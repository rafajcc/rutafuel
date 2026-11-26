import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// La URL pública se configura con SITE_URL en el despliegue.
const site = process.env.SITE_URL || 'https://rutafuel.es';

export default defineConfig({
  site,
  output: 'static',
  vite: {
    plugins: [tailwindcss()],
  },
});
