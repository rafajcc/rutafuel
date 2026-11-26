import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// La URL pública se configura con SITE_URL en el despliegue.
// TEMPORAL: diagnosticar qué valor inyecta Cloudflare Pages en cada build.
const site =
  process.env.SITE_URL || process.env.CF_PAGES_URL || 'https://rutafuel.es';
console.log(
  `[rutafuel-env] SITE_URL=${process.env.SITE_URL ?? '(unset)'} CF_PAGES_URL=${process.env.CF_PAGES_URL ?? '(unset)'} site=${site}`,
);

export default defineConfig({
  site,
  output: 'static',
  vite: {
    plugins: [tailwindcss()],
  },
});
