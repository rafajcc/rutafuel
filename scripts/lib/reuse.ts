/** Reutilización de fuentes no refrescadas en ingestas parciales. Sin inventar registros nuevos. */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { MergeResult } from './dedupe.js';
import { isValidCoordinate } from './gasolineras.js';
import type {
  ChargingStation,
  DatasetMetadata,
  FuelStation,
  NormalizeResult,
  SourceId,
  SourceInfo,
} from './types.js';

export function requirePrevious(previous: DatasetMetadata | undefined): DatasetMetadata {
  if (!previous) {
    throw new Error('No existe un dataset anterior: no se pueden omitir fuentes en la primera ingesta');
  }
  return previous;
}

/** Lee el maestro anterior; el formato se valida en `validateDataset` antes de publicar. */
export async function readPreviousStations<T>(
  dataDir: string,
  relative: string,
): Promise<T[]> {
  const file = path.resolve(dataDir, relative);
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') throw new Error(`Falta ${relative} para reutilizar la fuente omitida`);
    throw error;
  }
  const value: unknown = JSON.parse(text);
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${relative} no contiene un array de registros`);
  }
  return value as T[];
}

/** La procedencia de una fuente omitida se conserva tal cual: Describe los datos publicados. */
export function previousSource(previous: DatasetMetadata, id: SourceId): SourceInfo {
  const source = previous.sources.find((entry) => entry.id === id);
  if (!source) throw new Error(`El dataset anterior no registra la procedencia de ${id}`);
  return { ...source };
}

export function normalizedFromPrevious(stations: FuelStation[]): NormalizeResult {
  return {
    stations,
    discarded: [],
    duplicateIds: [],
    warnings: [],
    withoutCoordinates: stations.filter((station) => !isValidCoordinate(station.lat, station.lon)).length,
    invalidPrices: 0,
  };
}

export function mergeResultFromPrevious(stations: ChargingStation[]): MergeResult {
  return { stations, merged: 0, matchedBy: { officialId: 0, proximity: 0 } };
}
