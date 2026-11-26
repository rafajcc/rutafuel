# Decisiones de arquitectura

## Alcance actual (HITO 2)

Sitio estático generado con Astro, sin backend. El navegador no necesita Node.js para funcionar; la
ingesta se ejecuta en Node.js y produce JSON versionado que se publica junto al sitio. El HITO 2
añade la ingesta de puntos de recarga (RIPREE y Open Charge Map) y su deduplicación. Los mapas y el
planificador siguen pendientes de los HITOS 3 y 5.

## Stack y versiones

- Astro 7 (SSG), TypeScript estricto y Tailwind 4 (plugin de Vite).
- `tsx` para ejecutar scripts TypeScript sin configuración adicional.
- Pruebas con `node:test` (incluido en Node.js), sin dependencias de test adicionales.
- Leaflet, RBush/Turf y proveedores de mapas/queries externas **no se instalan todavía**: pertenecen
  a hitos posteriores.

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
`cargadores/indice.json` son catálogos ligeros con identificadores, nombres, slugs y recuentos.
`estadisticas/cargadores.json` resume totales, potencias, conectores y calidad. `metadata.json`
usa `DATA_VERSION = 2` y mantiene MINETUR como primera fuente por compatibilidad con la portada.

El planificador de rutas (HITO 5) añadirá una rejilla espacial con celdas y una interfaz de búsqueda
por geometría. La decisión entre RBush y Turf se tomará cuando se conozca el volumen y el patrón de
consulta; no se añaden dependencias ahora.

## Validación y escritura atómica

Antes de publicar se comprueban: esquema de la respuesta, `ResultadoConsulta`, fecha, registros
mínimos, IDs únicos y presentes, localización, coordenadas, rango de precios, proporción de
descartes/duplicados, variación frente al dataset anterior y coherencia de los ficheros generados.
Para recarga se añaden: registros mínimos, IDs únicos, coordenadas válidas, procedencia presente,
conectores válidos, coherencia del fichero maestro/índice/estadísticas, proporción de filas
malformadas acorde con el volumen, variación frente al dataset anterior y **ausencia de credenciales
en URLs de metadatos**. Los errores críticos detienen la publicación; los avisos se registran en
`metadata.json`.

La escritura ocurre en `src/.staging-data-*`; tras verificar que cada JSON es parseable y no está
vacío se renombra el directorio anterior a `.backup-data-*`, se coloca el nuevo y se elimina el
backup. Si falla cualquier paso, se restaura el backup. Así una fuente caída nunca deja datos
parciales en `src/data`.

## SEO y contenido

Las URLs definitivas serán `/gasolineras/[provincia]/` y `/gasolineras/[provincia]/[municipio]/`,
con slugs basados en nombre e ID. El slug lleva el ID para garantizar unicidad aunque dos entidades
compartan denominación. Solo se generarán páginas con datos suficientes; el contenido estático se
calculará a partir de `estadisticas/` y no inventará horarios, disponibilidad ni valoraciones.

La URL pública se configura con `SITE_URL` (valor por defecto de ejemplo en `astro.config.mjs`).
Antes de producción debe establecerse el dominio real para canonical y sitemap.

## Despliegue

El resultado de `npm run build` es un directorio `dist/` puramente estático, compatible con
Apache/Nginx gestionados mediante Plesk. No se requiere Node.js en el servidor de producción.
`OCM_API_KEY` se usa solo durante la ingesta (GitHub Actions o entorno local), nunca se escribe en el
repositorio ni en JSON públicos.
