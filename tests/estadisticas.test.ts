import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildIndexes } from '../scripts/lib/indexes.js';
import { buildStatistics, priceStatsFor, valueStats } from '../scripts/lib/statistics.js';
import type { FuelStation } from '../scripts/lib/types.js';

function station(id: string, price: number | null, provinceId = '11', municipalityId = '100'): FuelStation {
  return {
    id,
    municipality: 'Los Barrios',
    municipalityId,
    municipalitySlug: `los-barrios-${municipalityId}`,
    province: 'Cádiz',
    provinceId,
    provinceSlug: `cadiz-${provinceId}`,
    lat: 36.18,
    lon: -5.49,
    prices: { g95: price, g98: null, goa: null, gop: null, glp: null },
    raw: { latitud: '36,18', longitud: '-5,49', precios: {} },
  };
}

describe('estadísticas', () => {
  it('calcula mínimo, máximo y media ignorando ausentes', () => {
    assert.deepEqual(valueStats([]), { count: 0, min: null, max: null, avg: null });
    assert.deepEqual(valueStats([1.4, 1.6, 1.5]), { count: 3, min: 1.4, max: 1.6, avg: 1.5 });
    const stations = [station('1', 1.4), station('2', null), station('3', 1.6)];
    assert.deepEqual(priceStatsFor(stations, 'g95'), {
      count: 2,
      min: 1.4,
      max: 1.6,
      avg: 1.5,
    });
  });

  it('genera estadísticas por provincia, municipio y resumen', () => {
    const stations = [station('1', 1.4), station('2', 1.6), station('3', 1.8, '29', '200')];
    const indexes = buildIndexes(stations);
    const output = buildStatistics({
      stations,
      indexes,
      generatedAt: '2026-11-26T10:00:00.000Z',
      sourceUpdatedAt: '2026-11-26T14:24:06',
      totals: {
        stations: 3,
        provinces: 2,
        municipalities: 2,
        discarded: 0,
        duplicates: 0,
        withoutCoordinates: 0,
      },
      quality: {
        recordsWithoutPrices: 0,
        invalidPrices: 0,
        discarded: 0,
        duplicates: 0,
        withoutCoordinates: 0,
      },
    });

    assert.equal(output.provincias.length, 2);
    assert.equal(output.municipios.length, 2);
    assert.equal(output.provincias.find((item) => item.id === '11')?.prices.g95.avg, 1.5);
    assert.equal(output.resumen.prices.g95.min, 1.4);
    assert.equal(output.resumen.totals.stations, 3);
  });
});
