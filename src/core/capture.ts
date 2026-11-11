import type { AuditLog } from './audit';
import { json, LedgerError, notFound, type Store } from './db';
import type { EntryInput, LedgerService } from './ledger';
import { clampedDate, dayKey, fromDayKey } from './time';

/** A prefilled entry: everything is optional until it is saved as a transaction. */
export type EntryTemplate = Partial<Omit<EntryInput, 'occurred_at'>>;

export interface Bookmark {
  id: string;
  name: string;
  template: EntryTemplate;
}

export type Frequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface Schedule {
  id: string;
  name: string;
  template: EntryTemplate;
  frequency: Frequency;
  every: number;
  start_date: string;
  local_time: string;
  end_date: string | null;
  next_index: number;
  next_due_at: string | null;
  active: number;
  error: string | null;
}

export interface ScheduleInput {
  name: string;
  template: EntryTemplate;
  frequency: Frequency;
  every: number;
  start_date: string;
  local_time?: string;
  end_date?: string | null;
}

/** Anchored calendar recurrence: short months never move the original anchor day. */
export class RecurrenceRule {
  constructor(
    private startDate: string,
    private localTime: string,
    private frequency: Frequency,
    private every: number,
    private endDate: string | null = null,
  ) {}

  /** When occurrence `index` falls, or null once the schedule has ended. */
  dueAt(index: number): Date | null {
    const start = fromDayKey(this.startDate);
    const step = index * this.every;
    const date =
      this.frequency === 'daily' || this.frequency === 'weekly'
        ? new Date(start.getFullYear(), start.getMonth(), start.getDate() + step * (this.frequency === 'weekly' ? 7 : 1))
        : clampedDate(start.getFullYear(), start.getMonth() + step * (this.frequency === 'yearly' ? 12 : 1), start.getDate());
    if (this.endDate && dayKey(date) > this.endDate) return null;
    const [hours, minutes] = this.localTime.split(':').map(Number);
    // Local construction moves a clock time skipped by daylight saving forward by the gap.
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes);
  }
}

const MAX_CATCH_UP = 100;

type ScheduleRow = Omit<Schedule, 'template'> & { payload: string };

/** Owns bookmarks (reusable prefills) and schedules (entries recorded automatically). */
export class CaptureService {
  constructor(private store: Store, private audit: AuditLog, private ledger: LedgerService) {}

  // Bookmarks never post anything: applying one opens an editable entry.

  bookmarks(): Bookmark[] {
    return this.store
      .all<{ id: string; name: string; payload: string }>('SELECT * FROM bookmarks ORDER BY position, name')
      .map((row) => ({ id: row.id, name: row.name, template: JSON.parse(row.payload) }));
  }

  saveBookmark(name: string, template: EntryTemplate, id?: string): string {
    const clean = name.trim();
    if (!clean) throw new LedgerError('Give the bookmark a name');
    return this.store.atomic(() => {
      if (id) {
        this.store.run('UPDATE bookmarks SET name = ?, payload = ? WHERE id = ?', [clean, json(template), id]);
        return id;
      }
      const newId = this.store.newId();
      this.store.run('INSERT INTO bookmarks (id, name, payload) VALUES (?, ?, ?)', [newId, clean, json(template)]);
      return newId;
    });
  }

  deleteBookmark(id: string) {
    this.store.atomic(() => this.store.run('DELETE FROM bookmarks WHERE id = ?', [id]));
  }

  // Schedules

  private static schedule(row: ScheduleRow): Schedule {
    const { payload, ...rest } = row;
    return { ...rest, template: JSON.parse(payload) };
  }

  schedules(): Schedule[] {
    return this.store.all<ScheduleRow>('SELECT * FROM schedules ORDER BY name').map(CaptureService.schedule);
  }

  findSchedule(id: string): Schedule {
    const row = this.store.get<ScheduleRow>('SELECT * FROM schedules WHERE id = ?', [id]);
    if (!row) throw notFound('Schedule');
    return CaptureService.schedule(row);
  }

  private static rule(schedule: Pick<Schedule, 'start_date' | 'local_time' | 'frequency' | 'every' | 'end_date'>) {
    return new RecurrenceRule(schedule.start_date, schedule.local_time, schedule.frequency, schedule.every, schedule.end_date);
  }

  saveSchedule(input: ScheduleInput, id?: string): Schedule {
    const name = input.name.trim();
    if (!name) throw new LedgerError('Give the schedule a name');
    if (!Number.isInteger(input.every) || input.every < 1) throw new LedgerError('Repeat every 1 or more');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.start_date)) throw new LedgerError('Choose a start date');
    if (input.end_date && input.end_date < input.start_date) throw new LedgerError('The end date is before the start');
    const localTime = input.local_time ?? '09:00';
    return this.store.atomic(() => {
      const before = id ? this.findSchedule(id) : null;
      // A dry run proves the template can actually be recorded before it is relied on.
      this.store.dryRun(() => this.ledger.save(this.entryFor(input.template, this.store.nowIso())));
      const shape = { start_date: input.start_date, local_time: localTime, frequency: input.frequency, every: input.every, end_date: input.end_date ?? null };
      if (before && before.next_index > 0) {
        const changed = (['start_date', 'frequency', 'every'] as const).some((key) => before[key] !== shape[key]);
        if (changed) throw new LedgerError('This schedule has already run. Pause it and create a new one to change when it repeats.');
      }
      const index = before?.next_index ?? 0;
      const due = CaptureService.rule(shape).dueAt(index);
      const fields = [name, json(input.template), shape.frequency, shape.every, shape.start_date, shape.local_time, shape.end_date, due?.toISOString() ?? null];
      if (before) {
        // Saving a paused schedule resumes it.
        this.store.run(
          `UPDATE schedules SET name = ?, payload = ?, frequency = ?, every = ?, start_date = ?, local_time = ?,
             end_date = ?, next_due_at = ?, active = ?, error = NULL WHERE id = ?`,
          [...fields, due ? 1 : 0, before.id],
        );
      } else {
        id = this.store.newId();
        this.store.run(
          `INSERT INTO schedules (name, payload, frequency, every, start_date, local_time, end_date, next_due_at, active, id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [...fields, due ? 1 : 0, id],
        );
      }
      return this.findSchedule(id!);
    });
  }

  setScheduleActive(id: string, active: boolean) {
    this.store.atomic(() => {
      const schedule = this.findSchedule(id);
      if (active && !schedule.next_due_at) throw new LedgerError('This schedule has finished');
      this.store.run('UPDATE schedules SET active = ?, error = NULL WHERE id = ?', [active ? 1 : 0, id]);
    });
  }

  /** Removes a schedule. The entries it already recorded are ordinary entries and stay. */
  deleteSchedule(id: string) {
    this.store.atomic(() => {
      this.store.run('DELETE FROM schedule_occurrences WHERE schedule_id = ?', [id]);
      this.store.run('DELETE FROM schedules WHERE id = ?', [id]);
    });
  }

  private entryFor(template: EntryTemplate, occurredAt: string): EntryInput {
    if (!template.kind || !template.account_id || !template.amount_minor) {
      throw new LedgerError('A repeating entry needs a type, an account and an amount');
    }
    return { ...template, kind: template.kind, account_id: template.account_id, amount_minor: template.amount_minor, occurred_at: occurredAt };
  }

  /**
   * Records every occurrence that has fallen due. Each one is an independent transaction
   * saved together with its occurrence record, so running this twice (or being
   * interrupted) can never record an occurrence twice. Returns how many were recorded.
   */
  runDue(): number {
    let recorded = 0;
    for (const { id } of this.store.all<{ id: string }>(
      'SELECT id FROM schedules WHERE active = 1 AND next_due_at IS NOT NULL AND next_due_at <= ?',
      [this.store.nowIso()],
    )) {
      for (let run = 0; run < MAX_CATCH_UP; run += 1) {
        const schedule = this.findSchedule(id);
        if (!schedule.active || !schedule.next_due_at || schedule.next_due_at > this.store.nowIso()) break;
        try {
          this.store.atomic(() => {
            const entry = this.audit.via('schedule', () => this.ledger.save(this.entryFor(schedule.template, schedule.next_due_at!)));
            this.store.run('INSERT INTO schedule_occurrences (schedule_id, occurrence_index, transaction_id) VALUES (?, ?, ?)', [
              id, schedule.next_index, entry.id,
            ]);
            const next = CaptureService.rule(schedule).dueAt(schedule.next_index + 1);
            this.store.run('UPDATE schedules SET next_index = next_index + 1, next_due_at = ?, active = ? WHERE id = ?', [
              next?.toISOString() ?? null, next ? 1 : 0, id,
            ]);
          });
          recorded += 1;
        } catch (error) {
          if (!(error instanceof LedgerError)) throw error;
          // Something the entry needs has gone (an archived account, say): pause for review.
          this.store.atomic(() =>
            this.store.run('UPDATE schedules SET active = 0, error = ? WHERE id = ?', [error.message.slice(0, 200), id]),
          );
          break;
        }
      }
    }
    return recorded;
  }
}
