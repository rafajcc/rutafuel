import type { FuelStation, GlobalIndex, MunicipalityIndex, ProvinceIndex } from './types.js';

function compareName(a: { name: string; id: string }, b: { name: string; id: string }): number {
  return a.name.localeCompare(b.name, 'es') || a.id.localeCompare(b.id);
}

export interface BuiltIndexes {
  provinces: Map<string, ProvinceIndex>;
  municipalities: Map<string, MunicipalityIndex>;
  global: GlobalIndex;
}

/** Agrupa estaciones por provincia y municipio usando los identificadores oficiales. */
export function buildIndexes(stations: FuelStation[]): BuiltIndexes {
  const provinces = new Map<string, ProvinceIndex>();
  const municipalities = new Map<string, MunicipalityIndex>();

  const sorted = [...stations].sort((a, b) => a.id.localeCompare(b.id));

  for (const station of sorted) {
    let province = provinces.get(station.provinceId);
    if (!province) {
      province = {
        id: station.provinceId,
        name: station.province,
        slug: station.provinceSlug,
        stationCount: 0,
        municipalities: [],
        stations: [],
      };
      provinces.set(station.provinceId, province);
    }
    province.stations.push(station);
    province.stationCount += 1;

    const municipalityKey = `${station.provinceId}/${station.municipalityId}`;
    let municipality = municipalities.get(municipalityKey);
    if (!municipality) {
      municipality = {
        id: station.municipalityId,
        name: station.municipality,
        slug: station.municipalitySlug,
        provinceId: station.provinceId,
        provinceName: station.province,
        provinceSlug: station.provinceSlug,
        stationCount: 0,
        stations: [],
      };
      municipalities.set(municipalityKey, municipality);
      province.municipalities.push({
        id: station.municipalityId,
        name: station.municipality,
        slug: station.municipalitySlug,
        stationCount: 0,
      });
    }
    municipality.stations.push(station);
    municipality.stationCount += 1;
    const entry = province.municipalities.find((item) => item.id === station.municipalityId);
    if (entry) entry.stationCount += 1;
  }

  for (const province of provinces.values()) {
    province.stations.sort((a, b) => a.id.localeCompare(b.id));
    province.municipalities.sort(compareName);
  }
  for (const municipality of municipalities.values()) {
    municipality.stations.sort((a, b) => a.id.localeCompare(b.id));
  }

  const provinceList = [...provinces.values()].sort(compareName);
  const municipalityList = [...municipalities.values()].sort((a, b) =>
    compareName({ name: a.name, id: a.id }, { name: b.name, id: b.id }),
  );

  return {
    provinces,
    municipalities,
    global: {
      provinces: provinceList.map(({ id, name, slug, stationCount }) => ({
        id,
        name,
        slug,
        stationCount,
      })),
      municipalities: municipalityList.map(({ id, name, slug, provinceId, stationCount }) => ({
        id,
        name,
        slug,
        provinceId,
        stationCount,
      })),
    },
  };
}

export function municipalityIndexPath(index: MunicipalityIndex): string {
  return `gasolineras/municipios/${index.provinceId}/${index.id}.json`;
}

export function provinceIndexPath(index: ProvinceIndex): string {
  return `gasolineras/provincias/${index.id}.json`;
}
