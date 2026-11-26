import type {
  ChargerConnector,
  ChargingStation,
  SourceId,
} from '../../scripts/lib/types.js';

export function makeConnector(
  type = 'TYPE2',
  powerKw: number | null = 22,
  source: SourceId = 'RIPREE',
): ChargerConnector {
  return {
    type,
    rawType: type === 'TYPE2' ? 'IEC_62196_T2' : type,
    chargeMode: 'AC_3_PHASE',
    format: 'Socket',
    powerKw,
    rawPower: powerKw === null ? '' : `${String(powerKw).replace('.', ',')} kW`,
    sources: [source],
  };
}

/** Estación mínima válida; los tests sobrescriben sólo los campos que ejercitan. */
export function makeStation(overrides: Partial<ChargingStation> = {}): ChargingStation {
  return {
    id: 'RIPREE-1',
    source: 'RIPREE',
    officialId: '1',
    name: 'Estación Central',
    address: 'Calle Mayor 1',
    municipality: 'Madrid',
    municipalityId: 'madrid-madrid',
    municipalitySlug: 'madrid-madrid',
    province: 'Madrid',
    provinceId: 'madrid',
    provinceSlug: 'madrid-madrid',
    lat: 40,
    lon: -3,
    accessibility: 'unknown',
    status: 'unknown',
    connectors: [makeConnector()],
    maxPowerKw: 22,
    pointCount: 1,
    pointIds: ['P1'],
    sources: [{ source: 'RIPREE', id: '1', url: 'https://example.test/ripree/1' }],
    raw: {},
    ...overrides,
  };
}
