/** Money is held as whole minor units (pence, cents); rates as exact decimals. */

/** Every supported currency uses two decimal places. */
export const CURRENCIES = [
  'GBP', 'EUR', 'USD', 'AUD', 'CAD', 'CHF', 'CZK', 'DKK', 'NOK', 'NZD', 'PLN', 'SEK',
] as const;
export type Currency = (typeof CURRENCIES)[number];

export const SYMBOLS: Record<Currency, string> = {
  GBP: '£', EUR: '€', USD: '$', AUD: 'A$', CAD: 'C$', CHF: 'CHF ', CZK: 'Kč ', DKK: 'kr ',
  NOK: 'kr ', NZD: 'NZ$', PLN: 'zł ', SEK: 'kr ',
};

export function isCurrency(value: unknown): value is Currency {
  return typeof value === 'string' && (CURRENCIES as readonly string[]).includes(value);
}

const RATE_PLACES = 12;
const RATE_SCALE = 10n ** BigInt(RATE_PLACES);

/** A positive decimal string as a scaled integer, or null when it is not one. */
function scaled(decimal: string, places: number): bigint | null {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(decimal.trim());
  if (!match) return null;
  const fraction = match[2] ?? '';
  if (fraction.length > places) return null;
  return BigInt(match[1] + fraction.padEnd(places, '0'));
}

export const Money = {
  /** Parses "12.34", "12", "1,234.50" or "-3.2" into minor units; null when invalid. */
  parse(text: string): number | null {
    const cleaned = text.replace(/[,\s]/g, '').replace(/^[£$€]/, '');
    const negative = cleaned.startsWith('-');
    const value = scaled(negative ? cleaned.slice(1) : cleaned, 2);
    if (value === null || value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return negative ? -Number(value) : Number(value);
  },

  /** "1234.50" - plain, for inputs, exports and the assistant. */
  plain(minor: number): string {
    const sign = minor < 0 ? '-' : '';
    const abs = Math.abs(minor);
    return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  },

  /** "£1,234.50" with a true minus sign. */
  format(minor: number, currency: Currency | string, options: { sign?: boolean } = {}): string {
    const abs = Math.abs(minor);
    const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const symbol = SYMBOLS[currency as Currency] ?? `${currency} `;
    const sign = minor < 0 ? '−' : options.sign && minor > 0 ? '+' : '';
    return `${sign}${symbol}${whole}.${String(abs % 100).padStart(2, '0')}`;
  },

  /** A rate such as "1.1734" checked and normalised; null when it is not a positive rate. */
  rate(text: string): string | null {
    const value = scaled(text, RATE_PLACES);
    if (value === null || value === 0n) return null;
    return Money.rateText(value);
  },

  rateText(value: bigint): string {
    const digits = value.toString().padStart(RATE_PLACES + 1, '0');
    const fraction = digits.slice(-RATE_PLACES).replace(/0+$/, '');
    return digits.slice(0, -RATE_PLACES) + (fraction ? `.${fraction}` : '');
  },

  /** Converts minor units by a rate, rounding half up. */
  convert(minor: number, rate: string): number {
    const value = scaled(rate, RATE_PLACES);
    if (value === null) throw new Error('Invalid rate');
    return Number((BigInt(minor) * value + RATE_SCALE / 2n) / RATE_SCALE);
  },

  /** The rate that turns `from` minor units into `to`, to twelve places. */
  impliedRate(from: number, to: number): string {
    return Money.rateText((BigInt(to) * RATE_SCALE + BigInt(from) / 2n) / BigInt(from));
  },

  /** numerator / denominator of two rates, to twelve places. */
  divideRates(numerator: string, denominator: string): string {
    const top = scaled(numerator, RATE_PLACES);
    const bottom = scaled(denominator, RATE_PLACES);
    if (top === null || bottom === null || bottom === 0n) throw new Error('Invalid rate');
    return Money.rateText((top * RATE_SCALE + bottom / 2n) / bottom);
  },
};
