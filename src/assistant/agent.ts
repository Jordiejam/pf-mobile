import type { CommitResult, Ledger, Preview } from '@/core';
import { LedgerError } from '@/core';
import { AssistantError, type InputItem, type ResponsesClient } from './responses';
import { AssistantTools } from './tools';

export type ChatItem =
  | { id: number; type: 'user'; text: string }
  | { id: number; type: 'assistant'; text: string }
  | { id: number; type: 'activity'; text: string }
  | { id: number; type: 'error'; text: string }
  | {
      id: number;
      type: 'proposal';
      preview: Preview;
      status: 'pending' | 'saved' | 'discarded';
      result?: CommitResult;
      error?: string;
    };

const MAX_ROUNDS = 8;

function instructions(ledger: Ledger, now: Date): string {
  const offset = -now.getTimezoneOffset();
  const zone = `${offset < 0 ? '-' : '+'}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0')}:${String(Math.abs(offset) % 60).padStart(2, '0')}`;
  return `You are the assistant inside a personal finance app. The ledger lives only on the user's phone; you reach it through tools.

Now: ${now.toString()} (UTC offset ${zone}). Primary currency: ${ledger.settings.primaryCurrency}.

Recording money:
- The user often dictates a brain dump of several transactions. Work out each one: amount, payee, category, account and date. Infer sensibly from their wording and from past entries; ask only when something material is genuinely ambiguous (for example which account, when they have several likely ones).
- Call get_reference_data first so you use real account and category ids. Use existing categories only; never invent one. If nothing fits, use the closest and say so.
- Money moved between the user's own accounts (including paying a credit card) is a transfer, not income or spending.
- Money back uses negative: true on an expense. If you can find the purchase it refunds, set refund_of_id to it.
- Pensions, investments and other "valued" accounts change value through a valuation change, never through income or expenses. Use the end of the day meant.
- Dates: use the user's timezone and include the offset. "Yesterday lunch" means yesterday around 13:00.
- Put every change through propose_changes. It shows the user a card with Approve and Discard. You cannot save anything yourself, so never say something is saved, recorded or done; say you have proposed it. If the result lists possible duplicates, mention them.
- To edit or delete, find the transaction first (search_transactions or get_transaction) so you have its id and version.

Answering questions:
- Use search_transactions for spending and income questions; its totals and category breakdown are exact, so quote them rather than adding figures up yourself.
- Be brief and concrete. Amounts with currency symbols. No financial advice beyond what the data shows.

Messages starting with "[app]" are notes from the app about what the user did with a proposal, not something the user typed.`;
}

/**
 * One conversation with the model. It owns the chat's items and the exchange with the
 * API, runs the model's tool calls against the ledger, and applies a proposal only when
 * the person approves it.
 */
export class Assistant {
  items: ChatItem[] = [];
  busy = false;
  private history: InputItem[] = [];
  private listeners = new Set<() => void>();
  private nextId = 1;
  private abort: AbortController | null = null;
  private tools: AssistantTools;

  constructor(private ledger: Ledger) {
    this.tools = new AssistantTools(ledger, (preview) => this.add({ type: 'proposal', preview, status: 'pending' }));
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** A new array each change, so views re-render. */
  snapshot = () => this.items;

  private emit() {
    this.items = [...this.items];
    this.listeners.forEach((listener) => listener());
  }

  private add(item: ChatItem extends infer T ? (T extends ChatItem ? Omit<T, 'id'> : never) : never) {
    const added = { ...item, id: this.nextId++ } as ChatItem;
    this.items.push(added);
    this.emit();
    return added;
  }

  reset() {
    this.stop();
    this.items = [];
    this.history = [];
    this.emit();
  }

  stop() {
    this.abort?.abort();
  }

  /** Sends what the person said and lets the model work until it has answered. */
  async send(text: string, client: ResponsesClient, model: string) {
    if (this.busy || !text.trim()) return;
    this.busy = true;
    this.abort = new AbortController();
    this.add({ type: 'user', text: text.trim() });
    this.history.push({ role: 'user', content: text.trim() });
    const mark = this.history.length;
    try {
      for (let round = 0; round < MAX_ROUNDS; round += 1) {
        let bubble: Extract<ChatItem, { type: 'assistant' }> | null = null;
        const output = await client.respond(
          { model, instructions: instructions(this.ledger, this.ledger.store.now()), input: this.history, tools: AssistantTools.definitions },
          (delta) => {
            bubble ??= this.add({ type: 'assistant', text: '' }) as Extract<ChatItem, { type: 'assistant' }>;
            bubble.text += delta;
            this.emit();
          },
          this.abort.signal,
        );
        this.history.push(...output);
        const calls = output.filter((item) => item.type === 'function_call');
        if (calls.length === 0) return;
        for (const call of calls) {
          this.add({ type: 'activity', text: AssistantTools.label(call.name) });
          const result = this.tools.call(call.name, call.arguments);
          this.history.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(result) });
        }
      }
      this.add({ type: 'error', text: 'That took too many steps. Try asking for less at once.' });
    } catch (error) {
      // Keep what the person said but drop the unfinished turn's partial exchange.
      this.history.length = mark;
      if (this.abort.signal.aborted) this.add({ type: 'activity', text: 'Stopped' });
      else if (error instanceof AssistantError) this.add({ type: 'error', text: error.message });
      else this.add({ type: 'error', text: 'Something went wrong talking to the assistant.' });
    } finally {
      this.busy = false;
      this.abort = null;
      this.emit();
    }
  }

  /** The person's tap: saves a proposal exactly as it was shown. */
  approve(id: number) {
    const item = this.items.find((entry) => entry.id === id);
    if (item?.type !== 'proposal' || item.status !== 'pending' || !item.preview.preview_id) return;
    try {
      item.result = this.ledger.changes.commit(item.preview.preview_id);
      item.status = 'saved';
      item.error = undefined;
      this.note('The user approved the proposal and it was saved.');
    } catch (error) {
      if (!(error instanceof LedgerError)) throw error;
      item.error = error.message;
      item.status = 'discarded';
      this.note(`The user approved the proposal but it could not be saved: ${error.message}`);
    }
    this.emit();
  }

  discard(id: number) {
    const item = this.items.find((entry) => entry.id === id);
    if (item?.type !== 'proposal' || item.status !== 'pending') return;
    item.status = 'discarded';
    this.note('The user discarded the proposal. Nothing was saved.');
    this.emit();
  }

  /** Tells the model, on its next turn, what happened to a proposal. */
  private note(text: string) {
    this.history.push({ role: 'user', content: `[app] ${text}` });
  }
}
