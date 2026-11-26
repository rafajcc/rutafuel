import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  mergeResultFromPrevious,
  normalizedFromPrevious,
  previousSource,
  readPreviousStations,
  requirePrevious,
} from '../scripts/lib/reuse.js';
import { DATA_VERSION, SOURCE_IDS, type DatasetMetadata, type FuelStation } from '../scripts/lib/types.js';
import { validateDataset } from '../scripts/lib/validation.js';

function makeFuel(index: number, lat = 40.1): FuelStation {
  return {
    id: `F${index}`,
    municipality: 'Madrid',
    municipalityId: 'madrid',
    municipalitySlug: 'madrid-madrid',
    province: 'Madrid',
    provinceId: '28',
    provinceSlug: 'madrid-28',
    lat,
    lon: -3.1,
    prices: { g95: 1.4, g98: null, goa: null, gop: null, glp: null },
    raw: { latitud: '40,1', longitud: '-3,1', precios: {} },
  };
}

function metadata(overrides: Partial<DatasetMetadata> = {}): DatasetMetadata {
  return {
    dataVersion: DATA_VERSION,
    generatedAt: '2026-11-26T15:00:00.000Z',
    sources: [
      {
        id: SOURCE_IDS.minetur,
        url: 'https://example.test/minetur',
        fetchedAt: '2026-11-26T14:00:00.000Z',
        sourceUpdatedAt: '2026-11-26T13:00:00',
        recordsReceived: 1000,
        recordsProcessed: 1000,
        recordsDiscarded: 4,
        recordsWithoutCoordinates: 4,
        duplicateRecords: 0,
      },
      {
        id: SOURCE_IDS.ripree,
        url: 'https://example.test/ripree',
        fetchedAt: '2026-11-26T14:00:00.000Z',
        recordsReceived: 10,
        recordsProcessed: 10,
        recordsDiscarded: 0,
        recordsWithoutCoordinates: 0,
        duplicateRecords: 0,
      },
    ],
    validation: { ok: true, checkedAt: '2026-11-26T15:00:00.000Z', checks: [] },
    totals: {
      stations: 1000,
      provinces: 1,
      municipalities: 1,
      discarded: 4,
      duplicates: 0,
      withoutCoordinates: 4,
      chargingStations: 10,
      chargingDuplicates: 1,
      malformedRipreeRows: 2,
    },
    ...overrides,
  };
}

async function withDataDir(content: string | null): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'rutafuel-hito6-'));
  if (content !== null) await writeFile(path.join(dir, 'gasolineras.json'), content, 'utf8');
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

describe('HITO 6: automatización, rendimiento y despliegue', () => {
  it('exige un dataset anterior antes de omitir fuentes', () => {
    assert.throws(() => requirePrevious(undefined), /primera ingesta/);
    const prior = metadata();
    assert.equal(requirePrevious(prior), prior);
    assert.equal(previousSource(prior, SOURCE_IDS.ripree).id, SOURCE_IDS.ripree);
    assert.throws(() => previousSource(prior, SOURCE_IDS.ocm), /no registra/);
  });

  it('lee el maestro anterior y falla con mensaje claro si falta o está vacío', async () => {
    const ok = await withDataDir(JSON.stringify([makeFuel(1), makeFuel(2)]));
    try {
      const stations = await readPreviousStations<FuelStation>(ok.dir, 'gasolineras.json');
      assert.equal(stations.length, 2);
    } finally {
      await ok.cleanup();
    }

    const missing = await withDataDir(null);
    try {
      await assert.rejects(
        readPreviousStations(missing.dir, 'gasolineras.json'),
        /Falta gasolineras\.json/,
      );
    } finally {
      await missing.cleanup();
    }

    const empty = await withDataDir('[]');
    try {
      await assert.rejects(readPreviousStations(empty.dir, 'gasolineras.json'), /no contiene un array/);
    } finally {
      await empty.cleanup();
    }
  });

  it('reutiliza estaciones sin inventar descartes ni fusiones', () => {
    const stations = [makeFuel(1), makeFuel(2, Number.NaN)];
    const normalized = normalizedFromPrevious(stations);
    assert.equal(normalized.stations, stations);
    assert.equal(normalized.withoutCoordinates, 1);
    assert.deepEqual(normalized.discarded, []);
    assert.deepEqual(normalized.duplicateIds, []);

    const merged = mergeResultFromPrevious([]);
    assert.deepEqual(merged.stations, []);
    assert.equal(merged.merged, 0);
    assert.deepEqual(merged.matchedBy, { officialId: 0, proximity: 0 });
  });

  it('usa los recuentos de calidad originales al validar una fuente reutilizada', () => {
    const stations = Array.from({ length: 1000 }, (_, index) => makeFuel(index));
    const normalized = normalizedFromPrevious(stations);
    const input = {
      stations,
      normalized,
      files: {},
      generatedAt: '2026-11-26T15:00:00.000Z',
      dataVersion: DATA_VERSION,
    };
    const reused = validateDataset({
      ...input,
      quality: { discarded: 4, duplicates: 0 },
      previous: metadata(),
    });
    const discards = reused.checks.find((check) => check.name === 'descartes-proporción');
    assert.equal(discards?.ok, true);
    assert.match(discards?.detail ?? '', /0\.40%/);

    const corrupted = validateDataset({
      ...input,
      quality: { discarded: 400, duplicates: 0 },
      previous: metadata(),
    });
    assert.equal(corrupted.checks.find((check) => check.name === 'descartes-proporción')?.ok, false);

    const defaults = validateDataset(input);
    assert.match(
      defaults.checks.find((check) => check.name === 'descartes-proporción')?.detail ?? '',
      /0\.00%/,
    );
  });

  it('configura el workflow con refresco separado, validación y sin secretos en el código', async () => {
    const workflow = await readFile(
      path.resolve('.github/workflows/update-data.yml'),
      'utf8',
    );
    for (const token of [
      '0 */2 * * *',
      '30 3 * * *',
      '--skip-ripree --skip-ocm',
      '--skip-minetur',
      'secrets.OCM_API_KEY',
      'npm run check',
      'npm run verify:dist',
      'git commit',
      'cancel-in-progress: false',
    ]) {
      assert.ok(workflow.includes(token), `falta en el workflow: ${token}`);
    }
    assert.equal(workflow.includes('key='), false);

    const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {
      scripts: Record<string, string>;
    };
    assert.equal(packageJson.scripts['verify:dist'], 'tsx scripts/verify-dist.ts');
  });

  it('prepara Apache con caché por tipo y compresión sin listar directorios', async () => {
    const htaccess = await readFile(path.resolve('public/.htaccess'), 'utf8');
    assert.ok(htaccess.includes('DirectoryIndex index.html'));
    assert.ok(htaccess.includes('IndexIgnore *'));
    assert.ok(htaccess.includes('DEFLATE'));
    assert.ok(htaccess.includes('max-age=31536000, immutable'));
    assert.ok(htaccess.includes('max-age=0, must-revalidate'));
    assert.ok(htaccess.includes('nosniff'));
  });
});
