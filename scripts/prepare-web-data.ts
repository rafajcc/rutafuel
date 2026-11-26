import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FuelStation } from './lib/types.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(projectRoot, 'src', 'data');
const webRoot = path.join(projectRoot, 'public', 'data');

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

async function copyDirectory(relative: string): Promise<number> {
  const source = path.join(sourceRoot, relative);
  const entries = await readdir(source, { withFileTypes: true });
  let count = 0;
  for (const entry of entries) {
    if (entry.isDirectory()) {
      count += await copyDirectory(`${relative}/${entry.name}`);
      continue;
    }
    if (!entry.name.endsWith('.json')) continue;
    const index = await readJson<{ stations?: FuelStation[] }>(`${relative}/${entry.name}`);
    if (Array.isArray(index.stations)) {
      await writeJson(`${relative}/${entry.name}`, {
        ...index,
        stations: index.stations.map(slimStation),
      });
      count += 1;
    }
  }
  return count;
}

async function main(): Promise<void> {
  // El directorio es generado; se puede reconstruir siempre desde src/data.
  await rm(webRoot, { recursive: true, force: true });
  await mkdir(webRoot, { recursive: true });

  const provinces = await copyDirectory('gasolineras/provincias');
  const municipalities = await copyDirectory('gasolineras/municipios');
  const search = await readJson<unknown>('buscador/municipios.json');
  await writeJson('buscador/municipios.json', search);

  console.log(
    `[rutafuel] Copia web preparada: ${provinces} provincias, ${municipalities} municipios ` +
      `y ${(search as unknown[]).length} entradas de búsqueda en public/data`,
  );
}

await main();
