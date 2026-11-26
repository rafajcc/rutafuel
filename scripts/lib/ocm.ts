import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { isValidCoordinate } from './gasolineras.js';
import { fetchJson, type FetchOptions } from './http.js';
import { slugify, uniqueSlug } from './slug.js';
import { ACCESS_STATUSES, CHARGE_MODES, CHARGER_STATUSES, SOURCE_IDS } from './types.js';
import type {
  ChargerConnector,
  ChargerSourceResult,
  ChargeMode,
  ChargingStation,
  ChargerStatus,
  DiscardedRecord,
  SourceId,
} from './types.js';

/** Documentado en https://openchargemap.io/develop/api (v3.1). */
export const OCM_API_URL = 'https://api.openchargemap.io/v3/poi/';
export const OCM_DETAIL_URL = 'https://openchargemap.org/site/poi/details/';
export const OCM_CLIENT = 'rutafuel';
export const OCM_DEFAULT_MAX_RESULTS = 100_000;

export interface OcmAddressInfo {
  ID?: number;
  Title?: string;
  AddressLine1?: string;
  AddressLine2?: string | null;
  Town?: string;
  StateOrProvince?: string;
  Postcode?: string;
  Latitude?: number;
  Longitude?: number;
  Country?: { ID?: number; ISOCode?: string; Title?: string };
}

export interface OcmConnection {
  ID?: number;
  ConnectionTypeID?: number;
  ConnectionType?: { ID?: number; Title?: string; FormalName?: string };
  StatusTypeID?: number;
  StatusType?: { ID?: number; Title?: string; IsOperational?: boolean };
  Reference?: string | null;
  LevelID?: number;
  Amps?: number;
  Voltage?: number;
  PowerKW?: number;
  CurrentTypeID?: number;
  CurrentType?: { ID?: number; Title?: string };
  Quantity?: number;
}

export interface OcmPoi {
  ID?: number;
  UUID?: string;
  DataProviderID?: number;
  DataProvider?: { ID?: number; Title?: string; License?: string; IsOpenDataLicensed?: boolean };
  DataProvidersReference?: string;
  OperatorID?: number;
  OperatorInfo?: { ID?: number; Title?: string };
  OperatorsReference?: string;
  UsageTypeID?: number;
  UsageType?: { ID?: number; Title?: string };
  AddressInfo?: OcmAddressInfo;
  Connections?: OcmConnection[];
  NumberOfPoints?: number;
  StatusTypeID?: number;
  StatusType?: { ID?: number; Title?: string; IsOperational?: boolean };
  DateLastStatusUpdate?: string;
  DateLastVerified?: string;
  DateLastConfirmed?: string;
  DateCreated?: string;
  SubmissionStatusTypeID?: number;
  SubmissionStatus?: { ID?: number; Title?: string; IsLive?: boolean };
}

export interface OcmRequest {
  url: string;
  headers: Record<string, string>;
}

export interface OcmFetchOptions extends FetchOptions {
  url?: string;
  apiKey: string;
  maxResults?: number;
}

export interface OcmFetched {
  pois: OcmPoi[];
  fetchedAt: string;
  bytes: number;
  finalUrl: string;
}

/** La clave viaja como cabecera `X-API-Key`; nunca se pone en la URL ni en metadatos. */
export function createOcmRequest(options: {
  baseUrl?: string;
  apiKey: string;
  maxResults?: number;
}): OcmRequest {
  const url = new URL(options.baseUrl ?? OCM_API_URL);
  url.searchParams.set('output', 'json');
  url.searchParams.set('countrycode', 'ES');
  url.searchParams.set('maxresults', String(options.maxResults ?? OCM_DEFAULT_MAX_RESULTS));
  url.searchParams.set('compact', 'false');
  url.searchParams.set('verbose', 'false');
  url.searchParams.set('client', OCM_CLIENT);
  return {
    url: url.toString(),
    headers: { 'X-API-Key': options.apiKey },
  };
}

export function validateOcmResponse(data: unknown): OcmPoi[] {
  if (!Array.isArray(data)) throw new Error('OCM: la respuesta no es un array de POIs');
  const pois = data as OcmPoi[];
  if (pois.length === 0) return pois;
  const sample = pois.slice(0, 50);
  const withAddress = sample.filter((poi) => poi.AddressInfo && typeof poi.AddressInfo === 'object').length;
  if (withAddress < sample.length * 0.8) {
    throw new Error('OCM: cambio de esquema detectado, falta AddressInfo en la mayoría de POIs');
  }
  return pois;
}

export async function fetchOcm(options: OcmFetchOptions): Promise<OcmFetched> {
  if (!options.apiKey.trim()) throw new Error('OCM: se requiere API key para consultar la API');
  const request = createOcmRequest({
    baseUrl: options.url,
    apiKey: options.apiKey,
    maxResults: options.maxResults,
  });
  const fetched = await fetchJson<unknown>(request.url, {
    ...options,
    headers: { ...options.headers, ...request.headers },
  });
  return {
    pois: validateOcmResponse(fetched.data),
    fetchedAt: fetched.fetchedAt,
    bytes: fetched.bytes,
    finalUrl: fetched.finalUrl,
  };
}

export async function readLocalOcm(input: string): Promise<OcmFetched> {
  const resolved = path.resolve(input);
  const text = await readFile(resolved, 'utf8');
  return {
    pois: validateOcmResponse(JSON.parse(text) as unknown),
    fetchedAt: new Date().toISOString(),
    bytes: Buffer.byteLength(text, 'utf8'),
    finalUrl: `file://${resolved}`,
  };
}

/** Normaliza el título humano de OCM sin depender de una tabla de IDs no verificada. */
export function normalizeOcmConnector(raw: string): string {
  const value = raw.toLocaleLowerCase('es-ES');
  if (!value.trim()) return 'UNKNOWN';
  if (/combo.*(2|ccs2)|ccs.*2|62196-2 combo/.test(value)) return 'CCS2';
  if (/combo.*(1|ccs1)|ccs.*1|62196-1 combo/.test(value)) return 'CCS1';
  if (/chademo/.test(value)) return 'CHADEMO';
  if (/tesla/.test(value)) return 'TESLA';
  if (/domestic/.test(value)) return 'DOMESTIC';
  if (/type\s*2|t2|62196-2/.test(value)) return 'TYPE2';
  if (/type\s*1|t1|62196-1/.test(value)) return 'TYPE1';
  if (/type\s*3|t3/.test(value)) return 'TYPE3';
  return 'UNKNOWN';
}

function normalizeOcmCurrentType(raw: string): ChargeMode {
  const value = raw.toLocaleLowerCase('es-ES');
  if (value.includes('dc') || value.includes('direct')) return CHARGE_MODES.dc;
  if (value.includes('three')) return CHARGE_MODES.ac3;
  if (value.includes('single')) return CHARGE_MODES.ac1;
  return CHARGE_MODES.unknown;
}

function normalizeOcmFormat(raw: string): string {
  const value = raw.toLocaleLowerCase('es-ES');
  if (value.includes('socket')) return 'Socket';
  if (value.includes('cable')) return 'Cable';
  return 'UNKNOWN';
}

function normalizeOcmStatus(poi: OcmPoi): ChargerStatus {
  if (typeof poi.StatusType?.IsOperational === 'boolean') {
    return poi.StatusType.IsOperational ? CHARGER_STATUSES.operational : CHARGER_STATUSES.outOfService;
  }
  return CHARGER_STATUSES.unknown;
}

function parseIsoDate(raw: string | undefined): { iso: string; raw: string } | undefined {
  if (!raw) return undefined;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return { iso: parsed.toISOString(), raw };
}

function addWarning(warnings: string[], detail: string): void {
  if (warnings.length < 30) warnings.push(detail);
  else if (warnings.length === 30) warnings.push('... más avisos omitidos');
}

function optionalField(key: string, value: string | undefined): Record<string, string> {
  return value ? { [key]: value } : {};
}

export interface OcmNormalizeContext {
  fetchedAt?: string;
  sourceUrl?: string;
}

export function normalizeOcm(pois: OcmPoi[], context: OcmNormalizeContext = {}): ChargerSourceResult {
  const stations: ChargingStation[] = [];
  const discarded: DiscardedRecord[] = [];
  const duplicateIds: string[] = [];
  const warnings: string[] = [];
  const seen = new Set<number>();
  let withoutCoordinates = 0;
  let withoutLicense = 0;
  let latestUpdatedAt: string | undefined;
  let latestUpdatedAtRaw: string | undefined;

  for (const [index, poi] of pois.entries()) {
    const ocmId = poi.ID;
    if (typeof ocmId !== 'number' || !Number.isInteger(ocmId) || ocmId <= 0) {
      discarded.push({ reason: 'missing-id', detail: `POI ${index + 1}: sin ID de OCM` });
      continue;
    }
    if (poi.SubmissionStatus?.IsLive === false) {
      discarded.push({ id: String(ocmId), reason: 'not-live', detail: 'POI no publicado en OCM' });
      continue;
    }
    if (seen.has(ocmId)) {
      duplicateIds.push(String(ocmId));
      continue;
    }
    seen.add(ocmId);

    const address = poi.AddressInfo ?? {};
    const lat = address.Latitude;
    const lon = address.Longitude;
    if (typeof lat !== 'number' || typeof lon !== 'number' || !isValidCoordinate(lat, lon)) {
      withoutCoordinates += 1;
      discarded.push({
        id: String(ocmId),
        reason: 'invalid-coordinates',
        detail: `Coordenadas no válidas: ${String(lat)} / ${String(lon)}`,
      });
      continue;
    }

    const municipality = address.Town?.trim() || address.Title?.trim();
    const province = address.StateOrProvince?.trim();
    if (!municipality || !province) {
      discarded.push({ id: String(ocmId), reason: 'missing-location', detail: 'Falta Town o StateOrProvince' });
      continue;
    }

    const provinceId = slugify(province) || 'sin-provincia';
    const municipalityId = `${provinceId}-${slugify(municipality) || 'sin-municipio'}`;
    const updated = parseIsoDate(poi.DateLastStatusUpdate ?? poi.DateLastVerified ?? poi.DateLastConfirmed);
    if (updated && (!latestUpdatedAt || updated.iso > latestUpdatedAt)) {
      latestUpdatedAt = updated.iso;
      latestUpdatedAtRaw = updated.raw;
    }

    const connectors: ChargerConnector[] = (poi.Connections ?? []).map((connection) => {
      const rawType = connection.ConnectionType?.Title ?? connection.ConnectionType?.FormalName ?? '';
      const rawPower = connection.PowerKW === undefined || connection.PowerKW === null
        ? ''
        : String(connection.PowerKW);
      const power = typeof connection.PowerKW === 'number' && Number.isFinite(connection.PowerKW)
        && connection.PowerKW >= 0 && connection.PowerKW <= 1000
        ? connection.PowerKW
        : null;
      return {
        type: normalizeOcmConnector(rawType),
        rawType,
        chargeMode: normalizeOcmCurrentType(connection.CurrentType?.Title ?? ''),
        format: normalizeOcmFormat(rawType),
        powerKw: power,
        rawPower,
        sources: [SOURCE_IDS.ocm as SourceId],
        ...optionalField('voltage', connection.Voltage === undefined ? undefined : String(connection.Voltage)),
        ...optionalField('amperage', connection.Amps === undefined ? undefined : String(connection.Amps)),
      };
    });

    const maxPowerKw = connectors.reduce<number | null>((max, connector) => {
      if (connector.powerKw === null) return max;
      return max === null || connector.powerKw > max ? connector.powerKw : max;
    }, null);
    const license = poi.DataProvider?.License;
    if (!license) withoutLicense += 1;

    stations.push({
      id: `OCM-${ocmId}`,
      source: SOURCE_IDS.ocm,
      officialId: String(ocmId),
      ...optionalField('name', address.Title?.trim()),
      ...optionalField('address', address.AddressLine1?.trim()),
      municipality,
      municipalityId,
      municipalitySlug: uniqueSlug(municipality, municipalityId),
      province,
      provinceId,
      provinceSlug: uniqueSlug(province, provinceId),
      ...optionalField('postalCode', address.Postcode?.trim()),
      lat,
      lon,
      ...optionalField('operator', poi.OperatorInfo?.Title?.trim()),
      ...optionalField('operatorId', poi.OperatorID === undefined ? undefined : String(poi.OperatorID)),
      accessibility: ACCESS_STATUSES.unknown,
      status: normalizeOcmStatus(poi),
      connectors,
      maxPowerKw,
      pointCount: Math.max(poi.NumberOfPoints ?? 0, connectors.length, connectors.length > 0 ? 1 : 0),
      pointIds: [],
      ...optionalField('updatedAt', updated?.iso),
      ...optionalField('updatedAtRaw', updated?.raw),
      sources: [{
        source: SOURCE_IDS.ocm,
        id: String(ocmId),
        url: `${OCM_DETAIL_URL}${ocmId}`,
        ...optionalField('fetchedAt', context.fetchedAt),
        ...optionalField('dataProvider', poi.DataProvider?.Title),
        ...optionalField('license', license),
      }],
      raw: {
        ocm: {
          id: ocmId,
          ...optionalField('uuid', poi.UUID),
          ...optionalField('dataProvidersReference', poi.DataProvidersReference),
          ...optionalField('operatorsReference', poi.OperatorsReference),
          ...(typeof poi.StatusTypeID === 'number' ? { statusTypeID: poi.StatusTypeID } : {}),
          ...(typeof poi.DataProviderID === 'number' ? { dataProviderID: poi.DataProviderID } : {}),
        },
      },
    });
  }

  if (withoutLicense > 0 && pois.length > 0) {
    addWarning(warnings, `${withoutLicense} POIs de OCM no declaran licencia de su proveedor de datos`);
  }
  return {
    stations,
    discarded,
    duplicateIds,
    warnings,
    withoutCoordinates,
    malformedRows: 0,
    latestUpdatedAt,
    latestUpdatedAtRaw,
  };
}
