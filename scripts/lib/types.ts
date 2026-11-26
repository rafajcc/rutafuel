/** Tipos del pipeline de datos. El formato de salida está versionado en DATA_VERSION. */

export const DATA_VERSION = 2;

/** Fuentes ingeridas. MINETUR se mantiene primero para compatibilidad con la portada. */
export const SOURCE_IDS = {
  minetur: 'MINETUR',
  ripree: 'RIPREE',
  ocm: 'OCM',
} as const;

export type SourceId = (typeof SOURCE_IDS)[keyof typeof SOURCE_IDS];

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

/** La fuente no siempre permite afirmar que un punto está operativo o es de acceso público. */
export const CHARGER_STATUSES = {
  unknown: 'unknown',
  operational: 'operational',
  outOfService: 'out-of-service',
} as const;
export type ChargerStatus = (typeof CHARGER_STATUSES)[keyof typeof CHARGER_STATUSES];

export const ACCESS_STATUSES = {
  yes: 'yes',
  no: 'no',
  unknown: 'unknown',
} as const;
export type AccessStatus = (typeof ACCESS_STATUSES)[keyof typeof ACCESS_STATUSES];

export const CHARGE_MODES = {
  ac1: 'AC_1_PHASE',
  ac3: 'AC_3_PHASE',
  dc: 'DC',
  unknown: 'UNKNOWN',
} as const;
export type ChargeMode = (typeof CHARGE_MODES)[keyof typeof CHARGE_MODES];

export interface ChargerConnector {
  /** Código normalizado. El valor original se conserva en `raw`. */
  type: string;
  rawType: string;
  chargeMode: ChargeMode;
  /** Formato declarado por la fuente: Socket, Cable o UNKNOWN. */
  format: string;
  powerKw: number | null;
  rawPower: string;
  voltage?: string;
  amperage?: string;
  sources: SourceId[];
}

export interface ChargerProvenance {
  source: SourceId;
  /** Identificador oficial de la fuente (sin el prefijo interno del dataset). */
  id: string;
  pointId?: string;
  url?: string;
  fetchedAt?: string;
  sourceUpdatedAt?: string;
  sourceUpdatedAtRaw?: string;
  /** Atribución exigida por Open Charge Map cuando aplica. */
  dataProvider?: string;
  license?: string;
}

export interface ChargerAudit {
  ripree?: {
    latitud: string;
    longitud: string;
    codigoPostal: string;
    accesibilidad: string;
    estatus: string;
    fechaModificacion: string;
    puntos: Array<{
      pointId: string;
      pointCode: string;
      connectorId: string;
      connector: string;
      chargeMode: string;
      format: string;
      power: string;
      voltage: string;
      amperage: string;
    }>;
  };
  ocm?: {
    id: number;
    uuid?: string;
    dataProvidersReference?: string;
    operatorsReference?: string;
    statusTypeID?: number;
    dataProviderID?: number;
  };
}

export interface ChargingStation {
  /** ID interno estable: `RIPREE-<codigo>` u `OCM-<id>`. */
  id: string;
  /** Fuente principal de los datos visibles. */
  source: SourceId;
  /** Identificador oficial de la fuente principal. */
  officialId: string;
  name?: string;
  address?: string;
  municipality: string;
  municipalityId: string;
  municipalitySlug: string;
  province: string;
  /** Slug derivado del nombre: RIPREE no publica un código INE oficial. */
  provinceId: string;
  provinceSlug: string;
  postalCode?: string;
  lat: number;
  lon: number;
  operator?: string;
  operatorId?: string;
  accessibility: AccessStatus;
  status: ChargerStatus;
  schedule?: string;
  services?: string;
  paymentMethods?: string;
  parkingRestrictions?: string;
  connectors: ChargerConnector[];
  maxPowerKw: number | null;
  pointCount: number;
  pointIds: string[];
  /** ISO sin offset si la fuente publica hora local; ISO con Z si es UTC. */
  updatedAt?: string;
  updatedAtRaw?: string;
  sources: ChargerProvenance[];
  raw: ChargerAudit;
}

export interface ChargerSourceResult {
  stations: ChargingStation[];
  discarded: DiscardedRecord[];
  duplicateIds: string[];
  warnings: string[];
  withoutCoordinates: number;
  malformedRows: number;
  latestUpdatedAt?: string;
  latestUpdatedAtRaw?: string;
}

export type DiscardReason =
  | 'missing-id'
  | 'missing-location'
  | 'invalid-coordinates'
  | 'unparseable-record'
  | 'not-live';

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
  id: SourceId;
  url: string;
  fetchedAt: string;
  /** `skipped` se usa para fuentes opcionales sin credenciales, nunca para fallos. */
  status?: 'active' | 'skipped';
  note?: string;
  sourceUpdatedAtRaw?: string;
  /** ISO sin offset: hora local peninsular declarada por la fuente. */
  sourceUpdatedAt?: string;
  recordsReceived: number;
  recordsProcessed: number;
  recordsDiscarded: number;
  recordsWithoutCoordinates: number;
  duplicateRecords: number;
  attribution?: { dataProvider?: string; license?: string };
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
    chargingStations?: number;
    chargingPoints?: number;
    chargingDuplicates?: number;
    malformedRipreeRows?: number;
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

export interface ChargerValueStats {
  count: number;
  min: number | null;
  max: number | null;
  avg: number | null;
}

export interface ChargerConnectorStats {
  type: string;
  stationCount: number;
  connectorCount: number;
  maxPowerKw: number | null;
}

export interface ChargerSummaryStats {
  dataVersion: number;
  generatedAt: string;
  sourceUpdatedAt?: string;
  totals: {
    stations: number;
    points: number;
    maxPowerKw: number | null;
    duplicatesRemoved: number;
    malformedRipreeRows: number;
  };
  bySource: Record<SourceId, number>;
  power: ChargerValueStats;
  status: Record<ChargerStatus, number>;
  accessibility: Record<AccessStatus, number>;
  connectors: ChargerConnectorStats[];
  quality: {
    withoutCoordinates: number;
    withoutPower: number;
    unknownStatus: number;
    unknownAccess: number;
  };
}

export interface ChargerIndex {
  provinces: Array<{
    id: string;
    name: string;
    slug: string;
    stationCount: number;
    maxPowerKw: number | null;
  }>;
  municipalities: Array<{
    id: string;
    name: string;
    slug: string;
    provinceId: string;
    stationCount: number;
  }>;
}
