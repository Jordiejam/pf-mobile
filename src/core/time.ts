/** Calendar helpers. Moments are stored as UTC ISO strings; days are the device's local days. */

export type Period = { start: Date; end: Date };
export type PeriodLength = 'week' | 'month' | 'year' | 'all';

const pad = (value: number) => String(value).padStart(2, '0');

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/** A local date in a month, with days past the month's end falling on its last day. */
export function clampedDate(year: number, month: number, day: number): Date {
  const y = year + Math.floor(month / 12);
  const m = ((month % 12) + 12) % 12;
  return new Date(y, m, Math.min(day, daysInMonth(y, m)));
}

/** "2026-11-11" for a moment's local day. */
export function dayKey(moment: Date | string): string {
  const date = typeof moment === 'string' ? new Date(moment) : moment;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function fromDayKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** The reporting month containing a date, for months that start on `startDay`. */
export function reportingMonth(date: Date, startDay: number): Period {
  let start = clampedDate(date.getFullYear(), date.getMonth(), startDay);
  if (start > date) start = clampedDate(date.getFullYear(), date.getMonth() - 1, startDay);
  return { start, end: clampedDate(start.getFullYear(), start.getMonth() + 1, startDay) };
}

/** The week (Monday to Sunday), reporting month or calendar year containing a date. */
export function periodFor(length: PeriodLength, date: Date, startDay: number): Period | null {
  if (length === 'all') return null;
  if (length === 'month') return reportingMonth(date, startDay);
  if (length === 'year') {
    return { start: new Date(date.getFullYear(), 0, 1), end: new Date(date.getFullYear() + 1, 0, 1) };
  }
  const start = addDays(startOfDay(date), -((date.getDay() + 6) % 7));
  return { start, end: addDays(start, 7) };
}

/** The period before (-1) or after (+1) one of the same length. */
export function shiftPeriod(length: PeriodLength, period: Period, by: number, startDay: number): Period {
  const { start } = period;
  if (length === 'week') return periodFor('week', addDays(start, 7 * by), startDay)!;
  if (length === 'year') return periodFor('year', new Date(start.getFullYear() + by, 0, 1), startDay)!;
  // The middle of the neighbouring reporting month is always inside it.
  const middle = new Date(start.getFullYear(), start.getMonth() + by, start.getDate() + 14);
  return reportingMonth(middle, startDay);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function monthName(month: number): string {
  return MONTHS[month];
}

/** "Wed 11 Nov" (with the year when it is not this year). */
export function dayLabel(date: Date, today = new Date()): string {
  const year = date.getFullYear() === today.getFullYear() ? '' : ` ${date.getFullYear()}`;
  return `${DAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}${year}`;
}

export function timeLabel(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function periodLabel(length: PeriodLength, period: Period | null, startDay: number): string {
  if (!period) return 'All time';
  const { start, end } = period;
  if (length === 'year') return String(start.getFullYear());
  const last = addDays(end, -1);
  if (length === 'month' && startDay === 1) return `${MONTHS[start.getMonth()]} ${start.getFullYear()}`;
  return `${start.getDate()} ${MONTHS[start.getMonth()]} – ${last.getDate()} ${MONTHS[last.getMonth()]} ${last.getFullYear()}`;
}
