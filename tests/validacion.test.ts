import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateDataset } from '../scripts/lib/validation.js';
import { DATA_VERSION } from '../scripts/lib/types.js';
import type { DatasetMetadata, FuelStation, NormalizeResult } from '../scripts/lib/types.js';

function makeStation(index: number, price = 1.4): FuelStation {
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
    prices: { g95: price, g98: null, goa: null, gop: null, glp: null },
    raw: { latitud: '36,18', longitud: '-5,49', precios: {} },
  };
}

function context(stations: FuelStation[], normalizedFixes: Partial<NormalizeResult> = {}) {
  const normalized: NormalizeResult = {
    stations,
    discarded: [],
    duplicateIds: [],
    warnings: [],
    withoutCoordinates: 0,
    invalidPrices: 0,
    ...normalizedFixes,
  };
  const metadata = {
    sources: [{ sourceUpdatedAt: '2026-11-26T14:24:06' }],
  } as unknown as DatasetMetadata;
  return {
    stations,
    normalized,
    generatedAt: '2026-11-26T15:00:00.000Z',
    dataVersion: DATA_VERSION,
    files: {
      'gasolineras/estaciones.json': stations,
      'gasolineras/provincias/11.json': { stationCount: stations.length },
      'gasolineras/municipios/11/100.json': { stationCount: stations.length },
      'metadata.json': metadata,
    },
  };
}

describe('validación del dataset', () => {
  it('acepta un dataset coherente', () => {
    const result = validateDataset(context(Array.from({ length: 1000 }, (_, index) => makeStation(index))));
    assert.equal(result.ok, true);
    assert.equal(result.checks.some((check) => !check.ok), false);
  });

  it('rechaza precios fuera de rango y coordenadas inválidas', () => {
    const badPrice = Array.from({ length: 1000 }, (_, index) => makeStation(index));
    badPrice[0]!.prices.g95 = 9.9;
    const resultPrice = validateDataset(context(badPrice));
    assert.equal(resultPrice.ok, false);
    assert.equal(resultPrice.checks.find((check) => check.name === 'precios-en-rango')?.ok, false);

    const badCoords = Array.from({ length: 1000 }, (_, index) => makeStation(index));
    badCoords[0]!.lat = 0;
    assert.equal(validateDataset(context(badCoords)).ok, false);
  });

  it('detecta duplicados y pérdida del fichero maestro', () => {
    const duplicated = Array.from({ length: 1000 }, (_, index) => makeStation(index));
    duplicated[1]!.id = duplicated[0]!.id;
    const input = context(duplicated, { duplicateIds: ['S0'] });
    assert.equal(validateDataset(input).ok, false);

    const { 'gasolineras/estaciones.json': _master, ...filesWithoutMaster } = input.files;
    assert.equal(validateDataset({ ...input, files: filesWithoutMaster }).ok, false);
  });

  it('avisa ante cambios grandes respecto al dataset anterior (y falla si son críticos)', () => {
    const stations = Array.from({ length: 1000 }, (_, index) => makeStation(index));
    const previous = {
      dataVersion: DATA_VERSION,
      generatedAt: '2026-11-26T13:00:00.000Z',
      sources: [{ sourceUpdatedAt: '2026-11-26T13:24:06' }],
      validation: { ok: true, checkedAt: '', checks: [] },
      totals: {
        stations: 1200,
        provinces: 1,
        municipalities: 1,
        discarded: 0,
        duplicates: 0,
        withoutCoordinates: 0,
      },
    } as unknown as DatasetMetadata;

    const warning = validateDataset({ ...context(stations), previous });
    assert.equal(warning.ok, true);
    assert.equal(warning.checks.find((check) => check.name === 'variación-vs-anterior')?.severity, 'warning');

    previous.totals.stations = 2000;
    const error = validateDataset({ ...context(stations), previous });
    assert.equal(error.ok, false);
  });
});
