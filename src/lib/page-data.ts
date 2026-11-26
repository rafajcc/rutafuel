/** Datos estáticos compartidos por páginas, sitemap y robots. */

import buscadorJson from '../data/buscador/municipios.json';
import provinciasJson from '../data/estadisticas/provincias.json';
import municipiosJson from '../data/estadisticas/municipios.json';
import resumenJson from '../data/estadisticas/resumen.json';
import metadataJson from '../data/metadata.json';
import cargadoresJson from '../data/estadisticas/cargadores.json';
import cargadorIndiceJson from '../data/cargadores/indice.json';
import {
  buildChargingMunicipalityPages,
  buildChargingProvincePages,
  type ChargingIndexLike,
} from './charging-pages.js';
import {
  buildMunicipalityPages,
  buildProvincePages,
  type GeoStatsLike,
  type SearchLike,
} from './pages.js';

export const provinciasStats = provinciasJson as unknown as GeoStatsLike[];
export const municipiosStats = municipiosJson as unknown as GeoStatsLike[];
export const buscadorEntries = buscadorJson as unknown as SearchLike[];
export const resumen = resumenJson;
export const metadata = metadataJson;
export const cargadores = cargadoresJson;
export const cargadorIndice = cargadorIndiceJson as unknown as ChargingIndexLike;

export const provincePages = buildProvincePages(provinciasStats);
export const municipalityPages = buildMunicipalityPages(
  municipiosStats,
  provinciasStats,
  buscadorEntries,
);

export const chargingProvincePages = buildChargingProvincePages(cargadorIndice);
export const chargingMunicipalityPages = buildChargingMunicipalityPages(cargadorIndice);

export const mineturSource = metadata.sources.find((source) => source.id === 'MINETUR');
export const ripreeSource = metadata.sources.find((source) => source.id === 'RIPREE');

export const provinceBySlug = new Map(provincePages.map((page) => [page.slug, page]));

export function municipalityPage(provinceSlug: string, municipalitySlug: string) {
  return municipalityPages.find(
    (page) => page.provinceSlug === provinceSlug && page.slug === municipalitySlug,
  );
}
