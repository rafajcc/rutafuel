import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildChargerIndex, buildChargerStatistics } from './lib/charger-stats.js';
import { deduplicateChargers } from './lib/dedupe.js';
import { MINETUR_URL, normalizeStations, validateResponse } from './lib/gasolineras.js';
import { fetchJson } from './lib/http.js';
import { buildIndexes, municipalityIndexPath, provinceIndexPath } from './lib/indexes.js';
import {
  fetchOcm,
  OCM_API_URL,
  normalizeOcm,
  readLocalOcm,
  type OcmFetched,
} from './lib/ocm.js';
import {
  fetchRipree,
  normalizeRipree,
  parseRipreeCsv,
  readLocalRipree,
  RIPREE_EXPORT_PAGE_URL,
  type RipreeFetched,
} from './lib/ripree.js';
import { buildStatistics } from './lib/statistics.js';
import { readPreviousMetadata, writeDatasetAtomic } from './lib/storage.js';
import { DATA_VERSION, FUEL_KEYS, SOURCE_IDS } from './lib/types.js';
import type { DatasetMetadata, MineturResponse, SourceInfo } from './lib/types.js';
import { validateDataset } from './lib/validation.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

type Args = Record<string, string | boolean>;

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (!token.startsWith('--')) continue;
    const equalsAt = token.indexOf('=');
    if (equalsAt > 2) {
      args[token.slice(2, equalsAt)] = token.slice(equalsAt + 1);
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      index += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function stringArg(args: Args, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' ? value : undefined;
}

function logWarnings(label: string, warnings: string[]): void {
  for (const warning of warnings) console.warn(`[rutafuel][aviso:${label}] ${warning}`);
}

/** Las rutas de ficheros locales son de depuración: nunca se publican en los JSON. */
function publicSourceUrl(url: string, officialUrl: string): string {
  return url.startsWith('file://') ? officialUrl : url;
}

async function loadMinetur(args: Args) {
  const input = stringArg(args, 'input');
  if (input) {
    const resolved = path.resolve(input);
    const text = await readFile(resolved, 'utf8');
    return {
      data: JSON.parse(text) as MineturResponse,
      fetchedAt: new Date().toISOString(),
      bytes: Buffer.byteLength(text, 'utf8'),
      finalUrl: `file://${resolved}`,
    };
  }
  return fetchJson<MineturResponse>(stringArg(args, 'url') ?? MINETUR_URL);
}

async function loadRipree(args: Args): Promise<RipreeFetched> {
  const input = stringArg(args, 'ripree-input');
  if (input) {
    console.log(`[rutafuel] Procesando RIPREE local ${path.resolve(input)}`);
    return readLocalRipree(input);
  }
  const url = stringArg(args, 'ripree-url');
  console.log(`[rutafuel] Descargando RIPREE desde ${url ?? RIPREE_EXPORT_PAGE_URL}`);
  const fetched = await fetchRipree(url ? { url } : {});
  if (fetched.contentType && !/csv|text\/plain/i.test(fetched.contentType)) {
    throw new Error(`RIPREE devolvió ${fetched.contentType} en lugar de CSV`);
  }
  return fetched;
}

interface OcmLoadResult {
  fetched?: OcmFetched;
  skippedNote?: string;
  url: string;
}

async function loadOcm(args: Args): Promise<OcmLoadResult> {
  const input = stringArg(args, 'ocm-input');
  if (input) {
    console.log(`[rutafuel] Procesando OCM local ${path.resolve(input)}`);
    const fetched = await readLocalOcm(input);
    return { fetched, url: fetched.finalUrl };
  }
  if (args['no-ocm']) return { skippedNote: 'fuente omitida con --no-ocm', url: OCM_API_URL };

  const apiKey = process.env.OCM_API_KEY?.trim();
  if (!apiKey) {
    return {
      skippedNote: 'OCM_API_KEY no configurada; fuente opcional omitida',
      url: OCM_API_URL,
    };
  }

  console.log('[rutafuel] Descargando Open Charge Map (credencial solo en cabecera)');
  const fetched = await fetchOcm({ apiKey, timeoutMs: 180_000 });
  return { fetched, url: fetched.finalUrl };
}

function sourceInfo(input: {
  id: SourceInfo['id'];
  url: string;
  fetchedAt: string;
  received: number;
  processed: number;
  discarded: number;
  withoutCoordinates: number;
  duplicates: number;
  sourceUpdatedAt?: string;
  sourceUpdatedAtRaw?: string;
  note?: string;
  attribution?: SourceInfo['attribution'];
}): SourceInfo {
  return {
    id: input.id,
    url: input.url,
    fetchedAt: input.fetchedAt,
    status: input.note ? 'skipped' : 'active',
    ...(input.note ? { note: input.note } : {}),
    ...(input.sourceUpdatedAt ? { sourceUpdatedAt: input.sourceUpdatedAt } : {}),
    ...(input.sourceUpdatedAtRaw ? { sourceUpdatedAtRaw: input.sourceUpdatedAtRaw } : {}),
    recordsReceived: input.received,
    recordsProcessed: input.processed,
    recordsDiscarded: input.discarded,
    recordsWithoutCoordinates: input.withoutCoordinates,
    duplicateRecords: input.duplicates,
    ...(input.attribution ? { attribution: input.attribution } : {}),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dataDir = path.resolve(projectRoot, stringArg(args, 'data-dir') ?? 'src/data');
  const generatedAt = new Date().toISOString();
  const inputPath = stringArg(args, 'input');

  console.log(
    inputPath
      ? `[rutafuel] Procesando fichero local ${path.resolve(inputPath)}`
      : `[rutafuel] Descargando ${stringArg(args, 'url') ?? MINETUR_URL}`,
  );
  const fetched = await loadMinetur(args);
  console.log(`[rutafuel] Recibidos ${(fetched.bytes / 1024 / 1024).toFixed(2)} MiB de MINETUR`);

  const response = validateResponse(fetched.data);
  logWarnings('MINETUR', response.warnings);
  const normalized = normalizeStations(response.records);
  logWarnings('MINETUR', normalized.warnings);

  const indexes = buildIndexes(normalized.stations);
  const mineturSource = sourceInfo({
    id: SOURCE_IDS.minetur,
    url: publicSourceUrl(fetched.finalUrl, stringArg(args, 'url') ?? MINETUR_URL),
    fetchedAt: fetched.fetchedAt,
    received: response.records.length,
    processed: normalized.stations.length,
    discarded: normalized.discarded.length,
    withoutCoordinates: normalized.withoutCoordinates,
    duplicates: normalized.duplicateIds.length,
    sourceUpdatedAt: response.sourceDate.iso,
    sourceUpdatedAtRaw: response.sourceDate.raw,
  });

  const ripreeFetched = await loadRipree(args);
  console.log(`[rutafuel] Recibidos ${(ripreeFetched.bytes.byteLength / 1024 / 1024).toFixed(2)} MiB de RIPREE`);
  const ripreeParsed = parseRipreeCsv(ripreeFetched.text);
  const ripreeNormalized = normalizeRipree(ripreeParsed, {
    fetchedAt: ripreeFetched.fetchedAt,
    sourceUrl: publicSourceUrl(ripreeFetched.finalUrl, RIPREE_EXPORT_PAGE_URL),
    sourceUpdatedAt: ripreeFetched.sourceUpdatedAt,
  });
  logWarnings('RIPREE', ripreeNormalized.warnings);

  const ripreeUpdatedAt = ripreeFetched.sourceUpdatedAt ?? ripreeNormalized.latestUpdatedAt;
  const ripreeUpdatedAtRaw = ripreeFetched.sourceUpdatedAtRaw ?? ripreeNormalized.latestUpdatedAtRaw;
  if (!ripreeFetched.sourceUpdatedAt && ripreeUpdatedAt) {
    for (const station of ripreeNormalized.stations) {
      station.sources = station.sources.map((source) => ({
        ...source,
        sourceUpdatedAt: ripreeUpdatedAt,
        ...(ripreeUpdatedAtRaw ? { sourceUpdatedAtRaw: ripreeUpdatedAtRaw } : {}),
      }));
    }
  }
  const ripreeSource = sourceInfo({
    id: SOURCE_IDS.ripree,
    url: publicSourceUrl(ripreeFetched.finalUrl, RIPREE_EXPORT_PAGE_URL),
    fetchedAt: ripreeFetched.fetchedAt,
    received: ripreeParsed.rows.length,
    processed: ripreeNormalized.stations.length,
    discarded: ripreeNormalized.discarded.length,
    withoutCoordinates: ripreeNormalized.withoutCoordinates,
    duplicates: ripreeNormalized.duplicateIds.length,
    sourceUpdatedAt: ripreeUpdatedAt,
    sourceUpdatedAtRaw: ripreeUpdatedAtRaw,
  });

  const ocmLoad = await loadOcm(args);
  let ocmNormalized: ReturnType<typeof normalizeOcm> | undefined;
  let ocmSource: SourceInfo;
  if (ocmLoad.fetched) {
    ocmNormalized = normalizeOcm(ocmLoad.fetched.pois, {
      fetchedAt: ocmLoad.fetched.fetchedAt,
      sourceUrl: ocmLoad.fetched.finalUrl,
    });
    logWarnings('OCM', ocmNormalized.warnings);
    const provider = ocmNormalized.stations
      .flatMap((station) => station.sources)
      .find((source) => source.dataProvider);
    ocmSource = sourceInfo({
      id: SOURCE_IDS.ocm,
      url: publicSourceUrl(ocmLoad.url, OCM_API_URL),
      fetchedAt: ocmLoad.fetched.fetchedAt,
      received: ocmLoad.fetched.pois.length,
      processed: ocmNormalized.stations.length,
      discarded: ocmNormalized.discarded.length,
      withoutCoordinates: ocmNormalized.withoutCoordinates,
      duplicates: ocmNormalized.duplicateIds.length,
      sourceUpdatedAt: ocmNormalized.latestUpdatedAt,
      sourceUpdatedAtRaw: ocmNormalized.latestUpdatedAtRaw,
      attribution: provider ? { dataProvider: provider.dataProvider, license: provider.license } : undefined,
    });
  } else {
    ocmSource = sourceInfo({
      id: SOURCE_IDS.ocm,
      url: ocmLoad.url,
      fetchedAt: generatedAt,
      received: 0,
      processed: 0,
      discarded: 0,
      withoutCoordinates: 0,
      duplicates: 0,
      note: ocmLoad.skippedNote,
    });
  }

  const merged = deduplicateChargers(
    ripreeNormalized.stations,
    ocmNormalized?.stations ?? [],
  );
  console.log(
    `[rutafuel] Deduplicación: ${merged.merged} fusiones ` +
      `(${merged.matchedBy.officialId} por ID oficial, ${merged.matchedBy.proximity} por proximidad)`,
  );

  const totals = {
    stations: normalized.stations.length,
    provinces: indexes.provinces.size,
    municipalities: indexes.municipalities.size,
    discarded: normalized.discarded.length,
    duplicates: normalized.duplicateIds.length,
    withoutCoordinates: normalized.withoutCoordinates,
    chargingStations: merged.stations.length,
    chargingPoints: merged.stations.reduce((total, station) => total + station.pointCount, 0),
    chargingDuplicates: merged.merged,
    malformedRipreeRows: ripreeNormalized.malformedRows,
  };

  const files: Record<string, unknown> = {
    'gasolineras/estaciones.json': normalized.stations,
    'gasolineras/indice.json': indexes.global,
  };
  for (const index of indexes.provinces.values()) files[provinceIndexPath(index)] = index;
  for (const index of indexes.municipalities.values()) {
    files[municipalityIndexPath(index)] = index;
  }

  const statistics = buildStatistics({
    stations: normalized.stations,
    indexes,
    generatedAt,
    sourceUpdatedAt: response.sourceDate.iso,
    totals,
    quality: {
      recordsWithoutPrices: normalized.stations.filter((station) =>
        FUEL_KEYS.every((fuel) => station.prices[fuel] === null),
      ).length,
      invalidPrices: normalized.invalidPrices,
      discarded: normalized.discarded.length,
      duplicates: normalized.duplicateIds.length,
      withoutCoordinates: normalized.withoutCoordinates,
    },
  });
  files['estadisticas/provincias.json'] = statistics.provincias;
  files['estadisticas/municipios.json'] = statistics.municipios;
  files['estadisticas/resumen.json'] = statistics.resumen;

  const chargerIndex = buildChargerIndex(merged.stations);
  const chargerStats = buildChargerStatistics({
    stations: merged.stations,
    generatedAt,
    sourceUpdatedAt: ripreeUpdatedAt,
    duplicatesRemoved: merged.merged,
    malformedRipreeRows: ripreeNormalized.malformedRows,
  });
  files['cargadores/estaciones.json'] = merged.stations;
  files['cargadores/indice.json'] = chargerIndex;
  files['estadisticas/cargadores.json'] = chargerStats;

  const sources = [mineturSource, ripreeSource, ocmSource];
  const metadata: DatasetMetadata = {
    dataVersion: DATA_VERSION,
    generatedAt,
    sources,
    validation: { ok: false, checkedAt: generatedAt, checks: [] },
    totals,
  };
  files['metadata.json'] = metadata;

  const previous = await readPreviousMetadata(dataDir);
  const validation = validateDataset({
    stations: normalized.stations,
    normalized,
    files,
    previous,
    generatedAt,
    dataVersion: DATA_VERSION,
    chargers: {
      stations: merged.stations,
      index: chargerIndex,
      stats: chargerStats,
      malformedRipreeRows: ripreeNormalized.malformedRows,
      duplicatesRemoved: merged.merged,
    },
  });
  metadata.validation = validation;

  for (const check of validation.checks) {
    if (check.ok) continue;
    const message = `[rutafuel][${check.severity}] ${check.name}: ${check.detail}`;
    if (check.severity === 'error') console.error(message);
    else console.warn(message);
  }

  if (!validation.ok) {
    throw new Error('Validación crítica fallida; los datos anteriores no se han modificado');
  }

  if (args['dry-run']) {
    console.log(
      `[rutafuel] dry-run: ${Object.keys(files).length} ficheros generados, sin escritura; ` +
        `${totals.stations} gasolineras y ${totals.chargingStations} estaciones de recarga ` +
        `(${totals.chargingPoints} puntos)`,
    );
    return;
  }

  await writeDatasetAtomic(dataDir, files, {
    pretty: [
      'metadata.json',
      'gasolineras/indice.json',
      'cargadores/indice.json',
      'estadisticas/resumen.json',
      'estadisticas/cargadores.json',
    ],
  });

  console.log(
    `[rutafuel] OK: ${totals.stations} estaciones, ${totals.provinces} provincias, ` +
      `${totals.municipalities} municipios; ${totals.chargingStations} puntos de recarga ` +
      `(${totals.chargingPoints} puntos de conexión)`,
  );
  console.log(
    `[rutafuel] Calidad: ${totals.discarded} descartes, ${totals.duplicates} duplicados, ` +
      `${totals.malformedRipreeRows} filas RIPREE malformadas, ${totals.chargingDuplicates} fusiones`,
  );
  console.log(`[rutafuel] Datos escritos en ${dataDir}`);
}

main().catch((error: unknown) => {
  console.error(`[rutafuel] ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
