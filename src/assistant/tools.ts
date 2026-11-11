import { LedgerError, Money, type Entry, type Ledger, type Preview } from '@/core';

/** A function tool in the shape the Responses API expects. */
export interface ToolDefinition {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict: false;
}

const text = (description: string) => ({ type: 'string', description });
const ids = (description: string) => ({ type: 'array', items: { type: 'string' }, description });

const ENTRY_FIELDS = {
  kind: { type: 'string', enum: ['income', 'expense', 'transfer'] },
  account_id: text('The account paid from or into; for a transfer, the account the money leaves'),
  destination_id: text('Transfers only: the account the money arrives in'),
  category_id: text('Income and expenses only: an existing category of the same kind'),
  amount: text('Positive decimal string such as "12.50", in `currency`'),
  currency: text("ISO code if it differs from the account's currency"),
  occurred_at: text('ISO 8601 date and time with offset, in the user\'s timezone'),
  note: text('Who was paid or who paid (the merchant or payer)'),
  description: text('Optional free-form context'),
  negative: { type: 'boolean', description: 'true for money back: reverses an income or expense' },
  refund_of_id: text('For money back on a specific purchase: that purchase\'s id (needs negative: true, kind: expense)'),
  rate: text('Optional exchange rate to use for another currency'),
  account_amount: text("Optional exact amount that reached the account, in the account's currency"),
};

const DEFINITIONS: ToolDefinition[] = [
  {
    type: 'function', strict: false, name: 'get_reference_data',
    description:
      'Accounts (with balances, types and groups), categories (with parents), credit card statement figures and the primary currency. Call this before proposing changes so you use real ids.',
    parameters: {
      type: 'object',
      properties: { include_archived: { type: 'boolean' } },
    },
  },
  {
    type: 'function', strict: false, name: 'search_transactions',
    description:
      'Find transactions by text and filters. Returns totals, a category breakdown of spending and income, and one page of transactions (newest first).',
    parameters: {
      type: 'object',
      properties: {
        text: text('Matches the payee/note and description'),
        start: text('Inclusive ISO 8601 start'),
        end: text('Exclusive ISO 8601 end'),
        account_ids: ids('Only these accounts'),
        category_ids: ids('Only these categories (a parent includes its subcategories)'),
        kinds: { type: 'array', items: { type: 'string', enum: ['income', 'expense', 'transfer'] } },
        min_amount: text('Decimal string'),
        max_amount: text('Decimal string'),
        deleted: { type: 'boolean', description: 'true to search the recycle bin instead' },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        offset: { type: 'integer', minimum: 0 },
      },
    },
  },
  {
    type: 'function', strict: false, name: 'get_transaction',
    description: 'One transaction in full, including the version needed to edit or delete it.',
    parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    type: 'function', strict: false, name: 'list_valuations',
    description: "A valued account's valuation history, oldest first, with ids and versions.",
    parameters: { type: 'object', properties: { account_id: { type: 'string' } }, required: ['account_id'] },
  },
  {
    type: 'function', strict: false, name: 'propose_changes',
    description:
      'Validate a batch of up to 50 changes and show it to the user as a proposal card with Approve and Discard buttons. Nothing is saved by this call: only the user can approve. If it returns problems, fix them and call it again.',
    parameters: {
      type: 'object',
      required: ['changes'],
      properties: {
        changes: {
          type: 'array', minItems: 1, maxItems: 50,
          items: {
            type: 'object',
            required: ['action'],
            properties: {
              action: {
                type: 'string',
                enum: ['create', 'edit', 'delete', 'restore', 'valuation', 'edit_valuation', 'delete_valuation'],
                description:
                  'create: a new transaction (give the transaction fields here). edit: id, version and `fields` with only what changes. delete/restore: id and version. valuation: account_id, amount, valued_at. edit_valuation: id, version, amount, valued_at. delete_valuation: id, version.',
              },
              id: { type: 'string' },
              version: { type: 'integer' },
              fields: { type: 'object', properties: ENTRY_FIELDS, description: 'For edit: only the fields to change' },
              valued_at: text('For valuations: ISO 8601 moment, normally the end of the day meant'),
              ...ENTRY_FIELDS,
            },
          },
        },
      },
    },
  },
];

const entryRecord = (entry: Entry) => ({
  id: entry.id,
  version: entry.version,
  kind: entry.kind,
  account_id: entry.account_id,
  account: entry.account_name,
  ...(entry.kind === 'transfer'
    ? { destination_id: entry.destination_id, destination: entry.destination_name }
    : { category_id: entry.category_id, category: [entry.parent_category_name, entry.category_name].filter(Boolean).join(' / ') }),
  amount: Money.plain(entry.amount_minor),
  currency: entry.currency,
  ...(entry.source_currency !== entry.currency
    ? { original_amount: Money.plain(entry.source_amount_minor), original_currency: entry.source_currency, rate: entry.applied_rate }
    : {}),
  occurred_at: entry.occurred_at,
  note: entry.note,
  ...(entry.description ? { description: entry.description } : {}),
  ...(entry.negative ? { negative: true } : {}),
  ...(entry.refund_of_id ? { refund_of_id: entry.refund_of_id } : {}),
  ...(entry.refunded_minor ? { refunded: Money.plain(entry.refunded_minor) } : {}),
  ...(entry.is_adjustment ? { balance_correction: true } : {}),
  ...(entry.deleted_at ? { deleted_at: entry.deleted_at } : {}),
});

type Args = Record<string, unknown>;

/**
 * What the assistant can do. Every tool is a thin adapter over the same services the
 * screens use. It can read, and it can put a proposal in front of the person; it has no
 * way to save anything itself.
 */
export class AssistantTools {
  static readonly definitions = DEFINITIONS;

  constructor(private ledger: Ledger, private onProposal: (preview: Preview) => void) {}

  /** Runs a tool call from the model. Its arguments are untrusted input. */
  call(name: string, rawArguments: string): unknown {
    try {
      const args = (rawArguments ? JSON.parse(rawArguments) : {}) as Args;
      switch (name) {
        case 'get_reference_data': return this.referenceData(args);
        case 'search_transactions': return this.search(args);
        case 'get_transaction': return entryRecord(this.ledger.entries.find(String(args.id)));
        case 'list_valuations': return this.valuations(String(args.account_id));
        case 'propose_changes': return this.propose(args);
        default: return { error: `Unknown tool ${name}` };
      }
    } catch (error) {
      if (error instanceof LedgerError) return { error: error.message };
      if (error instanceof SyntaxError) return { error: 'The arguments were not valid JSON' };
      // Anything else is a malformed request (a bad date, a wrong type). Every command is
      // atomic, so nothing was changed; the model is told so it can try again.
      return { error: 'The arguments were not valid. Check dates, ids and amounts, then try again.' };
    }
  }

  /** A short description of a call for the chat, such as "Searched transactions". */
  static label(name: string): string {
    return {
      get_reference_data: 'Looked at accounts and categories',
      search_transactions: 'Searched transactions',
      get_transaction: 'Looked at a transaction',
      list_valuations: 'Looked at valuations',
      propose_changes: 'Prepared a proposal',
    }[name] ?? name;
  }

  private referenceData(args: Args) {
    const { ledger } = this;
    const archived = !!args.include_archived;
    const groups = new Map(ledger.accounts.groups().map((group) => [group.id, group.name]));
    const primary = ledger.settings.primaryCurrency;
    const accounts = ledger.accounts.list({ archived });
    const categories = ledger.categories.list({ archived });
    const names = new Map(categories.map((category) => [category.id, category.name]));
    return {
      primary_currency: primary,
      month_starts_on_day: ledger.settings.monthStartDay,
      accounts: accounts.map((account) => {
        const card = ledger.cards.statement(account);
        return {
          id: account.id, name: account.name, group: groups.get(account.group_id), type: account.account_type,
          currency: account.currency, balance: Money.plain(account.balance),
          ...(account.archived ? { archived: true } : {}),
          ...(card
            ? { card: { payable: Money.plain(card.payable), outstanding: Money.plain(card.outstanding), payment_due_on: card.payment_due_on, payment_account_id: account.payment_account_id } }
            : {}),
        };
      }),
      totals: (({ assets, liabilities, total, ratesNeeded }) => ({
        assets: Money.plain(assets), liabilities: Money.plain(liabilities), total: Money.plain(total),
        ...(ratesNeeded.length ? { missing_rates_for: ratesNeeded } : {}),
      }))(ledger.accounts.totals(accounts.filter((account) => !account.archived), primary)),
      categories: categories.map((category) => ({
        id: category.id, name: category.name, kind: category.kind,
        ...(category.parent_id ? { parent: names.get(category.parent_id) } : {}),
        ...(category.archived ? { archived: true } : {}),
      })),
    };
  }

  private search(args: Args) {
    const amount = (value: unknown) => (value == null ? undefined : Money.parse(String(value)) ?? undefined);
    const list = (value: unknown) => (Array.isArray(value) ? value.map(String) : undefined);
    const filter = {
      text: args.text ? String(args.text) : undefined,
      start: args.start ? new Date(String(args.start)).toISOString() : undefined,
      end: args.end ? new Date(String(args.end)).toISOString() : undefined,
      account_ids: list(args.account_ids),
      category_ids: list(args.category_ids),
      kinds: list(args.kinds) as Entry['kind'][] | undefined,
      min_minor: amount(args.min_amount),
      max_minor: amount(args.max_amount),
      deleted: !!args.deleted,
    };
    const primary = this.ledger.settings.primaryCurrency;
    const totals = this.ledger.entries.totals(filter, primary);
    const breakdown = (kind: 'income' | 'expense') =>
      this.ledger.reports.byCategory(kind, filter, primary).categories.map((category) => ({
        category: category.name, total: Money.plain(category.total),
        ...(category.children.length
          ? { subcategories: category.children.map((child) => ({ category: child.name, total: Money.plain(child.total) })) }
          : {}),
      }));
    const limit = Math.min(Math.max(Number(args.limit) || 50, 1), 100);
    return {
      currency: primary,
      totals: { income: Money.plain(totals.income), expense: Money.plain(totals.expense), transfer: Money.plain(totals.transfer), count: totals.count },
      // The breakdown only applies to live entries on the filtered accounts.
      ...(filter.deleted ? {} : { spending_by_category: breakdown('expense'), income_by_category: breakdown('income') }),
      transactions: this.ledger.entries.search({ ...filter, limit, offset: Math.max(Number(args.offset) || 0, 0) }).map(entryRecord),
    };
  }

  private valuations(accountId: string) {
    const account = this.ledger.accounts.find(accountId);
    return {
      account: account.name, currency: account.currency,
      valuations: this.ledger.valuations.list(accountId).map((valuation) => ({
        id: valuation.id, version: valuation.version, valued_at: valuation.valued_at,
        amount: Money.plain(valuation.amount_minor), previous: Money.plain(valuation.previous_minor),
        change_not_from_money_moved: Money.plain(valuation.change_minor),
      })),
    };
  }

  private propose(args: Args) {
    const preview = this.ledger.changes.preview(args.changes);
    if (preview.problems.length) {
      return { shown_to_user: false, problems: preview.problems, hint: 'Fix these and propose again. Nothing was shown or saved.' };
    }
    this.onProposal(preview);
    return {
      shown_to_user: true,
      saved: false,
      changes: preview.lines,
      balances: preview.balances,
      possible_duplicates: preview.duplicates,
      next: 'The user now sees this proposal with Approve and Discard buttons. Tell them briefly what you proposed (mention possible duplicates) and that it needs their approval. Do not say it is saved.',
    };
  }
}
