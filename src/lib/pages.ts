/** Reglas compartidas entre getStaticPaths() y el sitemap: sólo páginas con contenido útil. */

import type { FuelKey } from './fuels.js';

export interface PriceStatsLike {
  count: number;
  min: number | null;
  max: number | null;
  avg: number | null;
}

export interface GeoStatsLike {
  id: string;
  name: string;
  slug: string;
  stationCount: number;
  prices: Record<FuelKey, PriceStatsLike>;
  provinceId?: string;
}

export interface SearchLike {
  id: string;
  name: string;
  slug: string;
  provinceId: string;
  provinceName: string;
  provinceSlug: string;
  stationCount: number;
  lat: number;
  lon: number;
  postalCodes: string[];
}

export interface ProvincePageDescriptor extends GeoStatsLike {
  url: string;
}

export interface MunicipalityPageDescriptor extends GeoStatsLike {
  provinceId: string;
  provinceName: string;
  provinceSlug: string;
  url: string;
  lat: number;
  lon: number;
}

/** Mínimos para evitar páginas indexables casi vacías. */
export const MIN_MUNICIPALITY_STATIONS = 3;
export const MIN_MUNICIPALITY_PRICES = 2;

export function hasEnoughContent(stats: GeoStatsLike): boolean {
  return (
    stats.stationCount >= MIN_MUNICIPALITY_STATIONS &&
    (stats.prices?.g95?.count ?? 0) >= MIN_MUNICIPALITY_PRICES
  );
}

export function buildProvincePages(stats: GeoStatsLike[]): ProvincePageDescriptor[] {
  return [...stats]
    .filter((item) => item.stationCount > 0 && Boolean(item.slug))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
    .map((item) => ({ ...item, url: `/gasolineras/${item.slug}/` }));
}

export function buildMunicipalityPages(
  stats: GeoStatsLike[],
  provinces: GeoStatsLike[],
  search: SearchLike[],
): MunicipalityPageDescriptor[] {
  const provinceBySlugId = new Map(provinces.map((province) => [province.id, province.slug]));
  const searchByKey = new Map(search.map((entry) => [`${entry.provinceId}/${entry.id}`, entry]));

  return stats
    .filter(hasEnoughContent)
    .flatMap((item) => {
      const provinceId = item.provinceId;
      const provinceSlug = provinceId ? provinceBySlugId.get(provinceId) : undefined;
      const located = provinceId ? searchByKey.get(`${provinceId}/${item.id}`) : undefined;
      if (!provinceId || !provinceSlug || !located) return [];
      return [
        {
          ...item,
          provinceId,
          provinceName: located.provinceName,
          provinceSlug,
          url: `/gasolineras/${provinceSlug}/${item.slug}/`,
          lat: located.lat,
          lon: located.lon,
        },
      ];
    })
    .sort(
      (a, b) =>
        a.provinceName.localeCompare(b.provinceName, 'es') ||
        a.name.localeCompare(b.name, 'es') ||
        a.id.localeCompare(b.id),
    );
}
