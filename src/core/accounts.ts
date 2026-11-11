import type { AuditLog } from './audit';
import { bool, LedgerError, notFound, stale, type Store } from './db';
import type { RateService } from './fx';
import { isCurrency, type Currency } from './money';

export type AccountType = 'standard' | 'credit_card' | 'valued';

export interface Group {
  id: string;
  name: string;
  position: number;
}

export interface Account {
  id: string;
  group_id: string;
  name: string;
  account_type: AccountType;
  currency: Currency;
  opening_minor: number;
  archived: number;
  in_net_worth: number;
  position: number;
  statement_day: number | null;
  due_day: number | null;
  payment_account_id: string | null;
  created_at: string;
  version: number;
}

export type AccountWithBalance = Account & { balance: number };

export interface AccountInput {
  name: string;
  group_id: string;
  account_type: AccountType;
  currency: string;
  opening_minor: number;
  in_net_worth?: boolean | number;
  statement_day?: number | null;
  due_day?: number | null;
  payment_account_id?: string | null;
}

export interface Totals {
  assets: number;
  liabilities: number;
  total: number;
  /** Currencies that could not be converted; the figures leave those accounts out. */
  ratesNeeded: string[];
}

/** Owns accounts, the groups that organise them, and their balances. */
export class AccountService {
  constructor(private store: Store, private audit: AuditLog, private rates: RateService) {}

  // Groups only organise accounts; they carry no behaviour.

  groups(): Group[] {
    return this.store.all<Group>('SELECT * FROM account_groups ORDER BY position, name');
  }

  saveGroup(name: string, id?: string): Group {
    const clean = name.trim();
    if (!clean) throw new LedgerError('Give the group a name');
    return this.store.atomic(() => {
      const clash = this.store.get<Group>('SELECT * FROM account_groups WHERE name = ? COLLATE NOCASE', [clean]);
      if (clash && clash.id !== id) throw new LedgerError('There is already a group with that name');
      if (id) {
        this.store.run('UPDATE account_groups SET name = ? WHERE id = ?', [clean, id]);
      } else {
        id = this.store.newId();
        const next = this.store.get<{ next: number }>('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM account_groups')!;
        this.store.run('INSERT INTO account_groups (id, name, position) VALUES (?, ?, ?)', [id, clean, next.next]);
      }
      return this.store.get<Group>('SELECT * FROM account_groups WHERE id = ?', [id])!;
    });
  }

  deleteGroup(id: string) {
    this.store.atomic(() => {
      if (this.store.get('SELECT 1 FROM accounts WHERE group_id = ?', [id])) {
        throw new LedgerError('Move or delete the accounts in this group first');
      }
      this.store.run('DELETE FROM account_groups WHERE id = ?', [id]);
    });
  }

  // Accounts

  find(id: string): Account {
    const account = this.store.get<Account>('SELECT * FROM accounts WHERE id = ?', [id]);
    if (!account) throw notFound('Account');
    return account;
  }

  list(options: { archived?: boolean } = {}): AccountWithBalance[] {
    const accounts = this.store.all<Account>(
      `SELECT a.* FROM accounts a JOIN account_groups g ON g.id = a.group_id
       ${options.archived ? '' : 'WHERE a.archived = 0'}
       ORDER BY g.position, g.name, a.position, a.name`,
    );
    return accounts.map((account) => ({ ...account, balance: this.balance(account) }));
  }

  get(id: string): AccountWithBalance {
    const account = this.find(id);
    return { ...account, balance: this.balance(account) };
  }

  /**
   * What an account holds, now or at the end of a moment. A valued account is worth its
   * latest valuation plus whatever was posted after it; a valuation covers every posting
   * at or before its own moment.
   */
  balance(account: Account, upTo?: string): number {
    const valuation =
      account.account_type === 'valued'
        ? this.store.get<{ valued_at: string; amount_minor: number }>(
            `SELECT valued_at, amount_minor FROM valuations
             WHERE account_id = ? AND (? IS NULL OR valued_at <= ?) ORDER BY valued_at DESC LIMIT 1`,
            [account.id, upTo ?? null, upTo ?? null],
          )
        : undefined;
    return (
      (valuation ? valuation.amount_minor : account.opening_minor) +
      this.posted(account.id, { after: valuation?.valued_at, upTo })
    );
  }

  /** The sum of an account's postings within optional bounds. */
  posted(accountId: string, bounds: { after?: string; upTo?: string; before?: string } = {}): number {
    const where = ['account_id = ?'];
    const params: string[] = [accountId];
    if (bounds.after) where.push('occurred_at > ?'), params.push(bounds.after);
    if (bounds.upTo) where.push('occurred_at <= ?'), params.push(bounds.upTo);
    if (bounds.before) where.push('occurred_at < ?'), params.push(bounds.before);
    return this.store.get<{ total: number }>(
      `SELECT COALESCE(SUM(amount_minor), 0) AS total FROM postings WHERE ${where.join(' AND ')}`,
      params,
    )!.total;
  }

  save(input: AccountInput, existing?: { id: string; version: number }): Account {
    return this.store.atomic(() => {
      const before = existing ? this.find(existing.id) : null;
      if (before && before.version !== existing!.version) throw stale('This account');
      const name = input.name.trim();
      if (!name) throw new LedgerError('Give the account a name');
      if (!isCurrency(input.currency)) throw new LedgerError('Choose a supported currency');
      if (!Number.isSafeInteger(input.opening_minor)) throw new LedgerError('Enter a valid opening balance');
      if (!this.store.get('SELECT 1 FROM account_groups WHERE id = ?', [input.group_id])) {
        throw new LedgerError('Choose a group for the account');
      }
      if (before) this.checkConversion(before, input);
      const card = this.cardSettings(input, before);
      const fields = [
        input.group_id, name, input.account_type, input.currency, input.opening_minor,
        bool(input.in_net_worth ?? before?.in_net_worth ?? true),
        card.statement_day, card.due_day, card.payment_account_id,
      ];
      let id = before?.id;
      if (id) {
        this.store.run(
          `UPDATE accounts SET group_id = ?, name = ?, account_type = ?, currency = ?, opening_minor = ?,
             in_net_worth = ?, statement_day = ?, due_day = ?, payment_account_id = ?, version = version + 1
           WHERE id = ?`,
          [...fields, id],
        );
      } else {
        id = this.store.newId();
        this.store.run(
          `INSERT INTO accounts (group_id, name, account_type, currency, opening_minor, in_net_worth,
             statement_day, due_day, payment_account_id, id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [...fields, id, this.store.nowIso()],
        );
        // A new account joins the saved views that include new accounts automatically.
        this.store.run(
          'INSERT INTO view_selections (view_id, account_id, included) SELECT id, ?, include_new FROM account_views',
          [id],
        );
      }
      const after = this.find(id);
      this.audit.record('account', id, before ? 'edited' : 'created', before, after);
      return after;
    });
  }

  private checkConversion(before: Account, input: AccountInput) {
    if (before.account_type !== input.account_type) {
      if (before.account_type === 'credit_card' || input.account_type === 'credit_card') {
        throw new LedgerError('An account cannot be changed to or from a credit card');
      }
      if (before.account_type === 'valued' && this.store.get('SELECT 1 FROM valuations WHERE account_id = ?', [before.id])) {
        throw new LedgerError('Delete this account\'s valuations before changing its type');
      }
    }
    if (before.currency !== input.currency && this.store.get('SELECT 1 FROM postings WHERE account_id = ?', [before.id])) {
      throw new LedgerError('An account with transactions keeps its currency');
    }
  }

  private cardSettings(input: AccountInput, before: Account | null) {
    if (input.account_type !== 'credit_card') {
      return { statement_day: null, due_day: null, payment_account_id: null };
    }
    const { statement_day, due_day, payment_account_id = null } = input;
    const validDay = (day: unknown) => Number.isInteger(day) && (day as number) >= 1 && (day as number) <= 31;
    if (!validDay(statement_day) || !validDay(due_day)) {
      throw new LedgerError('Credit cards need a statement day and a payment due day (1 to 31)');
    }
    if (payment_account_id) {
      const payer = this.store.get<Account>('SELECT * FROM accounts WHERE id = ?', [payment_account_id]);
      const kept = before?.payment_account_id === payment_account_id;
      if (!payer || payer.id === before?.id || payer.account_type !== 'standard' ||
          payer.currency !== input.currency || (payer.archived && !kept)) {
        throw new LedgerError("Pay from an active Standard account in the card's currency");
      }
    }
    return { statement_day: statement_day!, due_day: due_day!, payment_account_id };
  }

  setArchived(id: string, archived: boolean) {
    this.store.atomic(() => {
      const before = this.find(id);
      this.store.run('UPDATE accounts SET archived = ?, version = version + 1 WHERE id = ?', [bool(archived), id]);
      this.audit.record('account', id, archived ? 'archived' : 'unarchived', before, this.find(id));
    });
  }

  /** Deletes an account that has never been used; used ones are archived instead. */
  delete(id: string) {
    this.store.atomic(() => {
      const before = this.find(id);
      const used =
        this.store.get('SELECT 1 FROM transactions WHERE account_id = ? OR destination_id = ?', [id, id]) ||
        this.store.get('SELECT 1 FROM valuations WHERE account_id = ?', [id]) ||
        this.store.get('SELECT 1 FROM accounts WHERE payment_account_id = ?', [id]);
      if (used) throw new LedgerError('This account has history, so it can be archived but not deleted');
      this.store.run('DELETE FROM view_selections WHERE account_id = ?', [id]);
      this.store.run('DELETE FROM accounts WHERE id = ?', [id]);
      this.audit.record('account', id, 'deleted', before, null);
    });
  }

  /** Assets, liabilities and their total in the primary currency, at today's rates. */
  totals(accounts: AccountWithBalance[], primary: Currency): Totals {
    const totals: Totals = { assets: 0, liabilities: 0, total: 0, ratesNeeded: [] };
    for (const account of accounts) {
      const value = this.rates.convert(account.balance, account.currency, primary);
      if (value === null) {
        if (!totals.ratesNeeded.includes(account.currency)) totals.ratesNeeded.push(account.currency);
      } else if (value >= 0) totals.assets += value;
      else totals.liabilities += value;
    }
    totals.total = totals.assets + totals.liabilities;
    return totals;
  }
}
