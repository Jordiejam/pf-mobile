/** The storage the ledger runs on: a synchronous SQLite connection supplied by the platform. */

export type SqlValue = string | number | null;

export interface Db {
  exec(sql: string): void;
  run(sql: string, params?: SqlValue[]): void;
  all<T>(sql: string, params?: SqlValue[]): T[];
}

export interface Environment {
  /** A new random UUID. */
  newId(): string;
  now(): Date;
}

/** A problem the person can act on; its message is shown as written. */
export class LedgerError extends Error {
  constructor(message: string, public code: 'invalid' | 'stale' | 'not_found' = 'invalid') {
    super(message);
    this.name = 'LedgerError';
  }
}

export const stale = (what: string) =>
  new LedgerError(`${what} was changed elsewhere. Reload it and try again.`, 'stale');
export const notFound = (what: string) => new LedgerError(`${what} not found`, 'not_found');

class Rollback extends Error {}

/**
 * Owns transactions on the connection. Every ledger command runs inside `atomic`, so it
 * either happens completely or not at all; nested calls become savepoints.
 */
export class Store {
  private depth = 0;
  private listeners = new Set<() => void>();
  private revision = 0;

  constructor(private db: Db, private env: Environment) {}

  newId = () => this.env.newId();
  now = () => this.env.now();
  nowIso = () => this.env.now().toISOString();

  run(sql: string, params: SqlValue[] = []) {
    this.db.run(sql, params);
  }

  all<T>(sql: string, params: SqlValue[] = []): T[] {
    return this.db.all<T>(sql, params);
  }

  get<T>(sql: string, params: SqlValue[] = []): T | undefined {
    return this.db.all<T>(sql, params)[0];
  }

  exec(sql: string) {
    this.db.exec(sql);
  }

  atomic<T>(work: () => T): T {
    const result = this.scoped(work, false);
    if (this.depth === 0) this.changed();
    return result;
  }

  /** Runs real commands to see what they would do, then undoes them. */
  dryRun<T>(work: () => T): T {
    return this.scoped(work, true);
  }

  private scoped<T>(work: () => T, undo: boolean): T {
    const name = `sp${this.depth}`;
    this.db.exec(this.depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${name}`);
    this.depth += 1;
    let result: T;
    try {
      result = work();
      if (undo) throw new Rollback();
    } catch (error) {
      this.depth -= 1;
      this.db.exec(this.depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${name}; RELEASE ${name}`);
      if (error instanceof Rollback) return result!;
      throw error;
    }
    this.depth -= 1;
    if (this.depth > 0) {
      this.db.exec(`RELEASE ${name}`);
      return result;
    }
    try {
      this.db.exec('COMMIT');
    } catch (error) {
      // A commit can itself be refused (a deferred reference check); undo it fully.
      this.db.exec('ROLLBACK');
      throw error;
    }
    return result;
  }

  /** Screens subscribe so they re-read after any committed change. */
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getRevision = () => this.revision;

  changed() {
    this.revision += 1;
    this.listeners.forEach((listener) => listener());
  }
}

export const bool = (value: unknown) => (value ? 1 : 0);
export const json = (value: unknown) => JSON.stringify(value);
