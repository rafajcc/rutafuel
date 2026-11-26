# RutaFuel

Plataforma estática para comparar precios de carburantes y puntos de recarga eléctrica en España.
El proyecto sigue un desarrollo por hitos: **están implementados el HITO 1 (proyecto base y
carburantes), el HITO 2 (ingesta de recarga), el HITO 3 (comparador de carburantes), el HITO 4
(comparador eléctrico), el HITO 5 (planificador de rutas) y el HITO 6 (optimización, automatización
y preparación de despliegue)**.

Sitio publicado: **https://rutafuel-6pz.pages.dev/** (Cloudflare Pages, sin dominio propio).

## Requisitos

- Node.js >= 22.23.4 (ver `.nvmrc`). El repositorio incluye `node` como dependencia de desarrollo
  para que los scripts `npm run ...` usen esa versión aunque el Node del sistema sea anterior.
- npm >= 9.6.5.

## Comandos

```bash
npm install
npm test          # pruebas unitarias (sin red)
npm run check     # comprobación de tipos de Astro/TypeScript
npm run ingest    # descarga real, normalización, validación y escritura atómica
npm run dev       # servidor de desarrollo (prepara public/data antes de arrancar)
npm run build     # prepara public/data y genera el sitio estático en dist/
npm run verify:dist # comprueba SEO, presupuesto de assets, datos públicos y .htaccess
```

Opciones de ingesta (útiles para reproducir o depurar sin depender de la red):

```bash
npx tsx scripts/fetch-data.ts --input ruta/a/respuesta-minetur.json
npx tsx scripts/fetch-data.ts --ripree-input ruta/instalaciones.csv --no-ocm --dry-run
npx tsx scripts/fetch-data.ts --ocm-input ruta/pois.json --dry-run
npx tsx scripts/fetch-data.ts --data-dir ruta/a/salida --dry-run
```

- `--input` / `--url`: respuesta guardada o URL alternativa de MINETUR.
- `--ripree-input` / `--ripree-url`: CSV guardado o endpoint alternativo de RIPREE.
- `--ocm-input`: array de POIs guardado, para probar la normalización sin credenciales.
- `--no-ocm`: omite Open Charge Map explícitamente.
- `--skip-minetur` / `--skip-ripree` / `--skip-ocm`: refresco parcial; reutiliza el maestro y la
  procedencia anteriores sin volver a descargar esa fuente. Requiere un dataset previo válido.
- `--dry-run`: valida y genera todo sin escribir.
- `--clave=valor` (en lugar de `--clave valor`) evita problemas de argv en Windows.

La URL de MINETUR se puede sobrescribir con `--url <url>`. Si falla una fuente obligatoria o la
validación crítica, el pipeline se detiene y **no modifica** los datos anteriores.

`npm run dev` y `npm run build` ejecutan `scripts/prepare-web-data.ts` mediante los hooks `predev` y
`prebuild`: copian a `public/data/` una versión ligera de los índices por provincia y municipio (sin
`raw`) de carburantes y recarga, el buscador de localidades, `cargadores/buscador.json` y la rejilla
espacial `rutas/estaciones.json`. Ese directorio
es generado y está ignorado por Git; se reconstruye siempre desde `src/data`, que sigue siendo la
fuente de verdad para el build.

## Configuración

Copia las variables que necesites a `.env`:

```bash
SITE_URL=https://rutafuel-6pz.pages.dev
OCM_API_KEY=          # opcional
```

- `SITE_URL` se usa para canonical, `og:url`, JSON-LD, `sitemap.xml` y `robots.txt`. El valor actual
  es el del sitio publicado; sustitúyelo solo si despliegas en otro hostname (por ejemplo, un dominio
  propio en Plesk). No se usa `CF_PAGES_URL`: es la URL efímera del deployment y cambia en cada build.
- `OCM_API_KEY` se usa **solo en la ingesta** y se envía como cabecera `X-API-Key` a Open Charge Map.
  Nunca se escribe en el repositorio, en la URL ni en los JSON públicos. Sin clave, la fuente se omite
  de forma segura y `metadata.json` lo indica con `status: "skipped"`. Con clave configurada, un fallo
  de descarga detiene la ingesta.

## Fuentes y trazabilidad

- **Gasolineras**: API REST oficial del Ministerio para la Transición Ecológica
  (`EstacionesTerrestres`). Se conserva `IDEESS` como identificador estable, los valores originales
  de coordenadas y precios en `raw` (auditoría), y la fecha declarada por la fuente en `metadata.json`.
  Los precios se normalizan a `number` (coma decimal española); un precio ausente es `null`, nunca `0`.
  Se descartan registros sin `IDEESS`, sin municipio/provincia o con coordenadas fuera de España.
  `sourceUpdatedAt` es ISO **sin offset** porque la API publica hora local peninsular.

- **RIPREE**: exportación consolidada del Ministerio (`POST` que devuelve CSV UTF-16LE de 29
  columnas). El parser respeta comillas dobles, `\"` escapadas y saltos de línea dentro de campos;
  las filas con otro número de columnas se descartan y se contabilizan. Los valores `="38,3466"` y
  `350,00 kW` se interpretan como número. Cada instalación se construye a partir de todas sus filas
  de conector, con `COD.INSTALACION` como ID oficial: `RIPREE-<codigo>` es el ID interno. La fecha
  de actualización se toma del campo de la fuente, no de la descarga.

- **Open Charge Map**: `/v3/poi/` con `countrycode=ES`, `output=json`, `compact=false`,
  `verbose=false` y `client=rutafuel`. El ID interno es `OCM-<ID>`; se conservan el proveedor de
  datos y su licencia como atribución en `sources`. Solo se publican POIs con `IsLive` distinto de
  `false`. La clave viaja exclusivamente en la cabecera `X-API-Key`.

- **Recarga**: `status: "unknown"` y `accessibility: "unknown"` significan que la fuente no permite
  afirmar disponibilidad o acceso público. `NODISPONIBLE` en `ACCESIBILIDAD` nunca se traduce como
  acceso público. Los IDs `provinceId`/`municipalityId` de recarga se derivan de slugs del nombre y
  **no son códigos INE oficiales** (RIPREE no los publica). Las dudas de normalización se registran
  como avisos deduplicados en la salida de la ingesta.

- **Deduplicación**: primero por referencia oficial compartida; después por proximidad ≤ 75 m con
  nombre o dirección compatible **y** al menos un tipo de conector común. Se conserva la procedencia
  de ambas fuentes y se fusionan conectores y potencias sin borrar el ID oficial de cada una.

## Estructura de datos generada

```
src/data/
├── metadata.json                       # versión 2, fechas, conteos, fuentes y validación
├── estadisticas/
│   ├── provincias.json
│   ├── municipios.json
│   ├── resumen.json
│   └── cargadores.json                 # totales, potencias, conectores y calidad
├── buscador/
│   └── municipios.json                 # nombre, provincia, slug, CPs y centroide derivado
├── gasolineras/
│   ├── estaciones.json
│   ├── indice.json
│   ├── provincias/<id>.json
│   └── municipios/<idProv>/<idMun>.json
├── cargadores/
│   ├── estaciones.json                 # dataset completo de recarga (con `raw` y `sources`)
│   ├── indice.json                     # provincias y municipios con recuentos, potencia y centroide
│   ├── provincias/<id>.json            # estaciones ligeras de esa provincia
│   └── municipios/<idProv>/<idMun>.json
└── rutas/
    └── estaciones.json                 # rejilla de 0,25° con registros mínimos para el planificador
```

`metadata.sources` mantiene MINETUR en primer lugar por compatibilidad con la portada actual.

## Comparador de carburantes (HITO 3)

- **Portada (`/`)**: buscador por nombre de localidad o código postal, botón de geolocalización,
  enlaces a la localidad más barata, resumen de precios y estado de actualización. El tipo de energía
  y el combustible se guardan en `localStorage` (`rf-mode`, `rf-fuel`, `rf-charge`).
- **Páginas geográficas**: 52 provincias y 1.080 municipios. Solo se generan municipios con al menos
  3 estaciones y 2 precios publicados de gasolina 95, para evitar páginas indexables vacías. El HTML
  incluye ranking, estadísticas, texto original, enlaces internos, breadcrumbs y JSON-LD
  (`BreadcrumbList` + `GasStation`). El cliente solo ordena/filtra y dibuja el mapa.
- **Comparador**: carga únicamente el JSON de la provincia o municipio visitado desde `public/data`.
  Ordena por precio, distancia (Haversine) o precio dentro de un radio (5/10/25/50 km). La escala de
  colores verde/ámbar/rojo se calcula con cuartiles sobre las estaciones visibles. La preferencia de
  orden se guarda en `rf-sort`. Sin geolocalización se usa el centroide del municipio, que puede
  sustituirse por `?lat=<lat>&lon=<lon>`.
- **Mapa**: Leaflet y su CSS se importan dinámicamente al pulsar «Ver en el mapa». Marcadores
  `divIcon` con precio, agrupación por rejilla cuando hay muchos puntos y proveedor de teselas
  configurable en `TILE_PROVIDERS` (`osm` por defecto). Enlaces externos a Google Maps y Waze.
- **SEO técnico**: `sitemap.xml`, `robots.txt`, canonical, Open Graph, metadatos por página y datos
  estructurados. Modo claro/oscuro y huecos `data-ad-slot` con altura reservada.
## Comparador eléctrico (HITO 4)

- **Portada (`#recarga`)**: el modo eléctrico busca municipios con cargadores desde
  `data/cargadores/buscador.json`, permite geolocalización y guarda el tipo de recarga en
  `rf-charge`. Al entrar en una página de recarga se aplica esa preferencia.
- **Páginas geográficas**: 51 provincias y 867 municipios. Solo se generan municipios con al menos
  3 instalaciones, potencia máxima conocida y centroide válido. Incluyen ranking por potencia,
  estadísticas reales, distribución de conectores, enlaces internos, breadcrumbs y JSON-LD
  (`BreadcrumbList` + `ElectricVehicleChargingStation`). Están en `sitemap.xml`.
- **Comparador**: carga solo el JSON de la provincia o municipio visitado. Ordena por distancia
  (Haversine) o mayor potencia; filtra por tramo (lenta < 22 kW, rápida 22–<150 kW, ultrarrápida
  ≥ 150 kW), potencia mínima, conector y operador. El origen puede fijarse con `?lat=&lon=`.
- **Estado**: el filtro de estado solo se muestra si existe algún estado conocido con fecha dentro
  de 365 días respecto a `cargadores.sourceUpdatedAt`. Con los datos reales casi todos son
  `unknown`, así que la interfaz dice explícitamente que no se muestra disponibilidad.
- **Mapa**: `createChargingMap()` reutiliza Leaflet y su carga diferida. Iconos por tramo de potencia,
  popups con potencia/conectores/operador y enlaces a Google Maps y Waze. Agrupación por rejilla con
  muchos marcadores y proveedor de teselas configurable en `TILE_PROVIDERS`.
- **Datos publicados**: los índices llevan procedencia resumida (sin URLs sensibles), conectores,
  potencia y `updatedAt`, pero nunca `raw`. La ingesta valida su coherencia antes de escribir.

## Planificador de rutas (HITO 5)

- **Página (`/ruta/`)**: origen y destino, tipo de energía, combustible o tramo/potencia mínima de
  recarga y radio máximo de desviación (2/5/10/20 km). Enlazada desde la portada y `sitemap.xml`.
  Las preferencias se guardan en `localStorage` (`rf-route-*`).
- **Geocodificación**: por defecto se usa el buscador local `buscador/municipios.json`, sin peticiones
  externas; también se admiten coordenadas «lat, lon». Nominatim solo se consulta al pulsar
  «Buscar dirección con Nominatim»: sin autocompletado, `limit=1`, `countrycodes=es`, caché de 30 días
  en `localStorage` e intervalo mínimo de 1100 ms entre peticiones. Se muestra atribución a
  OpenStreetMap. La interfaz `GeocodingService` permite cambiar de proveedor.
- **Enrutado**: `RoutingService` con adaptador OSRM inyectable (`baseUrl` y `profile`). Se pide
  `overview=full&geometries=polyline&steps=false`; la polyline se decodifica sin dependencias.
  El servidor público de OSRM es solo de demostración: en producción debe configurarse una instancia
  propia mediante `createOsrmRoutingService({ baseUrl })`.
- **Estaciones en ruta**: la ingesta genera `rutas/estaciones.json`, una rejilla de celdas de 0,25°
  con 11.546 gasolineras y 12.150 cargadores (927 celdas). El cliente descarga ese único fichero bajo
  demanda y explora solo las celdas del corredor. La geometría se muestrea cada 1 km, se calcula la
  distancia real a la polilinea y se ordena por kilómetro acumulado desde el origen. El desvío es una
  estimación de ida y vuelta, no un cálculo de conducción.
- **Resultados y mapa**: tabla con kilómetro de ruta, distancia al trazado, desvío estimado, precio o
  potencia y enlaces a Google Maps/Waze. Leaflet se carga dinámicamente al pulsar «Ver en el mapa» y
  dibuja la polilinea junto a las estaciones. No se muestra disponibilidad ni precio en tiempo real.

## Automatización y despliegue (HITO 6)

- `.github/workflows/update-data.yml` programa la ingesta de gasolineras cada 2 h y la de recarga a
  las 03:30 UTC, admite ejecución manual (`fuel`, `charging`, `all`) y solo crea commit cuando
  `src/data` cambia. Las fuentes omitidas se reutilizan del dataset anterior; la validación crítica
  y la escritura atómica siguen siendo la puerta de salida.
- `OCM_API_KEY` se configura como secreto de GitHub Actions (nunca en el repositorio). `SITE_URL`
  controla canonical, `og:url`, JSON-LD, sitemap y robots; en Cloudflare se define en Production y
  Preview con `https://rutafuel-6pz.pages.dev`.
- El mismo `dist/` sirve para **Apache/Plesk** y **Cloudflare Pages**: incluye `public/.htaccess`
  (compresión, caché por tipo, seguridad y sin listados) y `public/_headers` (caché inmutable para
  assets con hash, caché corta para JSON, `noindex` en previews). Cada servidor usa el suyo.
  El procedimiento completo está en [`docs/despliegue.md`](docs/despliegue.md).
- `npm run verify:dist` comprueba el resultado: SEO, presupuesto de JS/CSS, ausencia de `raw` en los
  JSON públicos, rejilla de rutas y las configuraciones de Apache y Cloudflare Pages.

## Arquitectura

La información detallada de decisiones, modelos y umbrales de validación está en
[`docs/arquitectura.md`](docs/arquitectura.md).

## Estado y siguientes hitos

- [x] HITO 1 — Astro + TypeScript + Tailwind, ingesta y normalización de gasolineras, índices,
      estadísticas, pruebas y build estático.
- [x] HITO 2 — RIPREE + Open Charge Map, deduplicación con procedencia, JSON versionado, pruebas
      e ingesta validada. La llave de OCM es opcional; sin ella la fuente se omite.
- [x] HITO 3 — Comparador de carburantes: portada, buscador, geolocalización, páginas SEO de
      provincias/municipios, ranking, filtros en cliente y mapa diferido. 59 pruebas, `check` y
      `build` correctos (1.133 rutas).
- [x] HITO 4 — Comparador eléctrico: páginas SEO, mapa de cargadores, filtros de potencia y
      conectores, listados y buscador eléctrico en portada. 67 pruebas, `check` y `build` correctos
      (2.051 rutas).
- [x] HITO 5 — Planificador de rutas: geocodificación local/Nominatim, OSRM inyectable, rejilla
      espacial y estaciones ordenadas sobre la geometría real. 78 pruebas, `check` y `build` correctos
      (2.052 rutas).
- [x] HITO 6 — Refresco parcial, GitHub Actions con validación y commit automático, despliegue dual
      Apache/Plesk + Cloudflare Pages y `verify:dist`. 85 pruebas, `check`, `build` (2.053 rutas con
      los datos actuales) y verificación final (30/30 comprobaciones) correctos.

Pendiente para producción: verificación de Open Charge Map con una `OCM_API_KEY` real (sin clave la
fuente queda registrada como `skipped`), prueba de los proveedores externos con endpoints propios y
decisión del proveedor de teselas. El demo público de OSRM/Nominatim y las teselas de OpenStreetMap
son de uso limitado: no deben emplearse en un despliegue comercial sin alternativa configurada.

## Aviso

Los precios son orientativos y pueden no coincidir con el precio final en estación. Los datos de
recarga no representan disponibilidad en tiempo real. No se publican valoraciones ni datos de
Afiliados en esta fase.
