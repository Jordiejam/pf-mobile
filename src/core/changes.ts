import type { AccountService } from './accounts';
import type { AuditLog } from './audit';
import { json, LedgerError, type Store } from './db';
import type { Entry, EntryInput, LedgerService } from './ledger';
import { Money } from './money';
import { dayLabel } from './time';
import type { Valuation, ValuationService } from './valuations';

/** A change proposed from outside the editor. Amounts are decimal strings such as "12.50". */
export type Change =
  | ({ action: 'create' } & EntryFields)
  | { action: 'edit'; id: string; version: number; fields: Partial<EntryFields> }
  | { action: 'delete' | 'restore'; id: string; version: number }
  | { action: 'valuation'; account_id: string; amount: string; valued_at: string }
  | { action: 'edit_valuation'; id: string; version: number; amount: string; valued_at: string }
  | { action: 'delete_valuation'; id: string; version: number };

export interface EntryFields {
  kind: 'income' | 'expense' | 'transfer';
  account_id: string;
  destination_id?: string | null;
  category_id?: string | null;
  amount: string;
  currency?: string | null;
  occurred_at: string;
  note?: string;
  description?: string;
  negative?: boolean;
  refund_of_id?: string | null;
  rate?: string | null;
  account_amount?: string | null;
}

export interface ChangeLine {
  action: Change['action'];
  /** For example "Tesco · Groceries". */
  title: string;
  /** For example "Current account · Wed 11 Nov". */
  detail: string;
  /** Signed, formatted: "−£12.50". */
  amount: string;
  /** For edits: what it was before. */
  was?: string;
}

export interface BalanceEffect {
  account_id: string;
  name: string;
  before: string;
  after: string;
}

export interface Preview {
  preview_id: string | null;
  problems: { index: number; message: string }[];
  lines: ChangeLine[];
  balances: BalanceEffect[];
  /** Existing entries that look like ones being created. */
  duplicates: { index: number; existing: string }[];
  expires_at: string | null;
}

export interface CommitResult {
  saved: ChangeLine[];
  balances: BalanceEffect[];
}

const MAX_CHANGES = 50;
const PREVIEW_MINUTES = 30;

type Applied = { line: ChangeLine; fingerprint: unknown };

/**
 * Preview then commit, for changes that arrive from the assistant. A preview runs the
 * real ledger commands and undoes them, so it applies exactly the rules a save would. A
 * commit replays the stored batch all-or-nothing and refuses if the outcome would differ
 * from what was shown. The assistant can only preview; committing takes the person's tap.
 */
export class ChangeService {
  constructor(
    private store: Store,
    private audit: AuditLog,
    private ledger: LedgerService,
    private valuations: ValuationService,
    private accounts: AccountService,
  ) {}

  preview(changes: unknown): Preview {
    if (!Array.isArray(changes) || changes.length === 0) throw new LedgerError('Send at least one change');
    if (changes.length > MAX_CHANGES) throw new LedgerError(`Send at most ${MAX_CHANGES} changes at a time`);
    const preview: Preview = { preview_id: null, problems: [], lines: [], balances: [], duplicates: [], expires_at: null };
    const fingerprints: unknown[] = [];
    this.store.dryRun(() => {
      const before = this.balances();
      changes.forEach((change, index) => {
        try {
          const duplicate = this.duplicateOf(change);
          // Each change has its own savepoint, so one problem does not hide the others.
          const applied = this.store.atomic(() => this.apply(change));
          preview.lines.push(applied.line);
          fingerprints.push(applied.fingerprint);
          if (duplicate) preview.duplicates.push({ index, existing: duplicate });
        } catch (error) {
          if (!(error instanceof LedgerError)) throw error;
          preview.problems.push({ index, message: error.message });
        }
      });
      preview.balances = this.effects(before);
    });
    if (preview.problems.length) return { ...preview, lines: [], balances: [] };

    // Outside the dry run, so the stored preview survives it.
    const id = this.store.newId();
    const expires = new Date(this.store.now().getTime() + PREVIEW_MINUTES * 60_000).toISOString();
    this.store.atomic(() => {
      this.store.run('DELETE FROM change_previews WHERE expires_at < ? AND result IS NULL', [this.store.nowIso()]);
      this.store.run('INSERT INTO change_previews (id, changes, effects, summary, expires_at) VALUES (?, ?, ?, ?, ?)', [
        id, json(changes), json({ fingerprints, balances: preview.balances }), json(preview.lines), expires,
      ]);
    });
    return { ...preview, preview_id: id, expires_at: expires };
  }

  /** Saves a previewed batch exactly as previewed. Committing twice saves once. */
  commit(previewId: string): CommitResult {
    const row = this.store.get<{ changes: string; effects: string; expires_at: string; result: string | null }>(
      'SELECT * FROM change_previews WHERE id = ?',
      [previewId],
    );
    if (!row) throw new LedgerError('That proposal no longer exists. Ask for it again.', 'not_found');
    if (row.result) return JSON.parse(row.result);
    if (row.expires_at < this.store.nowIso()) throw new LedgerError('That proposal has expired. Ask for it again.');
    const expected = row.effects;
    return this.store.atomic(() => {
      const before = this.balances();
      const applied = this.audit.via('assistant', () => (JSON.parse(row.changes) as unknown[]).map((change) => this.apply(change)));
      const result: CommitResult = { saved: applied.map((item) => item.line), balances: this.effects(before) };
      const actual = json({ fingerprints: applied.map((item) => item.fingerprint), balances: result.balances });
      if (actual !== expected) {
        throw new LedgerError('Something changed since this was proposed, so nothing was saved. Ask for it again.', 'stale');
      }
      this.store.run('UPDATE change_previews SET result = ? WHERE id = ?', [json(result), previewId]);
      return result;
    });
  }

  private balances(): Map<string, { name: string; currency: string; balance: number }> {
    return new Map(this.accounts.list({ archived: true }).map((account) => [account.id, account]));
  }

  private effects(before: ReturnType<ChangeService['balances']>): BalanceEffect[] {
    const effects: BalanceEffect[] = [];
    for (const [id, after] of this.balances()) {
      const was = before.get(id)?.balance ?? 0;
      if (was !== after.balance) {
        effects.push({
          account_id: id, name: after.name,
          before: Money.format(was, after.currency), after: Money.format(after.balance, after.currency),
        });
      }
    }
    return effects;
  }

  /** Runs one change through the same commands the app uses. */
  private apply(raw: unknown): Applied {
    const change = raw as Change;
    switch (change?.action) {
      case 'create':
        return this.entryResult('create', this.ledger.save(ChangeService.entryInput(change)));
      case 'edit': {
        const was = this.ledger.find(String(change.id));
        const entry = this.ledger.patch(was.id, Number(change.version), ChangeService.partialInput(change.fields ?? {}));
        return this.entryResult('edit', entry, ChangeService.describe(was));
      }
      case 'delete':
      case 'restore':
        return this.entryResult(change.action, this.ledger.setDeleted(String(change.id), change.action === 'delete', Number(change.version)));
      case 'valuation':
        return this.valuationResult('valuation', this.valuations.create(String(change.account_id), ChangeService.amount(change.amount, true), change.valued_at));
      case 'edit_valuation': {
        const was = this.valuations.find(String(change.id));
        const account = this.accounts.find(was.account_id);
        return this.valuationResult(
          'edit_valuation',
          this.valuations.edit(was.id, Number(change.version), ChangeService.amount(change.amount, true), change.valued_at),
          Money.format(was.amount_minor, account.currency),
        );
      }
      case 'delete_valuation': {
        const was = this.valuations.find(String(change.id));
        this.valuations.delete(was.id, Number(change.version));
        return this.valuationResult('delete_valuation', was);
      }
      default:
        throw new LedgerError('Unknown kind of change');
    }
  }

  private static amount(text: unknown, allowNegative = false): number {
    const minor = typeof text === 'string' || typeof text === 'number' ? Money.parse(String(text)) : null;
    if (minor === null || (!allowNegative && minor <= 0)) {
      throw new LedgerError(`"${String(text)}" is not a valid amount; use a positive number with at most two decimal places`);
    }
    return minor;
  }

  private static partialInput(fields: Partial<EntryFields>): Partial<EntryInput> {
    const { amount, account_amount, ...rest } = fields;
    const input: Partial<EntryInput> = { ...rest };
    if (amount !== undefined) input.amount_minor = ChangeService.amount(amount);
    if (account_amount != null) input.account_amount_minor = ChangeService.amount(account_amount);
    return input;
  }

  private static entryInput(fields: EntryFields): EntryInput {
    const input = ChangeService.partialInput(fields);
    if (!input.kind || !input.account_id || input.amount_minor === undefined || !input.occurred_at) {
      throw new LedgerError('A new transaction needs kind, account_id, amount and occurred_at');
    }
    return input as EntryInput;
  }

  static describe(entry: Entry): string {
    return `${ChangeService.signed(entry)} ${ChangeService.title(entry)} (${entry.account_name}, ${dayLabel(new Date(entry.occurred_at))})`;
  }

  private static signed(entry: Entry): string {
    const credits = (entry.kind === 'income') !== !!entry.negative;
    const amount = entry.kind === 'transfer' || credits ? entry.amount_minor : -entry.amount_minor;
    return Money.format(amount, entry.currency);
  }

  private static title(entry: Entry): string {
    if (entry.kind === 'transfer') return `Transfer to ${entry.destination_name}`;
    return [entry.note, entry.category_name].filter(Boolean).join(' · ') || entry.kind;
  }

  private entryResult(action: Change['action'], entry: Entry, was?: string): Applied {
    return {
      line: {
        action,
        title: ChangeService.title(entry),
        detail: `${entry.account_name} · ${dayLabel(new Date(entry.occurred_at))}`,
        amount: ChangeService.signed(entry),
        was,
      },
      // Everything that must match between preview and commit; never the new ID.
      fingerprint: [
        entry.kind, entry.account_id, entry.destination_id, entry.category_id, entry.amount_minor,
        entry.source_amount_minor, entry.source_currency, entry.occurred_at, entry.note, entry.description,
        entry.negative, entry.refund_of_id, !!entry.deleted_at,
      ],
    };
  }

  private valuationResult(action: Change['action'], valuation: Valuation, was?: string): Applied {
    const account = this.accounts.find(valuation.account_id);
    return {
      line: {
        action,
        title: `${account.name} valued`,
        detail: dayLabel(new Date(valuation.valued_at)),
        amount: Money.format(valuation.amount_minor, account.currency),
        was,
      },
      fingerprint: [action, valuation.account_id, valuation.amount_minor, valuation.valued_at],
    };
  }

  /** An existing entry of the same kind, account and amount within a day either side. */
  private duplicateOf(raw: unknown): string | null {
    const change = raw as Change;
    if (change?.action !== 'create') return null;
    const amount = Money.parse(String(change.amount));
    const moment = new Date(change.occurred_at).getTime();
    if (amount === null || Number.isNaN(moment)) return null;
    const day = 24 * 3600 * 1000;
    const match = this.ledger
      .search({
        kinds: [change.kind], account_ids: [String(change.account_id)],
        start: new Date(moment - day).toISOString(), end: new Date(moment + day).toISOString(),
      })
      .find((entry) => entry.source_amount_minor === amount && entry.account_id === change.account_id);
    return match ? ChangeService.describe(match) : null;
  }
}
