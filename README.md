# RutaFuel

Plataforma estática para comparar precios de carburantes y, en fases posteriores, puntos de recarga
eléctrica en España. El proyecto sigue un desarrollo por hitos: **actualmente está implementado el
HITO 1 (proyecto base + datos de carburantes)**.

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
npm run ingest -- --input ruta/a/respuesta.json   # usar una respuesta guardada
npm run ingest -- --dry-run                       # validar sin escribir
npm run ingest -- --data-dir ruta/a/salida        # directorio de salida alternativo
```

La URL de la fuente se puede sobrescribir con `--url <url>`.

## Configuración

Copia las variables que necesites a `.env`:

```bash
SITE_URL=https://rutafuel.es
```

`SITE_URL` se usa para canonical URLs y futuros sitemaps. Sustituye el dominio de ejemplo por el
dominio real antes de publicar.

## Fuentes y trazabilidad

- **Gasolineras**: API REST oficial del Ministerio para la Transición Ecológica
  (`EstacionesTerrestres`). Se conserva `IDEESS` como identificador estable, los valores originales
  de coordenadas y precios en `raw` (auditoría), y la fecha declarada por la fuente en `metadata.json`.
- Los precios se normalizan a `number` (coma decimal española). Un precio ausente es `null`, nunca `0`.
- Se descartan registros sin `IDEESS`, sin municipio/provincia o con coordenadas fuera de España
  (incluye Canarias, Ceuta y Melilla).
- `sourceUpdatedAt` está expresado como ISO **sin offset** porque la API publica hora local
  peninsular; `sourceUpdatedAtRaw` conserva el texto original.

## Estructura de datos generada

```
src/data/
├── metadata.json                       # fechas, conteos, validación, versión de formato
├── estadisticas/
│   ├── provincias.json
│   ├── municipios.json
│   └── resumen.json
└── gasolineras/
    ├── estaciones.json                 # dataset completo (uso en build/SEO)
    ├── indice.json                     # provincias y municipios + número de estaciones
    ├── provincias/<id>.json            # estaciones de una provincia (carga bajo demanda)
    └── municipios/<idProv>/<idMun>.json
```

Si una descarga o validación falla, el pipeline **no sustituye** los datos anteriores: escribe en un
directorio de staging, valida lo escrito y solo entonces intercambia los directorios (con rollback).

## Arquitectura

La información detallada de decisiones, modelos y umbrales de validación está en
[`docs/arquitectura.md`](docs/arquitectura.md).

## Estado y siguientes hitos

- [x] HITO 1 — Astro + TypeScript + Tailwind, ingesta y normalización de gasolineras, índices,
      estadísticas, pruebas y build estático.
- [ ] HITO 2 — RIPREE + Open Charge Map y deduplicación.
- [ ] HITO 3 — Comparador de carburantes (buscador, geolocalización, mapas y páginas SEO).
- [ ] HITO 4 — Comparador eléctrico.
- [ ] HITO 5 — Planificador de rutas.
- [ ] HITO 6 — Optimización, GitHub Actions y despliegue en Plesk.

## Aviso

Los precios son orientativos y pueden no coincidir con el precio final en estación. No se publican
valoraciones, disponibilidad en tiempo real ni datos de Afiliados en esta fase.
