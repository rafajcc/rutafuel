import type { BuiltIndexes } from './indexes.js';
import type { FuelStation } from './types.js';

/** Entrada ligera para el buscador de la portada. Todo se deriva de estaciones reales. */
export interface SearchMunicipality {
  id: string;
  name: string;
  slug: string;
  provinceId: string;
  provinceName: string;
  provinceSlug: string;
  stationCount: number;
  /** Centroide aritmético de las estaciones del municipio, no un dato oficial. */
  lat: number;
  lon: number;
  postalCodes: string[];
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * Construye el índice de búsqueda a partir de los índices oficiales.
 * Los códigos postales y el centroide se obtienen de las estaciones; no se inventan datos.
 */
export function buildSearchIndex(indexes: BuiltIndexes): SearchMunicipality[] {
  const entries: SearchMunicipality[] = [];

  for (const index of indexes.municipalities.values()) {
    const withCoordinates = index.stations.filter(
      (station) => Number.isFinite(station.lat) && Number.isFinite(station.lon),
    );
    if (withCoordinates.length === 0) continue;

    const postalCodes = [
      ...new Set(
        index.stations
          .map((station: FuelStation) => station.postalCode?.trim())
          .filter((code): code is string => Boolean(code)),
      ),
    ].sort((a, b) => a.localeCompare(b, 'es'));

    entries.push({
      id: index.id,
      name: index.name,
      slug: index.slug,
      provinceId: index.provinceId,
      provinceName: index.provinceName,
      provinceSlug: index.provinceSlug,
      stationCount: index.stationCount,
      lat: round(withCoordinates.reduce((total, station) => total + station.lat, 0) / withCoordinates.length),
      lon: round(withCoordinates.reduce((total, station) => total + station.lon, 0) / withCoordinates.length),
      postalCodes,
    });
  }

  return entries.sort(
    (a, b) => a.name.localeCompare(b.name, 'es') || a.provinceName.localeCompare(b.provinceName, 'es'),
  );
}

/** Normaliza texto para comparar localidades sin depender de acentos ni mayúsculas. */
export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es-ES')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
