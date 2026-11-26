import type { ChargerConnector, ChargingStation, ChargerProvenance, SourceId } from './types.js';

/** Umbral deliberadamente conservador: sólo fusiona instalaciones prácticamente coincidentes. */
export const MAX_MATCH_DISTANCE_METERS = 75;

export interface MergeResult {
  stations: ChargingStation[];
  merged: number;
  matchedBy: { officialId: number; proximity: number };
}

function normalizeText(value: string | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es-ES')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function normalizeReference(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = normalizeText(value);
  return normalized.length >= 6 ? normalized : undefined;
}

function textMatch(primary: string | undefined, secondary: string | undefined, minLength: number): boolean {
  const left = normalizeText(primary);
  const right = normalizeText(secondary);
  if (left.length < minLength || right.length < minLength) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function operatorCompatible(primary: ChargingStation, secondary: ChargingStation): boolean {
  if (!primary.operator || !secondary.operator) return true;
  return textMatch(primary.operator, secondary.operator, 4);
}

function distanceMeters(a: ChargingStation, b: ChargingStation): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const haversine =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(haversine));
}

function bucketKey(station: ChargingStation): string {
  return `${Math.round(station.lat * 100)}:${Math.round(station.lon * 100)}`;
}

function connectorTypes(station: ChargingStation): Set<string> {
  return new Set(station.connectors.map((connector) => connector.type).filter((type) => type !== 'UNKNOWN'));
}

function connectorKey(connector: ChargerConnector): string {
  return [
    connector.type,
    connector.rawType,
    connector.chargeMode,
    connector.format,
    connector.powerKw ?? '',
  ].join('|');
}

function mergeSources(sources: ChargerProvenance[]): ChargerProvenance[] {
  const result = new Map<string, ChargerProvenance>();
  for (const source of sources) {
    const key = `${source.source}:${source.id}`;
    const existing = result.get(key);
    result.set(key, existing ? { ...existing, ...source } : { ...source });
  }
  return [...result.values()];
}

function mergeConnectorSources(sources: SourceId[]): SourceId[] {
  return [...new Set(sources)];
}

function mergeConnectors(primary: ChargerConnector[], secondary: ChargerConnector[]): ChargerConnector[] {
  const result = new Map<string, ChargerConnector>();
  for (const connector of [...primary, ...secondary]) {
    const key = connectorKey(connector);
    const existing = result.get(key);
    result.set(
      key,
      existing
        ? { ...existing, sources: mergeConnectorSources([...existing.sources, ...connector.sources]) }
        : { ...connector, sources: mergeConnectorSources(connector.sources) },
    );
  }
  return [...result.values()];
}

function latestDate(a: ChargingStation, b: ChargingStation): { iso?: string; raw?: string } {
  if (!a.updatedAt) return { iso: b.updatedAt, raw: b.updatedAtRaw };
  if (!b.updatedAt) return { iso: a.updatedAt, raw: a.updatedAtRaw };
  return a.updatedAt >= b.updatedAt
    ? { iso: a.updatedAt, raw: a.updatedAtRaw }
    : { iso: b.updatedAt, raw: b.updatedAtRaw };
}

function mergeStations(primary: ChargingStation, secondary: ChargingStation): ChargingStation {
  const connectors = mergeConnectors(primary.connectors, secondary.connectors);
  const maxPowerKw = connectors.reduce<number | null>((max, connector) => {
    if (connector.powerKw === null) return max;
    return max === null || connector.powerKw > max ? connector.powerKw : max;
  }, null);
  const updated = latestDate(primary, secondary);
  const status = primary.status === 'unknown' ? secondary.status : primary.status;

  return {
    ...primary,
    name: primary.name ?? secondary.name,
    address: primary.address ?? secondary.address,
    postalCode: primary.postalCode ?? secondary.postalCode,
    operator: primary.operator ?? secondary.operator,
    operatorId: primary.operatorId ?? secondary.operatorId,
    status,
    connectors,
    maxPowerKw,
    pointCount: Math.max(primary.pointCount, secondary.pointCount),
    ...(updated.iso ? { updatedAt: updated.iso } : {}),
    ...(updated.raw ? { updatedAtRaw: updated.raw } : {}),
    sources: mergeSources([...primary.sources, ...secondary.sources]),
    raw: { ...primary.raw, ...secondary.raw },
  };
}

export function deduplicateChargers(ripree: ChargingStation[], ocm: ChargingStation[]): MergeResult {
  const byReference = new Map<string, ChargingStation>();
  const addReference = (station: ChargingStation, value: string | undefined) => {
    const reference = normalizeReference(value);
    if (!reference) return;
    const existing = byReference.get(reference);
    if (!existing) byReference.set(reference, station);
  };

  for (const station of ripree) {
    addReference(station, station.officialId);
    for (const pointId of station.pointIds) addReference(station, pointId);
    for (const point of station.raw.ripree?.puntos ?? []) addReference(station, point.pointCode);
  }

  const buckets = new Map<string, ChargingStation[]>();
  for (const station of ripree) {
    const key = bucketKey(station);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(station);
    else buckets.set(key, [station]);
  }

  const used = new Set<string>();
  const mergedByOfficialId = new Map<string, ChargingStation>();
  const unmatchedOcm: ChargingStation[] = [];
  let proximityMatches = 0;

  for (const candidate of ocm) {
    const references = [
      candidate.officialId,
      candidate.raw.ocm?.dataProvidersReference,
      candidate.raw.ocm?.operatorsReference,
    ];
    const exact = references
      .map((reference) => byReference.get(normalizeReference(reference) ?? ''))
      .find((station): station is ChargingStation => Boolean(station));

    if (exact) {
      const merged = mergeStations(exact, candidate);
      mergedByOfficialId.set(exact.id, merged);
      used.add(exact.id);
      continue;
    }

    let best: { station: ChargingStation; score: number; distance: number } | undefined;
    const [latBucket = 0, lonBucket = 0] = bucketKey(candidate).split(':').map(Number);
    for (let latOffset = -1; latOffset <= 1; latOffset += 1) {
      for (let lonOffset = -1; lonOffset <= 1; lonOffset += 1) {
        const bucket = buckets.get(`${latBucket + latOffset}:${lonBucket + lonOffset}`);
        if (!bucket) continue;
        for (const station of bucket) {
          if (used.has(station.id)) continue;
          const distance = distanceMeters(station, candidate);
          if (distance > MAX_MATCH_DISTANCE_METERS) continue;
          if (!operatorCompatible(station, candidate)) continue;

          const nameMatch = textMatch(station.name, candidate.name, 8);
          const addressMatch = textMatch(station.address, candidate.address, 10);
          const overlap = [...connectorTypes(station)].some((type) => connectorTypes(candidate).has(type));
          // Se exige solapamiento de conectores además de nombre o dirección: dos instalaciones
          // distintas pueden compartir rótulo o estar en la misma dirección.
          if (!overlap || !(nameMatch || addressMatch)) continue;

          const score = (nameMatch ? 2 : 0) + (addressMatch ? 2 : 0) + (overlap ? 1 : 0);
          if (!best || score > best.score || (score === best.score && distance < best.distance)) {
            best = { station, score, distance };
          }
        }
      }
    }

    if (best) {
      mergedByOfficialId.set(best.station.id, mergeStations(best.station, candidate));
      used.add(best.station.id);
      proximityMatches += 1;
    } else {
      unmatchedOcm.push(candidate);
    }
  }

  const mergedRipree = ripree.map((station) => mergedByOfficialId.get(station.id) ?? station);
  const stations = [...mergedRipree, ...unmatchedOcm].sort(
    (a, b) =>
      a.province.localeCompare(b.province, 'es') ||
      a.municipality.localeCompare(b.municipality, 'es') ||
      (a.name ?? '').localeCompare(b.name ?? '', 'es') ||
      a.id.localeCompare(b.id),
  );

  return {
    stations,
    merged: mergedByOfficialId.size,
    matchedBy: { officialId: mergedByOfficialId.size - proximityMatches, proximity: proximityMatches },
  };
}
