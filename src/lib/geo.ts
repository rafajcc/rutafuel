/** Cálculos geográficos en cliente. Sin dependencias externas. */

export interface Coordinates {
  lat: number;
  lon: number;
}

const EARTH_RADIUS_KM = 6371.0088;
const TO_RADIANS = Math.PI / 180;

export function isValidCoordinates(point: Coordinates): boolean {
  return (
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lon) &&
    point.lat >= -90 &&
    point.lat <= 90 &&
    point.lon >= -180 &&
    point.lon <= 180
  );
}

/** Distancia en kilómetros entre dos puntos WGS84 (Haversine). */
export function haversineKm(origin: Coordinates, destination: Coordinates): number {
  if (!isValidCoordinates(origin) || !isValidCoordinates(destination)) return Number.POSITIVE_INFINITY;

  const deltaLat = (destination.lat - origin.lat) * TO_RADIANS;
  const deltaLon = (destination.lon - origin.lon) * TO_RADIANS;
  const lat1 = origin.lat * TO_RADIANS;
  const lat2 = destination.lat * TO_RADIANS;
  const a =
    Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Caja envolvente para filtrar antes de calcular Haversine sobre muchos puntos. */
export function boundingBox(origin: Coordinates, radiusKm: number): {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
} {
  const latDelta = radiusKm / 111.32;
  const cosLat = Math.max(0.01, Math.cos(origin.lat * TO_RADIANS));
  const lonDelta = radiusKm / (111.32 * cosLat);
  return {
    minLat: origin.lat - latDelta,
    maxLat: origin.lat + latDelta,
    minLon: origin.lon - lonDelta,
    maxLon: origin.lon + lonDelta,
  };
}

export function withinRadius(origin: Coordinates, point: Coordinates, radiusKm: number): boolean {
  const box = boundingBox(origin, radiusKm);
  if (point.lat < box.minLat || point.lat > box.maxLat) return false;
  if (point.lon < box.minLon || point.lon > box.maxLon) return false;
  return haversineKm(origin, point) <= radiusKm;
}

export function nearest<T extends Coordinates>(origin: Coordinates, items: T[]): T | null {
  let best: T | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const item of items) {
    const distance = haversineKm(origin, item);
    if (distance < bestDistance) {
      best = item;
      bestDistance = distance;
    }
  }
  return best;
}
