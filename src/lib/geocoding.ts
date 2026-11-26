/** Geocodificación desacoplada: dataset local por defecto, Nominatim sólo bajo petición explícita. */

import { isValidCoordinates, type Coordinates } from './geo.js';
import { normalizeSearchText } from './search.js';

export interface GeocodeResult extends Coordinates {
  label: string;
  provider: 'local' | 'nominatim';
}

export interface GeocodingService {
  geocode(query: string): Promise<GeocodeResult | null>;
}

export interface LocalPlace extends Coordinates {
  name: string;
  provinceName?: string;
  postalCodes?: string[];
  stationCount?: number;
}

/** Acepta coordenadas explícitas para no depender de ningún proveedor externo. */
export function parseCoordinates(value: string): Coordinates | null {
  const match = /^\s*(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(value);
  if (!match) return null;
  const point = { lat: Number(match[1]), lon: Number(match[2]) };
  return isValidCoordinates(point) ? point : null;
}

function labelOf(place: LocalPlace): string {
  return place.provinceName ? `${place.name} (${place.provinceName})` : place.name;
}

/** Busca en el índice ya publicado; no realiza peticiones de red ni autocompletado remoto. */
export function createLocalGeocoder(places: LocalPlace[]): GeocodingService {
  const byName = new Map<string, LocalPlace[]>();
  const byPostal = new Map<string, LocalPlace[]>();
  const add = (key: string, place: LocalPlace, target: Map<string, LocalPlace[]>) => {
    if (!key) return;
    target.set(key, [...(target.get(key) ?? []), place]);
  };

  for (const place of places) {
    const name = normalizeSearchText(place.name);
    add(name, place, byName);
    if (place.provinceName) add(`${name} ${normalizeSearchText(place.provinceName)}`, place, byName);
    for (const postalCode of place.postalCodes ?? []) add(postalCode.trim(), place, byPostal);
  }

  return {
    async geocode(query: string): Promise<GeocodeResult | null> {
      const typed = query.trim();
      if (!typed) return null;
      const coords = parseCoordinates(typed);
      if (coords) return { ...coords, label: typed, provider: 'local' };

      const normalized = normalizeSearchText(typed);
      const exact = [...(byName.get(normalized) ?? []), ...(byPostal.get(typed) ?? [])];
      const matches =
        exact.length > 0
          ? exact
          : places
              .filter((place) => normalizeSearchText(place.name).startsWith(normalized))
              .sort((a, b) => (b.stationCount ?? 0) - (a.stationCount ?? 0));

      if (matches.length !== 1) return null;
      const place = matches[0]!;
      return { lat: place.lat, lon: place.lon, label: labelOf(place), provider: 'local' };
    },
  };
}

interface CacheStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): CacheStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export interface NominatimOptions {
  endpoint?: string;
  fetchImpl?: typeof fetch;
  storage?: CacheStorage;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
  minIntervalMs?: number;
  cacheTtlMs?: number;
}

interface CachedResult {
  at: number;
  result: GeocodeResult;
}

/**
 * La política de Nominatim prohíbe autocompletado y exige ≤ 1 petición/s, atribución y caché.
 * Este servicio sólo se invoca desde una acción del usuario y admite sustituir el endpoint.
 */
export function createNominatimGeocoder(options: NominatimOptions = {}): GeocodingService {
  const endpoint = options.endpoint ?? 'https://nominatim.openstreetmap.org/search';
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const now = options.now ?? (() => Date.now());
  const wait =
    options.wait ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const minIntervalMs = options.minIntervalMs ?? 1100;
  const cacheTtlMs = options.cacheTtlMs ?? 30 * 24 * 60 * 60 * 1000;
  let lastRequestAt = 0;

  return {
    async geocode(query: string): Promise<GeocodeResult | null> {
      const typed = query.trim();
      if (!typed) return null;
      const cacheKey = `rf-geocode:${normalizeSearchText(typed)}`;

      if (storage) {
        try {
          const raw = storage.getItem(cacheKey);
          if (raw) {
            const cached = JSON.parse(raw) as CachedResult;
            if (
              cached.result &&
              Number.isFinite(cached.at) &&
              now() - cached.at <= cacheTtlMs &&
              isValidCoordinates(cached.result)
            ) {
              return { ...cached.result, label: cached.result.label || typed };
            }
          }
        } catch {
          // Una caché corrupta no debe impedir la búsqueda.
        }
      }

      const elapsed = now() - lastRequestAt;
      if (lastRequestAt > 0 && elapsed < minIntervalMs) await wait(minIntervalMs - elapsed);
      lastRequestAt = now();

      const url = new URL(endpoint);
      url.searchParams.set('q', typed);
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('limit', '1');
      url.searchParams.set('countrycodes', 'es');
      url.searchParams.set('accept-language', 'es');

      const response = await fetchImpl(url.toString());
      if (!response.ok) throw new Error(`Nominatim respondió HTTP ${response.status}`);
      const data: unknown = await response.json();
      if (!Array.isArray(data)) throw new Error('Respuesta inesperada de Nominatim');

      const first = data.find((item: unknown) => {
        if (typeof item !== 'object' || item === null) return false;
        const candidate = item as { lat?: unknown; lon?: unknown };
        return (
          typeof candidate.lat === 'string' &&
          typeof candidate.lon === 'string' &&
          isValidCoordinates({ lat: Number(candidate.lat), lon: Number(candidate.lon) })
        );
      }) as { lat: string; lon: string; display_name?: string } | undefined;
      if (!first) return null;

      const result: GeocodeResult = {
        lat: Number(first.lat),
        lon: Number(first.lon),
        label: first.display_name || typed,
        provider: 'nominatim',
      };
      if (storage) {
        try {
          storage.setItem(cacheKey, JSON.stringify({ at: now(), result } satisfies CachedResult));
        } catch {
          // Sin almacenamiento la búsqueda sigue funcionando.
        }
      }
      return result;
    },
  };
}
