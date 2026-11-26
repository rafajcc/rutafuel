/** Descriptores compartidos entre getStaticPaths() y el sitemap de recarga. */

export interface ChargingGeoEntry {
  id: string;
  name: string;
  slug: string;
  provinceId?: string;
  stationCount: number;
  pointCount: number;
  maxPowerKw: number | null;
  center: { lat: number; lon: number };
}

export interface ChargingIndexLike {
  provinces: ChargingGeoEntry[];
  municipalities: ChargingGeoEntry[];
}

export interface ChargingProvincePage extends ChargingGeoEntry {
  url: string;
}

export interface ChargingMunicipalityPage extends ChargingGeoEntry {
  provinceId: string;
  provinceName: string;
  provinceSlug: string;
  url: string;
}

/** Igual que en la ingesta: evita páginas indexables con datos insuficientes. */
export const MIN_CHARGING_STATIONS = 3;

export function hasEnoughChargingContent(entry: ChargingGeoEntry): boolean {
  return (
    entry.stationCount >= MIN_CHARGING_STATIONS &&
    entry.maxPowerKw !== null &&
    Number.isFinite(entry.center?.lat) &&
    Number.isFinite(entry.center?.lon)
  );
}

export function buildChargingProvincePages(index: ChargingIndexLike): ChargingProvincePage[] {
  return [...index.provinces]
    .filter((entry) => entry.stationCount > 0 && Boolean(entry.slug))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
    .map((entry) => ({ ...entry, url: `/recarga-electrica/${entry.slug}/` }));
}

export function buildChargingMunicipalityPages(
  index: ChargingIndexLike,
): ChargingMunicipalityPage[] {
  const provinces = new Map(index.provinces.map((province) => [province.id, province]));

  return index.municipalities
    .filter(hasEnoughChargingContent)
    .flatMap((entry) => {
      const province = entry.provinceId ? provinces.get(entry.provinceId) : undefined;
      if (!entry.provinceId || !province) return [];
      return [
        {
          ...entry,
          provinceId: entry.provinceId,
          provinceName: province.name,
          provinceSlug: province.slug,
          url: `/recarga-electrica/${province.slug}/${entry.slug}/`,
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
