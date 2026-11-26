import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { isValidCoordinate, parseSpanishNumber } from './gasolineras.js';
import { fetchBinary, type FetchOptions } from './http.js';
import { slugify, uniqueSlug } from './slug.js';
import {
  ACCESS_STATUSES,
  CHARGE_MODES,
  CHARGER_STATUSES,
  SOURCE_IDS,
} from './types.js';
import type {
  AccessStatus,
  ChargerConnector,
  ChargerSourceResult,
  ChargeMode,
  ChargingStation,
  ChargerStatus,
  DiscardedRecord,
  SourceId,
} from './types.js';

/** Endpoint real usado por la web de RIPREE (POST JSON, devuelve CSV UTF-16LE). */
export const RIPREE_URL = 'https://energia.serviciosmin.gob.es/Ripree/ExportarInstalaciones/GenerarExcel';
export const RIPREE_EXPORT_PAGE_URL =
  'https://energia.serviciosmin.gob.es/Ripree/ExportarInstalaciones/Export';
export const RIPREE_REQUEST_BODY = JSON.stringify({ model: null, soloConsolidado: true });

/** Cabeceras verificadas en la descarga real de 29 columnas (26/11/2026). */
export const RIPREE_HEADERS = [
  'COMUNIDAD AUTONOMA',
  'PROVINCIA',
  'MUNICIPIO',
  'LATITUD',
  'LONGITUD',
  'NOMBRE INSTALACION',
  'DIRECCIÓN',
  'CODIGO POSTAL',
  'LOCALIZACION',
  'TIPO HORARIO APERTURA',
  'HORARIO APERTURA',
  'NOMBRE OPERADOR',
  'COD.OPERADOR',
  'TIPOS DE SERVICIOS',
  'COD.INSTALACION',
  'ID. PUNTO DE RECARGA',
  'ACCESIBILIDAD',
  'ESTATUS',
  'METODOS DE PAGOS',
  'RESTRICCIONES DE PARKING',
  'COD. PUNTO DE RECARGA',
  'ID. CONECTOR',
  'TIPO CONECTOR',
  'TIPO DE CARGA',
  'FORMATO',
  'POTENCIA MAXIMA',
  'VOLTAJE',
  'INTENSIDAD',
  'FECHA DE ULTIMA MODIFICACION',
] as const;

/** Códigos observados en RIPREE. El valor original se conserva siempre en `rawType`. */
export const RIPREE_CONNECTOR_CODES: Record<string, string> = {
  IEC_62196_T2: 'TYPE2',
  IEC_62196_T2_COMBO: 'CCS2',
  IEC_62196_T1: 'TYPE1',
  IEC_62196_T1_COMBO: 'CCS1',
  IEC_62196_T3A: 'TYPE3A',
  IEC_62196_T3C: 'TYPE3C',
  CHADEMO: 'CHADEMO',
  DOMESTIC_A: 'DOMESTIC_A',
  DOMESTIC_E: 'DOMESTIC_E',
  DOMESTIC_F: 'DOMESTIC_F',
  IEC_60309_2_three_32: 'IEC60309_3P32',
  IEC_60309_2_three_16: 'IEC60309_3P16',
  IEC_60309_2_single_16: 'IEC60309_1P16',
  DOMESTIC_L: 'DOMESTIC_L',
  TeslaConnectorEurope: 'TESLA_EU',
};

export interface RipreeParsed {
  rows: string[][];
  malformedRows: number;
  warnings: string[];
}

export interface RipreeFetched {
  bytes: Buffer;
  text: string;
  fetchedAt: string;
  finalUrl: string;
  filename?: string;
  sourceUpdatedAt?: string;
  sourceUpdatedAtRaw?: string;
  contentType: string | null;
}

interface RipreeFetchOptions extends FetchOptions {
  url?: string;
}

interface InstallationGroup {
  row: string[];
  rows: string[][];
  pointIds: Set<string>;
  pointCodes: Set<string>;
  connectors: ChargerConnector[];
  accessibility: Set<string>;
  status: Set<string>;
  coordinates: Set<string>;
  dates: Array<{ iso: string; raw: string }>;
}

/** Detecta la codificación real: UTF-16LE (la usada por RIPREE) o UTF-8 con/sin BOM. */
export function decodeRipree(buffer: Buffer): string {
  const first = buffer[0] ?? -1;
  const second = buffer[1] ?? -1;
  const third = buffer[2] ?? -1;

  if (first === 0xff && second === 0xfe) return buffer.toString('utf16le').replace(/^\uFEFF/, '');
  if (first === 0xfe && second === 0xff) {
    throw new Error('RIPREE: codificación UTF-16BE no soportada');
  }
  if (first === 0xef && second === 0xbb && third === 0xbf) {
    return buffer.toString('utf8').replace(/^\uFEFF/, '');
  }

  const sample = buffer.subarray(0, Math.min(200, buffer.length));
  let zeroBytes = 0;
  for (const byte of sample) if (byte === 0) zeroBytes += 1;
  if (zeroBytes > sample.length / 4) return buffer.toString('utf16le').replace(/^\uFEFF/, '');
  return buffer.toString('utf8').replace(/^\uFEFF/, '');
}

/** Parser CSV estricto: separador `;`, comillas dobles y saltos de línea dentro de comillas. */
export function parseRipreeCsv(input: Buffer | string): RipreeParsed {
  const text = typeof input === 'string' ? input.replace(/^\uFEFF/, '') : decodeRipree(input);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let atFieldStart = true;

  const pushField = () => {
    row.push(field);
    field = '';
    quoted = false;
    atFieldStart = true;
  };

  const pushRecord = () => {
    pushField();
    if (row.some((value) => value.trim().length > 0)) rows.push(row);
    row = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"' && text[index - 1] === '\\') {
        // La exportación mezcla comillas dobles y escapadas con `\"`; no cierran el campo.
        field = `${field.slice(0, -1)}"`;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && atFieldStart) {
      quoted = true;
      atFieldStart = false;
    } else if (character === ';') {
      pushField();
    } else if (character === '\r' || character === '\n') {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      pushRecord();
    } else {
      field += character;
      atFieldStart = false;
    }
  }
  if (field.length > 0 || row.length > 0) pushRecord();

  if (rows.length === 0) throw new Error('RIPREE: CSV vacío');
  const header = (rows[0] ?? []).map((value) => value.trim());
  if (header.length !== RIPREE_HEADERS.length || header.some((name, index) => name !== RIPREE_HEADERS[index])) {
    throw new Error(
      `RIPREE: cabecera inesperada (${header.length} columnas; se esperaban ${RIPREE_HEADERS.length})`,
    );
  }

  const dataRows = rows.slice(1);
  const malformedRows = dataRows.filter((dataRow) => dataRow.length !== RIPREE_HEADERS.length).length;
  const warnings: string[] = [];
  if (malformedRows > 0) {
    warnings.push(
      `${malformedRows} filas con número de campos distinto de ${RIPREE_HEADERS.length} se descartan por comillas mal formadas`,
    );
  }
  return { rows: dataRows, malformedRows, warnings };
}

function cell(row: string[], index: number): string {
  return (row[index] ?? '').trim();
}

/** RIPREE exporta fórmulas Excel: `=39.5`, `=07011`, `=DESCONOCIDO`. */
export function unwrapExcelValue(raw: string): string | undefined {
  let value = raw.trim();
  // RIPREE mezcla fórmulas `=39.5` con celdas exportadas como `="39.5"`.
  if (value.startsWith('="') && value.endsWith('"')) value = `=${value.slice(2, -1)}`;
  if (!value || value === '=NULL' || value === '=DESCONOCIDO') return undefined;
  return value.startsWith('=') ? value.slice(1).trim() || undefined : value;
}

function parseMeasuredNumber(raw: string, allowNegative = false): number | null {
  const value = unwrapExcelValue(raw)?.replace(/\s*(?:kW|V|A)\s*$/i, '').trim();
  if (!value) return null;
  const parsed = parseSpanishNumber(value);
  if (parsed === null || (!allowNegative && parsed < 0) || parsed > 1000) return null;
  return parsed;
}

function parseCoordinate(raw: string): number | null {
  return parseMeasuredNumber(raw, true);
}

/** Acepta `21/11/2023 11:39:04` y `23/04/2025 9:35:26` (hora de un dígito). */
export function parseRipreeDate(raw: string): { iso: string; raw: string } | null {
  const value = unwrapExcelValue(raw) ?? '';
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, day, month, year, hour, minute, second] = match;
  const dayNumber = Number(day);
  const monthNumber = Number(month);
  const hourNumber = Number(hour);
  if (monthNumber < 1 || monthNumber > 12 || dayNumber < 1 || dayNumber > 31) return null;
  if (hourNumber > 23 || Number(minute) > 59 || Number(second) > 59) return null;
  const iso =
    `${year}-${String(monthNumber).padStart(2, '0')}-${String(dayNumber).padStart(2, '0')}` +
    `T${String(hourNumber).padStart(2, '0')}:${minute}:${second}`;
  return { iso, raw: value };
}

export function normalizeConnectorType(raw: string): string {
  return RIPREE_CONNECTOR_CODES[raw.trim()] ?? 'UNKNOWN';
}

function normalizeChargeMode(raw: string): ChargeMode {
  if (raw === 'AC_1_PHASE') return CHARGE_MODES.ac1;
  if (raw === 'AC_3_PHASE') return CHARGE_MODES.ac3;
  if (raw === 'DC') return CHARGE_MODES.dc;
  return CHARGE_MODES.unknown;
}

function normalizeAccess(values: Set<string>): AccessStatus {
  const known = [...values].filter((value) => value === 'SI' || value === 'NO');
  if (known.length === 0) return ACCESS_STATUSES.unknown;
  if (known.every((value) => value === 'SI') && !values.has('NO')) return ACCESS_STATUSES.yes;
  if (known.every((value) => value === 'NO') && !values.has('SI')) return ACCESS_STATUSES.no;
  return ACCESS_STATUSES.unknown;
}

function normalizeStatus(values: Set<string>): ChargerStatus {
  const known = [...values].map((value) => value.toUpperCase());
  const operational = known.some(
    (value) =>
      value === 'OPERATIVO' ||
      value.includes('EN SERVICIO') ||
      (value.includes('ACTIVO') && !value.includes('INACTIVO')),
  );
  const inactive = known.some(
    (value) => value.includes('INACTIVO') || value.includes('BAJA') || value.includes('FUERA DE SERVICIO'),
  );
  if (operational && !inactive) return CHARGER_STATUSES.operational;
  if (inactive && !operational) return CHARGER_STATUSES.outOfService;
  return CHARGER_STATUSES.unknown;
}

/** Dedupe por tipo de aviso (sin el ID de instalación) y limita el volumen de logs. */
function addWarning(warnings: string[], detail: string, seen: Set<string>): void {
  const key = detail.replace(/^[^:]+:\s*/, '');
  if (seen.has(key)) return;
  seen.add(key);
  if (warnings.length < 30) warnings.push(detail);
  else if (warnings.length === 30) warnings.push('... más avisos omitidos');
}

function optionalField(key: string, value: string | undefined): Record<string, string> {
  return value ? { [key]: value } : {};
}

export interface RipreeNormalizeContext {
  fetchedAt?: string;
  sourceUpdatedAt?: string;
  sourceUrl?: string;
}

/** Agrupa filas de conector por `COD.INSTALACION` y conserva la auditoría de cada punto. */
export function normalizeRipree(
  parsed: RipreeParsed,
  context: RipreeNormalizeContext = {},
): ChargerSourceResult {
  const groups = new Map<string, InstallationGroup>();
  const discarded: DiscardedRecord[] = [];
  const warnings = [...parsed.warnings];
  const seenWarnings = new Set<string>();
  let withoutCoordinates = 0;

  for (const [index, row] of parsed.rows.entries()) {
    if (row.length !== RIPREE_HEADERS.length) {
      discarded.push({
        reason: 'unparseable-record',
        detail: `Fila ${index + 2}: ${row.length} campos, se esperaban ${RIPREE_HEADERS.length}`,
      });
      continue;
    }

    const id = cell(row, 14);
    if (!id) {
      discarded.push({ reason: 'missing-id', detail: `Fila ${index + 2}: sin COD.INSTALACION` });
      continue;
    }

    const rawLat = cell(row, 3);
    const rawLon = cell(row, 4);
    const lat = parseCoordinate(rawLat);
    const lon = parseCoordinate(rawLon);
    if (lat === null || lon === null || !isValidCoordinate(lat, lon)) {
      withoutCoordinates += 1;
      discarded.push({
        id,
        reason: 'invalid-coordinates',
        detail: `Coordenadas no válidas: ${rawLat} / ${rawLon}`,
      });
      continue;
    }

    const municipality = unwrapExcelValue(cell(row, 2));
    const province = unwrapExcelValue(cell(row, 1));
    if (!municipality || !province) {
      discarded.push({ id, reason: 'missing-location', detail: 'Falta municipio o provincia' });
      continue;
    }

    const rawPower = cell(row, 25);
    const powerKw = parseMeasuredNumber(rawPower);
    if (rawPower && powerKw === null) {
      addWarning(warnings, `${id}: potencia no interpretable (${rawPower})`, seenWarnings);
    }


    const rawType = cell(row, 22);
    const connector: ChargerConnector = {
      type: normalizeConnectorType(rawType),
      rawType,
      chargeMode: normalizeChargeMode(cell(row, 23)),
      format: cell(row, 24) || 'UNKNOWN',
      powerKw,
      rawPower,
      sources: [SOURCE_IDS.ripree as SourceId],
      ...optionalField('voltage', unwrapExcelValue(cell(row, 26))),
      ...optionalField('amperage', unwrapExcelValue(cell(row, 27))),
    };
    if (connector.type === 'UNKNOWN' && rawType) {
      addWarning(warnings, `${id}: conector no reconocido (${rawType})`, seenWarnings);
    }


    const date = parseRipreeDate(cell(row, 28));
    if (!date && cell(row, 28)) {
      addWarning(warnings, `${id}: fecha no reconocida (${cell(row, 28)})`, seenWarnings);
    }


    let group = groups.get(id);
    if (!group) {
      group = {
        row,
        rows: [],
        pointIds: new Set(),
        pointCodes: new Set(),
        connectors: [],
        accessibility: new Set(),
        status: new Set(),
        coordinates: new Set(),
        dates: [],
      };
      groups.set(id, group);
    }

    group.rows.push(row);
    const pointId = cell(row, 15);
    const pointCode = cell(row, 20);
    if (pointId) group.pointIds.add(pointId);
    if (pointCode) group.pointCodes.add(pointCode);
    group.accessibility.add(cell(row, 16));
    group.status.add(cell(row, 17));
    group.coordinates.add(`${rawLat}|${rawLon}`);
    if (date) group.dates.push(date);

    const connectorKey = [
      connector.type,
      connector.rawType,
      connector.chargeMode,
      connector.format,
      connector.powerKw ?? '',
    ].join('|');
    if (!group.connectors.some((existing) =>
      [existing.type, existing.rawType, existing.chargeMode, existing.format, existing.powerKw ?? ''].join('|') === connectorKey,
    )) {
      group.connectors.push(connector);
    }
  }

  const stations: ChargingStation[] = [];
  let latestUpdatedAt: string | undefined;
  let latestUpdatedAtRaw: string | undefined;

  for (const [id, group] of groups) {
    const row = group.row;
    const province = unwrapExcelValue(cell(row, 1))!;
    const municipality = unwrapExcelValue(cell(row, 2))!;
    const provinceId = slugify(province) || 'sin-provincia';
    const municipalityId = `${provinceId}-${slugify(municipality) || 'sin-municipio'}`;
    const accessibility = normalizeAccess(group.accessibility);
    const status = normalizeStatus(group.status);
    if (accessibility === ACCESS_STATUSES.unknown && group.accessibility.has('NODISPONIBLE')) {
      // NODISPONIBLE no acredita acceso público; se deja deliberadamente como desconocido.
    }
    if (status === CHARGER_STATUSES.unknown && [...group.status].some((value) => value.trim())) {
      addWarning(warnings, `${id}: ESTATUS no interpretable, se publica como unknown`, seenWarnings);
    }
    if (group.coordinates.size > 1) {
      addWarning(
        warnings,
        `${id}: coords distintas entre conectores, se conserva la primera fila`,
        seenWarnings,
      );

    }

    const dates = [...group.dates].sort((a, b) => a.iso.localeCompare(b.iso));
    const updated = dates.at(-1);
    if (updated && (!latestUpdatedAt || updated.iso > latestUpdatedAt)) {
      latestUpdatedAt = updated.iso;
      latestUpdatedAtRaw = updated.raw;
    }

    const pointIds = [...group.pointIds].sort();
    const pointCodes = [...group.pointCodes].sort();
    const maxPowerKw = group.connectors.reduce<number | null>((max, connector) => {
      if (connector.powerKw === null) return max;
      return max === null || connector.powerKw > max ? connector.powerKw : max;
    }, null);

    const provenance = {
      source: SOURCE_IDS.ripree as SourceId,
      id,
      url: context.sourceUrl ?? RIPREE_EXPORT_PAGE_URL,
      ...optionalField('fetchedAt', context.fetchedAt),
      ...optionalField('sourceUpdatedAt', context.sourceUpdatedAt),
    };

    stations.push({
      id: `RIPREE-${id}`,
      source: SOURCE_IDS.ripree,
      officialId: id,
      ...optionalField('name', unwrapExcelValue(cell(row, 5))),
      ...optionalField('address', unwrapExcelValue(cell(row, 6))),
      municipality,
      municipalityId,
      municipalitySlug: uniqueSlug(municipality, municipalityId),
      province,
      provinceId,
      provinceSlug: uniqueSlug(province, provinceId),
      ...optionalField('postalCode', unwrapExcelValue(cell(row, 7))),
      lat: parseCoordinate(cell(row, 3))!,
      lon: parseCoordinate(cell(row, 4))!,
      ...optionalField('operator', unwrapExcelValue(cell(row, 11))),
      ...optionalField('operatorId', unwrapExcelValue(cell(row, 12))),
      accessibility,
      status,
      ...optionalField('schedule', unwrapExcelValue(cell(row, 10))),
      ...optionalField('services', unwrapExcelValue(cell(row, 13))),
      ...optionalField('paymentMethods', unwrapExcelValue(cell(row, 18))),
      ...optionalField('parkingRestrictions', unwrapExcelValue(cell(row, 19))),
      connectors: group.connectors,
      maxPowerKw,
      pointCount: Math.max(pointIds.length, pointCodes.length, group.connectors.length > 0 ? 1 : 0),
      pointIds,
      ...optionalField('updatedAt', updated?.iso),
      ...optionalField('updatedAtRaw', updated?.raw),
      sources: [provenance],
      raw: {
        ripree: {
          latitud: cell(row, 3),
          longitud: cell(row, 4),
          codigoPostal: cell(row, 7),
          accesibilidad: [...group.accessibility].join(','),
          estatus: [...group.status].join(','),
          fechaModificacion: updated?.raw ?? cell(row, 28),
          puntos: group.rows.map((candidate) => ({
            pointId: cell(candidate, 15),
            pointCode: cell(candidate, 20),
            connectorId: cell(candidate, 21),
            connector: cell(candidate, 22),
            chargeMode: cell(candidate, 23),
            format: cell(candidate, 24),
            power: cell(candidate, 25),
            voltage: cell(candidate, 26),
            amperage: cell(candidate, 27),
          })),
        },
      },
    });
  }

  return {
    stations,
    discarded,
    duplicateIds: [],
    warnings,
    withoutCoordinates,
    malformedRows: parsed.malformedRows,
    latestUpdatedAt,
    latestUpdatedAtRaw,
  };
}

function contentDispositionFilename(header: string | null): string | undefined {
  if (!header) return undefined;
  const encoded = header.match(/filename\*?=\s*(?:UTF-8''|")?([^";]+)"?/i);
  return encoded?.[1]?.trim() || undefined;
}

function filenameDate(filename: string): { iso: string; raw: string } | undefined {
  const match = filename.match(/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/);
  if (!match) return undefined;
  const [, year, month, day, hour, minute, second] = match;
  return {
    iso: `${year}-${month}-${day}T${hour}:${minute}:${second}`,
    raw: `${year}${month}${day}_${hour}${minute}${second}`,
  };
}

export async function fetchRipree(options: RipreeFetchOptions = {}): Promise<RipreeFetched> {
  const { url = RIPREE_URL, ...httpOptions } = options;
  const fetched = await fetchBinary(url, {
    ...httpOptions,
    method: 'POST',
    body: RIPREE_REQUEST_BODY,
    maxBytes: httpOptions.maxBytes ?? 80 * 1024 * 1024,
    timeoutMs: httpOptions.timeoutMs ?? 300_000,
  });

  const filename = contentDispositionFilename(fetched.headers.get('content-disposition'));
  const date = filename ? filenameDate(filename) : undefined;
  return {
    bytes: fetched.bytes,
    text: decodeRipree(fetched.bytes),
    fetchedAt: fetched.fetchedAt,
    finalUrl: fetched.finalUrl,
    filename,
    sourceUpdatedAt: date?.iso,
    sourceUpdatedAtRaw: date?.raw,
    contentType: fetched.contentType,
  };
}

export async function readLocalRipree(input: string): Promise<RipreeFetched> {
  const resolved = path.resolve(input);
  const bytes = await readFile(resolved);
  const filename = path.basename(resolved);
  const date = filenameDate(filename);
  return {
    bytes,
    text: decodeRipree(bytes),
    fetchedAt: new Date().toISOString(),
    finalUrl: `file://${resolved}`,
    filename,
    sourceUpdatedAt: date?.iso,
    sourceUpdatedAtRaw: date?.raw,
    contentType: 'text/csv',
  };
}
