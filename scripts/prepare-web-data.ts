import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChargerIndex, FuelStation } from './lib/types.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(projectRoot, 'src', 'data');
const webRoot = path.join(projectRoot, 'public', 'data');

/** Umbral de páginas de recarga, replicado de src/lib/charging.ts para no acoplar scripts y web. */
const MIN_CHARGING_STATIONS = 3;

/** Datos que el navegador necesita; `raw` queda fuera de la copia pública. */
interface WebStation {
  id: string;
  name?: string;
  address?: string;
  locality?: string;
  municipality: string;
  province: string;
  postalCode?: string;
  lat: number;
  lon: number;
  schedule?: string;
  prices: FuelStation['prices'];
}

function slimStation(station: FuelStation): WebStation {
  return {
    id: station.id,
    ...(station.name ? { name: station.name } : {}),
    ...(station.address ? { address: station.address } : {}),
    ...(station.locality ? { locality: station.locality } : {}),
    municipality: station.municipality,
    province: station.province,
    ...(station.postalCode ? { postalCode: station.postalCode } : {}),
    lat: station.lat,
    lon: station.lon,
    ...(station.schedule ? { schedule: station.schedule } : {}),
    prices: station.prices,
  };
}

async function readJson<T>(relative: string): Promise<T> {
  return JSON.parse(await readFile(path.join(sourceRoot, relative), 'utf8')) as T;
}

async function writeJson(relative: string, value: unknown): Promise<void> {
  const target = path.join(webRoot, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(value), 'utf8');
}

async function copyDirectory(
  relative: string,
  transform?: (station: Record<string, unknown>) => unknown,
): Promise<number> {
  const source = path.join(sourceRoot, relative);
  const entries = await readdir(source, { withFileTypes: true });
  let count = 0;
  for (const entry of entries) {
    if (entry.isDirectory()) {
      count += await copyDirectory(`${relative}/${entry.name}`, transform);
      continue;
    }
    if (!entry.name.endsWith('.json')) continue;
    const index = await readJson<{ stations?: Record<string, unknown>[] }>(
      `${relative}/${entry.name}`,
    );
    if (Array.isArray(index.stations)) {
      await writeJson(`${relative}/${entry.name}`, {
        ...index,
        stations: transform ? index.stations.map(transform) : index.stations,
      });
      count += 1;
    }
  }
  return count;
}

/** Índice mínimo para que la portada encuentre el municipio con cargadores más cercano. */
function buildChargingSearch(index: ChargerIndex) {
  const provinceNames = new Map(index.provinces.map((province) => [province.id, province.name]));
  return index.municipalities
    .filter(
      (municipality) =>
        municipality.stationCount >= MIN_CHARGING_STATIONS &&
        Number.isFinite(municipality.center.lat) &&
        Number.isFinite(municipality.center.lon),
    )
    .map((municipality) => ({
      id: municipality.id,
      name: municipality.name,
      slug: municipality.slug,
      provinceId: municipality.provinceId,
      provinceName: provinceNames.get(municipality.provinceId) ?? municipality.provinceId,
      provinceSlug: index.provinces.find((province) => province.id === municipality.provinceId)?.slug ?? '',
      stationCount: municipality.stationCount,
      lat: municipality.center.lat,
      lon: municipality.center.lon,
    }));
}

async function main(): Promise<void> {
  // El directorio es generado; se puede reconstruir siempre desde src/data.
  await rm(webRoot, { recursive: true, force: true });
  await mkdir(webRoot, { recursive: true });

  const fuelProvinces = await copyDirectory(
    'gasolineras/provincias',
    (station) => slimStation(station as unknown as FuelStation),
  );
  const fuelMunicipalities = await copyDirectory(
    'gasolineras/municipios',
    (station) => slimStation(station as unknown as FuelStation),
  );
  const chargeProvinces = await copyDirectory('cargadores/provincias');
  const chargeMunicipalities = await copyDirectory('cargadores/municipios');

  const search = await readJson<unknown>('buscador/municipios.json');
  await writeJson('buscador/municipios.json', search);
  const chargerIndex = await readJson<ChargerIndex>('cargadores/indice.json');
  const chargingSearch = buildChargingSearch(chargerIndex);
  await writeJson('cargadores/buscador.json', chargingSearch);

  console.log(
    `[rutafuel] Copia web preparada: ${fuelProvinces} provincias y ${fuelMunicipalities} municipios de carburantes; ` +
      `${chargeProvinces} provincias y ${chargeMunicipalities} municipios de recarga; ` +
      `${(search as unknown[]).length} localidades y ${chargingSearch.length} municipios con cargadores`,
  );
}

await main();
