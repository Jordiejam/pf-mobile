import type { Ledger } from './index';
import { addDays, startOfDay } from './time';

const EXPENSES: [string, string[]][] = [
  ['Groceries', []],
  ['Eating out', ['Restaurants', 'Takeaway', 'Coffee', 'Drinks']],
  ['Transport', ['Public transport', 'Fuel', 'Taxi']],
  ['Home', ['Rent or mortgage', 'Bills', 'Household']],
  ['Shopping', ['Clothes', 'Electronics', 'Gifts']],
  ['Health', []],
  ['Entertainment', ['Subscriptions', 'Going out']],
  ['Travel', []],
  ['Other', []],
];
const INCOME = ['Salary', 'Interest', 'Gifts received', 'Other income'];
const GROUPS = ['Cash', 'Current accounts', 'Savings', 'Credit cards', 'Investments'];

/** A first-run starting point: common groups and categories, all editable. */
export function seedDefaults(ledger: Ledger) {
  ledger.store.atomic(() => {
    GROUPS.forEach((name) => ledger.accounts.saveGroup(name));
    for (const [name, children] of EXPENSES) {
      const parent = ledger.categories.save({ name, kind: 'expense' });
      children.forEach((child) => ledger.categories.save({ name: child, kind: 'expense', parent_id: parent.id }));
    }
    INCOME.forEach((name) => ledger.categories.save({ name, kind: 'income' }));
    ledger.settings.set('seeded', '1');
  });
}

/** Invented accounts and three months of entries, for trying the app out. */
export function seedDemo(ledger: Ledger) {
  ledger.store.atomic(() => {
    const group = (name: string) => ledger.accounts.groups().find((item) => item.name === name) ?? ledger.accounts.saveGroup(name);
    const category = (kind: 'income' | 'expense', name: string) =>
      ledger.categories.list({ kind }).find((item) => item.name === name) ?? ledger.categories.save({ name, kind });
    const currency = ledger.settings.primaryCurrency;
    const account = (name: string, groupName: string, opening: number, extra = {}) =>
      ledger.accounts.save({
        name, group_id: group(groupName).id, account_type: 'standard', currency, opening_minor: opening, ...extra,
      });
    const current = account('Everyday (sample)', 'Current accounts', 184_250);
    const savings = account('Rainy day (sample)', 'Savings', 520_000);
    const card = account('Credit card (sample)', 'Credit cards', 0, {
      account_type: 'credit_card', statement_day: 5, due_day: 25, payment_account_id: current.id,
    });
    const pension = account('Pension (sample)', 'Investments', 1_850_000, { account_type: 'valued' });

    const today = startOfDay(ledger.store.now());
    const at = (daysAgo: number, hour = 12) => new Date(addDays(today, -daysAgo).getTime() + hour * 3_600_000).toISOString();
    const spend = (daysAgo: number, amount: number, note: string, categoryName: string, from = current.id) =>
      ledger.entries.save({
        kind: 'expense', account_id: from, category_id: category('expense', categoryName).id,
        amount_minor: amount, occurred_at: at(daysAgo), note,
      });

    for (let month = 2; month >= 0; month -= 1) {
      const base = month * 30;
      ledger.entries.save({
        kind: 'income', account_id: current.id, category_id: category('income', 'Salary').id,
        amount_minor: 265_000, occurred_at: at(base + 27, 9), note: 'Acme Ltd',
      });
      spend(base + 26, 95_000, 'Landlord', 'Rent or mortgage');
      spend(base + 24, 6_420, 'Energy Co', 'Bills');
      ledger.entries.save({
        kind: 'transfer', account_id: current.id, destination_id: savings.id, amount_minor: 30_000, occurred_at: at(base + 25),
      });
      [[22, 5_480], [15, 6_215], [8, 4_990], [2, 7_130]].forEach(([day, amount]) => spend(base + day, amount, 'Corner Market', 'Groceries', card.id));
      [[20, 320], [13, 340], [6, 320]].forEach(([day, amount]) => spend(base + day, amount, 'Bean There', 'Coffee', card.id));
      spend(base + 18, 4_250, 'Luigi\'s', 'Restaurants', card.id);
      spend(base + 11, 1_099, 'Streamflix', 'Subscriptions', card.id);
      spend(base + 9, 3_600, 'City Transit', 'Public transport');
      if (month > 0) {
        ledger.entries.save({
          kind: 'transfer', account_id: current.id, destination_id: card.id, amount_minor: 25_000, occurred_at: at(base + 3),
        });
      }
      ledger.valuations.create(pension.id, 1_850_000 + (3 - month) * 21_500, at(base + 1, 18));
    }
    const shoes = spend(12, 8_900, 'Trail Shoes Co', 'Clothes', card.id);
    ledger.entries.save({
      kind: 'expense', negative: true, refund_of_id: shoes.id, account_id: card.id,
      category_id: shoes.category_id, amount_minor: 8_900, occurred_at: at(5), note: 'Trail Shoes Co',
    });
  });
}
