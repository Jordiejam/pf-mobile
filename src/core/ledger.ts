import type { Account, AccountService } from './accounts';
import type { AuditLog } from './audit';
import type { Category, CategoryService } from './categories';
import { bool, LedgerError, notFound, stale, type SqlValue, type Store } from './db';
import type { RateService } from './fx';
import { isCurrency, Money, type Currency } from './money';

export type EntryKind = 'income' | 'expense' | 'transfer';

/** A stored transaction, with the names lists need. */
export interface Entry {
  id: string;
  kind: EntryKind;
  account_id: string;
  account_name: string;
  destination_id: string | null;
  destination_name: string | null;
  category_id: string | null;
  category_name: string | null;
  parent_category_name: string | null;
  /** What reached the account, in the account's currency. Always positive. */
  amount_minor: number;
  currency: Currency;
  /** What was paid, in the currency it was paid in. */
  source_amount_minor: number;
  source_currency: Currency;
  applied_rate: string;
  conversion_source: string;
  occurred_at: string;
  note: string;
  description: string;
  negative: number;
  is_adjustment: number;
  refund_of_id: string | null;
  /** Live refunds received on this purchase, in its currency. */
  refunded_minor: number;
  deleted_at: string | null;
  version: number;
}

/** What a person (or the assistant, or a schedule) supplies to record a transaction. */
export interface EntryInput {
  kind: EntryKind;
  account_id: string;
  destination_id?: string | null;
  category_id?: string | null;
  /** The amount paid, positive, in `currency`. */
  amount_minor: number;
  /** Defaults to the account's currency. */
  currency?: string | null;
  occurred_at: string;
  note?: string;
  description?: string;
  /** Money back: a negative expense credits the account, a negative income debits it. */
  negative?: boolean;
  refund_of_id?: string | null;
  /** For another currency: a rate to use in place of the stored one... */
  rate?: string | null;
  /** ...or exactly what reached the account. */
  account_amount_minor?: number | null;
  is_adjustment?: boolean;
}

export interface EntryFilter {
  text?: string;
  start?: string;
  end?: string;
  account_ids?: string[];
  category_ids?: string[];
  kinds?: EntryKind[];
  min_minor?: number;
  max_minor?: number;
  deleted?: boolean;
  exclude_adjustments?: boolean;
  limit?: number;
  offset?: number;
}

export interface EntryTotals {
  income: number;
  expense: number;
  transfer: number;
  count: number;
  ratesNeeded: string[];
}

const SELECT_ENTRY = `
  SELECT t.id, t.kind, t.account_id, a.name AS account_name, t.destination_id, d.name AS destination_name,
    t.category_id, c.name AS category_name, p.name AS parent_category_name,
    t.amount_minor, t.currency, t.source_amount_minor, t.source_currency, t.applied_rate,
    t.conversion_source, t.occurred_at, t.note, t.description, t.negative, t.is_adjustment,
    t.refund_of_id, t.deleted_at, t.version,
    COALESCE((SELECT SUM(r.amount_minor) FROM transactions r
      WHERE r.refund_of_id = t.id AND r.deleted_at IS NULL AND r.currency = t.currency), 0) AS refunded_minor
  FROM transactions t
  JOIN accounts a ON a.id = t.account_id
  LEFT JOIN accounts d ON d.id = t.destination_id
  LEFT JOIN categories c ON c.id = t.category_id
  LEFT JOIN categories p ON p.id = c.parent_id`;

const placeholders = (values: unknown[]) => values.map(() => '?').join(', ');

/**
 * Owns transactions and their effect on balances. Every way of recording money (the
 * editor, bookmarks, schedules, the assistant, balance corrections) goes through `save`,
 * so there is one set of rules.
 */
export class LedgerService {
  constructor(
    private store: Store,
    private audit: AuditLog,
    private accounts: AccountService,
    private categories: CategoryService,
    private rates: RateService,
  ) {}

  find(id: string): Entry {
    const entry = this.store.get<Entry>(`${SELECT_ENTRY} WHERE t.id = ?`, [id]);
    if (!entry) throw notFound('Transaction');
    return entry;
  }

  /** Records a new transaction, or replaces an existing one's details. */
  save(input: EntryInput, existing?: { id: string; version: number }): Entry {
    return this.store.atomic(() => {
      const before = existing ? this.find(existing.id) : null;
      if (before) {
        if (before.version !== existing!.version) throw stale('This transaction');
        if (before.deleted_at) throw new LedgerError('Restore this transaction before editing it');
      }
      const account = this.accounts.find(input.account_id);
      const posted = this.resolveAmounts(input, account, before);
      this.validate(input, account, before);

      const occurredAt = new Date(input.occurred_at);
      if (Number.isNaN(occurredAt.getTime())) throw new LedgerError('Enter a valid date and time');
      const transfer = input.kind === 'transfer';
      const fields: SqlValue[] = [
        input.kind, account.id, transfer ? input.destination_id! : null, transfer ? null : input.category_id!,
        posted.amount_minor, account.currency, posted.source_amount_minor, posted.source_currency,
        posted.applied_rate, posted.conversion_source, occurredAt.toISOString(),
        (input.note ?? '').trim().slice(0, 200), (input.description ?? '').trim().slice(0, 2000),
        bool(input.negative), bool(input.is_adjustment ?? before?.is_adjustment), input.refund_of_id ?? null,
      ];
      let id = before?.id;
      if (id) {
        this.store.run(
          `UPDATE transactions SET kind = ?, account_id = ?, destination_id = ?, category_id = ?,
             amount_minor = ?, currency = ?, source_amount_minor = ?, source_currency = ?, applied_rate = ?,
             conversion_source = ?, occurred_at = ?, note = ?, description = ?, negative = ?,
             is_adjustment = ?, refund_of_id = ?, version = version + 1
           WHERE id = ?`,
          [...fields, id],
        );
      } else {
        id = this.store.newId();
        this.store.run(
          `INSERT INTO transactions (kind, account_id, destination_id, category_id, amount_minor, currency,
             source_amount_minor, source_currency, applied_rate, conversion_source, occurred_at, note,
             description, negative, is_adjustment, refund_of_id, id, created_at)
           VALUES (${placeholders(fields)}, ?, ?)`,
          [...fields, id, this.store.nowIso()],
        );
      }
      this.post(id);
      const after = this.find(id);
      this.checkRefunds(after);
      this.audit.record('transaction', id, before ? 'edited' : 'created', before, after);
      return after;
    });
  }

  /**
   * Changes only the given fields of a transaction. The original amount and currency are
   * kept unless they are being changed, so a foreign entry is not revalued by accident.
   */
  patch(id: string, version: number, changes: Partial<EntryInput>): Entry {
    const current = this.inputOf(this.find(id));
    const keys = Object.keys(changes) as (keyof EntryInput)[];
    if (keys.every((key) => (changes[key] ?? null) === (current[key] ?? null))) {
      throw new LedgerError('That edit changes nothing');
    }
    const merged: EntryInput = { ...current, ...changes };
    if (merged.kind === 'transfer') merged.category_id = null;
    else merged.destination_id = null;
    return this.save(merged, { id, version });
  }

  private inputOf(entry: Entry): EntryInput {
    return {
      kind: entry.kind, account_id: entry.account_id, destination_id: entry.destination_id,
      category_id: entry.category_id, amount_minor: entry.source_amount_minor, currency: entry.source_currency,
      occurred_at: entry.occurred_at, note: entry.note, description: entry.description,
      negative: !!entry.negative, refund_of_id: entry.refund_of_id,
    };
  }

  /** Works out what reaches the account, converting from another currency if needed. */
  private resolveAmounts(input: EntryInput, account: Account, before: Entry | null) {
    const sourceCurrency = input.currency ?? account.currency;
    if (!isCurrency(sourceCurrency)) throw new LedgerError('Choose a supported currency');
    if (!Number.isSafeInteger(input.amount_minor) || input.amount_minor <= 0) {
      throw new LedgerError('Enter an amount above zero');
    }
    const source = { source_amount_minor: input.amount_minor, source_currency: sourceCurrency };
    if (sourceCurrency === account.currency) {
      return { ...source, amount_minor: input.amount_minor, applied_rate: '1', conversion_source: 'same_currency' };
    }
    if (input.kind === 'transfer') {
      throw new LedgerError('Transfers between currencies are not supported yet');
    }
    if (input.account_amount_minor != null) {
      if (!Number.isSafeInteger(input.account_amount_minor) || input.account_amount_minor <= 0) {
        throw new LedgerError('Enter the amount that reached the account');
      }
      return {
        ...source,
        amount_minor: input.account_amount_minor,
        applied_rate: Money.impliedRate(input.amount_minor, input.account_amount_minor),
        conversion_source: 'exact_amount',
      };
    }
    if (input.rate != null) {
      const rate = Money.rate(input.rate);
      if (!rate) throw new LedgerError('Enter a rate above zero, such as 1.17');
      return this.converted(source, rate, 'manual_rate');
    }
    // An edit that leaves the amount, currency and account alone keeps its saved conversion.
    if (before && before.source_amount_minor === input.amount_minor &&
        before.source_currency === sourceCurrency && before.account_id === account.id) {
      return { ...source, amount_minor: before.amount_minor, applied_rate: before.applied_rate, conversion_source: before.conversion_source };
    }
    const stored = this.rates.rate(sourceCurrency, account.currency);
    if (!stored) {
      throw new LedgerError(
        `No exchange rate from ${sourceCurrency} to ${account.currency}. Enter a rate or the exact amount that reached the account.`,
      );
    }
    return this.converted(source, stored.rate, `stored_${stored.source}`);
  }

  private converted(source: { source_amount_minor: number; source_currency: Currency }, rate: string, by: string) {
    const amount = Money.convert(source.source_amount_minor, rate);
    if (amount <= 0) throw new LedgerError('That amount converts to nothing in the account\'s currency');
    return { ...source, amount_minor: amount, applied_rate: rate, conversion_source: by };
  }

  private validate(input: EntryInput, account: Account, before: Entry | null) {
    if (account.archived && before?.account_id !== account.id) {
      throw new LedgerError(`${account.name} is archived`);
    }
    if (input.negative && input.kind === 'transfer') throw new LedgerError('A transfer cannot be negative');
    if (input.kind === 'transfer') {
      if (!input.destination_id || input.destination_id === account.id) {
        throw new LedgerError('Choose two different accounts for a transfer');
      }
      const destination = this.accounts.find(input.destination_id);
      if (destination.archived && before?.destination_id !== destination.id) {
        throw new LedgerError(`${destination.name} is archived`);
      }
      if (destination.currency !== account.currency) {
        throw new LedgerError('Transfers between currencies are not supported yet');
      }
    } else if (input.kind === 'income' || input.kind === 'expense') {
      if (!input.category_id) throw new LedgerError('Choose a category');
      const category: Category = this.categories.find(input.category_id);
      if (category.kind !== input.kind) throw new LedgerError(`${category.name} is not an ${input.kind} category`);
      if (category.archived && before?.category_id !== category.id) {
        throw new LedgerError(`${category.name} is archived`);
      }
    } else {
      throw new LedgerError('Choose income, expense or transfer');
    }
    if (input.refund_of_id) {
      if (input.kind !== 'expense' || !input.negative) throw new LedgerError('A refund must be money back on an expense');
      const purchase = this.find(input.refund_of_id);
      if (purchase.id === before?.id || purchase.kind !== 'expense' || purchase.negative) {
        throw new LedgerError('A refund must point at an ordinary purchase');
      }
    }
  }

  /**
   * Refunds in a purchase's own currency never add up to more than it cost, checked for
   * the entry just saved whether it is the refund or the purchase.
   */
  private checkRefunds(entry: Entry) {
    const purchase = entry.refund_of_id ? this.find(entry.refund_of_id) : entry;
    if (purchase === entry && entry.refunded_minor > 0 && (entry.kind !== 'expense' || entry.negative)) {
      throw new LedgerError('A purchase with refunds must stay an ordinary expense');
    }
    if (purchase.refunded_minor > purchase.amount_minor) {
      throw new LedgerError(
        `Refunds on ${purchase.note || 'this purchase'} would come to more than it cost ` +
          `(${Money.format(purchase.amount_minor, purchase.currency)})`,
      );
    }
  }

  /** Rewrites a live transaction's postings from its current state. */
  private post(id: string) {
    this.store.run('DELETE FROM postings WHERE transaction_id = ?', [id]);
    const row = this.store.get<Entry>('SELECT * FROM transactions WHERE id = ?', [id])!;
    if (row.deleted_at) return;
    const credits = (row.kind === 'income') !== !!row.negative;
    const postings: [string, number][] = [[row.account_id, credits ? row.amount_minor : -row.amount_minor]];
    if (row.kind === 'transfer') postings.push([row.destination_id!, row.amount_minor]);
    for (const [accountId, amount] of postings) {
      this.store.run(
        'INSERT INTO postings (transaction_id, account_id, amount_minor, occurred_at) VALUES (?, ?, ?, ?)',
        [id, accountId, amount, row.occurred_at],
      );
    }
  }

  /** Moves a transaction to the recycle bin, or brings it back with its ledger effect. */
  setDeleted(id: string, deleted: boolean, version: number): Entry {
    return this.store.atomic(() => {
      const before = this.find(id);
      if (before.version !== version) throw stale('This transaction');
      if (!!before.deleted_at === deleted) {
        throw new LedgerError(deleted ? 'This transaction is already in the recycle bin' : 'This transaction is not deleted');
      }
      this.store.run('UPDATE transactions SET deleted_at = ?, version = version + 1 WHERE id = ?', [
        deleted ? this.store.nowIso() : null, id,
      ]);
      this.post(id);
      const after = this.find(id);
      if (!deleted) this.checkRefunds(after);
      this.audit.record('transaction', id, deleted ? 'deleted' : 'restored', before, after);
      return after;
    });
  }

  /** Erases a transaction in the recycle bin for good. */
  purge(id: string) {
    this.store.atomic(() => {
      const entry = this.find(id);
      if (!entry.deleted_at) throw new LedgerError('Only transactions in the recycle bin can be erased');
      if (this.store.get('SELECT 1 FROM transactions WHERE refund_of_id = ?', [id])) {
        throw new LedgerError('Erase the refunds on this purchase first');
      }
      this.store.run('DELETE FROM schedule_occurrences WHERE transaction_id = ?', [id]);
      this.store.run('DELETE FROM transactions WHERE id = ?', [id]);
      this.audit.record('transaction', id, 'erased', entry, null);
    });
  }

  /**
   * Sets an account's balance by recording the difference as a tagged income or expense,
   * so the correction is visible, editable and reversible like any other entry.
   */
  correctBalance(accountId: string, targetMinor: number, accountVersion: number, occurredAt?: string): Entry | null {
    return this.store.atomic(() => {
      const account = this.accounts.find(accountId);
      if (account.version !== accountVersion) throw stale('This account');
      if (account.account_type === 'valued') {
        throw new LedgerError('A valued account is corrected by adding a valuation');
      }
      const difference = targetMinor - this.accounts.balance(account);
      if (difference === 0) return null;
      const kind = difference > 0 ? 'income' : 'expense';
      const entry = this.save({
        kind,
        account_id: accountId,
        category_id: this.categories.adjustmentCategory(kind).id,
        amount_minor: Math.abs(difference),
        occurred_at: occurredAt ?? this.store.nowIso(),
        note: 'Balance correction',
        is_adjustment: true,
      });
      // Bumping the version makes a second correction from the same stale screen fail.
      this.store.run('UPDATE accounts SET version = version + 1 WHERE id = ?', [accountId]);
      return entry;
    });
  }

  private where(filter: EntryFilter): { sql: string; params: SqlValue[] } {
    const where = [filter.deleted ? 't.deleted_at IS NOT NULL' : 't.deleted_at IS NULL'];
    const params: SqlValue[] = [];
    if (filter.text?.trim()) {
      where.push("(t.note LIKE ? ESCAPE '\\' OR t.description LIKE ? ESCAPE '\\')");
      const like = `%${filter.text.trim().replace(/[\\%_]/g, '\\$&')}%`;
      params.push(like, like);
    }
    if (filter.start) where.push('t.occurred_at >= ?'), params.push(filter.start);
    if (filter.end) where.push('t.occurred_at < ?'), params.push(filter.end);
    if (filter.account_ids?.length) {
      const marks = placeholders(filter.account_ids);
      where.push(`(t.account_id IN (${marks}) OR t.destination_id IN (${marks}))`);
      params.push(...filter.account_ids, ...filter.account_ids);
    }
    if (filter.category_ids?.length) {
      const ids = filter.category_ids.flatMap((id) => this.categories.withChildren(id));
      where.push(`t.category_id IN (${placeholders(ids)})`);
      params.push(...ids);
    }
    if (filter.kinds?.length) where.push(`t.kind IN (${placeholders(filter.kinds)})`), params.push(...filter.kinds);
    if (filter.min_minor != null) where.push('t.amount_minor >= ?'), params.push(filter.min_minor);
    if (filter.max_minor != null) where.push('t.amount_minor <= ?'), params.push(filter.max_minor);
    if (filter.exclude_adjustments) where.push('t.is_adjustment = 0');
    return { sql: `WHERE ${where.join(' AND ')}`, params };
  }

  /** Transactions matching a filter, newest first. */
  search(filter: EntryFilter = {}): Entry[] {
    const { sql, params } = this.where(filter);
    return this.store.all<Entry>(
      `${SELECT_ENTRY} ${sql} ORDER BY t.occurred_at DESC, t.created_at DESC, t.id LIMIT ? OFFSET ?`,
      [...params, filter.limit ?? 200, filter.offset ?? 0],
    );
  }

  /**
   * Income, spending and transfer totals for a filter, in the primary currency at
   * today's rates. Money back nets off its own kind rather than counting as the other.
   */
  totals(filter: EntryFilter, primary: Currency): EntryTotals {
    const { sql, params } = this.where(filter);
    const rows = this.store.all<{ kind: EntryKind; currency: string; total: number; count: number }>(
      `SELECT t.kind, t.currency, COUNT(*) AS count,
         SUM(CASE WHEN t.negative = 1 THEN -t.amount_minor ELSE t.amount_minor END) AS total
       FROM transactions t ${sql} GROUP BY t.kind, t.currency`,
      params,
    );
    const totals: EntryTotals = { income: 0, expense: 0, transfer: 0, count: 0, ratesNeeded: [] };
    for (const row of rows) {
      totals.count += row.count;
      const value = this.rates.convert(row.total, row.currency, primary);
      if (value === null) {
        if (!totals.ratesNeeded.includes(row.currency)) totals.ratesNeeded.push(row.currency);
      } else totals[row.kind] += value;
    }
    return totals;
  }

  /** Past payees containing some text: those starting with it first, most recent first. */
  payees(text: string, kind: EntryKind, limit = 5): { note: string; category_id: string | null; account_id: string }[] {
    const clean = text.trim().replace(/[\\%_]/g, '\\$&');
    if (!clean) return [];
    return this.store.all(
      `SELECT note, category_id, account_id FROM transactions t
       WHERE t.deleted_at IS NULL AND t.kind = ? AND t.note LIKE ? ESCAPE '\\'
         AND t.occurred_at = (SELECT MAX(o.occurred_at) FROM transactions o
           WHERE o.note = t.note AND o.kind = t.kind AND o.deleted_at IS NULL)
       GROUP BY note ORDER BY (note LIKE ? ESCAPE '\\') DESC, occurred_at DESC LIMIT ?`,
      [kind, `%${clean}%`, `${clean}%`, limit],
    );
  }

  /** The categories used most recently for a kind, for quick choices. */
  recentCategoryIds(kind: EntryKind, limit = 6): string[] {
    return this.store
      .all<{ category_id: string }>(
        `SELECT t.category_id FROM transactions t JOIN categories c ON c.id = t.category_id
         WHERE t.deleted_at IS NULL AND t.kind = ? AND t.is_adjustment = 0 AND c.archived = 0
         GROUP BY t.category_id ORDER BY MAX(t.occurred_at) DESC LIMIT ?`,
        [kind, limit],
      )
      .map((row) => row.category_id);
  }
}
