/** Geometría y filtrado sobre la ruta. Funciones puras, sin dependencias ni servicios externos. */

import type {
  RouteChargeEntry,
  RouteEntry,
  RouteFuelEntry,
  RouteGridIndex,
} from '../../scripts/lib/route-index.js';
import { powerTier, type PowerTier } from './charging.js';
import type { FuelKey } from './fuels.js';
import { boundingBox, haversineKm, isValidCoordinates, type Coordinates } from './geo.js';

export interface RouteSample extends Coordinates {
  cumulativeKm: number;
}

/** Polyline codificada de OSRM (precision 5, latitud y longitud en ese orden). */
export function decodePolyline(encoded: string, precision = 5): Coordinates[] {
  const points: Coordinates[] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  let factor = 10 ** precision;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte = 0;
    do {
      if (index >= encoded.length) throw new Error('Polyline incompleta');
      byte = encoded.charCodeAt(index) - 63;
      index += 1;
      if (byte < 0) throw new Error('Polyline inválida');
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;
    do {
      if (index >= encoded.length) throw new Error('Polyline incompleta');
      byte = encoded.charCodeAt(index) - 63;
      index += 1;
      if (byte < 0) throw new Error('Polyline inválida');
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lon += result & 1 ? ~(result >> 1) : result >> 1;

    const point = { lat: lat / factor, lon: lon / factor };
    if (!isValidCoordinates(point)) throw new Error('Coordenada de polyline fuera de rango');
    points.push(point);
  }
  return points;
}

/** Muestra la geometría real a intervalos regulares y acumula kilómetros desde el origen. */
export function sampleRoute(geometry: Coordinates[], stepKm = 1): RouteSample[] {
  if (geometry.length < 2 || !Number.isFinite(stepKm) || stepKm <= 0) return [];
  const samples: RouteSample[] = [{ ...geometry[0]!, cumulativeKm: 0 }];
  let total = 0;
  let pending = 0;
  const maxSamples = 10_000;

  for (let index = 1; index < geometry.length; index += 1) {
    const from = geometry[index - 1]!;
    const to = geometry[index]!;
    const segmentKm = haversineKm(from, to);
    if (!Number.isFinite(segmentKm) || segmentKm === 0) continue;

    let travelled = 0;
    while (pending + (segmentKm - travelled) >= stepKm) {
      const remaining = stepKm - pending;
      travelled += remaining;
      total += remaining;
      const ratio = travelled / segmentKm;
      samples.push({
        lat: from.lat + (to.lat - from.lat) * ratio,
        lon: from.lon + (to.lon - from.lon) * ratio,
        cumulativeKm: total,
      });
      pending = 0;
      if (samples.length >= maxSamples) return samples;
    }

    const rest = segmentKm - travelled;
    total += rest;
    pending += rest;
  }

  const end = geometry.at(-1)!;
  samples.push({ ...end, cumulativeKm: total });
  return samples;
}

/** Celdas de la rejilla que pueden contener estaciones dentro del radio de un punto. */
export function cellIdsWithin(point: Coordinates, radiusKm: number, cellSizeDeg: number): string[] {
  if (!isValidCoordinates(point) || !Number.isFinite(radiusKm) || radiusKm < 0) return [];
  if (!Number.isFinite(cellSizeDeg) || cellSizeDeg <= 0) return [];
  const box = boundingBox(point, radiusKm);
  const minLat = Math.floor(box.minLat / cellSizeDeg);
  const maxLat = Math.floor(box.maxLat / cellSizeDeg);
  const minLon = Math.floor(box.minLon / cellSizeDeg);
  const maxLon = Math.floor(box.maxLon / cellSizeDeg);
  if ((maxLat - minLat + 1) * (maxLon - minLon + 1) > 400) return [];

  const keys: string[] = [];
  for (let latCell = minLat; latCell <= maxLat; latCell += 1) {
    for (let lonCell = minLon; lonCell <= maxLon; lonCell += 1) {
      keys.push(`${latCell}:${lonCell}`);
    }
  }
  return keys;
}

/** Distancia real a la polilinea y punto de proyección medido desde el origen de la ruta. */
export function nearestOnRoute(
  station: Coordinates,
  samples: RouteSample[],
): { distanceKm: number; alongRouteKm: number } {
  let best = { distanceKm: Number.POSITIVE_INFINITY, alongRouteKm: 0 };
  const kmPerLat = 111.32;
  const kmPerLon = 111.32 * Math.max(0.01, Math.cos((station.lat * Math.PI) / 180));

  for (let index = 1; index < samples.length; index += 1) {
    const from = samples[index - 1]!;
    const to = samples[index]!;
    const ax = (from.lon - station.lon) * kmPerLon;
    const ay = (from.lat - station.lat) * kmPerLat;
    const bx = (to.lon - station.lon) * kmPerLon;
    const by = (to.lat - station.lat) * kmPerLat;
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    const rawT = lengthSq === 0 ? 0 : -(ax * dx + ay * dy) / lengthSq;
    const t = Math.max(0, Math.min(1, rawT));
    const distanceKm = Math.hypot(ax + t * dx, ay + t * dy);
    if (distanceKm < best.distanceKm) {
      best = {
        distanceKm,
        alongRouteKm: from.cumulativeKm + t * (to.cumulativeKm - from.cumulativeKm),
      };
    }
  }
  return best;
}

export interface RouteQuery {
  radiusKm: number;
  energy: 'fuel' | 'electric';
  fuel?: FuelKey;
  tier?: PowerTier | 'all';
  minPowerKw?: number;
}

export interface RouteMatch {
  entry: RouteEntry;
  distanceKm: number;
  detourKm: number;
  alongRouteKm: number;
}

/** El desvío es una estimación de ida y vuelta, no un cálculo de navegación puerta a puerta. */
export function estimateDetourKm(distanceKm: number): number {
  return distanceKm * 2;
}

function chargeMatches(entry: RouteChargeEntry, query: RouteQuery): boolean {
  if (query.tier && query.tier !== 'all' && powerTier(entry.maxPowerKw) !== query.tier) {
    return false;
  }
  if (
    query.minPowerKw !== undefined &&
    Number.isFinite(query.minPowerKw) &&
    (entry.maxPowerKw === null || entry.maxPowerKw < query.minPowerKw)
  ) {
    return false;
  }
  return true;
}

function fuelMatches(entry: RouteFuelEntry, query: RouteQuery): boolean {
  return Boolean(query.fuel && entry.prices[query.fuel] !== undefined);
}

/**
 * Explora únicamente las celdas que intersectan el corredor de la ruta. Nunca recorre
 * todas las estaciones del índice.
 */
export function stationsAlongRoute(
  index: RouteGridIndex,
  samples: RouteSample[],
  query: RouteQuery,
): RouteMatch[] {
  if (samples.length < 2 || !Number.isFinite(query.radiusKm) || query.radiusKm < 0) return [];

  const candidates = new Map<string, RouteEntry>();
  for (const sample of samples) {
    for (const key of cellIdsWithin(sample, query.radiusKm, index.cellSizeDeg)) {
      for (const entry of index.cells[key] ?? []) {
        const id = `${entry.kind}:${entry.id}`;
        if (candidates.has(id)) continue;
        if (query.energy === 'fuel') {
          if (entry.kind === 'fuel' && fuelMatches(entry, query)) candidates.set(id, entry);
        } else if (entry.kind === 'charging' && chargeMatches(entry, query)) {
          candidates.set(id, entry);
        }
      }
    }
  }

  const matches: RouteMatch[] = [];
  for (const entry of candidates.values()) {
    const { distanceKm, alongRouteKm } = nearestOnRoute(entry, samples);
    if (distanceKm > query.radiusKm) continue;
    matches.push({
      entry,
      distanceKm,
      detourKm: estimateDetourKm(distanceKm),
      alongRouteKm,
    });
  }
  return matches.sort(
    (a, b) =>
      a.alongRouteKm - b.alongRouteKm ||
      a.distanceKm - b.distanceKm ||
      a.entry.id.localeCompare(b.entry.id),
  );
}
