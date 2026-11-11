import { LedgerError, type Store } from './db';
import { CURRENCIES, isCurrency, Money, type Currency } from './money';

export interface StoredRate {
  base: string;
  quote: string;
  source: 'manual' | 'reference';
  rate: string;
  as_of: string;
}

export interface AppliedRate {
  rate: string;
  source: 'same_currency' | 'manual' | 'reference';
  as_of: string | null;
}

const REFERENCE_BASE = 'EUR';
const ENDPOINT = 'https://api.frankfurter.dev/v2/providers/ecb/rates';
/** Reference quotes older than this are labelled as old. */
export const STALE_AFTER_DAYS = 4;

/**
 * Exchange rates. The person's own (manual) rates always win; otherwise public reference
 * quotes against the euro are used. Rates only ever price new conversions and present-day
 * totals: a saved transaction keeps the rate it was saved with.
 */
export class RateService {
  constructor(private store: Store) {}

  list(): StoredRate[] {
    return this.store.all<StoredRate>('SELECT * FROM exchange_rates ORDER BY source, base, quote');
  }

  private stored(base: string, quote: string, source: string) {
    return this.store.get<StoredRate>(
      'SELECT * FROM exchange_rates WHERE base = ? AND quote = ? AND source = ?',
      [base, quote, source],
    );
  }

  /** The rate that turns one unit of `from` into `to`, or null when none is known. */
  rate(from: string, to: string): AppliedRate | null {
    if (from === to) return { rate: '1', source: 'same_currency', as_of: null };
    const direct = this.stored(from, to, 'manual');
    if (direct) return { rate: direct.rate, source: 'manual', as_of: direct.as_of };
    const inverse = this.stored(to, from, 'manual');
    if (inverse) {
      return { rate: Money.divideRates('1', inverse.rate), source: 'manual', as_of: inverse.as_of };
    }
    const leg = (currency: string) =>
      currency === REFERENCE_BASE
        ? { rate: '1', as_of: null as string | null }
        : this.stored(REFERENCE_BASE, currency, 'reference');
    const [top, bottom] = [leg(to), leg(from)];
    if (!top || !bottom) return null;
    const dates = [top.as_of, bottom.as_of].filter((date): date is string => !!date).sort();
    return { rate: Money.divideRates(top.rate, bottom.rate), source: 'reference', as_of: dates[0] ?? null };
  }

  /** An amount in another currency at today's rate, or null when no rate is known. */
  convert(minor: number, from: string, to: string): number | null {
    const applied = this.rate(from, to);
    return applied ? Money.convert(Math.abs(minor), applied.rate) * Math.sign(minor) : null;
  }

  setManual(base: string, quote: string, rateText: string) {
    const rate = Money.rate(rateText);
    if (!isCurrency(base) || !isCurrency(quote) || base === quote) {
      throw new LedgerError('Choose two different currencies');
    }
    if (!rate) throw new LedgerError('Enter a rate above zero, such as 1.17');
    this.store.atomic(() => {
      // One manual rate per pair, whichever way round it was entered.
      this.store.run(
        "DELETE FROM exchange_rates WHERE source = 'manual' AND ((base = ? AND quote = ?) OR (base = ? AND quote = ?))",
        [base, quote, quote, base],
      );
      this.store.run(
        "INSERT INTO exchange_rates (base, quote, source, rate, as_of) VALUES (?, ?, 'manual', ?, ?)",
        [base, quote, rate, this.store.nowIso()],
      );
    });
  }

  removeManual(base: string, quote: string) {
    this.store.atomic(() =>
      this.store.run("DELETE FROM exchange_rates WHERE source = 'manual' AND base = ? AND quote = ?", [base, quote]),
    );
  }

  /** Whether the reference rates are missing or more than a day old. */
  refreshDue(): boolean {
    const row = this.store.get<{ oldest: string | null; count: number }>(
      "SELECT MIN(as_of) AS oldest, COUNT(*) AS count FROM exchange_rates WHERE source = 'reference'",
    );
    if (!row || row.count < CURRENCIES.length - 1 || !row.oldest) return true;
    return this.store.now().getTime() - new Date(row.oldest).getTime() > 24 * 3600 * 1000;
  }

  /**
   * Fetches public ECB reference quotes. The request carries only currency codes: no
   * balances, transactions or anything identifying.
   */
  async refresh(fetcher: typeof fetch): Promise<number> {
    const quotes = CURRENCIES.filter((code) => code !== REFERENCE_BASE);
    const response = await fetcher(`${ENDPOINT}?base=${REFERENCE_BASE}&quotes=${quotes.join(',')}`);
    if (!response.ok) throw new Error(`The rate provider answered ${response.status}`);
    const rows = RateService.validate(await response.json(), quotes);
    this.store.atomic(() => {
      for (const [quote, { rate, date }] of rows) {
        this.store.run(
          `INSERT INTO exchange_rates (base, quote, source, rate, as_of) VALUES (?, ?, 'reference', ?, ?)
           ON CONFLICT (base, quote, source) DO UPDATE SET rate = excluded.rate, as_of = excluded.as_of
           WHERE excluded.as_of >= exchange_rates.as_of`,
          [REFERENCE_BASE, quote, rate, date],
        );
      }
    });
    return rows.size;
  }

  /** Checks the provider's answer, which is untrusted, before anything is stored. */
  static validate(body: unknown, quotes: readonly Currency[]) {
    if (!Array.isArray(body)) throw new Error('Unexpected answer from the rate provider');
    const rows = new Map<string, { rate: string; date: string }>();
    for (const row of body) {
      const quote = String(row?.quote ?? '').toUpperCase();
      if (String(row?.base ?? '').toUpperCase() !== REFERENCE_BASE || !quotes.includes(quote as Currency)) continue;
      const rate = Money.rate(Number(row.rate).toFixed(8));
      const date = new Date(`${row.date}T00:00:00Z`);
      if (!rate || Number.isNaN(date.getTime()) || Number(row.rate) > 1e6) {
        throw new Error('The rate provider sent an invalid rate');
      }
      rows.set(quote, { rate, date: date.toISOString() });
    }
    if (rows.size === 0) throw new Error('The rate provider sent no usable rates');
    return rows;
  }
}
