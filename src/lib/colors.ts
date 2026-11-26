/** Escala de precios calculada sobre los establecimientos visibles. */

export interface PriceScale {
  low: number;
  high: number;
}

export type PriceLevel = 'low' | 'mid' | 'high' | 'unknown';

const LEVEL_COLORS: Record<Exclude<PriceLevel, 'unknown'>, string> = {
  low: '#059669', // esmeralda
  mid: '#d97706', // ámbar
  high: '#dc2626', // rojo
};

/** Cuartiles 33/66; con menos de tres precios se usa el rango mínimo/máximo. */
export function priceScale(prices: number[]): PriceScale {
  const values = prices.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (values.length === 0) return { low: NaN, high: NaN };
  if (values.length === 1) {
    const margin = Math.max(0.01, values[0]! * 0.02);
    return { low: values[0]! - margin, high: values[0]! + margin };
  }
  const quantile = (fraction: number) => {
    const position = (values.length - 1) * fraction;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    return values[lower]! + (values[upper]! - values[lower]!) * (position - lower);
  };
  const low = quantile(1 / 3);
  const high = quantile(2 / 3);
  return high > low ? { low, high } : { low: values[0]!, high: values[values.length - 1]! };
}

export function priceLevel(price: number | null | undefined, scale: PriceScale): PriceLevel {
  if (price === null || price === undefined || !Number.isFinite(price)) return 'unknown';
  if (!Number.isFinite(scale.low) || !Number.isFinite(scale.high)) return 'unknown';
  if (price <= scale.low) return 'low';
  if (price >= scale.high) return 'high';
  return 'mid';
}

export function priceColor(level: PriceLevel): string | null {
  return level === 'unknown' ? null : LEVEL_COLORS[level];
}
