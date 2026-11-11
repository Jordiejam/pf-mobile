import { CURRENCIES } from './money';
import type { Db } from './db';

const currencyCheck = (column: string) =>
  `${column} IN (${CURRENCIES.map((code) => `'${code}'`).join(', ')})`;

/** Each entry upgrades the database by one version; never edit a released entry. */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE account_groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    position INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE accounts (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES account_groups(id),
    name TEXT NOT NULL,
    account_type TEXT NOT NULL DEFAULT 'standard'
      CHECK (account_type IN ('standard', 'credit_card', 'valued')),
    currency TEXT NOT NULL CHECK (${currencyCheck('currency')}),
    opening_minor INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    in_net_worth INTEGER NOT NULL DEFAULT 1,
    position INTEGER NOT NULL DEFAULT 0,
    statement_day INTEGER CHECK (statement_day BETWEEN 1 AND 31),
    due_day INTEGER CHECK (due_day BETWEEN 1 AND 31),
    payment_account_id TEXT REFERENCES accounts(id),
    created_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    CHECK (payment_account_id IS NULL OR payment_account_id <> id)
  );

  CREATE TABLE categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('income', 'expense')),
    parent_id TEXT REFERENCES categories(id),
    archived INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0,
    system_key TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    CHECK (parent_id IS NULL OR parent_id <> id),
    UNIQUE (kind, system_key)
  );

  CREATE TABLE transactions (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('income', 'expense', 'transfer')),
    account_id TEXT NOT NULL REFERENCES accounts(id),
    destination_id TEXT REFERENCES accounts(id),
    category_id TEXT REFERENCES categories(id),
    amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
    currency TEXT NOT NULL,
    source_amount_minor INTEGER NOT NULL CHECK (source_amount_minor > 0),
    source_currency TEXT NOT NULL,
    applied_rate TEXT NOT NULL DEFAULT '1',
    conversion_source TEXT NOT NULL DEFAULT 'same_currency',
    occurred_at TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    negative INTEGER NOT NULL DEFAULT 0,
    is_adjustment INTEGER NOT NULL DEFAULT 0,
    refund_of_id TEXT REFERENCES transactions(id),
    deleted_at TEXT,
    created_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    CHECK (negative = 0 OR kind <> 'transfer'),
    CHECK (refund_of_id IS NULL OR (negative = 1 AND kind = 'expense' AND refund_of_id <> id)),
    CHECK (
      (kind = 'transfer' AND destination_id IS NOT NULL AND destination_id <> account_id
        AND category_id IS NULL)
      OR (kind <> 'transfer' AND destination_id IS NULL AND category_id IS NOT NULL)
    )
  );
  CREATE INDEX ix_transactions_occurred ON transactions(occurred_at);
  CREATE INDEX ix_transactions_refund ON transactions(refund_of_id);

  -- The effect of each live transaction on each account. Deleted transactions have none.
  CREATE TABLE postings (
    transaction_id TEXT NOT NULL REFERENCES transactions(id),
    account_id TEXT NOT NULL REFERENCES accounts(id),
    amount_minor INTEGER NOT NULL CHECK (amount_minor <> 0),
    occurred_at TEXT NOT NULL,
    PRIMARY KEY (transaction_id, account_id)
  );
  CREATE INDEX ix_postings_account ON postings(account_id, occurred_at);

  CREATE TABLE valuations (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    valued_at TEXT NOT NULL,
    amount_minor INTEGER NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    UNIQUE (account_id, valued_at)
  );

  CREATE TABLE audit_events (
    id TEXT PRIMARY KEY,
    entity_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    action TEXT NOT NULL,
    via TEXT,
    occurred_at TEXT NOT NULL,
    before TEXT,
    after TEXT
  );
  CREATE INDEX ix_audit_entity ON audit_events(entity_id, occurred_at);

  CREATE TABLE change_previews (
    id TEXT PRIMARY KEY,
    changes TEXT NOT NULL,
    effects TEXT NOT NULL,
    summary TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    result TEXT
  );

  CREATE TABLE account_views (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    include_new INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE view_selections (
    view_id TEXT NOT NULL REFERENCES account_views(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    included INTEGER NOT NULL,
    PRIMARY KEY (view_id, account_id)
  );

  -- 'manual' rates are the person's own and always win; 'reference' rates are public
  -- quotes against the euro.
  CREATE TABLE exchange_rates (
    base TEXT NOT NULL,
    quote TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('manual', 'reference')),
    rate TEXT NOT NULL,
    as_of TEXT NOT NULL,
    PRIMARY KEY (base, quote, source)
  );

  CREATE TABLE bookmarks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    payload TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE schedules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    payload TEXT NOT NULL,
    frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly', 'yearly')),
    every INTEGER NOT NULL CHECK (every > 0),
    start_date TEXT NOT NULL,
    local_time TEXT NOT NULL,
    end_date TEXT,
    next_index INTEGER NOT NULL DEFAULT 0 CHECK (next_index >= 0),
    next_due_at TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    error TEXT
  );
  CREATE TABLE schedule_occurrences (
    schedule_id TEXT NOT NULL REFERENCES schedules(id),
    occurrence_index INTEGER NOT NULL,
    transaction_id TEXT NOT NULL UNIQUE REFERENCES transactions(id),
    PRIMARY KEY (schedule_id, occurrence_index)
  );
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

/** Brings a database up to the current schema; refuses one made by a newer app. */
export function migrate(db: Db) {
  db.exec('PRAGMA foreign_keys = ON');
  const [{ user_version: version }] = db.all<{ user_version: number }>('PRAGMA user_version');
  if (version > MIGRATIONS.length) {
    throw new Error('This data was saved by a newer version of the app. Update the app to open it.');
  }
  for (let next = version; next < MIGRATIONS.length; next += 1) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[next]);
      db.exec(`PRAGMA user_version = ${next + 1}`);
      db.exec('COMMIT');
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // Already rolled back by SQLite; the original error is the one that matters.
      }
      throw error;
    }
  }
}
