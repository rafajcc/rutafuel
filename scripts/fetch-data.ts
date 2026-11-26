import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MINETUR_URL, normalizeStations, validateResponse } from './lib/gasolineras.js';
import { fetchJson } from './lib/http.js';
import { buildIndexes, municipalityIndexPath, provinceIndexPath } from './lib/indexes.js';
import { buildStatistics } from './lib/statistics.js';
import { readPreviousMetadata, writeDatasetAtomic } from './lib/storage.js';
import { DATA_VERSION, FUEL_KEYS, SOURCE_IDS } from './lib/types.js';
import type { DatasetMetadata, MineturResponse, SourceInfo } from './lib/types.js';
import { validateDataset } from './lib/validation.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (!token.startsWith('--')) continue;
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

async function loadResponse(args: Record<string, string | boolean>) {
  if (typeof args.input === 'string') {
    const text = await readFile(path.resolve(args.input), 'utf8');
    return {
      data: JSON.parse(text) as MineturResponse,
      fetchedAt: new Date().toISOString(),
      bytes: Buffer.byteLength(text, 'utf8'),
      finalUrl: `file://${path.resolve(args.input)}`,
    };
  }
  return fetchJson<MineturResponse>(typeof args.url === 'string' ? args.url : MINETUR_URL);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dataDir = path.resolve(projectRoot, typeof args['data-dir'] === 'string' ? args['data-dir'] : 'src/data');
  const generatedAt = new Date().toISOString();
  const inputPath = typeof args.input === 'string' ? path.resolve(args.input) : undefined;

  console.log(
    inputPath
      ? `[rutafuel] Procesando fichero local ${inputPath}`
      : `[rutafuel] Descargando ${typeof args.url === 'string' ? args.url : MINETUR_URL}`,
  );
  const fetched = await loadResponse(args);
  console.log(`[rutafuel] Recibidos ${(fetched.bytes / 1024 / 1024).toFixed(2)} MiB`);

  const response = validateResponse(fetched.data);
  for (const warning of response.warnings) console.warn(`[rutafuel][aviso] ${warning}`);

  const normalized = normalizeStations(response.records);
  for (const warning of normalized.warnings) console.warn(`[rutafuel][aviso] ${warning}`);

  const indexes = buildIndexes(normalized.stations);
  const source: SourceInfo = {
    id: SOURCE_IDS.minetur,
    url: fetched.finalUrl,
    fetchedAt: fetched.fetchedAt,
    sourceUpdatedAtRaw: response.sourceDate.raw,
    sourceUpdatedAt: response.sourceDate.iso,
    recordsReceived: response.records.length,
    recordsProcessed: normalized.stations.length,
    recordsDiscarded: normalized.discarded.length,
    recordsWithoutCoordinates: normalized.withoutCoordinates,
    duplicateRecords: normalized.duplicateIds.length,
  };

  const totals = {
    stations: normalized.stations.length,
    provinces: indexes.provinces.size,
    municipalities: indexes.municipalities.size,
    discarded: normalized.discarded.length,
    duplicates: normalized.duplicateIds.length,
    withoutCoordinates: normalized.withoutCoordinates,
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

  const metadata: DatasetMetadata = {
    dataVersion: DATA_VERSION,
    generatedAt,
    sources: [source],
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
    console.log(`[rutafuel] dry-run: ${Object.keys(files).length} ficheros generados, sin escritura`);
    return;
  }

  await writeDatasetAtomic(dataDir, files, {
    pretty: ['metadata.json', 'gasolineras/indice.json', 'estadisticas/resumen.json'],
  });

  console.log(
    `[rutafuel] OK: ${totals.stations} estaciones, ${totals.provinces} provincias, ${totals.municipalities} municipios; ` +
      `${totals.discarded} descartados, ${totals.duplicates} duplicados, ${totals.withoutCoordinates} sin coordenadas`,
  );
  console.log(`[rutafuel] Datos escritos en ${dataDir}`);
}

main().catch((error: unknown) => {
  console.error(`[rutafuel] ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
