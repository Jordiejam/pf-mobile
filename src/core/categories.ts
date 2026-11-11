import type { AuditLog } from './audit';
import { bool, LedgerError, notFound, stale, type Store } from './db';

export type CategoryKind = 'income' | 'expense';

export interface Category {
  id: string;
  name: string;
  kind: CategoryKind;
  parent_id: string | null;
  archived: number;
  position: number;
  system_key: string | null;
  version: number;
}

export interface CategoryInput {
  name: string;
  kind: CategoryKind;
  parent_id?: string | null;
}

/**
 * Owns the two category trees (income and expense), each a parent level and one child
 * level. Transactions refer to categories by ID, so renaming or moving one reorganises
 * past reports without rewriting any transaction.
 */
export class CategoryService {
  constructor(private store: Store, private audit: AuditLog) {}

  list(options: { kind?: CategoryKind; archived?: boolean } = {}): Category[] {
    const where: string[] = [];
    const params: string[] = [];
    if (options.kind) where.push('c.kind = ?'), params.push(options.kind);
    // Archiving a parent hides its children from new-entry choices too.
    if (!options.archived) where.push('c.archived = 0 AND COALESCE(p.archived, 0) = 0');
    return this.store.all<Category>(
      `SELECT c.* FROM categories c LEFT JOIN categories p ON p.id = c.parent_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY c.kind, COALESCE(p.position, c.position), COALESCE(p.name, c.name),
         c.parent_id IS NOT NULL, c.position, c.name`,
      params,
    );
  }

  find(id: string): Category {
    const category = this.store.get<Category>('SELECT * FROM categories WHERE id = ?', [id]);
    if (!category) throw notFound('Category');
    return category;
  }

  /** A category's own ID plus its children's, for filtering by a parent. */
  withChildren(id: string): string[] {
    return [id, ...this.store.all<{ id: string }>('SELECT id FROM categories WHERE parent_id = ?', [id]).map((row) => row.id)];
  }

  save(input: CategoryInput, existing?: { id: string; version: number }): Category {
    return this.store.atomic(() => {
      const before = existing ? this.find(existing.id) : null;
      if (before && before.version !== existing!.version) throw stale('This category');
      const name = input.name.trim();
      if (!name) throw new LedgerError('Give the category a name');
      if (before && before.kind !== input.kind) throw new LedgerError('A category keeps its transaction type');
      const parentId = input.parent_id ?? null;
      if (parentId) {
        const parent = this.find(parentId);
        if (parent.id === before?.id || parent.parent_id || parent.kind !== input.kind || parent.archived) {
          throw new LedgerError('Choose an active top-level parent of the same transaction type');
        }
        if (before && this.store.get('SELECT 1 FROM categories WHERE parent_id = ?', [before.id])) {
          throw new LedgerError('A category containing subcategories must remain a parent');
        }
      }
      const clash = this.store.get<Category>(
        'SELECT * FROM categories WHERE kind = ? AND name = ? COLLATE NOCASE AND parent_id IS ?',
        [input.kind, name, parentId],
      );
      if (clash && clash.id !== before?.id) throw new LedgerError('There is already a category with that name here');
      let id = before?.id;
      if (id) {
        this.store.run('UPDATE categories SET name = ?, parent_id = ?, version = version + 1 WHERE id = ?', [name, parentId, id]);
      } else {
        id = this.store.newId();
        const { next } = this.store.get<{ next: number }>(
          'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM categories WHERE kind = ? AND parent_id IS ?',
          [input.kind, parentId],
        )!;
        this.store.run('INSERT INTO categories (id, name, kind, parent_id, position) VALUES (?, ?, ?, ?, ?)', [
          id, name, input.kind, parentId, next,
        ]);
      }
      const after = this.find(id);
      this.audit.record('category', id, before ? 'edited' : 'created', before, after);
      return after;
    });
  }

  setArchived(id: string, archived: boolean) {
    this.store.atomic(() => {
      const before = this.find(id);
      this.store.run('UPDATE categories SET archived = ?, version = version + 1 WHERE id = ?', [bool(archived), id]);
      this.audit.record('category', id, archived ? 'archived' : 'unarchived', before, this.find(id));
    });
  }

  /** Deletes a category nothing refers to; used ones are archived instead. */
  delete(id: string) {
    this.store.atomic(() => {
      const before = this.find(id);
      if (this.store.get('SELECT 1 FROM transactions WHERE category_id = ?', [id]) ||
          this.store.get('SELECT 1 FROM categories WHERE parent_id = ?', [id])) {
        throw new LedgerError('This category is in use, so it can be archived but not deleted');
      }
      this.store.run('DELETE FROM categories WHERE id = ?', [id]);
      this.audit.record('category', id, 'deleted', before, null);
    });
  }

  /** The category balance corrections fall under, created the first time it is needed. */
  adjustmentCategory(kind: CategoryKind): Category {
    const found = this.store.get<Category>(
      "SELECT * FROM categories WHERE kind = ? AND system_key = 'balance_adjustment'",
      [kind],
    );
    if (found) return found;
    const id = this.store.newId();
    this.store.run(
      "INSERT INTO categories (id, name, kind, position, system_key) VALUES (?, 'Balance adjustment', ?, 999, 'balance_adjustment')",
      [id, kind],
    );
    return this.find(id);
  }
}
