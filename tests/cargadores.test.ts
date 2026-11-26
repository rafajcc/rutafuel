import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildChargerIndexes } from '../scripts/lib/charger-indexes.js';
import { buildChargerIndex, buildChargerStatistics } from '../scripts/lib/charger-stats.js';
import type { FuelStation, NormalizeResult } from '../scripts/lib/types.js';
import { validateDataset } from '../scripts/lib/validation.js';
import { makeConnector, makeStation } from './fixtures/chargers.js';

describe('índices y estadísticas de cargadores', () => {
  it('agrupa por provincia y municipio con la potencia máxima', () => {
    const first = makeStation({ id: 'RIPREE-1', maxPowerKw: 22 });
    const second = makeStation({ id: 'RIPREE-2', officialId: '2', maxPowerKw: 150 });
    const other = makeStation({
      id: 'RIPREE-3',
      officialId: '3',
      municipality: 'Barcelona',
      municipalityId: 'barcelona-barcelona',
      province: 'Barcelona',
      provinceId: 'barcelona',
      maxPowerKw: null,
    });
    const index = buildChargerIndex([first, second, other]);

    assert.equal(index.provinces.length, 2);
    assert.deepEqual(index.provinces.find((item) => item.id === 'madrid'), {
      id: 'madrid',
      name: 'Madrid',
      slug: 'madrid-madrid',
      stationCount: 2,
      pointCount: 2,
      maxPowerKw: 150,
      center: { lat: 40, lon: -3 },
    });
    assert.equal(index.municipalities.find((item) => item.id === 'madrid-madrid')?.stationCount, 2);
    assert.equal(index.municipalities.find((item) => item.id === 'barcelona-barcelona')?.stationCount, 1);
  });

  it('calcula totales, procedencia, conectores y calidad sin inventar disponibilidad', () => {
    const ripree = makeStation({ status: 'unknown', accessibility: 'unknown', maxPowerKw: 22 });
    const ocm = makeStation({
      id: 'OCM-1',
      source: 'OCM',
      officialId: '1',
      status: 'operational',
      maxPowerKw: 50,
      connectors: [makeConnector('CCS2', 50, 'OCM')],
      sources: [{ source: 'OCM', id: '1' }],
    });
    const stats = buildChargerStatistics({
      stations: [ripree, ocm],
      generatedAt: '2026-11-26T15:00:00.000Z',
      sourceUpdatedAt: '2026-11-26T14:00:00',
      duplicatesRemoved: 3,
      malformedRipreeRows: 2,
    });

    assert.equal(stats.totals.stations, 2);
    assert.equal(stats.totals.points, 2);
    assert.equal(stats.totals.maxPowerKw, 50);
    assert.equal(stats.totals.duplicatesRemoved, 3);
    assert.equal(stats.totals.malformedRipreeRows, 2);
    assert.deepEqual(stats.bySource, { MINETUR: 0, RIPREE: 1, OCM: 1 });
    assert.deepEqual(stats.status, { unknown: 1, operational: 1, 'out-of-service': 0 });
    assert.deepEqual(stats.accessibility, { yes: 0, no: 0, unknown: 2 });
    assert.deepEqual(stats.power, { count: 2, min: 22, max: 50, avg: 36 });
    assert.deepEqual(stats.connectors.map((item) => item.type), ['CCS2', 'TYPE2']);
    assert.equal(stats.connectors[1]?.maxPowerKw, 22);
    assert.deepEqual(stats.quality, {
      withoutCoordinates: 0,
      withoutPower: 0,
      unknownStatus: 1,
      unknownAccess: 2,
    });
  });
});

function fuelStation(index: number): FuelStation {
  return {
    id: `S${index}`,
    municipality: 'Los Barrios',
    municipalityId: '100',
    municipalitySlug: 'los-barrios-100',
    province: 'Cádiz',
    provinceId: '11',
    provinceSlug: 'cadiz-11',
    lat: 36.18,
    lon: -5.49,
    prices: { g95: 1.4, g98: null, goa: null, gop: null, glp: null },
    raw: { latitud: '36,18', longitud: '-5,49', precios: {} },
  };
}

function validateChargers(
  stations: ReturnType<typeof makeStation>[],
  options: { metadataUrl?: string; malformedRows?: number; previousStations?: number } = {},
) {
  const fuels = Array.from({ length: 1000 }, (_, index) => fuelStation(index));
  // El umbral mínimo de la ingesta real es 1000 estaciones; se rellena con datos sintéticos
  // para poder ejercitar la validación con fixtures pequeños.
  const allStations = [
    ...stations,
    ...Array.from({ length: Math.max(0, 1000 - stations.length) }, (_, index) =>
      makeStation({
        id: `RIPREE-FILLER-${index}`,
        officialId: `FILLER-${index}`,
        pointIds: [`PF-${index}`],
      }),
    ),
  ];
  const normalized: NormalizeResult = {
    stations: fuels,
    discarded: [],
    duplicateIds: [],
    warnings: [],
    withoutCoordinates: 0,
    invalidPrices: 0,
  };
  const chargerIndexes = buildChargerIndexes(allStations);
  const files: Record<string, unknown> = {
    'gasolineras/estaciones.json': fuels,
    'gasolineras/provincias/11.json': { stationCount: fuels.length },
    'gasolineras/municipios/11/100.json': { stationCount: fuels.length },
    'cargadores/estaciones.json': allStations,
    'metadata.json': {
      sources: [{ url: options.metadataUrl ?? 'https://api.openchargemap.io/v3/poi/?countrycode=ES' }],
    },
  };
  for (const [id, index] of chargerIndexes.provinces) {
    files[`cargadores/provincias/${id}.json`] = index;
  }
  for (const [key, index] of chargerIndexes.municipalities) {
    const [provinceId, id] = key.split('/');
    files[`cargadores/municipios/${provinceId}/${id}.json`] = index;
  }
  const previous = options.previousStations
    ? {
        dataVersion: 2,
        generatedAt: '2026-11-01T00:00:00Z',
        sources: [],
        validation: { ok: true, checkedAt: '2026-11-01T00:00:00Z', checks: [] },
        totals: {
          stations: fuels.length,
          provinces: 1,
          municipalities: 1,
          discarded: 0,
          duplicates: 0,
          withoutCoordinates: 0,
          chargingStations: options.previousStations,
        },
      }
    : undefined;

  return validateDataset({
    stations: fuels,
    normalized,
    files,
    previous,
    generatedAt: '2026-11-26T15:00:00.000Z',
    dataVersion: 2,
    chargers: {
      stations: allStations,
      index: buildChargerIndex(allStations),
      stats: buildChargerStatistics({
        stations: allStations,
        generatedAt: '2026-11-26T15:00:00.000Z',
        duplicatesRemoved: 0,
        malformedRipreeRows: options.malformedRows ?? 0,
      }),
      malformedRipreeRows: options.malformedRows ?? 0,
      duplicatesRemoved: 0,
    },
  });
}

describe('validación del dataset con cargadores', () => {
  it('acepta un dataset coherente', () => {
    const result = validateChargers([
      makeStation({ id: 'RIPREE-1' }),
      makeStation({ id: 'OCM-1', source: 'OCM', officialId: '1' }),
    ]);
    assert.equal(result.ok, true, JSON.stringify(result.checks.filter((check) => !check.ok)));
  });

  it('detecta IDs duplicados, proveedores ausentes y secretos en metadatos', () => {
    const duplicated = makeStation({ id: 'RIPREE-1' });
    const result = validateChargers([duplicated, duplicated], {
      metadataUrl: 'https://api.openchargemap.io/v3/poi/?key=secreto-local',
    });
    const failed = result.checks.filter((check) => !check.ok).map((check) => check.name);
    assert.ok(failed.includes('cargadores-ids-únicos'));
    assert.ok(failed.includes('secretos-no-expuestos'));
    assert.equal(result.ok, false);
  });

  it('avisa de filas malformadas y bloquea una variación brusca', () => {
    const stations = [makeStation({ id: 'RIPREE-1' })];
    const withWarning = validateChargers(stations, { malformedRows: 1 });
    assert.equal(withWarning.ok, true);
    assert.equal(
      withWarning.checks.find((check) => check.name === 'cargadores-filas-malformadas')?.severity,
      'warning',
    );

    const withDrop = validateChargers(stations, { previousStations: 100 });
    assert.equal(withDrop.ok, false);
    assert.ok(withDrop.checks.some((check) => check.name === 'cargadores-variación-vs-anterior' && !check.ok));
  });
});
