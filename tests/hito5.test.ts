import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildRouteIndex,
  routeCellId,
  type RouteEntry,
  type RouteGridIndex,
} from '../scripts/lib/route-index.js';
import { DATA_VERSION, type FuelStation } from '../scripts/lib/types.js';
import { validateDataset } from '../scripts/lib/validation.js';
import { powerTier } from '../src/lib/charging.js';
import {
  createLocalGeocoder,
  createNominatimGeocoder,
  parseCoordinates,
} from '../src/lib/geocoding.js';
import { haversineKm, isValidCoordinates } from '../src/lib/geo.js';
import {
  cellIdsWithin,
  decodePolyline,
  estimateDetourKm,
  nearestOnRoute,
  sampleRoute,
  stationsAlongRoute,
  type RouteQuery,
  type RouteSample,
} from '../src/lib/route.js';
import {
  createOsrmRoutingService,
  RouteError,
  type RoutingService,
} from '../src/lib/routing.js';
import { makeStation } from './fixtures/chargers.js';

/** Polyline canónica del ejemplo de la documentación de Google (precisión 5). */
const GOOGLE_POLYLINE = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';

function makeFuel(index: number, overrides: Partial<FuelStation> = {}): FuelStation {
  return {
    id: `F${index}`,
    name: `Gasolinera ${index}`,
    municipality: 'Madrid',
    municipalityId: `m${index}`,
    municipalitySlug: `madrid-${index}`,
    province: 'Madrid',
    provinceId: '28',
    provinceSlug: 'madrid-28',
    lat: 40.1,
    lon: -3.1,
    prices: { g95: 1.4, g98: null, goa: 1.3, gop: null, glp: null },
    raw: { latitud: '40,1', longitud: '-3,1', precios: {} },
    ...overrides,
  };
}

function gridFrom(entries: Record<string, RouteEntry[]>): RouteGridIndex {
  const all = Object.values(entries).flat();
  return {
    cellSizeDeg: 0.25,
    generatedAt: '2026-11-26T00:00:00Z',
    sourceUpdatedAt: {},
    totals: {
      fuel: all.filter((entry) => entry.kind === 'fuel').length,
      charging: all.filter((entry) => entry.kind === 'charging').length,
      cells: Object.keys(entries).length,
    },
    cells: entries,
  };
}

function fakeFetch(body: unknown, status = 200): { calls: string[]; impl: typeof fetch } {
  const calls: string[] = [];
  const impl = (async (input: unknown) => {
    calls.push(String(input));
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { calls, impl };
}

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

describe('HITO 5: planificador de ruta', () => {
  it('decodifica polylines de OSRM con precisión 5 sin dependencias', () => {
    const points = decodePolyline(GOOGLE_POLYLINE);
    assert.equal(points.length, 3);
    assert.ok(Math.abs(points[0]!.lat - 38.5) < 0.0001);
    assert.ok(Math.abs(points[0]!.lon + 120.2) < 0.0001);
    assert.ok(Math.abs(points[1]!.lat - 40.7) < 0.0001);
    assert.ok(Math.abs(points[2]!.lon + 126.453) < 0.0001);
    assert.throws(() => decodePolyline('~'), /incompleta/);
    assert.throws(() => decodePolyline(' '), /inválida/);
  });

  it('muestrea la geometría real acumulando kilómetros desde el origen', () => {
    assert.deepEqual(sampleRoute([{ lat: 40, lon: -3 }]), []);
    const geometry = [
      { lat: 40, lon: -3 },
      { lat: 41, lon: -3 },
    ];
    const samples = sampleRoute(geometry, 1);
    assert.equal(samples[0]?.cumulativeKm, 0);
    const total = haversineKm(geometry[0]!, geometry[1]!);
    assert.ok(samples.length > 100 && samples.length < 120);
    assert.ok(Math.abs(samples.at(-1)!.cumulativeKm - total) < 0.001);
    assert.ok(samples.every((sample, index) => index === 0 || sample.cumulativeKm > samples[index - 1]!.cumulativeKm));
    assert.ok(Math.abs(samples[5]!.cumulativeKm - 5) < 0.001);
  });

  it('selecciona sólo las celdas del corredor y calcula la proyección sobre la ruta', () => {
    const cells = cellIdsWithin({ lat: 40, lon: -3 }, 5, 0.25);
    assert.ok(cells.includes('160:-12'), 'la celda del punto debe incluirse');
    assert.deepEqual(cells.sort(), ['159:-13', '159:-12', '160:-13', '160:-12'].sort());
    assert.deepEqual(cellIdsWithin({ lat: 91, lon: 0 }, 5, 0.25), []);
    assert.deepEqual(cellIdsWithin({ lat: 40, lon: -3 }, -1, 0.25), []);

    const samples: RouteSample[] = [
      { lat: 40, lon: -3, cumulativeKm: 0 },
      { lat: 40, lon: -2.5, cumulativeKm: 50 },
      { lat: 40, lon: -2, cumulativeKm: 100 },
    ];
    const projection = nearestOnRoute({ lat: 40.01, lon: -2.5 }, samples);
    assert.ok(projection.distanceKm > 1 && projection.distanceKm < 1.2);
    assert.ok(Math.abs(projection.alongRouteKm - 50) < 0.001);
    assert.equal(estimateDetourKm(3), 6);
  });

  it('filtra por combustible, potencia y radio, y ordena por posición en la ruta', () => {
    const entries: Record<string, RouteEntry[]> = {
      '160:-12': [
        {
          kind: 'fuel',
          id: 'F-inicio',
          lat: 40,
          lon: -2.95,
          prices: { g95: 1.4 },
        },
      ],
      '160:-9': [
        {
          kind: 'fuel',
          id: 'F-fin',
          lat: 40,
          lon: -2.05,
          prices: { g95: 1.5 },
        },
      ],
      '160:-10': [
        {
          kind: 'fuel',
          id: 'F-otro-combustible',
          lat: 40,
          lon: -2.5,
          prices: { goa: 1.3 },
        },
        {
          kind: 'charging',
          id: 'C-rapido',
          lat: 40.02,
          lon: -2.5,
          maxPowerKw: 150,
          connectors: ['CCS2'],
        },
      ],
      '164:-10': [
        {
          kind: 'charging',
          id: 'C-lejano',
          lat: 41,
          lon: -2.5,
          maxPowerKw: 350,
          connectors: ['CCS2'],
        },
      ],
    };
    const index = gridFrom(entries);
    const samples: RouteSample[] = [
      { lat: 40, lon: -3, cumulativeKm: 0 },
      { lat: 40, lon: -2.5, cumulativeKm: 50 },
      { lat: 40, lon: -2, cumulativeKm: 100 },
    ];

    const fuelQuery: RouteQuery = { radiusKm: 5, energy: 'fuel', fuel: 'g95' };
    const fuel = stationsAlongRoute(index, samples, fuelQuery);
    assert.deepEqual(
      fuel.map((match) => match.entry.id),
      ['F-inicio', 'F-fin'],
    );
    assert.ok(fuel[0]!.alongRouteKm < fuel[1]!.alongRouteKm);
    assert.ok(fuel[0]!.alongRouteKm < 10);
    assert.ok(fuel[1]!.alongRouteKm > 90);
    assert.ok(fuel.every((match) => match.detourKm === estimateDetourKm(match.distanceKm)));
    assert.deepEqual(stationsAlongRoute(index, samples.slice(0, 1), fuelQuery), []);

    const electricQuery: RouteQuery = { radiusKm: 5, energy: 'electric', tier: 'ultra', minPowerKw: 150 };
    const charging = stationsAlongRoute(index, samples, electricQuery);
    assert.deepEqual(
      charging.map((match) => match.entry.id),
      ['C-rapido'],
    );
    assert.equal(powerTier((charging[0]!.entry as { maxPowerKw: number | null }).maxPowerKw), 'ultra');
    assert.deepEqual(
      stationsAlongRoute(index, samples, { ...electricQuery, minPowerKw: 200 }),
      [],
    );
    assert.deepEqual(
      stationsAlongRoute(index, samples, { ...electricQuery, radiusKm: 1 }),
      [],
      'un cargador a ~2,2 km no entra en un radio de 1 km',
    );
  });

  it('construye una rejilla ligera, deduplica conectores y omite precios nulos', () => {
    const fuel = makeFuel(1);
    const bad = makeFuel(2, { lat: Number.NaN });
    const charger = makeStation({
      id: 'RIPREE-7',
      officialId: '7',
      lat: 40.1,
      lon: -3.1,
      connectors: [
        makeStation().connectors[0]!,
        makeStation().connectors[0]!,
      ],
      sources: [{ source: 'RIPREE', id: '7', url: 'https://example.test/secreto' }],
    });
    const index = buildRouteIndex(
      [fuel, bad],
      [charger],
      '2026-11-26T00:00:00Z',
      { fuel: '2026-11-26', charging: '2026-11-20' },
    );

    assert.equal(index.cellSizeDeg, 0.25);
    assert.equal(routeCellId({ lat: 40.1, lon: -3.1 }), '160:-13');
    assert.equal(index.totals.fuel, 1, 'una coordenada inválida no se indexa');
    assert.equal(index.totals.charging, 1);
    assert.equal(index.totals.cells, 1, 'gasolinera y cargador comparten celda');
    const fuelEntry = index.cells['160:-13']!.find((entry) => entry.kind === 'fuel');
    assert.ok(fuelEntry && fuelEntry.kind === 'fuel');
    assert.deepEqual(fuelEntry.prices, { g95: 1.4, goa: 1.3 });
    const chargeEntry = index.cells['160:-13']!.find((entry) => entry.kind === 'charging');
    assert.ok(chargeEntry && chargeEntry.kind === 'charging');
    assert.deepEqual(chargeEntry.connectors, ['TYPE2']);
    assert.equal('raw' in fuelEntry, false);
    assert.equal('sources' in chargeEntry, false);
    assert.equal(JSON.stringify(index).includes('secreto'), false);
  });

  it('valida coherencia de la rejilla de rutas detectando totales y registros inválidos', () => {
    const stations = Array.from({ length: 1000 }, (_, index) => makeFuel(index));
    const index = buildRouteIndex(stations, [makeStation()], '2026-11-26T00:00:00Z');
    const base = {
      stations,
      normalized: {
        stations,
        discarded: [],
        duplicateIds: [],
        warnings: [],
        withoutCoordinates: 0,
        invalidPrices: 0,
      },
      generatedAt: '2026-11-26T15:00:00.000Z',
      dataVersion: DATA_VERSION,
      files: {
        'gasolineras/estaciones.json': stations,
        'gasolineras/provincias/28.json': { stationCount: stations.length },
        'gasolineras/municipios/28/madrid.json': { stationCount: stations.length },
        'metadata.json': { sources: [{ sourceUpdatedAt: '2026-11-26T14:24:06' }] },
        'rutas/estaciones.json': index,
      },
      route: {
        index,
        fuelCount: stations.length,
        chargingCount: 1,
      },
    };

    const valid = validateDataset(base);
    assert.equal(valid.ok, true);
    for (const name of ['rutas-indice-generado', 'rutas-indice-coherente', 'rutas-celdas-válidas']) {
      assert.equal(valid.checks.find((check) => check.name === name)?.ok, true, name);
    }

    const mismatched = validateDataset({
      ...base,
      route: { index, fuelCount: stations.length + 1, chargingCount: 1 },
    });
    assert.equal(mismatched.checks.find((check) => check.name === 'rutas-indice-coherente')?.ok, false);

    const corrupted = gridFrom({ 'celda-mal': index.cells['160:-12'] ?? [] });
    const withoutFile = validateDataset({
      ...base,
      files: { ...base.files, 'rutas/estaciones.json': undefined },
      route: { index: corrupted, fuelCount: 1, chargingCount: 0 },
    });
    assert.equal(withoutFile.checks.find((check) => check.name === 'rutas-indice-generado')?.ok, false);
    assert.equal(withoutFile.checks.find((check) => check.name === 'rutas-celdas-válidas')?.ok, false);
  });

  it('resuelve coordenadas y localidades sin contactar con proveedores externos', async () => {
    assert.deepEqual(parseCoordinates(' 40.4168, -3.7038 '), { lat: 40.4168, lon: -3.7038 });
    assert.deepEqual(parseCoordinates('40;-3'), { lat: 40, lon: -3 });
    assert.equal(parseCoordinates('Madrid'), null);
    assert.equal(parseCoordinates('100, 200'), null);

    const geocoder = createLocalGeocoder([
      { name: 'Madrid', provinceName: 'Madrid', lat: 40.4168, lon: -3.7038, postalCodes: ['28001'], stationCount: 100 },
      { name: 'Málaga', provinceName: 'Málaga', lat: 36.7, lon: -4.4, stationCount: 50 },
      { name: 'Madrid Nuevo', lat: 40.5, lon: -3.7, stationCount: 1 },
    ]);
    const madrid = await geocoder.geocode('madrid, madrid');
    assert.equal(madrid?.lat, 40.4168);
    assert.equal(madrid?.provider, 'local');
    assert.equal((await geocoder.geocode('MÁLAGA'))?.lon, -4.4);
    assert.equal((await geocoder.geocode('28001'))?.lat, 40.4168);
    assert.equal(await geocoder.geocode('mad'), null, 'ambigüedad no resuelta');
    assert.equal(await geocoder.geocode(''), null);
  });

  it('cacha Nominatim, respeta el intervalo mínimo y construye la petición esperada', async () => {
    const calls: string[] = [];
    const impl = (async (input: unknown) => {
      const url = new URL(String(input));
      calls.push(url.toString());
      const body =
        url.searchParams.get('q') === 'Madrid'
          ? [{ lat: '40.4168', lon: '-3.7038', display_name: 'Madrid, España' }]
          : [];
      return { ok: true, status: 200, json: async () => body } as unknown as Response;
    }) as unknown as typeof fetch;
    const response = { calls };
    const storage = memoryStorage();
    let clock = 1000;
    const waits: number[] = [];
    const geocoder = createNominatimGeocoder({
      endpoint: 'https://nominatim.test/search',
      fetchImpl: impl,
      storage,
      now: () => clock,
      wait: async (ms) => void waits.push(ms),
      minIntervalMs: 1100,
    });

    const first = await geocoder.geocode('Madrid');
    assert.equal(first?.provider, 'nominatim');
    assert.equal(first?.label, 'Madrid, España');
    assert.equal(response.calls.length, 1);
    const url = new URL(response.calls[0]!);
    assert.equal(url.searchParams.get('q'), 'Madrid');
    assert.equal(url.searchParams.get('format'), 'jsonv2');
    assert.equal(url.searchParams.get('limit'), '1');
    assert.equal(url.searchParams.get('countrycodes'), 'es');
    assert.equal(url.searchParams.get('accept-language'), 'es');

    clock += 500;
    const cached = await geocoder.geocode('Madrid');
    assert.equal(cached?.label, 'Madrid, España');
    assert.equal(response.calls.length, 1, 'la caché evita una segunda petición');

    const second = await geocoder.geocode('Barcelona');
    assert.equal(second, null, 'sin resultados válidos devuelve null');
    assert.ok(waits.length >= 1 && waits[0]! >= 500 && waits[0]! <= 1100);
    assert.equal(response.calls.length, 2);

    clock += 31 * 24 * 60 * 60 * 1000;
    await geocoder.geocode('Madrid');
    assert.equal(response.calls.length, 3, 'la caché caduca y permite una nueva petición');
  });

  it('propaga errores HTTP de Nominatim sin romper la caché corrupta', async () => {
    const failing = fakeFetch({ error: 'ko' }, 503);
    const geocoder = createNominatimGeocoder({
      endpoint: 'https://nominatim.test/search',
      fetchImpl: failing.impl,
      storage: {
        getItem: () => '{no es json',
        setItem: () => undefined,
      },
      now: () => 1_000_000,
      wait: async () => undefined,
    });
    await assert.rejects(geocoder.geocode('Sevilla'), /HTTP 503/);
  });

  it('calcula una ruta OSRM con URL inyectable y geometría decodificada', async () => {
    const response = fakeFetch({
      code: 'Ok',
      routes: [
        {
          distance: 12345,
          duration: 600,
          geometry: GOOGLE_POLYLINE,
        },
      ],
      data_version: 'osrm-5.24',
    });
    const routing: RoutingService = createOsrmRoutingService({
      baseUrl: 'https://osrm.test/',
      profile: 'car',
      fetchImpl: response.impl,
    });
    const result = await routing.calculateRoute({ lat: 40, lon: -3 }, { lat: 41, lon: -2 });
    assert.equal(result.provider, 'OSRM');
    assert.equal(result.distanceKm, 12.345);
    assert.equal(result.durationMinutes, 10);
    assert.equal(result.dataVersion, 'osrm-5.24');
    assert.equal(result.geometry.length, 3);
    assert.ok(Math.abs(result.geometry[0]!.lat - 38.5) < 0.0001);

    const url = new URL(response.calls[0]!);
    assert.equal(url.pathname, '/route/v1/car/-3.000000,40.000000;-2.000000,41.000000');
    assert.equal(url.searchParams.get('overview'), 'full');
    assert.equal(url.searchParams.get('geometries'), 'polyline');
    assert.equal(url.searchParams.get('steps'), 'false');
  });

  it('convierte fallos del proveedor de rutas en RouteError', async () => {
    assert.ok(isValidCoordinates({ lat: 40, lon: -3 }));
    const invalid = createOsrmRoutingService({ fetchImpl: fakeFetch({}).impl });
    await assert.rejects(
      invalid.calculateRoute({ lat: 91, lon: 0 }, { lat: 40, lon: -3 }),
      RouteError,
    );

    const noRoute = createOsrmRoutingService({ fetchImpl: fakeFetch({ code: 'NoRoute', routes: [] }).impl });
    await assert.rejects(
      noRoute.calculateRoute({ lat: 40, lon: -3 }, { lat: 41, lon: -2 }),
      RouteError,
    );

    const http = createOsrmRoutingService({ fetchImpl: fakeFetch({}, 500).impl });
    await assert.rejects(
      http.calculateRoute({ lat: 40, lon: -3 }, { lat: 41, lon: -2 }),
      /HTTP 500/,
    );
  });
});
