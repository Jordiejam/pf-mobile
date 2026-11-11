import { describe, expect, it } from 'vitest';
import { seedDemo } from '../src/core';
import { testLedger } from './helpers';

const at = '2026-11-10T10:00:00.000Z';

function setup() {
  const context = testLedger();
  const current = context.account('Current', 10_000);
  const groceries = context.category('expense', 'Groceries').id;
  const create = (amount: string, extra = {}) => ({
    action: 'create', kind: 'expense', account_id: current.id, category_id: groceries, amount, occurred_at: at, note: 'Tesco', ...extra,
  });
  return { ...context, current, groceries, create };
}

describe('preview then commit', () => {
  it('previews without saving, then commits exactly what was shown', () => {
    const { ledger, balance, current, create } = setup();
    const preview = ledger.changes.preview([create('12.50'), create('3.00', { note: 'Bakery' })]);
    expect(preview.problems).toEqual([]);
    expect(preview.lines.map((line) => line.amount)).toEqual(['−£12.50', '−£3.00']);
    expect(preview.balances).toEqual([{ account_id: current.id, name: 'Current', before: '£100.00', after: '£84.50' }]);
    expect(balance(current.id)).toBe(10_000);
    expect(ledger.entries.search()).toHaveLength(0);

    const result = ledger.changes.commit(preview.preview_id!);
    expect(result.saved).toHaveLength(2);
    expect(balance(current.id)).toBe(8_450);
    const [entry] = ledger.entries.search();
    expect(ledger.audit.history(entry.id)[0].via).toBe('assistant');
  });

  it('committing twice saves once', () => {
    const { ledger, balance, current, create } = setup();
    const preview = ledger.changes.preview([create('10.00')]);
    const first = ledger.changes.commit(preview.preview_id!);
    expect(ledger.changes.commit(preview.preview_id!)).toEqual(first);
    expect(balance(current.id)).toBe(9_000);
    expect(ledger.entries.search()).toHaveLength(1);
  });

  it('reports every problem at once and stores nothing', () => {
    const { ledger, create } = setup();
    const preview = ledger.changes.preview([
      create('10.00'),
      create('abc'),
      create('5.00', { category_id: 'missing' }),
      { action: 'delete', id: 'missing', version: 1 },
      { action: 'nonsense' },
    ]);
    expect(preview.preview_id).toBeNull();
    expect(preview.problems.map((problem) => problem.index)).toEqual([1, 2, 3, 4]);
    expect(preview.lines).toEqual([]);
    expect(ledger.entries.search()).toHaveLength(0);
  });

  it('is all or nothing: one stale change stops the whole commit', () => {
    const { ledger, balance, current, groceries, create } = setup();
    const entry = ledger.entries.save({ kind: 'expense', account_id: current.id, category_id: groceries, amount_minor: 500, occurred_at: at });
    const preview = ledger.changes.preview([create('10.00'), { action: 'delete', id: entry.id, version: entry.version }]);
    expect(preview.balances[0].after).toBe('£90.00');
    // The entry is edited in the app after the preview.
    ledger.entries.patch(entry.id, entry.version, { amount_minor: 700 });
    expect(() => ledger.changes.commit(preview.preview_id!)).toThrow('changed elsewhere');
    expect(balance(current.id)).toBe(10_000 - 700);
    expect(ledger.entries.search()).toHaveLength(1);
  });

  it('refuses when the outcome would differ from the preview', () => {
    const { ledger, balance, current, create } = setup();
    const preview = ledger.changes.preview([create('10.00')]);
    // Another entry lands first, so the balances shown are no longer true.
    ledger.entries.save({ kind: 'expense', account_id: current.id, category_id: ledger.categories.list({ kind: 'expense' })[0].id, amount_minor: 100, occurred_at: at });
    expect(() => ledger.changes.commit(preview.preview_id!)).toThrow('Something changed');
    expect(balance(current.id)).toBe(9_900);
  });

  it('expires, flags duplicates and handles edits, restores and valuations', () => {
    const { ledger, clock, account, balance, current, groceries, create } = setup();
    const existing = ledger.entries.save({ kind: 'expense', account_id: current.id, category_id: groceries, amount_minor: 1_250, occurred_at: at, note: 'Tesco' });
    const duplicate = ledger.changes.preview([create('12.50')]);
    expect(duplicate.duplicates).toHaveLength(1);
    expect(duplicate.duplicates[0].existing).toContain('Tesco');

    const pension = account('Pension', 100_000, { account_type: 'valued' });
    const preview = ledger.changes.preview([
      { action: 'edit', id: existing.id, version: existing.version, fields: { amount: '20.00' } },
      { action: 'valuation', account_id: pension.id, amount: '1200.00', valued_at: at },
    ]);
    expect(preview.lines[0]).toMatchObject({ action: 'edit', amount: '−£20.00' });
    expect(preview.lines[0].was).toContain('£12.50');
    ledger.changes.commit(preview.preview_id!);
    expect([balance(current.id), balance(pension.id)]).toEqual([8_000, 120_000]);

    const late = ledger.changes.preview([create('1.00')]);
    clock.now = new Date(clock.now.getTime() + 31 * 60_000);
    expect(() => ledger.changes.commit(late.preview_id!)).toThrow('expired');
    expect(() => ledger.changes.commit('missing')).toThrow('no longer exists');
    expect(() => ledger.changes.preview([])).toThrow();
    expect(() => ledger.changes.preview(Array(51).fill(create('1.00')))).toThrow('at most 50');
  });
});

describe('sample data', () => {
  it('loads cleanly', () => {
    const { ledger } = testLedger();
    seedDemo(ledger);
    expect(ledger.accounts.list()).toHaveLength(4);
    expect(ledger.entries.search({ limit: 500 }).length).toBeGreaterThan(40);
    const card = ledger.accounts.list().find((account) => account.account_type === 'credit_card')!;
    expect(ledger.cards.statement(card)).not.toBeNull();
  });
});
