import type { ChargingStation, SourceId } from './types.js';

/** Registro ligero publicado en los índices de recarga. `raw` se queda en el dataset maestro. */
export interface WebChargingStation {
  id: string;
  source: SourceId;
  officialId: string;
  name?: string;
  address?: string;
  municipality: string;
  municipalityId: string;
  municipalitySlug: string;
  province: string;
  provinceId: string;
  provinceSlug: string;
  postalCode?: string;
  lat: number;
  lon: number;
  operator?: string;
  accessibility: ChargingStation['accessibility'];
  status: ChargingStation['status'];
  connectors: Array<{
    type: string;
    chargeMode?: string;
    powerKw: number | null;
  }>;
  maxPowerKw: number | null;
  pointCount: number;
  updatedAt?: string;
  /** Procedencia resumida; sin URLs con credenciales. */
  sources: Array<{ source: SourceId; id: string; sourceUpdatedAt?: string }>;
}

export interface ChargerProvinceIndex {
  id: string;
  name: string;
  slug: string;
  stationCount: number;
  pointCount: number;
  maxPowerKw: number | null;
  center: { lat: number; lon: number };
  municipalities: Array<{ id: string; name: string; slug: string; stationCount: number }>;
  stations: WebChargingStation[];
}

export interface ChargerMunicipalityIndex {
  id: string;
  name: string;
  slug: string;
  provinceId: string;
  provinceName: string;
  provinceSlug: string;
  stationCount: number;
  pointCount: number;
  maxPowerKw: number | null;
  center: { lat: number; lon: number };
  stations: WebChargingStation[];
}

export interface BuiltChargerIndexes {
  provinces: Map<string, ChargerProvinceIndex>;
  municipalities: Map<string, ChargerMunicipalityIndex>;
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function centerOf(stations: ChargingStation[]): { lat: number; lon: number } {
  const valid = stations.filter(
    (station) => Number.isFinite(station.lat) && Number.isFinite(station.lon),
  );
  if (valid.length === 0) return { lat: 0, lon: 0 };
  return {
    lat: round(valid.reduce((total, station) => total + station.lat, 0) / valid.length),
    lon: round(valid.reduce((total, station) => total + station.lon, 0) / valid.length),
  };
}

function slimStation(station: ChargingStation): WebChargingStation {
  return {
    id: station.id,
    source: station.source,
    officialId: station.officialId,
    ...(station.name ? { name: station.name } : {}),
    ...(station.address ? { address: station.address } : {}),
    municipality: station.municipality,
    municipalityId: station.municipalityId,
    municipalitySlug: station.municipalitySlug,
    province: station.province,
    provinceId: station.provinceId,
    provinceSlug: station.provinceSlug,
    ...(station.postalCode ? { postalCode: station.postalCode } : {}),
    lat: station.lat,
    lon: station.lon,
    ...(station.operator ? { operator: station.operator } : {}),
    accessibility: station.accessibility,
    status: station.status,
    connectors: station.connectors.map((connector) => ({
      type: connector.type,
      ...(connector.chargeMode ? { chargeMode: connector.chargeMode } : {}),
      powerKw: connector.powerKw,
    })),
    maxPowerKw: station.maxPowerKw,
    pointCount: station.pointCount,
    ...(station.updatedAt ? { updatedAt: station.updatedAt } : {}),
    sources: station.sources.map((source) => ({
      source: source.source,
      id: source.id,
      ...(source.sourceUpdatedAt ? { sourceUpdatedAt: source.sourceUpdatedAt } : {}),
    })),
  };
}

function compareStations(a: ChargingStation, b: ChargingStation): number {
  return a.id.localeCompare(b.id);
}

/** Agrupa recarga por provincia y municipio; las claves municipales incluyen la provincia. */
export function buildChargerIndexes(stations: ChargingStation[]): BuiltChargerIndexes {
  const provinces = new Map<string, ChargerProvinceIndex>();
  const municipalities = new Map<string, ChargerMunicipalityIndex>();
  const provinceMunicipalityEntries = new Map<
    string,
    { id: string; name: string; slug: string; stationCount: number }
  >();

  for (const station of [...stations].sort(compareStations)) {
    let province = provinces.get(station.provinceId);
    if (!province) {
      province = {
        id: station.provinceId,
        name: station.province,
        slug: station.provinceSlug,
        stationCount: 0,
        pointCount: 0,
        maxPowerKw: null,
        center: { lat: 0, lon: 0 },
        municipalities: [],
        stations: [],
      };
      provinces.set(station.provinceId, province);
    }
    province.stationCount += 1;
    province.pointCount += station.pointCount;
    if (station.maxPowerKw !== null) {
      province.maxPowerKw = Math.max(province.maxPowerKw ?? station.maxPowerKw, station.maxPowerKw);
    }
    province.stations.push(slimStation(station));

    const key = `${station.provinceId}/${station.municipalityId}`;
    const provinceKey = `${station.provinceId}|${station.municipalityId}`;
    let municipality = municipalities.get(key);
    if (!municipality) {
      municipality = {
        id: station.municipalityId,
        name: station.municipality,
        slug: station.municipalitySlug,
        provinceId: station.provinceId,
        provinceName: station.province,
        provinceSlug: station.provinceSlug,
        stationCount: 0,
        pointCount: 0,
        maxPowerKw: null,
        center: { lat: 0, lon: 0 },
        stations: [],
      };
      municipalities.set(key, municipality);
      const entry = {
        id: station.municipalityId,
        name: station.municipality,
        slug: station.municipalitySlug,
        stationCount: 0,
      };
      province.municipalities.push(entry);
      provinceMunicipalityEntries.set(provinceKey, entry);
    }
    municipality.stationCount += 1;
    municipality.pointCount += station.pointCount;
    if (station.maxPowerKw !== null) {
      municipality.maxPowerKw = Math.max(
        municipality.maxPowerKw ?? station.maxPowerKw,
        station.maxPowerKw,
      );
    }
    municipality.stations.push(slimStation(station));

    const provinceMunicipality = provinceMunicipalityEntries.get(provinceKey);
    if (provinceMunicipality) provinceMunicipality.stationCount += 1;
  }

  for (const province of provinces.values()) {
    province.center = centerOf(province.stations as unknown as ChargingStation[]);
    province.municipalities.sort((a, b) => a.name.localeCompare(b.name, 'es') || a.id.localeCompare(b.id));
  }
  for (const municipality of municipalities.values()) {
    municipality.center = centerOf(municipality.stations as unknown as ChargingStation[]);
  }

  return { provinces, municipalities };
}

export function chargerProvinceIndexPath(id: string): string {
  return `cargadores/provincias/${id}.json`;
}

export function chargerMunicipalityIndexPath(provinceId: string, id: string): string {
  return `cargadores/municipios/${provinceId}/${id}.json`;
}
