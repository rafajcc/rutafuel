import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildChargerIndexes,
  chargerMunicipalityIndexPath,
  chargerProvinceIndexPath,
} from '../scripts/lib/charger-indexes.js';
import type { ChargingIndexLike } from '../src/lib/charging-pages.js';
import {
  buildChargingMunicipalityPages,
  buildChargingProvincePages,
  MIN_CHARGING_STATIONS,
} from '../src/lib/charging-pages.js';
import {
  connectorLabel,
  filterChargingStations,
  hasRecentKnownStatus,
  powerTier,
  sortChargingStations,
  tierColor,
  type ChargingStationLike,
} from '../src/lib/charging.js';
import { chargingStationListSchema } from '../src/lib/seo.js';
import { makeConnector, makeStation } from './fixtures/chargers.js';

const REFERENCE = '2026-11-20T13:11:00';

function station(overrides: Partial<ChargingStationLike> = {}): ChargingStationLike {
  return {
    id: 'RIPREE-1',
    lat: 40,
    lon: -3,
    status: 'unknown',
    maxPowerKw: 50,
    pointCount: 2,
    connectors: [{ type: 'CCS2', powerKw: 50 }],
    ...overrides,
  };
}

const origin = { lat: 40, lon: -3 };

describe('HITO 4: comparador eléctrico', () => {
  it('clasifica la potencia en tramos lenta, rápida y ultrarrápida', () => {
    assert.equal(powerTier(null), 'unknown');
    assert.equal(powerTier(undefined), 'unknown');
    assert.equal(powerTier(-1), 'unknown');
    assert.equal(powerTier(0.06), 'slow');
    assert.equal(powerTier(21.99), 'slow');
    assert.equal(powerTier(22), 'fast');
    assert.equal(powerTier(149.9), 'fast');
    assert.equal(powerTier(150), 'ultra');
    assert.equal(powerTier(1000), 'ultra');
    assert.notEqual(tierColor('slow'), tierColor('ultra'));
  });

  it('muestra etiquetas legibles sin perder el tipo original del conector', () => {
    assert.equal(connectorLabel('CCS2'), 'CCS2 (Combo 2)');
    assert.equal(connectorLabel('CHADEMO'), 'CHAdeMO');
    assert.equal(connectorLabel('TIPO_DESCONOCIDO'), 'TIPO_DESCONOCIDO');
  });

  it('sólo acepta estados conocidos y recientes respecto a la fuente', () => {
    assert.equal(hasRecentKnownStatus(station(), REFERENCE), false);
    assert.equal(
      hasRecentKnownStatus(station({ status: 'operational' }), REFERENCE),
      false,
      'sin fecha no se considera reciente',
    );
    assert.equal(
      hasRecentKnownStatus(station({ status: 'operational', updatedAt: '2026-11-19T10:00:00' }), REFERENCE),
      true,
    );
    assert.equal(
      hasRecentKnownStatus(station({ status: 'out-of-service', updatedAt: '2025-11-01T10:00:00' }), REFERENCE),
      false,
    );
    assert.equal(
      hasRecentKnownStatus(station({ status: 'operational', updatedAt: '2026-12-01T10:00:00' }), REFERENCE),
      false,
      'una fecha futura no es fiable',
    );
    assert.equal(
      hasRecentKnownStatus(
        station({ status: 'operational', updatedAt: '2026-11-19T10:00:00' }),
        undefined,
      ),
      false,
    );
  });

  it('filtra por potencia, conector, operador, radio y estado reciente', () => {
    const slow = station({ id: 'slow', maxPowerKw: 11, connectors: [{ type: 'TYPE2' }] });
    const fast = station({
      id: 'fast',
      maxPowerKw: 150,
      operator: 'ENDESA X',
      connectors: [{ type: 'CCS2' }, { type: 'CHADEMO' }],
      lat: 40.01,
    });
    const far = station({
      id: 'far',
      maxPowerKw: 350,
      lat: 41.5,
      status: 'operational',
      updatedAt: '2026-11-19T10:00:00',
    });
    const oldStatus = station({
      id: 'old-status',
      status: 'operational',
      updatedAt: '2025-01-01T00:00:00',
    });
    const all = [slow, fast, far, oldStatus];

    assert.deepEqual(
      filterChargingStations(all, { tier: 'slow' }).map((item) => item.id),
      ['slow'],
    );
    assert.deepEqual(
      filterChargingStations(all, { minPowerKw: 150 }).map((item) => item.id),
      ['fast', 'far'],
    );
    assert.deepEqual(
      filterChargingStations(all, { connector: 'CHADEMO' }).map((item) => item.id),
      ['fast'],
    );
    assert.deepEqual(
      filterChargingStations(all, { operator: 'endesa' }).map((item) => item.id),
      ['fast'],
    );
    assert.deepEqual(
      filterChargingStations(all, { tier: 'all', minPowerKw: 0 }, origin, 2).map((item) => item.id),
      ['slow', 'fast', 'old-status'],
    );
    assert.deepEqual(
      filterChargingStations(all, { status: 'operational', referenceDate: REFERENCE }).map(
        (item) => item.id,
      ),
      ['far'],
    );
    assert.deepEqual(filterChargingStations(all, { status: 'out-of-service' }), []);
  });

  it('ordena por distancia y por potencia con desempate estable', () => {
    const near = station({ id: 'near', lat: 40.001, maxPowerKw: 22 });
    const powerful = station({ id: 'powerful', lat: 40.02, maxPowerKw: 350 });
    assert.deepEqual(
      sortChargingStations([powerful, near], origin, 'distance').map((item) => item.id),
      ['near', 'powerful'],
    );
    assert.deepEqual(
      sortChargingStations([near, powerful], origin, 'power').map((item) => item.id),
      ['powerful', 'near'],
    );
  });

  it('genera índices ligeros por provincia y municipio con centroide real', () => {
    const first = makeStation({
      id: 'RIPREE-1',
      officialId: '1',
      connectors: [makeConnector('CCS2', 150, 'RIPREE')],
      maxPowerKw: 150,
      lat: 40,
      lon: -3,
    });
    const second = makeStation({
      id: 'RIPREE-2',
      officialId: '2',
      municipality: 'Alcobendas',
      municipalityId: 'alcobendas-madrid',
      municipalitySlug: 'alcobendas-alcobendas-madrid',
      connectors: [makeConnector('TYPE2', 22, 'RIPREE')],
      maxPowerKw: 22,
      lat: 40.6,
      lon: -3.6,
    });
    const built = buildChargerIndexes([second, first]);

    const province = built.provinces.get('madrid');
    assert.equal(province?.stationCount, 2);
    assert.equal(province?.maxPowerKw, 150);
    assert.deepEqual(province?.center, { lat: 40.3, lon: -3.3 });
    assert.equal(province?.municipalities.length, 2);
    assert.deepEqual(
      province?.municipalities.map((entry) => entry.stationCount),
      [1, 1],
    );
    assert.equal(
      chargerProvinceIndexPath('madrid'),
      'cargadores/provincias/madrid.json',
    );
    assert.equal(
      chargerMunicipalityIndexPath('madrid', 'madrid-madrid'),
      'cargadores/municipios/madrid/madrid-madrid.json',
    );

    for (const index of [...built.provinces.values(), ...built.municipalities.values()]) {
      assert.ok(index.stations.length > 0);
      assert.ok(index.stations.every((entry) => !('raw' in entry)));
      assert.ok(index.stations.every((entry) => entry.sources.every((source) => !('url' in source))));
    }
    assert.equal(built.municipalities.get('madrid/alcobendas-madrid')?.maxPowerKw, 22);
    assert.equal(built.municipalities.get('madrid/alcobendas-madrid')?.pointCount, 1);
  });

  it('crea páginas de recarga sólo con contenido suficiente y URLs del dataset eléctrico', () => {
    const base: ChargingIndexLike = {
      provinces: [
        {
          id: 'madrid',
          name: 'Madrid',
          slug: 'madrid-madrid',
          stationCount: 10,
          pointCount: 20,
          maxPowerKw: 350,
          center: { lat: 40, lon: -3 },
        },
      ],
      municipalities: [
        {
          id: 'madrid-madrid',
          name: 'Madrid',
          slug: 'madrid-ciudad',
          provinceId: 'madrid',
          stationCount: MIN_CHARGING_STATIONS,
          pointCount: 6,
          maxPowerKw: 150,
          center: { lat: 40, lon: -3 },
        },
        {
          id: 'poco',
          name: 'Poco',
          slug: 'poco',
          provinceId: 'madrid',
          stationCount: MIN_CHARGING_STATIONS - 1,
          pointCount: 2,
          maxPowerKw: 50,
          center: { lat: 40.1, lon: -3.1 },
        },
        {
          id: 'sin-potencia',
          name: 'Sin potencia',
          slug: 'sin-potencia',
          provinceId: 'madrid',
          stationCount: 5,
          pointCount: 5,
          maxPowerKw: null,
          center: { lat: 40.2, lon: -3.2 },
        },
      ],
    };

    const provinces = buildChargingProvincePages(base);
    const municipalities = buildChargingMunicipalityPages(base);
    assert.deepEqual(
      provinces.map((page) => page.url),
      ['/recarga-electrica/madrid-madrid/'],
    );
    assert.deepEqual(
      municipalities.map((page) => page.url),
      ['/recarga-electrica/madrid-madrid/madrid-ciudad/'],
    );
    assert.equal(municipalities[0]?.provinceName, 'Madrid');
  });

  it('emite JSON-LD de cargadores sin inventar disponibilidad', () => {
    const schema = chargingStationListSchema(
      [
        {
          id: 'RIPREE-1',
          name: 'Cargador Centro',
          address: 'Calle Mayor 1',
          municipality: 'Madrid',
          province: 'Madrid',
          lat: 40,
          lon: -3,
          maxPowerKw: 150,
          connectors: [{ type: 'CCS2' }],
        },
      ],
      'https://rutafuel.es/',
    );
    assert.equal(schema['@type'], 'ItemList');
    assert.equal(schema.numberOfItems, 1);
    const item = schema.itemListElement[0]?.item;
    assert.equal(item['@type'], 'ElectricVehicleChargingStation');
    assert.equal(item.geo.latitude, 40);
    assert.equal(item.address?.addressCountry, 'ES');
    assert.match(item.description ?? '', /Potencia máxima: 150 kW/);
    assert.match(item.description ?? '', /Conectores: CCS2/);
    assert.equal(JSON.stringify(schema).toLowerCase().includes('operational'), false);
  });
});
