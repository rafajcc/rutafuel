/** Lectura de índices en tiempo de build (no se usa en el navegador). */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ChargingStationLike } from './charging.js';
import type { SeoStation } from './seo.js';

export interface StationIndexData {
  id: string;
  name: string;
  slug: string;
  stationCount: number;
  provinceName?: string;
  provinceSlug?: string;
  stations: SeoStation[];
}

/**
 * Durante el prerenderizado el código se ejecuta desde `dist/.prerender`, por lo que
 * `import.meta.url` no apunta al proyecto. `process.cwd()` sí es la raíz del build.
 */
function dataPath(relative: string): string {
  return path.resolve(process.cwd(), 'src', 'data', relative);
}

export async function readProvinceIndex(id: string): Promise<StationIndexData> {
  return JSON.parse(await readFile(dataPath(`gasolineras/provincias/${id}.json`), 'utf8')) as StationIndexData;
}

export async function readMunicipalityIndex(provinceId: string, id: string): Promise<StationIndexData> {
  return JSON.parse(
    await readFile(dataPath(`gasolineras/municipios/${provinceId}/${id}.json`), 'utf8'),
  ) as StationIndexData;
}

export interface ChargingIndexData {
  id: string;
  name: string;
  slug: string;
  stationCount: number;
  pointCount: number;
  maxPowerKw: number | null;
  center: { lat: number; lon: number };
  provinceName?: string;
  provinceSlug?: string;
  stations: ChargingStationLike[];
}

export async function readChargingProvinceIndex(id: string): Promise<ChargingIndexData> {
  return JSON.parse(
    await readFile(dataPath(`cargadores/provincias/${id}.json`), 'utf8'),
  ) as ChargingIndexData;
}

export async function readChargingMunicipalityIndex(
  provinceId: string,
  id: string,
): Promise<ChargingIndexData> {
  return JSON.parse(
    await readFile(dataPath(`cargadores/municipios/${provinceId}/${id}.json`), 'utf8'),
  ) as ChargingIndexData;
}
