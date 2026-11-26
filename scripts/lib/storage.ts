import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DatasetMetadata } from './types.js';

export type DatasetFiles = Record<string, unknown>;

/** Escritura atómica a nivel de directorio: staging -> backup -> swap -> limpieza. */
export async function writeDatasetAtomic(
  dataDir: string,
  files: DatasetFiles,
  options: { pretty?: string[] } = {},
): Promise<void> {
  const root = path.resolve(dataDir);
  const parent = path.dirname(root);
  const suffix = `${process.pid}-${Date.now()}`;
  const staging = path.join(parent, `.staging-data-${suffix}`);
  const backup = path.join(parent, `.backup-data-${suffix}`);
  const pretty = new Set(options.pretty ?? []);

  await mkdir(parent, { recursive: true });
  await mkdir(staging, { recursive: true });

  try {
    for (const [relativePath, content] of Object.entries(files)) {
      const target = path.join(staging, relativePath);
      await mkdir(path.dirname(target), { recursive: true });
      const text = JSON.stringify(content, null, pretty.has(relativePath) ? 2 : 0);
      if (!text || text === 'undefined') {
        throw new Error(`Contenido no serializable en ${relativePath}`);
      }
      await writeFile(target, text, 'utf8');
    }

    // Validación de lo efectivamente escrito antes de tocar los datos anteriores.
    for (const relativePath of Object.keys(files)) {
      const text = await readFile(path.join(staging, relativePath), 'utf8');
      if (!text.trim()) throw new Error(`Fichero vacío en staging: ${relativePath}`);
      JSON.parse(text);
    }

    const hadPrevious = existsSync(root);
    if (hadPrevious) await rename(root, backup);

    try {
      await rename(staging, root);
    } catch (error) {
      if (hadPrevious && existsSync(backup)) await rename(backup, root);
      throw error;
    }

    if (hadPrevious) await rm(backup, { recursive: true, force: true });
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export async function readPreviousMetadata(dataDir: string): Promise<DatasetMetadata | undefined> {
  const file = path.resolve(dataDir, 'metadata.json');
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(await readFile(file, 'utf8')) as DatasetMetadata;
  } catch {
    return undefined;
  }
}
