import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { writeDatasetAtomic } from '../scripts/lib/storage.js';

describe('escritura atómica', () => {
  it('escribe y lee un dataset completo', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'rutafuel-test-'));
    try {
      const dataDir = path.join(root, 'data');
      await writeDatasetAtomic(dataDir, {
        'metadata.json': { dataVersion: 1 },
        'gasolineras/estaciones.json': [{ id: '1' }],
      });

      const metadata = JSON.parse(await readFile(path.join(dataDir, 'metadata.json'), 'utf8'));
      assert.equal(metadata.dataVersion, 1);
      const stations = JSON.parse(await readFile(path.join(dataDir, 'gasolineras/estaciones.json'), 'utf8'));
      assert.equal(stations[0].id, '1');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('no sobrescribe datos válidos si la generación falla', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'rutafuel-test-'));
    try {
      const dataDir = path.join(root, 'data');
      await writeDatasetAtomic(dataDir, { 'metadata.json': { dataVersion: 1 } });
      let threw = false;
      try {
        await writeDatasetAtomic(dataDir, { 'metadata.json': undefined });
      } catch {
        threw = true;
      }
      assert.equal(threw, true);
      const metadata = JSON.parse(await readFile(path.join(dataDir, 'metadata.json'), 'utf8'));
      assert.equal(metadata.dataVersion, 1);

      // Resto del directorio intacto tras el fallo.
      await writeFile(path.join(dataDir, 'extra.json'), '{"ok":true}', 'utf8');
      assert.equal(JSON.parse(await readFile(path.join(dataDir, 'extra.json'), 'utf8')).ok, true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
