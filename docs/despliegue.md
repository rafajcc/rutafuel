# Despliegue y automatización

RutaFuel es un sitio estático: **no se ejecuta Node.js en el servidor de producción**. El contenido
de `dist/` se publica tal cual en Apache/Nginx gestionado por Plesk **o en Cloudflare Pages**.
Ambos destinos usan exactamente el mismo build: no hace falta generar dos artefactos distintos.

**Despliegue actual:** `https://rutafuel-6pz.pages.dev/`, publicado con la *Pages Git integration*
desde la rama `main`. No hay dominio propio configurado.

## 1. Generación del sitio

En local o en un runner de CI:

```bash
npm ci
SITE_URL=https://rutafuel-6pz.pages.dev npm run build
npm run verify:dist
```

- `SITE_URL` debe ser la URL pública exacta (sin barra final): `https://rutafuel-6pz.pages.dev`.
  Se usa en canonical, `og:url`, JSON-LD, `robots.txt` y `sitemap.xml`. Si se publica en Plesk con
  dominio propio, sustituir por esa URL. Si no se define, el valor por defecto `https://rutafuel.es`
  es solo un ejemplo y **no** coincide con el sitio publicado.
- `OCM_API_KEY` solo se necesita durante la ingesta; nunca se copia a `dist/`.
- `npm run verify:dist` falla si faltan páginas o cabeceras, si el JS/CSS inicial supera el
  presupuesto, si los JSON públicos incluyen `raw` o si no se han copiado `.htaccess` y `_headers`.

El resultado es `dist/index.html`, las páginas estáticas, `dist/data/`, `dist/.htaccess` (Apache) y
`dist/_headers` (Cloudflare Pages). Cada servidor usa el suyo y ignora el otro.

## 2. Plesk (Apache)

1. Crear el dominio y apuntar el document root al directorio que contenga **el contenido de
   `dist/`** (no al repositorio). Subir por SFTP o rsync; no es necesario PHP.
2. En *Apache & nginx Settings* habilitar `AllowOverride FileInfo` (o el nivel que Plesk denomine
   *FileInfo/All*) para que `.htaccess` pueda definir `Header` y `AddOutputFilterByType`. Si el panel
   no lo permite, trasladar esas directivas a la configuración de Apache del sitio.
3. Activar HTTPS con Let's Encrypt y forzar el redireccionamiento HTTP → HTTPS en Plesk.
4. Comprobar las cabeceras y las rutas clave:

   ```bash
   curl -I https://tu-dominio.es/                       # Cache-Control: max-age=0, must-revalidate
   curl -I https://tu-dominio.es/_astro/mapa.hsTgV1PS.js # max-age=31536000, immutable
   curl -I https://tu-dominio.es/data/buscador/municipios.json # max-age=3600
   curl -fsS https://tu-dominio.es/ruta/ >/dev/null
   curl -fsS https://tu-dominio.es/sitemap.xml | head
   ```

5. Verificar que un directorio sin `index.html` no muestra listado y que el modo claro/oscuro y los
   mapas funcionan en móvil.

### Qué hace `.htaccess`

- `DirectoryIndex index.html` e `IndexIgnore *`: sirve el HTML estático y evita listados.
- Compresión `DEFLATE`/Brotli para HTML, CSS, JS y JSON cuando el módulo está disponible.
- Caché inmutable para assets con hash (`/_astro/*.<hash>.js|css`), caché de 1 h para JSON/XML/TXT
  y revalidación para HTML. Así una actualización de datos no queda oculta por la caché.
- `X-Content-Type-Options`, `Referrer-Policy` y `X-Frame-Options`.

Si se usa Nginx en lugar de Apache, trasladar estas reglas al bloque `server`: `try_files` para las
rutas con barra final, `gzip on`, `expires` por tipo y `add_header` equivalentes.

## 3. Cloudflare Pages

Cloudflare ejecuta `npm run build` y sube `dist/` automáticamente; lee `_headers` e ignora
`.htaccess`. Apache hace exactamente lo contrario: usa `.htaccess` y `_headers` queda bloqueado.

1. En Cloudflare Dashboard → *Workers & Pages* → *Create application* → *Pages* → *Connect to Git* y
   conectar el repositorio de GitHub. No hace falta crear un Worker ni un token de API.
2. Configuración del proyecto:

   | Opción | Valor |
   | --- | --- |
   | Production branch | `main` |
   | Framework preset | **Astro** (o *None* si no aparece) |
   | Build command | `npm run build` |
   | Build output directory | `dist` |
   | Root directory | `/` |
   | Deploy command | **Vacío**: no usar `wrangler deploy` ni `wrangler preview` |
   | Variable de entorno (Production y Preview) | `SITE_URL=https://rutafuel-6pz.pages.dev` |
   | Node | versión de `.nvmrc` (22.23.4); la imagen de build ya la trae, `NODE_VERSION` es opcional |

   `OCM_API_KEY` **no se configura en Pages**: solo se usa durante la ingesta en GitHub Actions.
3. No se añade dominio propio: el sitio se publica solo en `https://rutafuel-6pz.pages.dev/`. Ese
   hostname es el que debe contener `SITE_URL`; el canonical, `og:url`, el JSON-LD, `robots.txt` y el
   sitemap se generan con él.

   **No usar `CF_PAGES_URL` como URL del sitio.** Cloudflare lo inyecta, pero contiene la URL del
   deployment (`https://<hash>.rutafuel-6pz.pages.dev`) y cambia en cada build; usarlo dejaría los
   enlaces canónicos apuntando a una URL efímera que luego desaparece.
4. Cada push a `main` —incluidos los commits del bot de Actions— dispara el build y el despliegue.
   No hace falta añadir un paso de deploy al workflow ni `CLOUDFLARE_API_TOKEN` /
   `CLOUDFLARE_ACCOUNT_ID`.
5. Si un log parece antiguo, comprobar que `HEAD is now at ...` coincide con el SHA esperado. Para
   forzar un rebuild se puede usar *Retry deployment* sobre esa fila o crear un commit vacío:

   ```bash
   git commit --allow-empty -m "ci: fuerza rebuild en Cloudflare Pages"
   git push origin main
   ```

6. Verificación rápida:

   ```bash
   curl -I https://rutafuel-6pz.pages.dev/          # 200 y SIN x-robots-tag: noindex
   curl -fsS https://rutafuel-6pz.pages.dev/ | grep -o 'rel="canonical" href="[^"]*"'
   curl -I https://rutafuel-6pz.pages.dev/_astro/<hash>.js   # max-age=31536000, immutable
   curl -I https://rutafuel-6pz.pages.dev/data/buscador/municipios.json # max-age=3600
   curl -fsS https://rutafuel-6pz.pages.dev/sitemap.xml | head
   curl -I https://<hash>.rutafuel-6pz.pages.dev/    # preview: x-robots-tag: noindex
   ```

Si quieres mantener también Plesk, sube por SFTP **el mismo `dist/`**: no necesitas otro build ni
otras variables.

### Qué hace `_headers`

- `/*`: revalidación para HTML y cabeceras de seguridad para todo.
- `/data/*`: caché de 1 h para los JSON regenerados por la ingesta.
- `/_astro/*`: caché inmutable para assets con hash.
- `! Cache-Control` antes de cada regla específica: Cloudflare une valores repetidos, y sin el
  `detach` las directivas `max-age` entrarían en conflicto.
- `https://:version.:project.pages.dev/*`: `X-Robots-Tag: noindex` **solo en previews**. El hostname
  de producción `rutafuel-6pz.pages.dev` queda indexable; Cloudflare ya marca los previews con
  `noindex` por defecto y esta regla lo hace explícito.

## 4. Actualización automática de datos

`.github/workflows/update-data.yml`:

| Disparador | Fuentes | Argumentos de ingesta |
| --- | --- | --- |
| `cron: 0 */2 * * *` | MINETUR cada 2 h | `--skip-ripree --skip-ocm` |
| `cron: 30 3 * * *` | Completa, diaria | ninguno |
| `workflow_dispatch` (`fuel`) | Solo gasolineras | `--skip-ripree --skip-ocm` |
| `workflow_dispatch` (`charging`) | Recarga (+ OCM si hay clave) | `--skip-minetur` |
| `workflow_dispatch` (`all`) | Completa | ninguno |

Cada ejecución:

1. Instala dependencias con `npm ci` y la versión de `.nvmrc`.
2. Ejecuta `npm test` y `npm run check` antes de tocar datos.
3. Ingesta con validación crítica y escritura atómica. Si falla una fuente obligatoria o una
   comprobación `severity: error`, el pipeline se detiene y los datos anteriores siguen intactos.
4. Genera el sitio y ejecuta `npm run verify:dist`.
5. Solo si `git status --porcelain -- src/data` detecta cambios, crea un commit y hace push.
6. Escribe el modo y el resultado en `$GITHUB_STEP_SUMMARY`; las notificaciones de error se pueden
   configurar en *Settings → Notifications* del repositorio.

La concurrencia está limitada con `concurrency.group = update-data-${{ github.ref }}` y
`cancel-in-progress: false`: una ingesta en curso nunca se cancela a medias.

### Configuración de secretos

En *Settings → Secrets and variables → Actions → New repository secret*:

- `OCM_API_KEY` (opcional): clave gratuita de Open Charge Map. Se envía como cabecera `X-API-Key`.
  Sin ella la fuente queda `status: "skipped"` y el sitio sigue funcionando.

`SITE_URL` no es un secreto: se define como variable de Pages (Production y Preview) con el valor
`https://rutafuel-6pz.pages.dev` o se pasa al build local. Ninguna credencial se escribe en
`src/data` ni en `public/data`.

## 5. Reutilización y recuperación

Las opciones `--skip-minetur`, `--skip-ripree` y `--skip-ocm` reutilizan los maestros y la procedencia
del dataset anterior. Requieren un `metadata.json` válido; si falta, la ingesta falla con un mensaje
explicativo en lugar de publicar un dataset incompleto.

Para revertir una actualización, basta con hacer `git revert` del commit `datos: actualizar ingesta
programada (...)` y reconstruir. La escritura atómica (`staging → backup → swap`) garantiza que una
ejecución local interrumpida no haya dejado datos parciales en `src/data`.

## 6. Límites antes de abrir al público

- El servidor público de OSRM es una demo y Nominatim tiene políticas de uso estricto: configurar
  proveedores propios (o cachear agresivamente) antes de un uso comercial de `/ruta/`.
- Las teselas de OpenStreetMap tienen política de uso; `TILE_PROVIDERS` en `src/scripts/mapa.ts`
  permite cambiar de proveedor sin reescribir marcadores ni filtros.
- La monetización sigue preparada pero inactiva: los huecos `data-ad-slot` tienen altura fija para
  evitar CLS y no influyen en el orden de los resultados.
