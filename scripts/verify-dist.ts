/** Comprobaciones finales sobre dist/: SEO, presupuesto de assets, datos públicos y Plesk. */

import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('dist');
const site = (process.env.SITE_URL ?? 'https://rutafuel.es').replace(/\/$/, '');
const passed: string[] = [];
const failed: string[] = [];

function check(name: string, ok: boolean, detail = ''): void {
  (ok ? passed : failed).push(detail ? `${name} (${detail})` : name);
}

async function exists(relative: string): Promise<boolean> {
  try {
    await stat(path.join(root, relative));
    return true;
  } catch {
    return false;
  }
}

async function text(relative: string): Promise<string> {
  return readFile(path.join(root, relative), 'utf8');
}

async function filesIn(relative: string, extension: string): Promise<string[]> {
  const absolute = path.join(root, relative);
  const result: string[] = [];
  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith(extension)) result.push(full);
    }
  }
  await walk(absolute);
  return result;
}

function assetPaths(html: string, tag: 'script' | 'stylesheet'): string[] {
  const pattern =
    tag === 'script'
      ? /<script\b[^>]*\bsrc="(\/_astro\/[^"]+\.js)"/g
      : /<link\b[^>]*rel="stylesheet"[^>]*href="(\/_astro\/[^"]+\.css)"/g;
  return [...html.matchAll(pattern)].map((match) => match[1]!);
}

async function bytesOf(relative: string): Promise<number> {
  try {
    return (await stat(path.join(root, relative))).size;
  } catch {
    return 0;
  }
}

async function totalBytes(relativePaths: string[]): Promise<number> {
  let total = 0;
  for (const relative of new Set(relativePaths)) total += await bytesOf(relative);
  return total;
}

async function main(): Promise<void> {
  for (const file of [
    'index.html',
    'ruta/index.html',
    'robots.txt',
    'sitemap.xml',
    '.htaccess',
    '_headers',
    'data/rutas/estaciones.json',
  ]) {
    check(`fichero ${file}`, await exists(file));
  }

  const sitemap = await text('sitemap.xml');
  const locs = [...sitemap.matchAll(/<loc>/g)].length;
  check('sitemap con páginas suficientes', locs > 2000, `${locs} URLs`);
  check('sitemap incluye /ruta/', sitemap.includes(`<loc>${site}/ruta/</loc>`));

  const robots = await text('robots.txt');
  check('robots apunta al sitemap', robots.includes(`Sitemap: ${site}/sitemap.xml`));

  const home = await text('index.html');
  check('canonical de la portada', home.includes(`rel="canonical" href="${site}/"`));
  check('enlace al planificador', home.includes('href="/ruta/"'));
  check('meta og:locale', home.includes('property="og:locale" content="es_ES"'));
  check('relación con el sitemap', home.includes('rel="sitemap"'));
  check('hueco publicitario reservado', home.includes('data-ad-slot'));

  const planner = await text('ruta/index.html');
  check('planificador renderizado', planner.includes('data-route-planner'));
  check('atribuciones en /ruta/', planner.includes('Nominatim') && planner.includes('OSRM'));

  const province = await text('gasolineras/madrid-28/index.html');
  check('breadcrumbs JSON-LD', province.includes('BreadcrumbList'));
  check('ranking en HTML estático', province.includes('Precio'));

  const initialJs = assetPaths(home, 'script');
  const jsBytes = await totalBytes(initialJs);
  check('JavaScript inicial <= 48 KiB', jsBytes <= 48 * 1024, `${(jsBytes / 1024).toFixed(1)} KiB`);
  check('Leaflet no se carga en el HTML inicial', !initialJs.some((file) => /leaflet/i.test(file)));

  const cssPaths = assetPaths(home, 'stylesheet');
  const cssBytes = await totalBytes(cssPaths);
  check('CSS inicial <= 24 KiB', cssBytes <= 24 * 1024, `${(cssBytes / 1024).toFixed(1)} KiB`);

  const styles = await filesIn('_astro', '.css');
  let adSlotReserved = false;
  for (const file of styles) {
    if ((await readFile(file, 'utf8')).includes('.ad-slot')) adSlotReserved = true;
  }
  check('altura del hueco publicitario en CSS', adSlotReserved);

  const dataFiles = await filesIn('data', '.json');
  let withRaw = 0;
  for (const file of dataFiles) {
    if (/"raw"\s*:/.test(await readFile(file, 'utf8'))) withRaw += 1;
  }
  check('JSON público sin auditoría raw', withRaw === 0, `${dataFiles.length} ficheros revisados`);

  const grid = JSON.parse(await text('data/rutas/estaciones.json')) as {
    cells?: Record<string, unknown>;
    totals?: { fuel?: number; charging?: number };
  };
  const cellCount = Object.keys(grid.cells ?? {}).length;
  check('rejilla de rutas publicada', cellCount > 500 && (grid.totals?.fuel ?? 0) > 10000,
    `${cellCount} celdas, ${grid.totals?.fuel ?? 0} gasolineras`);

  const htaccess = await text('.htaccess');
  check('caché y compresión en Apache', /Cache-Control/.test(htaccess) && /DEFLATE/.test(htaccess));
  check(
    'Apache no expone _headers',
    /<Files "_headers">/.test(htaccess) && /Require all denied/.test(htaccess),
  );

  const headers = await text('_headers');
  check(
    'cabeceras de Cloudflare Pages',
    headers.includes('X-Content-Type-Options') &&
      headers.includes('Referrer-Policy') &&
      headers.includes('X-Frame-Options'),
  );
  check(
    'caché diferenciada en Cloudflare Pages',
    headers.includes('/data/*') &&
      headers.includes('/_astro/*') &&
      (headers.match(/!\s+Cache-Control/g) ?? []).length >= 2 &&
      headers.includes('max-age=31536000, immutable') &&
      headers.includes('max-age=3600'),
  );
  check(
    'noindex en despliegues de preview',
    headers.includes('pages.dev') && headers.includes('X-Robots-Tag: noindex'),
  );

  for (const name of passed) console.log(`  OK  ${name}`);
  for (const name of failed) console.error(`  FAIL  ${name}`);
  console.log(`[rutafuel] verify:dist: ${passed.length} correctas, ${failed.length} fallidas`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(`[rutafuel] verify:dist ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
