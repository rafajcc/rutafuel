import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { normalizeStation, normalizeStations, parseSourceDate, validateResponse } from '../scripts/lib/gasolineras.js';
import type { MineturResponse } from '../scripts/lib/types.js';

const fixturePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/api-response.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as MineturResponse;

describe('normalización de la API del Ministerio', () => {
  it('valida la forma de una respuesta real', () => {
    const result = validateResponse(fixture);
    assert.equal(result.records.length, 6);
    assert.equal(result.sourceDate.iso, '2026-11-26T14:24:06');
  });

  it('normaliza campos oficiales y mantiene la auditoría de valores originales', () => {
    const record = (fixture.ListaEESSPrecio as Array<Record<string, unknown>>)[0]!;
    const { station, discarded } = normalizeStation(record);
    assert.equal(discarded, null);
    assert.ok(station);
    assert.equal(station.id, '4375');
    assert.equal(station.province, 'Albacete');
    assert.equal(station.municipality, 'Abengibre');
    assert.equal(station.postalCode, '02250');
    assert.equal(station.lat, 39.211417);
    assert.equal(station.lon, -1.539167);
    assert.equal(station.prices.g95, 1.399);
    assert.equal(station.prices.goa, 1.699);
    assert.equal(station.prices.gop, null);
    assert.equal(station.raw.precios.g95, '1,399');
    assert.equal(station.raw.latitud, '39,211417');
  });

  it('descarta coordenadas inválidas, sin ID y deduplica por IDEESS', () => {
    const result = normalizeStations(fixture.ListaEESSPrecio as Array<Record<string, unknown>>);
    assert.equal(result.stations.length, 2);
    assert.equal(result.duplicateIds.length, 2);
    assert.equal(result.withoutCoordinates, 1);
    assert.equal(result.invalidPrices, 1);
    assert.ok(result.discarded.some((item) => item.reason === 'invalid-coordinates' && item.id === '11988'));
    assert.ok(result.discarded.some((item) => item.reason === 'missing-id'));
    assert.equal(result.stations.find((station) => station.id === '4375')?.prices.g95, 1.399);
  });

  it('falla cerrado ante cambios de respuesta o de esquema', () => {
    const badResult = { ...fixture, ResultadoConsulta: 'ERROR' };
    assert.throws(() => validateResponse(badResult), /ResultadoConsulta/);
    assert.throws(() => validateResponse({ ...fixture, ListaEESSPrecio: [] }), /vacía/);
    assert.throws(() => validateResponse({ ...fixture, Fecha: 'hoy' }), /Fecha/);

    const withoutField = (fixture.ListaEESSPrecio as Array<Record<string, unknown>>).map((record) => {
      const copy = { ...record };
      delete copy['Precio Gasolina 95 E5'];
      return copy;
    });
    assert.throws(() => validateResponse({ ...fixture, ListaEESSPrecio: withoutField }), /esquema/);
  });

  it('interpreta la fecha declarada por la fuente', () => {
    assert.deepEqual(parseSourceDate('26/11/2026 14:24:06'), {
      iso: '2026-11-26T14:24:06',
      raw: '26/11/2026 14:24:06',
    });
    assert.equal(parseSourceDate('no-fecha'), null);
  });
});
