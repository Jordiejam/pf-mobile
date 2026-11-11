import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Ledger, type Db } from '../src/core';

/** An in-memory ledger on Node's SQLite, with a clock the test controls. */
export function testLedger(start = '2026-11-11T12:00:00Z') {
  const sqlite = new DatabaseSync(':memory:');
  const db: Db = {
    exec: (sql) => sqlite.exec(sql),
    run: (sql, params = []) => void sqlite.prepare(sql).run(...params),
    all: <T>(sql: string, params: (string | number | null)[] = []) => sqlite.prepare(sql).all(...params) as T[],
  };
  const clock = { now: new Date(start) };
  const ledger = Ledger.open(db, { newId: randomUUID, now: () => new Date(clock.now) });
  const group = ledger.accounts.groups()[0];
  const account = (name: string, opening = 0, extra: Record<string, unknown> = {}) =>
    ledger.accounts.save({ name, group_id: group.id, account_type: 'standard', currency: 'GBP', opening_minor: opening, ...extra });
  const category = (kind: 'income' | 'expense', name: string) => ledger.categories.list({ kind }).find((item) => item.name === name)!;
  const balance = (id: string) => ledger.accounts.get(id).balance;
  return { ledger, clock, account, category, balance, sqlite };
}
