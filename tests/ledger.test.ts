import { describe, expect, it } from 'vitest';
import { LedgerError, Money, periodFor, reportingMonth, shiftPeriod, StatementCycle, RecurrenceRule, dayKey } from '../src/core';
import { testLedger } from './helpers';

const at = '2026-11-10T10:00:00.000Z';

describe('money', () => {
  it('parses and formats exact minor units', () => {
    expect(Money.parse('12.34')).toBe(1234);
    expect(Money.parse('1,234.5')).toBe(123450);
    expect(Money.parse('-3')).toBe(-300);
    expect(Money.parse('1.234')).toBeNull();
    expect(Money.parse('abc')).toBeNull();
    expect(Money.format(-123456, 'GBP')).toBe('−£1,234.56');
    expect(Money.plain(-5)).toBe('-0.05');
  });

  it('converts half up and derives rates', () => {
    expect(Money.convert(1000, '0.8765')).toBe(877);
    expect(Money.convert(1, '0.5')).toBe(1);
    expect(Money.impliedRate(1000, 877)).toBe('0.877');
    expect(Money.rate('0')).toBeNull();
    expect(Money.divideRates('1', '0.8')).toBe('1.25');
  });
});

describe('periods', () => {
  it('starts reporting months on the chosen day, clamped in short months', () => {
    const month = reportingMonth(new Date(2026, 1, 10), 31);
    expect(dayKey(month.start)).toBe('2026-01-31');
    expect(dayKey(month.end)).toBe('2026-02-28');
    const next = shiftPeriod('month', month, 1, 31);
    expect([dayKey(next.start), dayKey(next.end)]).toEqual(['2026-02-28', '2026-03-31']);
    expect(dayKey(shiftPeriod('month', next, -1, 31).start)).toBe('2026-01-31');
  });

  it('weeks run Monday to Sunday', () => {
    const week = periodFor('week', new Date(2026, 10, 11), 1)!; // a Wednesday
    expect([dayKey(week.start), dayKey(week.end)]).toEqual(['2026-11-09', '2026-11-16']);
  });
});

describe('transactions and balances', () => {
  it('applies income, expenses and transfers to balances', () => {
    const { ledger, account, category, balance } = testLedger();
    const current = account('Current', 10_000);
    const savings = account('Savings');
    ledger.entries.save({ kind: 'income', account_id: current.id, category_id: category('income', 'Salary').id, amount_minor: 5_000, occurred_at: at });
    ledger.entries.save({ kind: 'expense', account_id: current.id, category_id: category('expense', 'Groceries').id, amount_minor: 1_250, occurred_at: at });
    ledger.entries.save({ kind: 'transfer', account_id: current.id, destination_id: savings.id, amount_minor: 2_000, occurred_at: at });
    expect(balance(current.id)).toBe(11_750);
    expect(balance(savings.id)).toBe(2_000);
    const totals = ledger.entries.totals({}, 'GBP');
    expect(totals).toMatchObject({ income: 5_000, expense: 1_250, transfer: 2_000, count: 3 });
  });

  it('rejects invalid shapes without changing anything', () => {
    const { ledger, account, category, balance } = testLedger();
    const current = account('Current', 100);
    const groceries = category('expense', 'Groceries').id;
    const bad = [
      { kind: 'expense', account_id: current.id, amount_minor: 100, occurred_at: at },
      { kind: 'expense', account_id: current.id, category_id: category('income', 'Salary').id, amount_minor: 100, occurred_at: at },
      { kind: 'expense', account_id: current.id, category_id: groceries, amount_minor: 0, occurred_at: at },
      { kind: 'transfer', account_id: current.id, destination_id: current.id, amount_minor: 100, occurred_at: at },
      { kind: 'transfer', account_id: current.id, destination_id: 'missing', amount_minor: 100, occurred_at: at },
      { kind: 'expense', account_id: current.id, category_id: groceries, amount_minor: 100, occurred_at: 'nonsense' },
    ] as const;
    for (const input of bad) expect(() => ledger.entries.save({ ...input })).toThrow(LedgerError);
    expect(balance(current.id)).toBe(100);
    expect(ledger.entries.search()).toHaveLength(0);
  });

  it('moves a transfer atomically: a failing edit leaves both balances alone', () => {
    const { ledger, account, balance } = testLedger();
    const [a, b] = [account('A', 1_000), account('B')];
    const euro = account('Euro', 0, { currency: 'EUR' });
    const transfer = ledger.entries.save({ kind: 'transfer', account_id: a.id, destination_id: b.id, amount_minor: 400, occurred_at: at });
    expect(() => ledger.entries.save(
      { kind: 'transfer', account_id: a.id, destination_id: euro.id, amount_minor: 400, occurred_at: at },
      transfer,
    )).toThrow('between currencies');
    expect([balance(a.id), balance(b.id), balance(euro.id)]).toEqual([600, 400, 0]);
  });

  it('edits move the effect between accounts and reject stale versions', () => {
    const { ledger, account, category, balance } = testLedger();
    const [a, b] = [account('A', 1_000), account('B', 1_000)];
    const groceries = category('expense', 'Groceries').id;
    const entry = ledger.entries.save({ kind: 'expense', account_id: a.id, category_id: groceries, amount_minor: 300, occurred_at: at });
    const edited = ledger.entries.save({ kind: 'expense', account_id: b.id, category_id: groceries, amount_minor: 450, occurred_at: at }, entry);
    expect([balance(a.id), balance(b.id)]).toEqual([1_000, 550]);
    expect(edited.version).toBe(2);
    expect(() => ledger.entries.save({ kind: 'expense', account_id: a.id, category_id: groceries, amount_minor: 1, occurred_at: at }, entry)).toThrow('changed elsewhere');
    expect(balance(b.id)).toBe(550);
    expect(ledger.audit.history(entry.id).map((event) => event.action)).toEqual(['edited', 'created']);
  });

  it('deleting removes the effect and restoring brings it back', () => {
    const { ledger, account, balance } = testLedger();
    const [a, b] = [account('A', 1_000), account('B')];
    const transfer = ledger.entries.save({ kind: 'transfer', account_id: a.id, destination_id: b.id, amount_minor: 400, occurred_at: at });
    const deleted = ledger.entries.setDeleted(transfer.id, true, transfer.version);
    expect([balance(a.id), balance(b.id)]).toEqual([1_000, 0]);
    expect(ledger.entries.search()).toHaveLength(0);
    expect(ledger.entries.search({ deleted: true })).toHaveLength(1);
    expect(() => ledger.entries.setDeleted(transfer.id, true, deleted.version)).toThrow('already');
    ledger.entries.setDeleted(transfer.id, false, deleted.version);
    expect([balance(a.id), balance(b.id)]).toEqual([600, 400]);
  });

  it('money back nets off its own kind', () => {
    const { ledger, account, category, balance } = testLedger();
    const a = account('A', 1_000);
    const clothes = category('expense', 'Clothes').id;
    ledger.entries.save({ kind: 'expense', account_id: a.id, category_id: clothes, amount_minor: 500, occurred_at: at });
    ledger.entries.save({ kind: 'expense', negative: true, account_id: a.id, category_id: clothes, amount_minor: 200, occurred_at: at });
    expect(balance(a.id)).toBe(700);
    expect(ledger.entries.totals({}, 'GBP')).toMatchObject({ expense: 300, income: 0 });
    const breakdown = ledger.reports.byCategory('expense', {}, 'GBP');
    expect(breakdown.total).toBe(300);
    expect(breakdown.categories[0]).toMatchObject({ name: 'Shopping', total: 300 });
  });

  it('refunds never exceed what the purchase cost', () => {
    const { ledger, account, category } = testLedger();
    const a = account('A', 1_000);
    const clothes = category('expense', 'Clothes').id;
    const purchase = ledger.entries.save({ kind: 'expense', account_id: a.id, category_id: clothes, amount_minor: 500, occurred_at: at });
    const refund = (amount: number) =>
      ledger.entries.save({ kind: 'expense', negative: true, refund_of_id: purchase.id, account_id: a.id, category_id: clothes, amount_minor: amount, occurred_at: at });
    const first = refund(300);
    expect(() => refund(201)).toThrow('more than it cost');
    refund(200);
    expect(ledger.entries.find(purchase.id).refunded_minor).toBe(500);
    // The purchase cannot shrink below what has come back, or stop being a purchase.
    const now = ledger.entries.find(purchase.id);
    expect(() => ledger.entries.patch(purchase.id, now.version, { amount_minor: 400 })).toThrow('more than it cost');
    expect(() => ledger.entries.patch(purchase.id, now.version, { negative: true })).toThrow('ordinary expense');
    // Deleting a refund frees its share; restoring is checked again.
    const gone = ledger.entries.setDeleted(first.id, true, first.version);
    refund(300);
    expect(() => ledger.entries.setDeleted(first.id, false, gone.version)).toThrow('more than it cost');
  });

  it('search filters combine and escape wildcards', () => {
    const { ledger, account, category } = testLedger();
    const a = account('A');
    const groceries = category('expense', 'Groceries').id;
    ledger.entries.save({ kind: 'expense', account_id: a.id, category_id: groceries, amount_minor: 500, occurred_at: at, note: 'Tesco' });
    ledger.entries.save({ kind: 'expense', account_id: a.id, category_id: category('expense', 'Coffee').id, amount_minor: 300, occurred_at: at, note: '100% Arabica' });
    expect(ledger.entries.search({ text: 'tesc' })).toHaveLength(1);
    expect(ledger.entries.search({ text: '%' })).toHaveLength(1);
    expect(ledger.entries.search({ category_ids: [category('expense', 'Eating out').id] })).toHaveLength(1);
    expect(ledger.entries.search({ min_minor: 400 })).toHaveLength(1);
    expect(ledger.entries.search({ start: '2026-11-11T00:00:00.000Z' })).toHaveLength(0);
  });

  it('patch changes only the given fields and refuses a no-op', () => {
    const { ledger, account, category, balance } = testLedger();
    const a = account('A', 1_000);
    const entry = ledger.entries.save({ kind: 'expense', account_id: a.id, category_id: category('expense', 'Groceries').id, amount_minor: 500, occurred_at: at, note: 'Tesco' });
    const patched = ledger.entries.patch(entry.id, entry.version, { amount_minor: 600 });
    expect(patched).toMatchObject({ note: 'Tesco', amount_minor: 600 });
    expect(balance(a.id)).toBe(400);
    expect(() => ledger.entries.patch(entry.id, patched.version, { note: 'Tesco' })).toThrow('changes nothing');
  });
});

describe('balance correction', () => {
  it('records the difference as a tagged entry and rejects a stale screen', () => {
    const { ledger, account, balance } = testLedger();
    const a = account('A', 1_000);
    const entry = ledger.entries.correctBalance(a.id, 750, a.version)!;
    expect(entry).toMatchObject({ kind: 'expense', amount_minor: 250, is_adjustment: 1 });
    expect(balance(a.id)).toBe(750);
    expect(() => ledger.entries.correctBalance(a.id, 500, a.version)).toThrow('changed elsewhere');
    expect(ledger.entries.correctBalance(a.id, 750, ledger.accounts.find(a.id).version)).toBeNull();
    expect(ledger.entries.totals({ exclude_adjustments: true }, 'GBP').expense).toBe(0);
    ledger.entries.setDeleted(entry.id, true, entry.version);
    expect(balance(a.id)).toBe(1_000);
  });
});

describe('currencies', () => {
  it('keeps the original amount and the applied rate, however rates move later', () => {
    const { ledger, account, category, balance } = testLedger();
    const a = account('A', 10_000);
    const travel = category('expense', 'Travel').id;
    const input = { kind: 'expense', account_id: a.id, category_id: travel, amount_minor: 2_000, currency: 'EUR', occurred_at: at } as const;
    expect(() => ledger.entries.save({ ...input })).toThrow('No exchange rate');
    ledger.rates.setManual('EUR', 'GBP', '0.85');
    const entry = ledger.entries.save({ ...input });
    expect(entry).toMatchObject({ amount_minor: 1_700, source_amount_minor: 2_000, source_currency: 'EUR', applied_rate: '0.85', currency: 'GBP' });
    ledger.rates.setManual('EUR', 'GBP', '0.9');
    // Editing the note keeps the saved conversion...
    const renamed = ledger.entries.patch(entry.id, entry.version, { note: 'Hotel' });
    expect(renamed.amount_minor).toBe(1_700);
    // ...changing the amount reprices it, and an exact amount overrides any rate.
    expect(ledger.entries.patch(entry.id, renamed.version, { amount_minor: 1_000 }).amount_minor).toBe(900);
    const exact = ledger.entries.save({ ...input, account_amount_minor: 1_723 });
    expect(exact).toMatchObject({ amount_minor: 1_723, conversion_source: 'exact_amount' });
    expect(balance(a.id)).toBe(10_000 - 900 - 1_723);
  });

  it('uses reference rates through the euro and reports missing rates', () => {
    const { ledger, account, sqlite } = testLedger();
    const usd = account('Dollars', 10_000, { currency: 'USD' });
    account('Pounds', 5_000);
    expect(ledger.accounts.totals(ledger.accounts.list(), 'GBP')).toMatchObject({ total: 5_000, ratesNeeded: ['USD'] });
    const insert = sqlite.prepare("INSERT INTO exchange_rates VALUES ('EUR', ?, 'reference', ?, '2026-11-10T00:00:00.000Z')");
    insert.run('USD', '1.1');
    insert.run('GBP', '0.88');
    expect(ledger.rates.rate('USD', 'GBP')).toMatchObject({ rate: '0.8', source: 'reference' });
    expect(ledger.accounts.totals(ledger.accounts.list(), 'GBP')).toMatchObject({ total: 13_000, ratesNeeded: [] });
    expect(usd.currency).toBe('USD');
  });

  it('validates the rate provider answer before storing it', async () => {
    const { ledger } = testLedger();
    const answer = (body: unknown) => (async () => ({ ok: true, json: async () => body })) as unknown as typeof fetch;
    await expect(ledger.rates.refresh(answer({ nope: true }))).rejects.toThrow();
    await expect(ledger.rates.refresh(answer([{ base: 'EUR', quote: 'GBP', rate: -1, date: '2026-11-10' }]))).rejects.toThrow();
    expect(ledger.rates.list()).toHaveLength(0);
    await ledger.rates.refresh(answer([{ base: 'EUR', quote: 'GBP', rate: 0.88, date: '2026-11-10' }, { base: 'EUR', quote: 'XXX', rate: 2, date: '2026-11-10' }]));
    expect(ledger.rates.list()).toHaveLength(1);
  });
});

describe('credit cards', () => {
  it('finds statement dates, clamping to short months', () => {
    const cycle = new StatementCycle(31, 15);
    const closed = cycle.lastClosed(new Date(2026, 2, 10));
    expect(dayKey(closed)).toBe('2026-02-28');
    expect(dayKey(cycle.dueAfter(closed))).toBe('2026-03-15');
    expect(dayKey(cycle.nextClosing(closed))).toBe('2026-03-31');
    // A statement closes at the end of its day, so on the day itself it is still open.
    expect(dayKey(new StatementCycle(5, 25).lastClosed(new Date(2026, 10, 5)))).toBe('2026-10-05');
  });

  it('splits what is owed into payable and outstanding', () => {
    const { ledger, account, category } = testLedger('2026-11-11T12:00:00Z');
    const current = account('Current', 100_000);
    const card = account('Card', 0, { account_type: 'credit_card', statement_day: 5, due_day: 25, payment_account_id: current.id });
    const groceries = category('expense', 'Groceries').id;
    const spend = (amount: number, when: string, negative = false) =>
      ledger.entries.save({ kind: 'expense', negative, account_id: card.id, category_id: groceries, amount_minor: amount, occurred_at: when });
    const statement = () => ledger.cards.statement(ledger.accounts.get(card.id))!;
    spend(10_000, '2026-11-01T10:00:00Z'); // before the 5 Nov statement
    spend(3_000, '2026-11-08T10:00:00Z'); // current cycle
    expect(statement()).toMatchObject({ payable: 10_000, outstanding: 3_000, statement_closed_on: '2026-11-05', payment_due_on: '2026-11-25', next_statement_on: '2026-12-05' });
    ledger.entries.save({ kind: 'transfer', account_id: current.id, destination_id: card.id, amount_minor: 4_000, occurred_at: '2026-11-09T10:00:00Z' });
    expect(statement()).toMatchObject({ payable: 6_000, outstanding: 3_000 });
    spend(5_000, '2026-11-10T10:00:00Z', true); // a refund: outstanding first, then payable
    expect(statement()).toMatchObject({ payable: 4_000, outstanding: 0 });
  });

  it('requires card settings and refuses type conversion', () => {
    const { ledger, account } = testLedger();
    expect(() => account('Card', 0, { account_type: 'credit_card' })).toThrow('statement day');
    const plain = account('Plain');
    expect(() => ledger.accounts.save({ ...plain, account_type: 'credit_card', statement_day: 1, due_day: 2 }, plain)).toThrow('credit card');
  });
});

describe('valued accounts', () => {
  it('are worth their latest valuation plus later postings', () => {
    const { ledger, account, category, balance } = testLedger();
    const pension = account('Pension', 100_000, { account_type: 'valued' });
    const salary = category('income', 'Salary').id;
    const pay = (when: string) => ledger.entries.save({ kind: 'income', account_id: pension.id, category_id: salary, amount_minor: 5_000, occurred_at: when });
    pay('2026-09-01T10:00:00Z');
    expect(balance(pension.id)).toBe(105_000);
    ledger.valuations.create(pension.id, 120_000, '2026-10-01T10:00:00Z');
    pay('2026-10-15T10:00:00Z');
    expect(balance(pension.id)).toBe(125_000);
    expect(ledger.accounts.balance(ledger.accounts.find(pension.id), '2026-09-15T00:00:00.000Z')).toBe(105_000);
    const [first] = ledger.valuations.list(pension.id);
    expect(first).toMatchObject({ previous_minor: 105_000, change_minor: 15_000 });
    // A change in value is never income.
    expect(ledger.entries.totals({}, 'GBP').income).toBe(10_000);
    expect(() => ledger.valuations.create(pension.id, 1, '2026-10-01T10:00:00Z')).toThrow('already a valuation');
    expect(() => ledger.entries.correctBalance(pension.id, 1, ledger.accounts.find(pension.id).version)).toThrow('valuation');
    expect(() => ledger.accounts.save({ ...ledger.accounts.find(pension.id), account_type: 'standard' }, ledger.accounts.find(pension.id))).toThrow('valuations');
  });
});

describe('recurring entries', () => {
  it('keeps its anchor day through short months', () => {
    const rule = new RecurrenceRule('2026-01-31', '09:00', 'monthly', 1);
    expect([0, 1, 2].map((index) => dayKey(rule.dueAt(index)!))).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    expect(new RecurrenceRule('2026-01-01', '09:00', 'weekly', 2, '2026-01-20').dueAt(2)).toBeNull();
  });

  it('records each due occurrence exactly once, however often it runs', () => {
    const { ledger, clock, account, category, balance } = testLedger('2026-11-11T12:00:00Z');
    const a = account('A', 10_000);
    const template = { kind: 'expense' as const, account_id: a.id, category_id: category('expense', 'Subscriptions').id, amount_minor: 999, note: 'Streamflix' };
    const schedule = ledger.capture.saveSchedule({ name: 'Streamflix', template, frequency: 'monthly', every: 1, start_date: '2026-09-15' });
    expect(ledger.capture.runDue()).toBe(2); // 15 Sep and 15 Oct
    expect(ledger.capture.runDue()).toBe(0);
    expect(balance(a.id)).toBe(10_000 - 2 * 999);
    clock.now = new Date('2026-11-15T12:00:00Z');
    expect(ledger.capture.runDue()).toBe(1);
    const entries = ledger.entries.search();
    expect(entries.map((entry) => dayKey(entry.occurred_at))).toEqual(['2026-11-15', '2026-10-15', '2026-09-15']);
    expect(ledger.audit.history(entries[0].id)[0].via).toBe('schedule');
    // Generated entries are independent: deleting one does not bring it back.
    ledger.entries.setDeleted(entries[0].id, true, entries[0].version);
    expect(ledger.capture.runDue()).toBe(0);
    expect(() => ledger.capture.saveSchedule({ name: 'x', template, frequency: 'weekly', every: 1, start_date: '2026-09-15' }, schedule.id)).toThrow('already run');
  });

  it('pauses with a reason when its account is archived', () => {
    const { ledger, account, category } = testLedger();
    const a = account('A');
    const template = { kind: 'expense' as const, account_id: a.id, category_id: category('expense', 'Groceries').id, amount_minor: 100 };
    const schedule = ledger.capture.saveSchedule({ name: 'Weekly shop', template, frequency: 'weekly', every: 1, start_date: '2026-11-01' });
    ledger.accounts.setArchived(a.id, true);
    expect(ledger.capture.runDue()).toBe(0);
    expect(ledger.capture.findSchedule(schedule.id)).toMatchObject({ active: 0, error: 'A is archived' });
    expect(() => ledger.capture.saveSchedule({ name: 'Bad', template: { kind: 'expense', account_id: a.id, amount_minor: 1 }, frequency: 'daily', every: 1, start_date: '2026-11-01' })).toThrow();
  });
});

describe('organisation', () => {
  it('keeps the category tree to two levels and archives used categories', () => {
    const { ledger, account, category } = testLedger();
    const eating = category('expense', 'Eating out');
    const coffee = category('expense', 'Coffee');
    expect(() => ledger.categories.save({ name: 'Flat white', kind: 'expense', parent_id: coffee.id })).toThrow('top-level');
    expect(() => ledger.categories.save({ name: 'Eating out', kind: 'expense', parent_id: category('expense', 'Home').id }, eating)).toThrow('must remain a parent');
    const a = account('A');
    ledger.entries.save({ kind: 'expense', account_id: a.id, category_id: coffee.id, amount_minor: 300, occurred_at: at });
    expect(() => ledger.categories.delete(coffee.id)).toThrow('in use');
    // Moving a subcategory reorganises past reports without touching transactions.
    ledger.categories.save({ name: 'Coffee', kind: 'expense', parent_id: category('expense', 'Shopping').id }, coffee);
    expect(ledger.reports.byCategory('expense', {}, 'GBP').categories[0].name).toBe('Shopping');
    ledger.categories.setArchived(eating.id, true);
    expect(ledger.categories.list({ kind: 'expense' }).some((item) => item.name === 'Restaurants')).toBe(false);
  });

  it('saved views select accounts and follow their new-account policy', () => {
    const { ledger, account } = testLedger();
    const [a, b] = [account('A', 100), account('B', 200)];
    const auto = ledger.views.save({ name: 'Auto', include_new: true, account_ids: [a.id] });
    const fixed = ledger.views.save({ name: 'Fixed', include_new: false, account_ids: [b.id] });
    const c = account('C', 300);
    expect(ledger.views.accountIds(auto.id).sort()).toEqual([a.id, c.id].sort());
    expect(ledger.views.accountIds(fixed.id)).toEqual([b.id]);
    expect(() => ledger.views.save({ name: 'auto', include_new: false, account_ids: [] })).toThrow('already');
  });

  it('archives accounts with history and deletes unused ones', () => {
    const { ledger, account, category } = testLedger();
    const [used, unused] = [account('Used'), account('Unused')];
    ledger.entries.save({ kind: 'expense', account_id: used.id, category_id: category('expense', 'Groceries').id, amount_minor: 1, occurred_at: at });
    expect(() => ledger.accounts.delete(used.id)).toThrow('history');
    ledger.accounts.delete(unused.id);
    ledger.accounts.setArchived(used.id, true);
    expect(ledger.accounts.list()).toHaveLength(0);
    expect(() => ledger.entries.save({ kind: 'expense', account_id: used.id, category_id: category('expense', 'Groceries').id, amount_minor: 1, occurred_at: at })).toThrow('archived');
  });
});

describe('reports', () => {
  it('totals months and net worth by group', () => {
    const { ledger, account, category } = testLedger('2026-11-11T12:00:00Z');
    const a = account('A', 10_000);
    ledger.entries.save({ kind: 'expense', account_id: a.id, category_id: category('expense', 'Groceries').id, amount_minor: 1_000, occurred_at: '2026-10-10T10:00:00Z' });
    ledger.entries.save({ kind: 'income', account_id: a.id, category_id: category('income', 'Salary').id, amount_minor: 3_000, occurred_at: '2026-11-02T10:00:00Z' });
    const months = ledger.reports.months(2, 1, 'GBP');
    expect(months.map((month) => [month.income, month.expense])).toEqual([[0, 1_000], [3_000, 0]]);
    // Months before the first entry are left off.
    const worth = ledger.reports.netWorth(6, 1, 'GBP');
    expect(worth.map((point) => point.total)).toEqual([9_000, 12_000]);
  });
});

describe('backup', () => {
  it('round-trips the whole ledger and refuses damaged files without changing anything', () => {
    const source = testLedger();
    const a = source.account('A', 1_000);
    source.ledger.entries.save({ kind: 'expense', account_id: a.id, category_id: source.category('expense', 'Groceries').id, amount_minor: 250, occurred_at: at, note: 'Tesco' });
    const file = JSON.parse(JSON.stringify(source.ledger.backup.export()));

    const target = testLedger();
    const other = target.account('Other', 5);
    expect(() => target.ledger.backup.restore({ format: 'something-else' })).toThrow("isn't a backup");
    const damaged = JSON.parse(JSON.stringify(file));
    damaged.tables.transactions[0].account_id = 'missing';
    expect(() => target.ledger.backup.restore(damaged)).toThrow('nothing was changed');
    expect(target.balance(other.id)).toBe(5);

    target.ledger.backup.restore(file);
    expect(target.ledger.accounts.list().map((account) => account.name)).toEqual(['A']);
    expect(target.balance(a.id)).toBe(750);
    expect(target.ledger.entries.search()[0].note).toBe('Tesco');
  });
});
