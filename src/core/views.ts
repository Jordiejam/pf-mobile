import { bool, LedgerError, notFound, type Store } from './db';

export interface AccountView {
  id: string;
  name: string;
  include_new: number;
  position: number;
}

/**
 * Saved account views: named selections of accounts with their own totals. Home (every
 * active account) is permanent and is not stored. A view never affects the ledger.
 */
export class ViewService {
  constructor(private store: Store) {}

  list(): AccountView[] {
    return this.store.all<AccountView>('SELECT * FROM account_views ORDER BY position, name');
  }

  /** The accounts a view includes. Archived accounts count only where explicitly chosen. */
  accountIds(viewId: string): string[] {
    return this.store
      .all<{ account_id: string }>('SELECT account_id FROM view_selections WHERE view_id = ? AND included = 1', [viewId])
      .map((row) => row.account_id);
  }

  save(input: { name: string; include_new: boolean; account_ids: string[] }, id?: string): AccountView {
    const name = input.name.trim();
    if (!name) throw new LedgerError('Give the view a name');
    return this.store.atomic(() => {
      const clash = this.store.get<AccountView>('SELECT * FROM account_views WHERE name = ? COLLATE NOCASE', [name]);
      if (clash && clash.id !== id) throw new LedgerError('There is already a view with that name');
      if (id) {
        if (!this.store.get('SELECT 1 FROM account_views WHERE id = ?', [id])) throw notFound('View');
        this.store.run('UPDATE account_views SET name = ?, include_new = ? WHERE id = ?', [name, bool(input.include_new), id]);
        this.store.run('DELETE FROM view_selections WHERE view_id = ?', [id]);
      } else {
        id = this.store.newId();
        const { next } = this.store.get<{ next: number }>('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM account_views')!;
        this.store.run('INSERT INTO account_views (id, name, include_new, position) VALUES (?, ?, ?, ?)', [
          id, name, bool(input.include_new), next,
        ]);
      }
      // Every existing account gets an explicit yes or no, so include_new only ever
      // decides accounts created later.
      const chosen = new Set(input.account_ids);
      for (const { id: accountId } of this.store.all<{ id: string }>('SELECT id FROM accounts')) {
        this.store.run('INSERT INTO view_selections (view_id, account_id, included) VALUES (?, ?, ?)', [
          id, accountId, bool(chosen.has(accountId)),
        ]);
      }
      return this.store.get<AccountView>('SELECT * FROM account_views WHERE id = ?', [id])!;
    });
  }

  delete(id: string) {
    this.store.atomic(() => this.store.run('DELETE FROM account_views WHERE id = ?', [id]));
  }
}
