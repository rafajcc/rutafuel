import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deduplicateChargers, MAX_MATCH_DISTANCE_METERS } from '../scripts/lib/dedupe.js';
import { makeConnector, makeStation } from './fixtures/chargers.js';

describe('deduplicación de cargadores', () => {
  it('fusiona por referencia oficial y conserva la procedencia de ambas fuentes', () => {
    const ripree = makeStation({
      id: 'RIPREE-1',
      officialId: 'INST-1',
      pointIds: ['P1'],
      raw: {
        ripree: {
          latitud: '40',
          longitud: '-3',
          codigoPostal: '28001',
          accesibilidad: 'NODISPONIBLE',
          estatus: '',
          fechaModificacion: '',
          puntos: [
            {
              pointId: 'P1',
              pointCode: 'ES*ESX*E42',
              connectorId: '',
              connector: 'IEC_62196_T2',
              chargeMode: 'AC_3_PHASE',
              format: 'Socket',
              power: '22,00 kW',
              voltage: '400 V',
              amperage: '32,00 A',
            },
          ],
        },
      },
    });
    const ocm = makeStation({
      id: 'OCM-42',
      source: 'OCM',
      officialId: '42',
      connectors: [makeConnector('TYPE2', 50, 'OCM')],
      maxPowerKw: 50,
      sources: [{ source: 'OCM', id: '42', dataProvider: 'ENDESA X WAY' }],
      raw: { ocm: { id: 42, dataProvidersReference: 'ES*ESX*E42' } },
    });

    const result = deduplicateChargers([ripree], [ocm]);
    assert.equal(result.stations.length, 1);
    assert.equal(result.merged, 1);
    assert.deepEqual(result.matchedBy, { officialId: 1, proximity: 0 });
    const merged = result.stations[0]!;
    assert.equal(merged.id, 'RIPREE-1');
    assert.equal(merged.maxPowerKw, 50);
    assert.deepEqual(merged.connectors.map((connector) => connector.type), ['TYPE2', 'TYPE2']);
    assert.deepEqual(merged.connectors[1]?.sources, ['OCM']);
    assert.deepEqual(merged.sources.map((source) => source.source), ['RIPREE', 'OCM']);
    assert.equal(merged.sources[1]?.dataProvider, 'ENDESA X WAY');
  });

  it('fusiona por proximidad sólo con nombre/dirección y conectores compatibles', () => {
    const ripree = makeStation({ lat: 40, lon: -3 });
    const nearby = makeStation({
      id: 'OCM-7',
      source: 'OCM',
      officialId: '7',
      lat: 40.0002,
      lon: -3.0002,
      address: 'Calle Mayor, 1',
      connectors: [makeConnector('TYPE2', 22, 'OCM')],
      sources: [{ source: 'OCM', id: '7' }],
      raw: { ocm: { id: 7 } },
    });
    const result = deduplicateChargers([ripree], [nearby]);
    assert.equal(result.stations.length, 1);
    assert.deepEqual(result.matchedBy, { officialId: 0, proximity: 1 });
  });

  it('no fusiona instalaciones lejanas, con distinto operador o sin conectores comunes', () => {
    const ripree = makeStation({ operator: 'OPERADOR A' });
    const far = makeStation({
      id: 'OCM-FAR',
      source: 'OCM',
      operator: 'OPERADOR A',
      lat: 40.01,
      lon: -3,
      sources: [{ source: 'OCM', id: 'FAR' }],
    });
    const differentOperator = makeStation({
      id: 'OCM-OP',
      source: 'OCM',
      operator: 'OPERADOR B',
      sources: [{ source: 'OCM', id: 'OP' }],
    });
    const differentConnector = makeStation({
      id: 'OCM-CON',
      source: 'OCM',
      connectors: [makeConnector('CHADEMO', 50, 'OCM')],
      sources: [{ source: 'OCM', id: 'CON' }],
    });

    const result = deduplicateChargers([ripree], [far, differentOperator, differentConnector]);
    assert.equal(result.stations.length, 4);
    assert.equal(result.merged, 0);
    assert.ok(MAX_MATCH_DISTANCE_METERS <= 100);
  });

  it('mantiene IDs únicos y orden determinista', () => {
    const first = makeStation({ id: 'RIPREE-2', officialId: '2', municipality: 'Zaragoza' });
    const second = makeStation({ id: 'RIPREE-1', officialId: '1', municipality: 'Albacete' });
    const result = deduplicateChargers([first, second], []);
    assert.deepEqual(result.stations.map((station) => station.id), ['RIPREE-1', 'RIPREE-2']);
    assert.equal(new Set(result.stations.map((station) => station.id)).size, 2);
  });
});
