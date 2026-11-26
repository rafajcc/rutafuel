import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildIndexes, municipalityIndexPath, provinceIndexPath } from '../scripts/lib/indexes.js';
import type { FuelStation } from '../scripts/lib/types.js';

function station(id: string, provinceId: string, municipalityId: string, name: string): FuelStation {
  return {
    id,
    municipality: name,
    municipalityId,
    municipalitySlug: `${name.toLowerCase()}-${municipalityId}`,
    province: 'Cádiz',
    provinceId,
    provinceSlug: `cadiz-${provinceId}`,
    lat: 36.18,
    lon: -5.49,
    prices: { g95: 1.4, g98: null, goa: null, gop: null, glp: null },
    raw: { latitud: '36,18', longitud: '-5,49', precios: {} },
  };
}

describe('índices geográficos', () => {
  const indexes = buildIndexes([
    station('1', '11', '100', 'Los Barrios'),
    station('2', '11', '100', 'Los Barrios'),
    station('3', '11', '101', 'Algeciras'),
    station('4', '29', '200', 'Sevilla'),
  ]);

  it('agrupa por provincia y municipio sin perder estaciones', () => {
    assert.equal(indexes.provinces.size, 2);
    assert.equal(indexes.municipalities.size, 3);
    assert.equal(indexes.global.provinces.find((item) => item.id === '11')?.stationCount, 3);
    assert.equal(indexes.global.municipalities.find((item) => item.id === '100')?.stationCount, 2);
    assert.equal(indexes.provinces.get('11')?.municipalities.length, 2);
  });

  it('expone rutas relativas estables para carga bajo demanda', () => {
    const province = indexes.provinces.get('11')!;
    const municipality = indexes.municipalities.get('11/100')!;
    assert.equal(provinceIndexPath(province), 'gasolineras/provincias/11.json');
    assert.equal(municipalityIndexPath(municipality), 'gasolineras/municipios/11/100.json');
  });
});
