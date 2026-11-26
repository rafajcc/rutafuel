import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createOcmRequest,
  normalizeOcm,
  OCM_API_URL,
  validateOcmResponse,
  type OcmPoi,
} from '../scripts/lib/ocm.js';

function poi(overrides: Partial<OcmPoi> = {}): OcmPoi {
  return {
    ID: 42,
    UUID: 'ocm-uuid-42',
    DataProviderID: 7,
    DataProvider: { ID: 7, Title: 'ENDESA X WAY', License: 'CC BY 4.0' },
    DataProvidersReference: 'ES*ESX*E42',
    OperatorID: 12,
    OperatorInfo: { ID: 12, Title: 'Operador de prueba' },
    AddressInfo: {
      ID: 1,
      Title: 'Estación de prueba',
      AddressLine1: 'Calle Mayor 1',
      Town: 'Madrid',
      StateOrProvince: 'Madrid',
      Postcode: '28001',
      Latitude: 40.4168,
      Longitude: -3.7038,
    },
    Connections: [
      {
        ID: 1,
        ConnectionType: { ID: 32, Title: 'CCS (Combo 2)' },
        CurrentType: { ID: 3, Title: 'DC' },
        PowerKW: 150,
        Voltage: 500,
        Amps: 300,
      },
    ],
    NumberOfPoints: 1,
    StatusTypeID: 2,
    StatusType: { ID: 2, Title: 'Operational', IsOperational: true },
    DateLastStatusUpdate: '2026-11-20T10:00:00Z',
    SubmissionStatus: { ID: 10, Title: 'Published', IsLive: true },
    ...overrides,
  };
}

describe('Open Charge Map: petición', () => {
  it('envía la clave como cabecera X-API-Key y nunca en la URL', () => {
    const request = createOcmRequest({ apiKey: 'secreto-local', maxResults: 500 });
    const url = new URL(request.url);
    assert.equal(`${url.origin}${url.pathname}`, OCM_API_URL);
    assert.equal(url.searchParams.get('output'), 'json');
    assert.equal(url.searchParams.get('countrycode'), 'ES');
    assert.equal(url.searchParams.get('maxresults'), '500');
    assert.equal(url.searchParams.get('compact'), 'false');
    assert.equal(url.searchParams.get('verbose'), 'false');
    assert.equal(url.searchParams.get('client'), 'rutafuel');
    assert.deepEqual(request.headers, { 'X-API-Key': 'secreto-local' });
    assert.doesNotMatch(request.url, /secreto-local|apikey/i);
  });

  it('valida la forma básica de la respuesta', () => {
    assert.deepEqual(validateOcmResponse([]), []);
    assert.equal(validateOcmResponse([poi()]).length, 1);
    assert.throws(() => validateOcmResponse({}), /no es un array/);
    assert.throws(() => validateOcmResponse([{ ID: 1 }, { ID: 2 }]), /cambio de esquema/);
  });
});

describe('Open Charge Map: normalización', () => {
  it('normaliza POIs con conectores, estado, atribución y procedencia', () => {
    const result = normalizeOcm([poi()], {
      fetchedAt: '2026-11-26T15:00:00.000Z',
      sourceUrl: 'https://api.openchargemap.io/v3/poi/?countrycode=ES',
    });
    assert.equal(result.stations.length, 1);
    assert.equal(result.discarded.length, 0);
    const station = result.stations[0]!;
    assert.equal(station.id, 'OCM-42');
    assert.equal(station.officialId, '42');
    assert.equal(station.name, 'Estación de prueba');
    assert.equal(station.lat, 40.4168);
    assert.equal(station.lon, -3.7038);
    assert.equal(station.status, 'operational');
    assert.equal(station.accessibility, 'unknown');
    assert.equal(station.maxPowerKw, 150);
    assert.deepEqual(station.connectors.map((connector) => connector.type), ['CCS2']);
    assert.equal(station.connectors[0]?.chargeMode, 'DC');
    assert.equal(station.sources[0]?.dataProvider, 'ENDESA X WAY');
    assert.equal(station.sources[0]?.license, 'CC BY 4.0');
    assert.equal(station.sources[0]?.url, 'https://openchargemap.org/site/poi/details/42');
    assert.equal(station.updatedAt, '2026-11-20T10:00:00.000Z');
    assert.doesNotMatch(JSON.stringify(station), /secreto-local/);
  });

  it('descarta POIs no publicados, duplicados y sin coordenadas válidas', () => {
    const duplicate = poi();
    const notLive = poi({ ID: 43, SubmissionStatus: { ID: 1, Title: 'Awaiting approval', IsLive: false } });
    const noCoordinates = poi({
      ID: 44,
      AddressInfo: { ...poi().AddressInfo!, Latitude: undefined, Longitude: undefined },
    });
    const result = normalizeOcm([poi(), duplicate, notLive, noCoordinates]);
    assert.equal(result.stations.length, 1);
    assert.deepEqual(result.duplicateIds, ['42']);
    assert.deepEqual(result.discarded.map((item) => item.reason), ['not-live', 'invalid-coordinates']);
    assert.equal(result.withoutCoordinates, 1);
  });

  it('no afirma disponibilidad cuando OCM no declara estado operativo', () => {
    const result = normalizeOcm([poi({ StatusType: undefined })]);
    assert.equal(result.stations[0]?.status, 'unknown');
  });
});
