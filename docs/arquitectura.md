# Decisiones de arquitectura

## Alcance actual (HITO 1)

Sitio estático generado con Astro, sin backend. El navegador no necesita Node.js para funcionar; la
ingesta se ejecuta en Node.js y produce JSON versionado que se publica junto al sitio.

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

## Salida e índices

`gasolineras/estaciones.json` contiene el dataset completo y se usa en build para páginas estáticas.
Para el navegador se generan índices por provincia y municipio con los registros completos de ese
ámbito, de forma que una página pueda cargar solo el subconjunto necesario. `gasolineras/indice.json`
es un catálogo ligero con identificadores, nombres, slugs y recuentos.

El planificador de rutas (HITO 5) añadirá una rejilla espacial con celdas y una interfaz de búsqueda
por geometría. La decisión entre RBush y Turf se tomará cuando se conozca el volumen y el patrón de
consulta; no se añaden dependencias ahora.

## Validación y escritura atómica

Antes de publicar se comprueban: esquema de la respuesta, `ResultadoConsulta`, fecha, registros
mínimos, IDs únicos y presentes, localización, coordenadas, rango de precios, proporción de
descartes/duplicados, variación frente al dataset anterior y coherencia de los ficheros generados.
Los errores críticos detienen la publicación; los avisos se registran en `metadata.json`.

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
Los secretos (por ejemplo, la API Key de Open Charge Map en el HITO 2) se usarán solo en GitHub
Actions y nunca se escribirán en el repositorio ni en JSON públicos.
