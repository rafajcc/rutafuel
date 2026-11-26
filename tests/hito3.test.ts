import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { priceColor, priceLevel, priceScale } from '../src/lib/colors.js';
import { escapeHtml, googleMapsUrl, wazeUrl } from '../src/lib/format.js';
import { formatDistance, formatPrice, isFuelKey } from '../src/lib/fuels.js';
import { boundingBox, haversineKm, nearest, withinRadius } from '../src/lib/geo.js';
import {
  buildMunicipalityPages,
  buildProvincePages,
  hasEnoughContent,
  MIN_MUNICIPALITY_STATIONS,
  type GeoStatsLike,
  type SearchLike,
} from '../src/lib/pages.js';
import { breadcrumbSchema, gasStationListSchema } from '../src/lib/seo.js';
import { normalizeSearchText } from '../src/lib/search.js';
import { buildSearchIndex } from '../scripts/lib/search-index.js';
import type { BuiltIndexes } from '../scripts/lib/indexes.js';
import type { FuelStation } from '../scripts/lib/types.js';

function stats(overrides: Partial<GeoStatsLike> = {}): GeoStatsLike {
  return {
    id: '1',
    name: 'Ejemplo',
    slug: 'ejemplo-1',
    stationCount: 4,
    prices: {
      g95: { count: 3, min: 1.2, max: 1.6, avg: 1.4 },
      g98: { count: 0, min: null, max: null, avg: null },
      goa: { count: 3, min: 1.4, max: 1.8, avg: 1.6 },
      gop: { count: 0, min: null, max: null, avg: null },
      glp: { count: 0, min: null, max: null, avg: null },
    },
    ...overrides,
  };
}

function searchEntry(overrides: Partial<SearchLike> = {}): SearchLike {
  return {
    id: '1',
    name: 'Ejemplo',
    slug: 'ejemplo-1',
    provinceId: '08',
    provinceName: 'Barcelona',
    provinceSlug: 'barcelona-08',
    stationCount: 4,
    lat: 41.4,
    lon: 2.2,
    postalCodes: ['08001'],
    ...overrides,
  };
}

describe('HITO 3: geografía en cliente', () => {
  it('calcula distancias Haversine y las compara con valores conocidos', () => {
    const madrid = { lat: 40.4168, lon: -3.7038 };
    const barcelona = { lat: 41.3874, lon: 2.1686 };
    const distance = haversineKm(madrid, barcelona);
    assert.ok(distance > 500 && distance < 520, `distancia inesperada: ${distance}`);
    assert.equal(haversineKm(madrid, madrid), 0);
    assert.equal(haversineKm(madrid, { lat: 100, lon: 0 }), Number.POSITIVE_INFINITY);
  });

  it('filtra por caja envolvente antes de aplicar el radio', () => {
    const origin = { lat: 40, lon: -3 };
    const box = boundingBox(origin, 10);
    assert.ok(box.minLat < 40 && box.maxLat > 40);
    assert.ok(box.minLon < -3 && box.maxLon > -3);
    assert.equal(withinRadius(origin, { lat: 40.01, lon: -3.01 }, 10), true);
    assert.equal(withinRadius(origin, { lat: 41, lon: -3 }, 10), false);
  });

  it('encarga el punto más cercano en coordenadas válidas', () => {
    const origin = { lat: 40, lon: -3 };
    const closest = nearest(origin, [
      { lat: 41, lon: -3, name: 'lejano' },
      { lat: 40.001, lon: -3.001, name: 'cercano' },
    ]);
    assert.equal(closest?.name, 'cercano');
  });
});

describe('HITO 3: escala de precios y formato', () => {
  it('clasifica precios con cuartiles y color coherente', () => {
    const scale = priceScale([1.2, 1.3, 1.4, 1.5, 1.6]);
    assert.equal(priceLevel(1.2, scale), 'low');
    assert.equal(priceLevel(1.6, scale), 'high');
    assert.equal(priceLevel(1.4, scale), 'mid');
    assert.equal(priceLevel(null, scale), 'unknown');
    assert.equal(priceColor('low'), '#059669');
    assert.equal(priceColor('mid'), '#d97706');
    assert.equal(priceColor('high'), '#dc2626');
    assert.equal(priceColor('unknown'), null);
  });

  it('formatea precios y distancias en español sin inventar valores', () => {
    assert.equal(formatPrice(1.459), '1,459');
    assert.equal(formatPrice(null), '—');
    assert.equal(formatDistance(0.25), '250 m');
    assert.equal(formatDistance(12.6), '13 km');
    assert.equal(isFuelKey('g95'), true);
    assert.equal(isFuelKey('diesel'), false);
  });

  it('escapa HTML y construye enlaces externos con coordenadas', () => {
    assert.equal(escapeHtml('<b>"x"</b>'), '&lt;b&gt;&quot;x&quot;&lt;/b&gt;');
    assert.match(googleMapsUrl(40.1, -3.2), /query=40\.1,-3\.2/);
    assert.match(wazeUrl(40.1, -3.2), /ll=40\.1%2C-3\.2/);
  });
});

describe('HITO 3: páginas e índice de búsqueda', () => {
  it('sólo genera páginas de municipios con contenido suficiente', () => {
    assert.equal(hasEnoughContent(stats()), true);
    assert.equal(MIN_MUNICIPALITY_STATIONS, 3);
    assert.equal(hasEnoughContent(stats({ stationCount: 2 })), false);
    assert.equal(hasEnoughContent(stats({ prices: { ...stats().prices, g95: { count: 1, min: 1, max: 1, avg: 1 } } })), false);
  });

  it('construye URLs de provincia y municipio con slugs del dataset', () => {
    const province = stats({ id: '08', name: 'Barcelona', slug: 'barcelona-08' });
    const municipalities = buildMunicipalityPages(
      [stats({ id: '881', name: 'Barcelona', slug: 'barcelona-881', provinceId: '08' })],
      [province],
      [searchEntry({ id: '881' })],
    );
    assert.deepEqual(
      buildProvincePages([province]).map((page) => page.url),
      ['/gasolineras/barcelona-08/'],
    );
    assert.deepEqual(municipalities.map((page) => page.url), ['/gasolineras/barcelona-08/barcelona-881/']);
    assert.equal(municipalities[0]?.lat, 41.4);
    assert.equal(
      buildMunicipalityPages([stats({ provinceId: '99' })], [province], []).length,
      0,
    );
  });

  it('normaliza búsquedas y deriva códigos postales y centroide de estaciones reales', () => {
    assert.equal(normalizeSearchText('A Coruña'), 'a coruna');
    assert.equal(normalizeSearchText('08.001'), '08 001');

    const station = (lat: number): FuelStation => ({
      id: String(lat),
      municipality: 'Ejemplo',
      municipalityId: '1',
      municipalitySlug: 'ejemplo-1',
      province: 'Barcelona',
      provinceId: '08',
      provinceSlug: 'barcelona-08',
      lat,
      lon: 2,
      postalCode: '08001',
      prices: { g95: 1.4, g98: null, goa: null, gop: null, glp: null },
      raw: { latitud: '', longitud: '', precios: {} },
    });
    const indexes = {
      municipalities: new Map([
        [
          '08/1',
          {
            id: '1',
            name: 'Ejemplo',
            slug: 'ejemplo-1',
            provinceId: '08',
            provinceName: 'Barcelona',
            provinceSlug: 'barcelona-08',
            stationCount: 2,
            stations: [station(40), station(42)],
          },
        ],
      ]),
    } as unknown as BuiltIndexes;
    const [entry] = buildSearchIndex(indexes);
    assert.equal(entry?.lat, 41);
    assert.deepEqual(entry?.postalCodes, ['08001']);
  });
});

describe('HITO 3: datos estructurados', () => {
  it('genera breadcrumbs y GasStation sin campos inventados', () => {
    const crumbs = breadcrumbSchema(
      [{ name: 'Inicio', url: '/' }, { name: 'Barcelona' }],
      'https://rutafuel.es/',
    );
    assert.equal(crumbs.itemListElement[0]?.item, 'https://rutafuel.es/');
    assert.equal(crumbs.itemListElement[1]?.item, undefined);

    const list = gasStationListSchema(
      [
        {
          id: '123',
          name: 'REPSOL',
          municipality: 'Barcelona',
          province: 'Barcelona',
          lat: 41.4,
          lon: 2.2,
          prices: { g95: 1.459 },
        },
      ],
      'https://rutafuel.es',
      'g95',
      'Gasolina 95 E5',
    );
    const first = (list.itemListElement[0] as { item: Record<string, unknown> }).item;
    assert.equal(first['@type'], 'GasStation');
    assert.equal((first['geo'] as { latitude: number }).latitude, 41.4);
    assert.equal((first['makesOffer'] as { price: number }).price, 1.459);
  });
});
