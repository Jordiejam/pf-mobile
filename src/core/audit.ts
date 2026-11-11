import { json, type Store } from './db';

export interface AuditEvent {
  id: string;
  entity_id: string;
  entity_type: string;
  action: string;
  via: string | null;
  occurred_at: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

/**
 * The change history. Every ledger command records what it changed and through which
 * channel (the app itself, the assistant or a schedule).
 */
export class AuditLog {
  private channel: string | null = null;

  constructor(private store: Store) {}

  /** Attributes everything recorded during `work` to a channel other than the app. */
  via<T>(channel: string, work: () => T): T {
    const previous = this.channel;
    this.channel = channel;
    try {
      return work();
    } finally {
      this.channel = previous;
    }
  }

  record(entityType: string, entityId: string, action: string, before: unknown, after: unknown) {
    this.store.run(
      `INSERT INTO audit_events (id, entity_id, entity_type, action, via, occurred_at, before, after)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        this.store.newId(), entityId, entityType, action, this.channel, this.store.nowIso(),
        before == null ? null : json(before), after == null ? null : json(after),
      ],
    );
  }

  history(entityId: string): AuditEvent[] {
    return this.store
      .all<Omit<AuditEvent, 'before' | 'after'> & { before: string | null; after: string | null }>(
        'SELECT * FROM audit_events WHERE entity_id = ? ORDER BY occurred_at DESC, rowid DESC',
        [entityId],
      )
      .map((row) => ({
        ...row,
        before: row.before ? JSON.parse(row.before) : null,
        after: row.after ? JSON.parse(row.after) : null,
      }));
  }
}
