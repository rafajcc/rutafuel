# RutaFuel

Plataforma estática para comparar precios de carburantes y puntos de recarga eléctrica en España.
El proyecto sigue un desarrollo por hitos: **están implementados el HITO 1 (proyecto base y
carburantes) y el HITO 2 (ingesta de recarga)**. El comparador, los mapas y el planificador
pertenecen a hitos posteriores.

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
npm run build     # genera el sitio estático en dist/
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
- `--dry-run`: valida y genera todo sin escribir.
- `--clave=valor` (en lugar de `--clave valor`) evita problemas de argv en Windows.

La URL de MINETUR se puede sobrescribir con `--url <url>`. Si falla una fuente obligatoria o la
validación crítica, el pipeline se detiene y **no modifica** los datos anteriores.

## Configuración

Copia las variables que necesites a `.env`:

```bash
SITE_URL=https://rutafuel.es
OCM_API_KEY=          # opcional
```

- `SITE_URL` se usa para canonical URLs y futuros sitemaps. Sustituye el dominio de ejemplo por el
  dominio real antes de publicar.
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
├── gasolineras/
│   ├── estaciones.json
│   ├── indice.json
│   ├── provincias/<id>.json
│   └── municipios/<idProv>/<idMun>.json
└── cargadores/
    ├── estaciones.json                 # dataset completo de recarga (con `raw` y `sources`)
    └── indice.json                     # provincias y municipios con recuentos
```

`metadata.sources` mantiene MINETUR en primer lugar por compatibilidad con la portada actual.

## Arquitectura

La información detallada de decisiones, modelos y umbrales de validación está en
[`docs/arquitectura.md`](docs/arquitectura.md).

## Estado y siguientes hitos

- [x] HITO 1 — Astro + TypeScript + Tailwind, ingesta y normalización de gasolineras, índices,
      estadísticas, pruebas y build estático.
- [x] HITO 2 — RIPREE + Open Charge Map, deduplicación con procedencia, JSON versionado, pruebas
      e ingesta validada. La llave de OCM es opcional; sin ella la fuente se omite.
- [ ] HITO 3 — Comparador de carburantes (buscador, geolocalización, mapas y páginas SEO).
- [ ] HITO 4 — Comparador eléctrico.
- [ ] HITO 5 — Planificador de rutas.
- [ ] HITO 6 — Optimización, GitHub Actions y despliegue en Plesk.

## Aviso

Los precios son orientativos y pueden no coincidir con el precio final en estación. Los datos de
recarga no representan disponibilidad en tiempo real. No se publican valoraciones ni datos de
Afiliados en esta fase.
