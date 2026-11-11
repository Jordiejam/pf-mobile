import type { Account, AccountService } from './accounts';
import type { AuditLog } from './audit';
import { LedgerError, notFound, stale, type Store } from './db';

export interface Valuation {
  id: string;
  account_id: string;
  valued_at: string;
  amount_minor: number;
  version: number;
}

export type ValuationWithChange = Valuation & {
  /** The balance this valuation replaced. */
  previous_minor: number;
  /** The change not explained by money moved in or out: growth or loss. */
  change_minor: number;
};

/**
 * What a Valued account (a pension, investment, property, loan) was worth at a moment.
 * A valuation is not a transaction, so a change in value is never income or spending.
 */
export class ValuationService {
  constructor(private store: Store, private audit: AuditLog, private accounts: AccountService) {}

  find(id: string): Valuation {
    const valuation = this.store.get<Valuation>('SELECT * FROM valuations WHERE id = ?', [id]);
    if (!valuation) throw notFound('Valuation');
    return valuation;
  }

  /** An account's valuations, oldest first, each with the balance it replaced. */
  list(accountId: string): ValuationWithChange[] {
    const account = this.accounts.find(accountId);
    const rows = this.store.all<Valuation>('SELECT * FROM valuations WHERE account_id = ? ORDER BY valued_at', [accountId]);
    return rows.map((row, index) => {
      const earlier = rows[index - 1];
      const previous =
        (earlier ? earlier.amount_minor : account.opening_minor) +
        this.accounts.posted(accountId, { after: earlier?.valued_at, upTo: row.valued_at });
      return { ...row, previous_minor: previous, change_minor: row.amount_minor - previous };
    });
  }

  private check(account: Account, amount: number, valuedAt: string, exceptId?: string) {
    if (account.account_type !== 'valued') throw new LedgerError(`${account.name} is not a valued account`);
    if (account.archived) throw new LedgerError(`${account.name} is archived`);
    if (!Number.isSafeInteger(amount)) throw new LedgerError('Enter a valid value');
    if (Number.isNaN(new Date(valuedAt).getTime())) throw new LedgerError('Enter a valid date');
    const clash = this.store.get<Valuation>('SELECT * FROM valuations WHERE account_id = ? AND valued_at = ?', [
      account.id, new Date(valuedAt).toISOString(),
    ]);
    if (clash && clash.id !== exceptId) throw new LedgerError('There is already a valuation at that moment');
  }

  create(accountId: string, amountMinor: number, valuedAt: string): Valuation {
    return this.store.atomic(() => {
      this.check(this.accounts.find(accountId), amountMinor, valuedAt);
      const id = this.store.newId();
      this.store.run('INSERT INTO valuations (id, account_id, valued_at, amount_minor) VALUES (?, ?, ?, ?)', [
        id, accountId, new Date(valuedAt).toISOString(), amountMinor,
      ]);
      const after = this.find(id);
      this.audit.record('valuation', id, 'created', null, after);
      return after;
    });
  }

  edit(id: string, version: number, amountMinor: number, valuedAt: string): Valuation {
    return this.store.atomic(() => {
      const before = this.find(id);
      if (before.version !== version) throw stale('This valuation');
      this.check(this.accounts.find(before.account_id), amountMinor, valuedAt, id);
      this.store.run('UPDATE valuations SET amount_minor = ?, valued_at = ?, version = version + 1 WHERE id = ?', [
        amountMinor, new Date(valuedAt).toISOString(), id,
      ]);
      const after = this.find(id);
      this.audit.record('valuation', id, 'edited', before, after);
      return after;
    });
  }

  delete(id: string, version: number) {
    this.store.atomic(() => {
      const before = this.find(id);
      if (before.version !== version) throw stale('This valuation');
      this.store.run('DELETE FROM valuations WHERE id = ?', [id]);
      this.audit.record('valuation', id, 'deleted', before, null);
    });
  }
}
