import type { Store } from './db';
import { LedgerError } from './db';
import { isCurrency, type Currency } from './money';

/** Small key/value preferences that belong with the ledger and travel in its backups. */
export class SettingsService {
  constructor(private store: Store) {}

  get(key: string): string | undefined {
    return this.store.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key])?.value;
  }

  set(key: string, value: string) {
    this.store.atomic(() =>
      this.store.run(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
        [key, value],
      ),
    );
  }

  get primaryCurrency(): Currency {
    const value = this.get('primary_currency');
    return isCurrency(value) ? value : 'GBP';
  }

  setPrimaryCurrency(currency: string) {
    if (!isCurrency(currency)) throw new LedgerError('Choose a supported currency');
    this.set('primary_currency', currency);
  }

  /** The day of the month on which a reporting month starts. */
  get monthStartDay(): number {
    return Number(this.get('month_start_day') ?? 1);
  }

  setMonthStartDay(day: number) {
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      throw new LedgerError('The month can start on day 1 to 31');
    }
    this.set('month_start_day', String(day));
  }
}
