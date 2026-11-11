import type { AccountService } from './accounts';
import type { Store } from './db';
import type { RateService } from './fx';
import type { EntryFilter, LedgerService } from './ledger';
import type { Currency } from './money';
import { reportingMonth, shiftPeriod, type Period } from './time';

export interface CategoryTotal {
  id: string;
  name: string;
  total: number;
  children: { id: string; name: string; total: number }[];
}

export interface Breakdown {
  total: number;
  categories: CategoryTotal[];
  ratesNeeded: string[];
}

export interface MonthTotals {
  period: Period;
  income: number;
  expense: number;
}

export interface NetWorthPoint {
  period: Period;
  total: number;
  groups: Record<string, number>;
}

type ReportFilter = Pick<EntryFilter, 'start' | 'end' | 'account_ids' | 'exclude_adjustments'>;

/** Read-only summaries, all in the primary currency at today's rates. */
export class ReportService {
  constructor(
    private store: Store,
    private ledger: LedgerService,
    private accounts: AccountService,
    private rates: RateService,
  ) {}

  /** Spending or income by category, children rolled up under their current parent. */
  byCategory(kind: 'income' | 'expense', filter: ReportFilter, primary: Currency): Breakdown {
    const where = ['t.deleted_at IS NULL', 't.kind = ?'];
    const params: (string | number)[] = [kind];
    if (filter.start) where.push('t.occurred_at >= ?'), params.push(filter.start);
    if (filter.end) where.push('t.occurred_at < ?'), params.push(filter.end);
    if (filter.exclude_adjustments) where.push('t.is_adjustment = 0');
    if (filter.account_ids?.length) {
      where.push(`t.account_id IN (${filter.account_ids.map(() => '?').join(', ')})`);
      params.push(...filter.account_ids);
    }
    const rows = this.store.all<{
      id: string; name: string; parent_id: string | null; parent_name: string | null; currency: string; total: number;
    }>(
      `SELECT c.id, c.name, c.parent_id, p.name AS parent_name, t.currency,
         SUM(CASE WHEN t.negative = 1 THEN -t.amount_minor ELSE t.amount_minor END) AS total
       FROM transactions t JOIN categories c ON c.id = t.category_id
       LEFT JOIN categories p ON p.id = c.parent_id
       WHERE ${where.join(' AND ')} GROUP BY c.id, t.currency`,
      params,
    );
    const breakdown: Breakdown = { total: 0, categories: [], ratesNeeded: [] };
    const parents = new Map<string, CategoryTotal>();
    for (const row of rows) {
      const value = this.rates.convert(row.total, row.currency, primary);
      if (value === null) {
        if (!breakdown.ratesNeeded.includes(row.currency)) breakdown.ratesNeeded.push(row.currency);
        continue;
      }
      const parentId = row.parent_id ?? row.id;
      let parent = parents.get(parentId);
      if (!parent) {
        parent = { id: parentId, name: row.parent_name ?? row.name, total: 0, children: [] };
        parents.set(parentId, parent);
      }
      parent.total += value;
      breakdown.total += value;
      if (row.parent_id) {
        const child = parent.children.find((item) => item.id === row.id);
        if (child) child.total += value;
        else parent.children.push({ id: row.id, name: row.name, total: value });
      }
    }
    breakdown.categories = [...parents.values()].sort((a, b) => b.total - a.total);
    breakdown.categories.forEach((parent) => parent.children.sort((a, b) => b.total - a.total));
    return breakdown;
  }

  /** The last `count` reporting months, oldest first. */
  private recentMonths(count: number, startDay: number): Period[] {
    let period = reportingMonth(this.store.now(), startDay);
    const periods = [period];
    while (periods.length < count) {
      period = shiftPeriod('month', period, -1, startDay);
      periods.unshift(period);
    }
    return periods;
  }

  /** Income and spending for each recent reporting month. Transfers are neither. */
  months(count: number, startDay: number, primary: Currency, filter: ReportFilter = {}): MonthTotals[] {
    return this.recentMonths(count, startDay).map((period) => {
      const totals = this.ledger.totals(
        { ...filter, start: period.start.toISOString(), end: period.end.toISOString() },
        primary,
      );
      return { period, income: totals.income, expense: totals.expense };
    });
  }

  /**
   * Month-end worth of the accounts that count in net worth, by group. Other currencies
   * are valued at today's rate, so their past figures are approximate.
   */
  netWorth(count: number, startDay: number, primary: Currency): NetWorthPoint[] {
    const accounts = this.accounts.list({ archived: true }).filter((account) => account.in_net_worth);
    const now = this.store.nowIso();
    const begins = new Map(
      accounts.map((account) => {
        const first = this.store.get<{ first: string | null }>(
          `SELECT MIN(moment) AS first FROM (
             SELECT MIN(occurred_at) AS moment FROM postings WHERE account_id = ?
             UNION ALL SELECT MIN(valued_at) FROM valuations WHERE account_id = ?)`,
          [account.id, account.id],
        )?.first;
        return [account.id, first && first < account.created_at ? first : account.created_at];
      }),
    );
    const earliest = [...begins.values()].sort()[0];
    const months = this.recentMonths(count, startDay);
    // Months before anything existed are left off, keeping at least two points to draw.
    const from = Math.min(months.findIndex((period) => !earliest || period.end.toISOString() > earliest), months.length - 2);
    return months.slice(Math.max(from, 0)).map((period) => {
      // The current month is valued as of now rather than at its (future) end.
      const end = period.end.toISOString() > now ? now : new Date(period.end.getTime() - 1).toISOString();
      const point: NetWorthPoint = { period, total: 0, groups: {} };
      for (const account of accounts) {
        if (begins.get(account.id)! > end) continue;
        const value = this.rates.convert(this.accounts.balance(account, end), account.currency, primary);
        if (value === null) continue;
        point.total += value;
        point.groups[account.group_id] = (point.groups[account.group_id] ?? 0) + value;
      }
      return point;
    });
  }
}
