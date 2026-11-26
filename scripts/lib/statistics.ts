import { DATA_VERSION, FUEL_KEYS } from './types.js';
import type {
  FuelKey,
  FuelStation,
  FuelValueStats,
  GeoStats,
  SummaryStats,
} from './types.js';
import type { BuiltIndexes } from './indexes.js';

function roundPrice(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function valueStats(values: number[]): FuelValueStats {
  if (values.length === 0) return { count: 0, min: null, max: null, avg: null };
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    sum += value;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (min === Infinity) return { count: 0, min: null, max: null, avg: null };
  const count = values.filter(Number.isFinite).length;
  return {
    count,
    min: roundPrice(min),
    max: roundPrice(max),
    avg: roundPrice(sum / count),
  };
}

export function priceStatsFor(stations: FuelStation[], fuel: FuelKey): FuelValueStats {
  return valueStats(
    stations.map((station) => station.prices[fuel]).filter((value): value is number => value !== null),
  );
}

function allPriceStats(stations: FuelStation[]): Record<FuelKey, FuelValueStats> {
  return Object.fromEntries(FUEL_KEYS.map((fuel) => [fuel, priceStatsFor(stations, fuel)])) as Record<
    FuelKey,
    FuelValueStats
  >;
}

export interface StatisticsInput {
  stations: FuelStation[];
  indexes: BuiltIndexes;
  generatedAt: string;
  sourceUpdatedAt?: string;
  totals: SummaryStats['totals'];
  quality: SummaryStats['quality'];
}

export interface StatisticsOutput {
  provincias: Array<GeoStats>;
  municipios: Array<GeoStats & { provinceId: string }>;
  resumen: SummaryStats;
}

export function buildStatistics(input: StatisticsInput): StatisticsOutput {
  const provincias = [...input.indexes.provinces.values()]
    .map((index) => ({
      id: index.id,
      name: index.name,
      slug: index.slug,
      stationCount: index.stationCount,
      prices: allPriceStats(index.stations),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));

  const municipios = [...input.indexes.municipalities.values()]
    .map((index) => ({
      id: index.id,
      name: index.name,
      slug: index.slug,
      provinceId: index.provinceId,
      stationCount: index.stationCount,
      prices: allPriceStats(index.stations),
    }))
    .sort(
      (a, b) =>
        a.provinceId.localeCompare(b.provinceId) || a.name.localeCompare(b.name, 'es'),
    );

  return {
    provincias,
    municipios,
    resumen: {
      dataVersion: DATA_VERSION,
      generatedAt: input.generatedAt,
      sourceUpdatedAt: input.sourceUpdatedAt,
      totals: input.totals,
      prices: allPriceStats(input.stations),
      quality: input.quality,
    },
  };
}
