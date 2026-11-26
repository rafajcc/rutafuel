import type { APIRoute } from 'astro';
import { municipalityPages, provincePages, resumen } from '../lib/page-data.js';

export const GET: APIRoute = ({ site }) => {
  const base = (site ?? new URL('https://rutafuel.es/')).toString().replace(/\/$/, '');
  const lastmod = (resumen.sourceUpdatedAt ?? resumen.generatedAt).slice(0, 10);
  const paths = [
    '/',
    ...provincePages.map((page) => page.url),
    ...municipalityPages.map((page) => page.url),
  ];
  const entries = paths
    .map((path) => `  <url><loc>${base}${path}</loc><lastmod>${lastmod}</lastmod></url>`)
    .join('\n');
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;

  return new Response(body, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
