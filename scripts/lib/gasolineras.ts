import type {
  DiscardedRecord,
  FuelKey,
  FuelPrices,
  FuelStation,
  MineturResponse,
  NormalizeResult,
  StationAudit,
} from './types.js';
import { slugify, titleCaseProvince, uniqueSlug } from './slug.js';

export const MINETUR_URL =
  'https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/';

/** Campos de la respuesta real que consumedor el pipeline (verificado 2026-11-26). */
export const EXPECTED_RESPONSE_KEYS = ['Fecha', 'ListaEESSPrecio', 'ResultadoConsulta'] as const;
export const EXPECTED_STATION_KEYS = [
  'C.P.',
  'Dirección',
  'Horario',
  'Latitud',
  'Localidad',
  'Longitud (WGS84)',
  'Municipio',
  'Precio Gasoleo A',
  'Precio Gasoleo Premium',
  'Precio Gasolina 95 E5',
  'Precio Gasolina 98 E5',
  'Precio Gases licuados del petróleo',
  'Provincia',
  'IDEESS',
  'IDMunicipio',
  'IDProvincia',
] as const;

export const PRICE_FIELDS: Record<FuelKey, string> = {
  g95: 'Precio Gasolina 95 E5',
  g98: 'Precio Gasolina 98 E5',
  goa: 'Precio Gasoleo A',
  gop: 'Precio Gasoleo Premium',
  glp: 'Precio Gases licuados del petróleo',
};

/** Rango razonable en €/litro para detectar cambios de formato o valores corruptos. */
export const MIN_PRICE = 0.5;
export const MAX_PRICE = 3.5;

/** Incluye Península, Baleares, Canarias, Ceuta y Melilla. */
export const SPAIN_BOUNDS = { minLat: 26, maxLat: 44.5, minLon: -19, maxLon: 5.5 } as const;

export type PriceStatus = 'ok' | 'empty' | 'invalid-format' | 'out-of-range';

export interface PriceParseResult {
  price: number | null;
  status: PriceStatus;
}

type RawRecord = Record<string, unknown>;

/** Convierte números con separador decimal español (o inglés) a number. */
export function parseSpanishNumber(raw: unknown): number | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  let value = String(raw).trim();
  if (!value) return null;

  if (value.includes(',') && value.includes('.')) {
    // En la fuente real se usa "," decimal; el "." actúa como millares si aparece junto a ",".
    value = value.replace(/\./g, '').replace(',', '.');
  } else if (value.includes(',')) {
    value = value.replace(',', '.');
  }

  if (!/^-?\d+(\.\d+)?$/.test(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** Un precio ausente es null, nunca 0. */
export function parseFuelPrice(raw: unknown): PriceParseResult {
  if (raw === null || raw === undefined || String(raw).trim() === '') {
    return { price: null, status: 'empty' };
  }

  const number = parseSpanishNumber(raw);
  if (number === null) return { price: null, status: 'invalid-format' };
  if (number < MIN_PRICE || number > MAX_PRICE) return { price: null, status: 'out-of-range' };
  return { price: number, status: 'ok' };
}

export function isValidCoordinate(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= SPAIN_BOUNDS.minLat &&
    lat <= SPAIN_BOUNDS.maxLat &&
    lon >= SPAIN_BOUNDS.minLon &&
    lon <= SPAIN_BOUNDS.maxLon
  );
}

function readString(record: RawRecord, key: string): string | undefined {
  const value = record[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function optionalField(key: string, value: string | undefined): Record<string, string> {
  return value ? { [key]: value } : {};
}

/** Normaliza un registro. No descarta precios inválidos: los convierte a null y avisa. */
export function normalizeStation(record: RawRecord): {
  station: FuelStation | null;
  discarded: DiscardedRecord | null;
  warnings: string[];
  invalidPrices: number;
} {
  const warnings: string[] = [];
  const id = readString(record, 'IDEESS');
  if (!id) {
    return {
      station: null,
      discarded: { reason: 'missing-id', detail: 'El registro no tiene IDEESS' },
      warnings,
      invalidPrices: 0,
    };
  }

  const rawLat = record['Latitud'];
  const rawLon = record['Longitud (WGS84)'];
  const hasCoordinates = Boolean(String(rawLat ?? '').trim() && String(rawLon ?? '').trim());
  const lat = parseSpanishNumber(rawLat);
  const lon = parseSpanishNumber(rawLon);

  if (lat === null || lon === null || !isValidCoordinate(lat, lon)) {
    return {
      station: null,
      discarded: {
        id,
        reason: 'invalid-coordinates',
        detail: hasCoordinates
          ? `Coordenadas fuera de España o no numéricas: ${String(rawLat)} / ${String(rawLon)}`
          : 'Coordenadas vacías',
      },
      warnings,
      invalidPrices: 0,
    };
  }

  const municipality = readString(record, 'Municipio');
  const provinceRaw = readString(record, 'Provincia');
  if (!municipality || !provinceRaw) {
    return {
      station: null,
      discarded: {
        id,
        reason: 'missing-location',
        detail: 'Falta municipio o provincia',
      },
      warnings,
      invalidPrices: 0,
    };
  }

  const province = titleCaseProvince(provinceRaw);
  const municipalityId =
    readString(record, 'IDMunicipio') ?? `${slugify(province)}-${slugify(municipality)}`;
  const provinceId = readString(record, 'IDProvincia') ?? '';

  let invalidPrices = 0;
  const prices: FuelPrices = { g95: null, g98: null, goa: null, gop: null, glp: null };
  const rawPrices: StationAudit['precios'] = {};

  for (const fuel of Object.keys(PRICE_FIELDS) as FuelKey[]) {
    const field = PRICE_FIELDS[fuel];
    const rawPrice = record[field];
    rawPrices[fuel] = rawPrice === undefined || rawPrice === null ? '' : String(rawPrice);
    const parsed = parseFuelPrice(rawPrice);
    prices[fuel] = parsed.price;
    if (parsed.status === 'invalid-format' || parsed.status === 'out-of-range') {
      invalidPrices += 1;
      warnings.push(`${id}: ${field} (${parsed.status}: ${String(rawPrice)})`);
    }
  }

  const station: FuelStation = {
    id,
    ...optionalField('name', readString(record, 'Rótulo')),
    ...optionalField('address', readString(record, 'Dirección')),
    ...optionalField('locality', readString(record, 'Localidad')),
    municipality,
    municipalityId,
    municipalitySlug: uniqueSlug(municipality, municipalityId),
    province,
    provinceId: provinceId.padStart(2, '0'),
    provinceSlug: uniqueSlug(province, provinceId.padStart(2, '0')),
    ...optionalField('postalCode', readString(record, 'C.P.')),
    lat,
    lon,
    ...optionalField('schedule', readString(record, 'Horario')),
    prices,
    raw: {
      latitud: String(rawLat ?? ''),
      longitud: String(rawLon ?? ''),
      precios: rawPrices,
    },
  };

  if (!provinceId) warnings.push(`${id}: falta IDProvincia, se genera slug como identificador`);
  if (!readString(record, 'IDMunicipio')) {
    warnings.push(`${id}: falta IDMunicipio, se genera slug como identificador`);
  }

  return { station, discarded: null, warnings, invalidPrices };
}

export function normalizeStations(records: RawRecord[]): NormalizeResult {
  const stations: FuelStation[] = [];
  const discarded: DiscardedRecord[] = [];
  const duplicateIds: string[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  let withoutCoordinates = 0;
  let invalidPrices = 0;

  for (const record of records) {
    const result = normalizeStation(record);
    invalidPrices += result.invalidPrices;
    if (result.discarded) {
      if (result.discarded.reason === 'invalid-coordinates') withoutCoordinates += 1;
      discarded.push(result.discarded);
      continue;
    }
    const station = result.station!;
    if (seen.has(station.id)) {
      duplicateIds.push(station.id);
      continue;
    }
    seen.add(station.id);
    stations.push(station);
    if (result.warnings.length) {
      if (warnings.length < 20) warnings.push(...result.warnings);
      else if (warnings.length === 20) warnings.push('... más avisos omitidos');
    }
  }

  return { stations, discarded, duplicateIds, warnings, withoutCoordinates, invalidPrices };
}

/** Fecha de actualización declarada por la fuente: "dd/MM/yyyy HH:mm:ss". */
export function parseSourceDate(raw: unknown): { iso: string; raw: string } | null {
  if (typeof raw !== 'string') return null;
  const match = raw.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, day, month, year, hour, minute, second] = match.map(Number);
  if (month! < 1 || month! > 12 || day! < 1 || day! > 31) return null;
  if (hour! > 23 || minute! > 59 || second! > 59) return null;
  const iso = `${year}-${month!.toString().padStart(2, '0')}-${day!.toString().padStart(2, '0')}T${hour!.toString().padStart(2, '0')}:${minute!.toString().padStart(2, '0')}:${second!.toString().padStart(2, '0')}`;
  return { iso, raw: raw.trim() };
}

export interface ResponseValidation {
  warnings: string[];
  records: RawRecord[];
  sourceDate: { iso: string; raw: string };
}

/** Valida la forma de la respuesta antes de procesarla; falla cerrado ante cambios de esquema. */
export function validateResponse(response: MineturResponse): ResponseValidation {
  if (response.ResultadoConsulta !== 'OK') {
    throw new Error(`ResultadoConsulta inesperado: ${String(response.ResultadoConsulta)}`);
  }

  for (const key of EXPECTED_RESPONSE_KEYS) {
    if (!(key in response)) throw new Error(`Falta la clave ${key} en la respuesta de MINETUR`);
  }

  if (!Array.isArray(response.ListaEESSPrecio) || response.ListaEESSPrecio.length === 0) {
    throw new Error('ListaEESSPrecio no es un array o está vacía');
  }

  const records = response.ListaEESSPrecio as RawRecord[];
  const sample = records.slice(0, 50);
  for (const key of EXPECTED_STATION_KEYS) {
    const present = sample.filter((record) => key in record).length;
    if (present < sample.length * 0.8) {
      throw new Error(`Cambio de esquema detectado: falta "${key}" en la mayoría de registros`);
    }
  }

  const sourceDate = parseSourceDate(response.Fecha);
  if (!sourceDate) throw new Error(`Fecha de la fuente no reconocida: ${String(response.Fecha)}`);

  const warnings: string[] = [];
  if (records.length < 1000) {
    warnings.push(`Sólo ${records.length} registros recibidos; se esperaban miles`);
  }

  return { warnings, records, sourceDate };
}
