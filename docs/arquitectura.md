# Decisiones de arquitectura

## Alcance actual (HITO 6)

Sitio estático generado con Astro, sin backend. El navegador no necesita Node.js para funcionar; la
ingesta se ejecuta en Node.js y produce JSON versionado que se publica junto al sitio. El HITO 3 añadió
la interfaz de carburantes, el HITO 4 la de recarga y el HITO 5 el planificador de rutas: portada con
ambos buscadores, páginas SEO, comparadores en cliente, mapa Leaflet bajo demanda y `/ruta/` con
geocodificación, enrutado y estaciones sobre la geometría real. El HITO 6 añade refresco parcial,
GitHub Actions, verificación del build y configuración para Apache/Plesk y Cloudflare Pages.

## Stack y versiones

- Astro 7 (SSG), TypeScript estricto y Tailwind 4 (plugin de Vite).
- `tsx` para ejecutar scripts TypeScript sin configuración adicional.
- Pruebas con `node:test` (incluido en Node.js) y `yaml` para validar el parseo del workflow de
  GitHub Actions: un YAML inválido degradaba el run a «No jobs were run» y dejaba sin registrar los
  cron de ingesta.
- Leaflet 1.9 y `@types/leaflet` son las únicas dependencias nuevas del HITO 3; los hitos 4 y 5 las
  reutilizan sin añadir paquetes. `sitemap.xml` y `robots.txt` son endpoints de Astro: no se añade
  ningún plugin de SEO.
- RBush/Turf y proveedores de geocodificación/enrutado **no se instalan**: se decodifica la polyline y
  se consulta una rejilla propia con código sin dependencias (ver «Planificador de rutas»).
- El HITO 6 añade únicamente `yaml` (dependencia de desarrollo) para el test de parseo del workflow;
  GitHub Actions usa las acciones oficiales de checkout/setup-node y `verify:dist` es un script `tsx`
  con módulos de Node.

Astro 7 exige Node >= 22.23.4. Se fija esa versión en `.nvmrc` y se añade `node` como dependencia
de desarrollo para que los scripts funcionen también en entornos con Node del sistema anterior.

## Modelo de datos de carburantes

Campos mapeados desde la respuesta real (verificada contra la API el 26/11/2026):

| Modelo | Campo de la API | Notas |
| --- | --- | --- |
| `id` | `IDEESS` | Identidad estable entre actualizaciones |
| `name` | `Rótulo` | Opcional si está vacío |
| `address` | `Dirección` | Opcional |
| `locality` | `Localidad` | Opcional |
| `municipality` / `municipalityId` | `Municipio` / `IDMunicipio` | Slug = nombre + ID |
| `province` / `provinceId` | `Provincia` / `IDProvincia` | Nombre humanizado; slug = nombre + ID |
| `postalCode` | `C.P.` | Se conserva el texto original (puede tener ceros a la izquierda) |
| `lat` / `lon` | `Latitud` / `Longitud (WGS84)` | Coma decimal → `number` |
| `schedule` | `Horario` | Texto original; no se interpreta como disponibilidad |
| `prices.g95`…`glp` | 5 campos `Precio ...` | `null` si el campo está vacío o es inválido |
| `raw` | valores originales | Auditoría de precios y coordenadas |

Rangos y reglas:

- Precio razonable: 0,5 – 3,5 €/l. Valores fuera de rango se convierten a `null` y generan aviso.
- Coordenadas válidas: latitud 26 – 44,5 y longitud −19 – 5,5 (cubre Península, Baleares,
  Canarias, Ceuta y Melilla). Se descartan `(0,0)` y valores como latitud negativa detectados en la
  fuente real.
- No se fusionan estaciones con distinto `IDEESS`; los duplicados por ID se cuentan y se conserva el
  primer registro.

## Ingesta de RIPREE

- Endpoint real: `POST https://energia.serviciosmin.gob.es/Ripree/ExportarInstalaciones/GenerarExcel`
  con cuerpo `{"model":null,"soloConsolidado":true}`. Devuelve `text/csv` en UTF-16LE con 29
  columnas. El fichero bajado el 26/11/2026 tenía 43.262 filas, 12.150 instalaciones y 36.052
  puntos; las cifras antiguas (18.456/5.307) procedían de un parser que partía mal las comillas.
- El parser (en `scripts/lib/ripree.ts`) usa `;`, comillas dobles dobladas (`""`), comillas escapadas
  con `\"` y saltos de línea dentro de campos. Una fila con un número de campos distinto de 29 se
  descarta y se contabiliza en `metadata` y en las estadísticas de calidad; no se intenta reparar.
- RIPREE exporta fórmulas de Excel (`=39.5`, `=07011`, `="38.3466000"`, `=DESCONOCIDO`). Se elimina
  el prefijo `=` y el envoltorio de comillas; la coma decimal y las unidades (`kW`, `V`, `A`) se
  convierten a `number`. La longitud puede ser negativa, a diferencia del parser de carburantes.
- Se agrupa por `COD.INSTALACION`. El ID oficial se mantiene en `officialId` y el interno es
  `RIPREE-<codigo>`. Cada fila de conector añade su punto (`ID. PUNTO DE RECARGA`,
  `COD. PUNTO DE RECARGA`) y su conector; los duplicados exactos de conector se colapsan.
- `ESTATUS` está vacío en casi todas las filas y `ACCESIBILIDAD` es `NODISPONIBLE` en la mayoría.
  Por eso `status` y `accessibility` son `unknown` salvo que la fuente afirme lo contrario. `SI` →
  `yes`, `NO` → `no`, `NODISPONIBLE` → `unknown` (nunca `yes`). `OPERATIVO` → `operational`.
- Los códigos de conector observados se mapean a un tipo normalizado, conservando siempre `rawType`
  y el resto de campos originales en `raw.ripree.puntos`. Los tipos no reconocidos generan un aviso
  deduplicado y se publican como `UNKNOWN`.
- RIPREE no publica códigos INE: `provinceId`/`municipalityId` se derivan de slugs y se documentan
  como identificadores internos, no oficiales.

## Ingesta de Open Charge Map

- Endpoint documentado: `GET https://api.openchargemap.io/v3/poi/` con `output=json`,
  `countrycode=ES`, `maxresults=100000`, `compact=false`, `verbose=false` y `client=rutafuel`.
- La credencial se envía como cabecera `X-API-Key` (nunca `?key=`). Sin `OCM_API_KEY` la fuente se
  omite con un aviso y `metadata.json` registra `status: "skipped"`. Con clave configurada, un fallo
  de descarga detiene la ingesta: no se publica un dataset parcial.
- Se valida la forma de la respuesta antes de normalizar: debe ser un array y la mayoría de los POIs
  de muestra deben tener `AddressInfo`. Un cambio de esquema falla cerrado.
- Se descartan POIs sin ID, sin coordenadas válidas, sin municipio/provincia y los que declaran
  `SubmissionStatus.IsLive === false`. Los IDs duplicados se cuentan y se conserva el primero.
- Se conserva `DataProvider.Title` y `License` en `sources` para cumplir la atribución. El ID interno
  es `OCM-<ID>` y `officialId` mantiene el ID original. OCM no acredita acceso público, por lo que
  `accessibility` siempre es `unknown`.

## Modelo de datos de recarga

| Modelo | Origen | Notas |
| --- | --- | --- |
| `id` | `RIPREE-<codigo>` / `OCM-<id>` | ID interno estable; `officialId` guarda el de la fuente |
| `source` / `sources` | fuente dominante / todas | Cada entrada incluye URL, fecha y, si aplica, proveedor y licencia |
| `name`, `address`, `postalCode` | campos oficiales | Opcionales; se omite la clave si está vacía |
| `provinceId`, `municipalityId` | slugs derivados | Internos, **no** códigos INE oficiales en recarga |
| `lat` / `lon` | campos oficiales | Coma decimal en RIPREE, número en OCM |
| `status` | `ESTATUS` / `StatusType` | `unknown` cuando la fuente no lo afirma |
| `accessibility` | `ACCESIBILIDAD` | `NODISPONIBLE` se convierte en `unknown` |
| `connectors[]` | filas de conector / `Connections[]` | `rawType`, tipo normalizado, modo, formato, potencia y `sources` |
| `maxPowerKw`, `pointCount`, `pointIds` | agregación | Potencia máxima y puntos declarados por la fuente |
| `updatedAt`, `updatedAtRaw` | fecha de la fuente | ISO sin offset en RIPREE, ISO con `Z` en OCM |
| `raw` | valores originales | Auditoría de cada punto de RIPREE y metadatos de OCM |

La potencia no se inventa: si la fuente no la declara, `powerKw`/`maxPowerKw` son `null`.

## Deduplicación de recarga

1. Coincidencia exacta por referencia oficial: ID de instalación, ID/código de punto de RIPREE o
   `DataProvidersReference`/`OperatorsReference` de OCM (normalizando acentos y mayúsculas).
2. Si no hay coincidencia exacta, se buscan candidatos a ≤ 75 m (Haversine) en cubetas de 0,01°.
   Se exige además nombre o dirección compatible y al menos un tipo de conector común. Si el
   operador está declarado por ambas fuentes y difiere, no se fusionan.
3. Al fusionar se conserva el ID de RIPREE como principal, se unen `sources`, conectores y puntos,
   se toma la potencia máxima y la fecha más reciente. `status` de la fuente principal se mantiene
   salvo que sea `unknown`, en cuyo caso se usa el de la otra fuente.

El criterio es deliberadamente conservador: ante la duda se conservan dos registros con su
procedencia en lugar de perder información.

## Salida e índices

`gasolineras/estaciones.json` y `cargadores/estaciones.json` contienen los datasets completos y se
usan en el build para páginas estáticas. Para el navegador se generan índices por provincia y
municipio con los registros completos de ese ámbito. `gasolineras/indice.json` y
`cargadores/indice.json` son catálogos ligeros con identificadores, nombres, slugs, recuentos,
potencia máxima y centroide calculado de las estaciones. `estadisticas/cargadores.json` resume
totales, potencias, conectores y calidad. `metadata.json` usa `DATA_VERSION = 2` y mantiene MINETUR
como primera fuente por compatibilidad con la portada.

En el HITO 4 se añaden `cargadores/provincias/<id>.json` y
`cargadores/municipios/<provincia>/<id>.json`. Cada índice incluye `stationCount`, `pointCount`,
`maxPowerKw`, `center` y estaciones ligeras: conservan `officialId`, conectores, potencia, `updatedAt`
y procedencia resumida (`source` + `id` + fecha), pero nunca `raw` ni URLs con credenciales. El
centroide es aritmético sobre las estaciones reales, no una ubicación oficial.

## Índice de búsqueda y copia web (HITO 3)

- `scripts/lib/search-index.ts` deriva `buscador/municipios.json` de los índices oficiales: nombre,
  provincia, slug, número de estaciones, códigos postales presentes y centroide aritmético de las
  estaciones con coordenadas. El centroide es un dato calculado, no una ubicación oficial.
- La validación `buscador-coherente` comprueba que el índice no está vacío y que toda entrada tiene
  nombre, provincia y coordenadas finitas; la ingesta incluye el fichero en la escritura atómica.
- `scripts/prepare-web-data.ts` (hooks `predev`/`prebuild`) copia `src/data` a `public/data` sin el
  campo `raw` y solo para provincias y municipios con estaciones. El navegador descarga así el índice
  de la página visitada (el de Barcelona tiene cientos de estaciones, no las 11.546 de España).
  `public/data/` es generado y está ignorado por Git; `src/data` permanece como fuente de verdad.
- La normalización de texto para búsquedas vive por duplicado en `scripts/lib/search-index.ts` y
  `src/lib/search.ts`. Es intencionado: mantiene desacoplados el pipeline y el navegador con la misma
  regla (NFD, sin diacríticos, minúsculas, caracteres no alfanuméricos → espacio).
- `cargadores/buscador.json` se deriva de `cargadores/indice.json` con el mismo criterio de páginas
  (≥ 3 instalaciones y centroide válido). La portada lo usa para sugerir municipios con cargadores y
  para elegir el más cercano con geolocalización.

## Páginas, comparador y mapa (HITO 3)

- `getStaticPaths()` genera 52 páginas de provincia y 1.080 de municipio. El umbral de municipio es
  `stationCount >= 3` y `prices.g95.count >= 2`; evita páginas indexables con información insuficiente.
  El HTML contiene ranking (top 10 por G95), estadísticas, comparación con la media provincial o
  nacional, enlaces a localidades cercanas (Haversine sobre centroides), breadcrumbs y JSON-LD.
- `src/lib/pages.ts` centraliza los umbrales y construye los descriptores usados tanto por las Rutas
  como por `sitemap.xml`, de modo que no se anuncie una URL que no se genera.
- `src/lib/read-data.ts` lee los índices desde `process.cwd()/src/data`: durante el prerenderizado
  `import.meta.url` apunta a `dist/.prerender`, por lo que usarlo provocaría `ENOENT`.
- El ranking es HTML estático (SEO y resiliencia sin JS). El JS de `src/scripts/comparador.ts` solo
  ordena por precio, distancia o precio en radio, y colorea con cuartiles calculados sobre los
  establecimientos visibles (`src/lib/colors.ts`). Sin permiso de geolocalización se usa el centro
  calculado y se admite `?lat=&lon=` para fijar el origen. Preferencias en `localStorage`
  (`rf-mode`, `rf-fuel`, `rf-charge`, `rf-sort`).
- Leaflet y su CSS se importan dinámicamente al pulsar «Ver en el mapa» (`src/scripts/mapa.ts`). Los
  marcadores son `divIcon` (sin imágenes externas), se agrupan en celdas de 0,02° con más de 120
  estaciones y zoom bajo, y el proveedor de teselas se elige en `TILE_PROVIDERS` (solo `osm` por
  ahora). Cambiar de proveedor no obliga a reescribir marcadores ni filtros. La atribución de
  OpenStreetMap se muestra en el mapa.
- La portada usa el mismo índice ligero para sugerir localidades y, con geolocalización, elegir la
  más cercana. El ancla `#recarga` abre directamente el modo eléctrico.

## Páginas, comparador y mapa de recarga (HITO 4)

- `getStaticPaths()` genera 51 páginas de provincia y 867 de municipio con los slugs del dataset de
  recarga (distintos de los de gasolineras). El umbral de municipio es `stationCount >= 3`,
  `maxPowerKw !== null` y centroide finito; no se crean páginas indexables con datos insuficientes.
- `src/lib/charging-pages.ts` centraliza los descriptores compartidos entre las rutas y
  `sitemap.xml`, igual que `src/lib/pages.ts` hace para carburantes. Las URLs nuevas se añaden al
  sitemap con la fecha más reciente entre ambas fuentes.
- `src/lib/charging.ts` contiene la lógica pura: tramos de potencia (lenta `< 22`, rápida
  `22–<150`, ultrarrápida `>=150` kW), filtros por tramo, potencia mínima, conector, operador,
  radio y estado, y ordenación por distancia o potencia con desempate estable. Etiquetas de conector
  son convenciones de nombre; el tipo original se conserva siempre en los datos.
- El filtro de estado solo se ofrece si hay algún `status` conocido con `updatedAt` dentro de 365
  días respecto a `cargadores.sourceUpdatedAt`. En el dataset real 12.114 de 12.150 estaciones son
  `unknown`, así que la interfaz indica explícitamente que no se muestra disponibilidad; nunca se afirma que un
  registro esté operativo por defecto.
- `src/components/ChargingComparador.astro` y `src/scripts/charging-comparador.ts` filtran y ordenan
  en cliente sobre el JSON de la página. Sin geolocalización se usa el centroide del ámbito y se
  admite `?lat=&lon=`. Las preferencias `rf-charge` y `rf-sort` se guardan en `localStorage`.
- `createChargingMap()` en `src/scripts/mapa.ts` comparte proveedor de teselas y carga diferida de
  Leaflet con el mapa de carburantes. Usa `divIcon` con color por tramo, popups con potencia,
  conectores, operador y estado solo cuando es reciente, y agrupación por rejilla con muchos puntos.
- El JSON-LD usa `ElectricVehicleChargingStation` dentro de `ItemList`, sin horarios, disponibilidad
  ni valoraciones inferidas; el texto de cada página se deriva de los índices reales.

## Planificador de rutas (HITO 5)

- **Rejilla en lugar de RBush/Turf**: `scripts/lib/route-index.ts` genera `rutas/estaciones.json`, una
  rejilla de celdas de 0,25° (≈ 28 km en latitud). El navegador descarga un único fichero bajo demanda
  y `cellIdsWithin()` explora solo las celdas del corredor (radio máximo 20 km). Con 11.546
  gasolineras y 12.150 cargadores el fichero ocupa ~5 MB; un índice espacial con librería o un fichero
  por estación añadiría dependencias y peticiones sin beneficio para este patrón de consulta.
- **Registros mínimos**: cada entrada guarda `id`, coordenadas, nombre, municipio, provincia y solo
  los campos que la búsqueda necesita (precios publicados no nulos; potencia, conectores y operador en
  recarga). No incluye `raw`, `sources` ni URLs de auditoría, que se mantienen en `src/data` para la
  procedencia completa. Las coordenadas inválidas se omiten y los conectores se deduplican.
- **Geocodificación desacoplada**: `GeocodingService.geocode(query)` es el contrato. Por defecto se
  usa `createLocalGeocoder()` sobre `buscador/municipios.json` (sin red) y se admiten coordenadas
  literales «lat, lon». `createNominatimGeocoder()` solo se invoca al pulsar explícitamente
  «Buscar dirección con Nominatim»: sin autocompletado, `limit=1`, `countrycodes=es`,
  `accept-language=es`, caché en `localStorage` con TTL de 30 días e intervalo mínimo de 1100 ms
  entre peticiones. Se muestra atribución a OpenStreetMap y el adaptador es sustituible.
- **Enrutado desacoplado**: `RoutingService.calculateRoute(origin, destination)` es el contrato;
  `createOsrmRoutingService()` acepta `baseUrl`, `profile` y `fetchImpl` inyectables. Se pide
  `overview=full&geometries=polyline&steps=false` y `decodePolyline()` interpreta la polyline de
  precisión 5 sin dependencias. Los fallos se normalizan como `RouteError`. El servidor público de
  OSRM es de demostración: en producción debe configurarse una instancia propia mediante `baseUrl`.
- **Lógica sobre la geometría real** (`src/lib/route.ts`, funciones puras): `sampleRoute()` muestrea la
  polilinea cada 1 km acumulando distancia desde el origen, `nearestOnRoute()` proyecta cada estación
  sobre el trazado y `stationsAlongRoute()` aplica filtros de combustible o tramo de potencia, potencia
  mínima y radio, y ordena por `alongRouteKm` (no por línea recta origen-destino). `detourKm = 2 *
  distanceKm` es una estimación de ida y vuelta, no un cálculo de conducción.
- **Interfaz**: `src/pages/ruta/index.astro` genera `/ruta/` estático para SEO con el formulario, los
  límites y las atribuciones; `src/scripts/ruta.ts` resuelve origen y destino, calcula la ruta, carga
  la rejilla, filtra y renderiza la tabla (kilómetro de ruta, distancia al trazado, desvío, precio o
  potencia y enlaces a Google Maps/Waze). `createRouteMap()` reutiliza la carga diferida de Leaflet y
  dibuja la polilinea con las estaciones. Preferencias en `localStorage` (`rf-route-*`). La página está
  enlazada desde la portada y añadida a `sitemap.xml`.
- **Límites explícitos**: no se muestra disponibilidad ni precio en tiempo real; el radio se limita a
  20 km para no consultar media España; Nominatim y OSRM se prueban solo con `fetchImpl` falso en los
  tests, y sus endpoints públicos son de uso limitado, no aptos para producción.

## Automatización, rendimiento y despliegue (HITO 6)

- **Refresco parcial**: `--skip-minetur`, `--skip-ripree` y `--skip-ocm` reutilizan el maestro y la
  procedencia del dataset anterior. `scripts/lib/reuse.ts` concentra esa lógica: exige un
  `metadata.json` previo, lee los maestros, reconstruye los datos de normalización sin inventar
  descartes y copia la `SourceInfo` original. La validación acepta recuentos de calidad
  (`quality.discarded` / `quality.duplicates`) para conservar las cifras históricas al no volver a
  parsear una fuente. La escritura atómica no cambia.
- **GitHub Actions**: `update-data.yml` programa MINETUR cada 2 h y la ingestión completa a las 03:30
  UTC, con `workflow_dispatch` para elegir `fuel`, `charging` o `all`. Usa `concurrency` para evitar
  ingestas simultáneas, instala con `npm ci` y la versión de `.nvmrc`, exige `npm test` y
  `npm run check`, ejecuta la ingesta, `npm run build` y `npm run verify:dist`, y solo hace commit si
  `src/data` ha cambiado. `OCM_API_KEY` se lee de `secrets` y nunca se escribe en el repositorio.
  El resultado se resume en `$GITHUB_STEP_SUMMARY`.
- **SEO y rendimiento medibles**: `BaseLayout.astro` añade `rel="sitemap"`, `og:locale` y
  `meta robots`, además de canonical, Open Graph, JSON-LD y breadcrumbs ya existentes.
  `scripts/verify-dist.ts` (`npm run verify:dist`) comprueba 30 condiciones: ficheros publicados,
  sitemap y robots, HTML de `/ruta/`, presupuesto de JS inicial (≤ 48 KiB) y CSS (≤ 24 KiB), ausencia
  de Leaflet en el HTML inicial, altura reservada para anuncios, 5.490 JSON sin `raw`, rejilla de
  rutas, cabeceras de Apache y cabeceras de Cloudflare Pages.
- **Despliegue dual**: un único `dist/` sirve para **Apache/Plesk** y **Cloudflare Pages**.
  `public/.htaccess` aporta compresión, caché por tipo, seguridad y ausencia de listados; Apache
  bloquea `_headers`. `public/_headers` hace lo equivalente en Pages: revalidación para HTML, caché
  inmutable para assets con hash, caché de 1 h para JSON, `noindex` en `*.pages.dev` y `detach` de
  `Cache-Control` para no unir directivas conflictivas. Cloudflare ignora `.htaccess`. No se añade
  ningún paso de deploy al workflow: Pages reacciona al push y Plesk recibe el mismo `dist/` por SFTP.
  `docs/despliegue.md` detalla ambos procedimientos, `AllowOverride`, HTTPS, `curl`, secretos y
  recuperación por `git revert`. No se requiere Node.js ni PHP en producción.

## Validación y escritura atómica

Antes de publicar se comprueban: esquema de la respuesta, `ResultadoConsulta`, fecha, registros
mínimos, IDs únicos y presentes, localización, coordenadas, rango de precios, proporción de
descartes/duplicados, variación frente al dataset anterior y coherencia de los ficheros generados.
Para recarga se añaden: registros mínimos, IDs únicos, coordenadas válidas, procedencia presente,
conectores válidos, coherencia del fichero maestro/índice/estadísticas, proporción de filas
malformadas acorde con el volumen, variación frente al dataset anterior y **ausencia de credenciales
en URLs de metadatos**. En el HITO 4 se comprueban además los índices geográficos (`stationCount`
coherente con el maestro, centroides finitos dentro de rango y ausencia de `raw`). En el HITO 5 se
añaden `rutas-indice-generado` (fichero publicado y número de celdas), `rutas-indice-coherente`
(totales de gasolineras y cargadores iguales a los del dataset) y `rutas-celdas-válidas` (claves y
registros con coordenadas finitas y campos admitidos). En el HITO 6, los refrescos parciales pasan
los recuentos históricos de descartes y duplicados mediante `quality`, de modo que reutilizar una
fuente no falsifica las proporciones. Los errores críticos detienen la publicación; los avisos se
registran en `metadata.json`.

La escritura ocurre en `src/.staging-data-*`; tras verificar que cada JSON es parseable y no está
vacío se renombra el directorio anterior a `.backup-data-*`, se coloca el nuevo y se elimina el
backup. Si falla cualquier paso, se restaura el backup. Así una fuente caída nunca deja datos
parciales en `src/data`.

## SEO y contenido

- URLs limpias `/gasolineras/[provincia]/` y `/gasolineras/[provincia]/[municipio]/`, con slugs
  nombre + ID para garantizar unicidad. El ID es el oficial de MINETUR para gasolineras.
- `sitemap.xml` y `robots.txt` son endpoints de Astro que reutilizan los descriptores de páginas y
  la fecha de actualización de la fuente. Canonical y Open Graph se generan en `BaseLayout.astro`.
- JSON-LD: `BreadcrumbList` en cada página jerárquica, `GasStation` para el ranking de carburantes y
  `ElectricVehicleChargingStation` para el de recarga, ambos dentro de `ItemList`. Solo se publican
  campos presentes en el dataset: nunca horarios inferidos, valoraciones, disponibilidad ni precios
  inventados.
- El texto de cada página se calcula desde `estadisticas/`: mínimo y media de G95, media de gasóleo
  A, diferencia con la media nacional/provincial y recuento de estaciones. No se publican páginas de
  municipios sin datos suficientes.
- La URL pública se configura con `SITE_URL` (valor por defecto de ejemplo en `astro.config.mjs`).
  Antes de producción debe establecerse el dominio real para canonical y sitemap.

## Estado actual y límites

- `npm test`: 85 pruebas (22 suites); `npm run check`: 0 errores, 0 avisos, 0 hints;
  `npm run build`: 2.052 rutas (portada, `/ruta/`, 52 provincias y 1.080 municipios de carburantes,
  51 provincias y 867 municipios de recarga, sitemap y robots). `npm run verify:dist`: 30/30
  comprobaciones correctas sobre `dist/` (SEO, presupuesto de assets, datos, Apache y Cloudflare Pages).
- Ingesta real de referencia (26/11/2026): 11.546 gasolineras, 52 provincias, 3.262 municipios,
  12.150 estaciones de recarga y 36.052 puntos; 4 descartes, 0 duplicados y 0 filas RIPREE
  malformadas. La rejilla de rutas contiene 927 celdas (~5 MB) con las tres comprobaciones `rutas-*`
  correctas. Se publican 51 índices de provincia y 2.122 de municipio de recarga, coherentes y sin `raw`.
- OCM sigue en `status: "skipped"` porque no se dispone de `OCM_API_KEY`. No se han validado sus
  respuestas reales; la integración queda preparada pero sin datos de esa fuente.
- Los adaptadores de Nominatim y OSRM se han probado solo con respuestas simuladas. Falta probarlos
  contra endpoints reales y decidir el proveedor de producción antes de publicar `/ruta/`.
- Los precios no son tiempo real: son los declarados en la última publicación oficial. La web muestra
  la fecha de actualización de la fuente y una advertencia explícita.
- Modo claro/oscuro y huecos `data-ad-slot` con altura fija preparan la monetización futura sin
  introducir anuncios ni afiliados en el MVP.

## Despliegue

El resultado de `npm run build` es un directorio `dist/` puramente estático, compatible con
Apache/Nginx gestionados mediante Plesk **y con Cloudflare Pages**. No se requiere Node.js en el
servidor de producción. `OCM_API_KEY` se usa solo durante la ingesta (GitHub Actions o entorno local),
nunca se escribe en el repositorio ni en JSON públicos. `public/.htaccess` y `public/_headers` se
copian a `dist/`; cada plataforma usa el suyo. El procedimiento paso a paso está en
[`despliegue.md`](despliegue.md).
