import {
  ACCESS_STATUSES,
  CHARGER_STATUSES,
  DATA_VERSION,
  SOURCE_IDS,
} from './types.js';
import type {
  AccessStatus,
  ChargerConnectorStats,
  ChargerIndex,
  ChargerStatus,
  ChargerSummaryStats,
  ChargerValueStats,
  ChargingStation,
  SourceId,
} from './types.js';

type CenterAccumulator = { lat: number; lon: number; count: number };

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function centerOf(accumulator: CenterAccumulator | undefined) {
  if (!accumulator || accumulator.count === 0) return { lat: 0, lon: 0 };
  return {
    lat: round(accumulator.lat / accumulator.count),
    lon: round(accumulator.lon / accumulator.count),
  };
}

export function buildChargerIndex(stations: ChargingStation[]): ChargerIndex {
  const provinces = new Map<string, ChargerIndex['provinces'][number]>();
  const municipalities = new Map<string, ChargerIndex['municipalities'][number]>();
  const provinceCenters = new Map<string, CenterAccumulator>();
  const municipalityCenters = new Map<string, CenterAccumulator>();

  const register = (map: Map<string, CenterAccumulator>, key: string, station: ChargingStation) => {
    if (!Number.isFinite(station.lat) || !Number.isFinite(station.lon)) return;
    const entry = map.get(key) ?? { lat: 0, lon: 0, count: 0 };
    entry.lat += station.lat;
    entry.lon += station.lon;
    entry.count += 1;
    map.set(key, entry);
  };

  const upgradePower = (current: number | null, value: number | null): number | null => {
    if (value === null) return current;
    return current === null ? value : Math.max(current, value);
  };

  for (const station of stations) {
    const provinceKey = station.provinceId;
    const municipalityKey = `${station.provinceId}/${station.municipalityId}`;
    register(provinceCenters, provinceKey, station);
    register(municipalityCenters, municipalityKey, station);

    const province = provinces.get(provinceKey);
    if (province) {
      province.stationCount += 1;
      province.pointCount += station.pointCount;
      province.maxPowerKw = upgradePower(province.maxPowerKw, station.maxPowerKw);
    } else {
      provinces.set(provinceKey, {
        id: station.provinceId,
        name: station.province,
        slug: station.provinceSlug,
        stationCount: 1,
        pointCount: station.pointCount,
        maxPowerKw: station.maxPowerKw,
        center: { lat: 0, lon: 0 },
      });
    }

    const municipality = municipalities.get(municipalityKey);
    if (municipality) {
      municipality.stationCount += 1;
      municipality.pointCount += station.pointCount;
      municipality.maxPowerKw = upgradePower(municipality.maxPowerKw, station.maxPowerKw);
    } else {
      municipalities.set(municipalityKey, {
        id: station.municipalityId,
        name: station.municipality,
        slug: station.municipalitySlug,
        provinceId: station.provinceId,
        stationCount: 1,
        pointCount: station.pointCount,
        maxPowerKw: station.maxPowerKw,
        center: { lat: 0, lon: 0 },
      });
    }
  }

  for (const province of provinces.values()) province.center = centerOf(provinceCenters.get(province.id));
  for (const municipality of municipalities.values()) {
    municipality.center = centerOf(municipalityCenters.get(`${municipality.provinceId}/${municipality.id}`));
  }

  return {
    provinces: [...provinces.values()].sort((a, b) => a.name.localeCompare(b.name, 'es')),
    municipalities: [...municipalities.values()].sort(
      (a, b) => a.provinceId.localeCompare(b.provinceId) || a.name.localeCompare(b.name, 'es'),
    ),
  };
}

function powerStats(stations: ChargingStation[]): ChargerValueStats {
  const values = stations
    .map((station) => station.maxPowerKw)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  if (values.length === 0) return { count: 0, min: null, max: null, avg: null };
  const sum = values.reduce((total, value) => total + value, 0);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const round = (value: number) => Math.round(value * 100) / 100;
  return { count: values.length, min: round(min), max: round(max), avg: round(sum / values.length) };
}

export interface ChargerStatisticsInput {
  stations: ChargingStation[];
  generatedAt: string;
  sourceUpdatedAt?: string;
  duplicatesRemoved: number;
  malformedRipreeRows: number;
}

export function buildChargerStatistics(input: ChargerStatisticsInput): ChargerSummaryStats {
  const bySource: Record<SourceId, number> = {
    [SOURCE_IDS.minetur]: 0,
    [SOURCE_IDS.ripree]: 0,
    [SOURCE_IDS.ocm]: 0,
  };
  const status: Record<ChargerStatus, number> = {
    [CHARGER_STATUSES.unknown]: 0,
    [CHARGER_STATUSES.operational]: 0,
    [CHARGER_STATUSES.outOfService]: 0,
  };
  const accessibility: Record<AccessStatus, number> = {
    [ACCESS_STATUSES.yes]: 0,
    [ACCESS_STATUSES.no]: 0,
    [ACCESS_STATUSES.unknown]: 0,
  };
  const connectorMap = new Map<string, { stations: Set<string>; count: number; max: number | null }>();
  let withoutPower = 0;

  for (const station of input.stations) {
    bySource[station.source] += 1;
    status[station.status] += 1;
    accessibility[station.accessibility] += 1;
    if (station.maxPowerKw === null) withoutPower += 1;

    for (const connector of station.connectors) {
      const entry = connectorMap.get(connector.type) ?? { stations: new Set<string>(), count: 0, max: null };
      entry.stations.add(station.id);
      entry.count += 1;
      if (connector.powerKw !== null) entry.max = entry.max === null ? connector.powerKw : Math.max(entry.max, connector.powerKw);
      connectorMap.set(connector.type, entry);
    }
  }

  const connectors: ChargerConnectorStats[] = [...connectorMap]
    .map(([type, entry]) => ({
      type,
      stationCount: entry.stations.size,
      connectorCount: entry.count,
      maxPowerKw: entry.max,
    }))
    .sort((a, b) => b.stationCount - a.stationCount || a.type.localeCompare(b.type));

  const power = powerStats(input.stations);
  return {
    dataVersion: DATA_VERSION,
    generatedAt: input.generatedAt,
    sourceUpdatedAt: input.sourceUpdatedAt,
    totals: {
      stations: input.stations.length,
      points: input.stations.reduce((total, station) => total + station.pointCount, 0),
      maxPowerKw: power.max,
      duplicatesRemoved: input.duplicatesRemoved,
      malformedRipreeRows: input.malformedRipreeRows,
    },
    bySource,
    power,
    status,
    accessibility,
    connectors,
    quality: {
      withoutCoordinates: input.stations.filter(
        (station) => !Number.isFinite(station.lat) || !Number.isFinite(station.lon),
      ).length,
      withoutPower,
      unknownStatus: status.unknown,
      unknownAccess: accessibility.unknown,
    },
  };
}
