import { LedgerError, type SqlValue, type Store } from './db';
import { SCHEMA_VERSION } from './schema';

/** Tables in an order that satisfies their references when restoring. */
const TABLES = [
  'settings', 'account_groups', 'accounts', 'categories', 'transactions', 'postings', 'valuations',
  'audit_events', 'account_views', 'view_selections', 'exchange_rates', 'bookmarks', 'schedules',
  'schedule_occurrences',
] as const;

const FORMAT = 'pf-mobile-backup';

export interface BackupFile {
  format: typeof FORMAT;
  schema_version: number;
  exported_at: string;
  tables: Record<string, Record<string, SqlValue>[]>;
}

/** Writes the whole ledger to one JSON document and restores from one. */
export class BackupService {
  constructor(private store: Store) {}

  export(): BackupFile {
    const tables: BackupFile['tables'] = {};
    for (const table of TABLES) tables[table] = this.store.all(`SELECT * FROM ${table}`);
    return { format: FORMAT, schema_version: SCHEMA_VERSION, exported_at: this.store.nowIso(), tables };
  }

  /**
   * Replaces everything with a backup's contents, or changes nothing if any part of it is
   * unusable. The file is untrusted: only known tables and their real columns are read,
   * and the database's own checks apply to every row.
   */
  restore(file: unknown): { rows: number } {
    const backup = file as Partial<BackupFile> | null;
    if (!backup || backup.format !== FORMAT || typeof backup.tables !== 'object' || !backup.tables) {
      throw new LedgerError("This isn't a backup from this app");
    }
    if (backup.schema_version !== SCHEMA_VERSION) {
      throw new LedgerError(
        backup.schema_version! > SCHEMA_VERSION
          ? 'This backup is from a newer version of the app. Update the app to restore it.'
          : 'This backup is from an older version of the app and cannot be restored yet.',
      );
    }
    let rows = 0;
    try {
      this.store.atomic(() => {
        // References are checked once at the end, so tables can be emptied in any order.
        this.store.exec('PRAGMA defer_foreign_keys = ON');
        for (const table of [...TABLES].reverse()) this.store.run(`DELETE FROM ${table}`);
        this.store.run('DELETE FROM change_previews');
        for (const table of TABLES) {
          const columns = this.store.all<{ name: string }>(`PRAGMA table_info(${table})`).map((column) => column.name);
          const records = backup.tables![table] ?? [];
          if (!Array.isArray(records)) throw new LedgerError('The backup is damaged');
          for (const record of records) {
            const used = columns.filter((column) => record != null && column in record);
            const values = used.map((column) => record[column]);
            if (values.some((value) => value !== null && typeof value !== 'string' && typeof value !== 'number')) {
              throw new LedgerError('The backup is damaged');
            }
            this.store.run(
              `INSERT INTO ${table} (${used.join(', ')}) VALUES (${used.map(() => '?').join(', ')})`,
              values,
            );
            rows += 1;
          }
        }
      });
    } catch (error) {
      if (error instanceof LedgerError) throw error;
      throw new LedgerError('The backup is damaged, so nothing was changed');
    }
    return { rows };
  }

  /** Erases the whole ledger. */
  erase() {
    this.store.atomic(() => {
      this.store.exec('PRAGMA defer_foreign_keys = ON');
      for (const table of [...TABLES].reverse()) this.store.run(`DELETE FROM ${table}`);
      this.store.run('DELETE FROM change_previews');
    });
  }
}
