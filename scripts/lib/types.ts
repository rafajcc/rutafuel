/** Tipos del pipeline de datos. El formato de salida está versionado en DATA_VERSION. */

export const DATA_VERSION = 1;

/** Fuentes previstas. De momento sólo se ingiere la API del Ministerio. */
export const SOURCE_IDS = {
  minetur: 'MINETUR',
} as const;

export const FUEL_KEYS = ['g95', 'g98', 'goa', 'gop', 'glp'] as const;
export type FuelKey = (typeof FUEL_KEYS)[number];

export const FUEL_LABELS: Record<FuelKey, string> = {
  g95: 'Gasolina 95 E5',
  g98: 'Gasolina 98 E5',
  goa: 'Gasóleo A',
  gop: 'Gasóleo Premium',
  glp: 'GLP',
};

export interface FuelPrices {
  g95: number | null;
  g98: number | null;
  goa: number | null;
  gop: number | null;
  glp: number | null;
}

/** Valores originales conservados para auditoría de la normalización. */
export interface StationAudit {
  latitud: string;
  longitud: string;
  precios: Partial<Record<FuelKey, string>>;
}

export interface FuelStation {
  /** IDEESS oficial del Ministerio; estable entre actualizaciones. */
  id: string;
  /** Rótulo comercial tal como lo publica la fuente. */
  name?: string;
  address?: string;
  locality?: string;
  municipality: string;
  /** IDMunicipio oficial (único en la respuesta observada). */
  municipalityId: string;
  municipalitySlug: string;
  province: string;
  /** IDProvincia oficial con dos dígitos (INE). */
  provinceId: string;
  provinceSlug: string;
  postalCode?: string;
  lat: number;
  lon: number;
  schedule?: string;
  prices: FuelPrices;
  raw: StationAudit;
}

export interface Coordinates {
  lat: number;
  lon: number;
}

export type DiscardReason =
  | 'missing-id'
  | 'missing-location'
  | 'invalid-coordinates'
  | 'unparseable-record';

export interface DiscardedRecord {
  id?: string;
  reason: DiscardReason;
  detail: string;
}

export interface NormalizeResult {
  stations: FuelStation[];
  discarded: DiscardedRecord[];
  duplicateIds: string[];
  warnings: string[];
  withoutCoordinates: number;
  invalidPrices: number;
}

/** Respuesta real de la API de estaciones terrestres (campos utilizados). */
export interface MineturResponse {
  Fecha?: unknown;
  ListaEESSPrecio?: unknown;
  Nota?: unknown;
  ResultadoConsulta?: unknown;
}

export interface SourceInfo {
  id: typeof SOURCE_IDS.minetur;
  url: string;
  fetchedAt: string;
  sourceUpdatedAtRaw?: string;
  /** ISO sin offset: hora local peninsular declarada por la fuente. */
  sourceUpdatedAt?: string;
  recordsReceived: number;
  recordsProcessed: number;
  recordsDiscarded: number;
  recordsWithoutCoordinates: number;
  duplicateRecords: number;
}

export interface ValidationResult {
  ok: boolean;
  checkedAt: string;
  checks: Array<{
    name: string;
    ok: boolean;
    detail: string;
    severity: 'error' | 'warning';
  }>;
}

export interface DatasetMetadata {
  dataVersion: number;
  generatedAt: string;
  sources: SourceInfo[];
  validation: ValidationResult;
  totals: {
    stations: number;
    provinces: number;
    municipalities: number;
    discarded: number;
    duplicates: number;
    withoutCoordinates: number;
  };
}

export interface FuelValueStats {
  count: number;
  min: number | null;
  max: number | null;
  avg: number | null;
}

export interface GeoStats {
  id: string;
  name: string;
  slug: string;
  provinceId?: string;
  stationCount: number;
  prices: Record<FuelKey, FuelValueStats>;
}

export interface SummaryStats {
  dataVersion: number;
  generatedAt: string;
  sourceUpdatedAt?: string;
  totals: DatasetMetadata['totals'];
  prices: Record<FuelKey, FuelValueStats>;
  quality: {
    recordsWithoutPrices: number;
    invalidPrices: number;
    discarded: number;
    duplicates: number;
    withoutCoordinates: number;
  };
}

export interface ProvinceIndex {
  id: string;
  name: string;
  slug: string;
  stationCount: number;
  municipalities: Array<{
    id: string;
    name: string;
    slug: string;
    stationCount: number;
  }>;
  stations: FuelStation[];
}

export interface MunicipalityIndex {
  id: string;
  name: string;
  slug: string;
  provinceId: string;
  provinceName: string;
  provinceSlug: string;
  stationCount: number;
  stations: FuelStation[];
}

export interface GlobalIndex {
  provinces: Array<{ id: string; name: string; slug: string; stationCount: number }>;
  municipalities: Array<{
    id: string;
    name: string;
    slug: string;
    provinceId: string;
    stationCount: number;
  }>;
}
