import type { AccountService, AccountWithBalance } from './accounts';
import type { Store } from './db';
import { addDays, clampedDate, dayKey, startOfDay } from './time';

export interface CardStatement {
  statement_closed_on: string;
  payment_due_on: string;
  next_statement_on: string;
  /** What was owed when the latest statement closed, less payments since. */
  payable: number;
  /** The rest of what is owed now: the current, not yet payable, cycle. */
  outstanding: number;
}

/** Statement dates for a card. Days past a month's end fall on its last day. */
export class StatementCycle {
  constructor(private statementDay: number, private dueDay: number) {}

  /** The latest statement date before today; a statement closes at the end of its day. */
  lastClosed(today: Date): Date {
    const day = startOfDay(today);
    const closing = clampedDate(day.getFullYear(), day.getMonth(), this.statementDay);
    return closing >= day ? clampedDate(day.getFullYear(), day.getMonth() - 1, this.statementDay) : closing;
  }

  nextClosing(closed: Date): Date {
    return clampedDate(closed.getFullYear(), closed.getMonth() + 1, this.statementDay);
  }

  dueAfter(closed: Date): Date {
    const due = clampedDate(closed.getFullYear(), closed.getMonth(), this.dueDay);
    return due > closed ? due : clampedDate(closed.getFullYear(), closed.getMonth() + 1, this.dueDay);
  }

  /** The instant a statement closed: midnight after its date. */
  endsAt(closed: Date): Date {
    return addDays(closed, 1);
  }
}

/**
 * Derives a card's Balance Payable / Outstanding split from the ledger; nothing about
 * cycles is stored. A payment (a transfer into the card) clears the closed statement
 * first. Everything else belongs to the cycle it posts in, so a refund reduces the
 * outstanding amount and credit beyond that comes off the payable amount.
 */
export class CardService {
  constructor(private store: Store, private accounts: AccountService) {}

  statement(account: AccountWithBalance, at = this.store.now()): CardStatement | null {
    if (account.account_type !== 'credit_card' || !account.statement_day || !account.due_day) return null;
    const cycle = new StatementCycle(account.statement_day, account.due_day);
    const closed = cycle.lastClosed(at);
    const boundary = cycle.endsAt(closed).toISOString();
    const owedAtClose = -(account.opening_minor + this.accounts.posted(account.id, { before: boundary }));
    const paidSince = this.store.get<{ total: number }>(
      `SELECT COALESCE(SUM(p.amount_minor), 0) AS total FROM postings p
       JOIN transactions t ON t.id = p.transaction_id
       WHERE p.account_id = ? AND t.kind = 'transfer' AND t.destination_id = ? AND p.occurred_at >= ?`,
      [account.id, account.id, boundary],
    )!.total;
    const owed = Math.max(-account.balance, 0);
    const payable = Math.min(Math.max(owedAtClose - paidSince, 0), owed);
    return {
      statement_closed_on: dayKey(closed),
      payment_due_on: dayKey(cycle.dueAfter(closed)),
      next_statement_on: dayKey(cycle.nextClosing(closed)),
      payable,
      outstanding: owed - payable,
    };
  }
}
