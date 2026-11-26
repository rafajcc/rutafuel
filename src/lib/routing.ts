/** Contrato de enrutado y adaptador OSRM. La URL base es inyectable para usar otro proveedor. */

import { isValidCoordinates, type Coordinates } from './geo.js';
import { decodePolyline } from './route.js';

export interface RouteResult {
  distanceKm: number;
  durationMinutes: number | null;
  geometry: Coordinates[];
  provider: string;
  /** Fecha de los datos de carretera declarada por el proveedor, si la publica. */
  dataVersion?: string;
}

export interface RoutingService {
  calculateRoute(origin: Coordinates, destination: Coordinates): Promise<RouteResult>;
}

export class RouteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RouteError';
  }
}

export interface OsrmOptions {
  baseUrl?: string;
  profile?: string;
  fetchImpl?: typeof fetch;
}

interface OsrmRoute {
  distance?: unknown;
  duration?: unknown;
  geometry?: unknown;
}

interface OsrmResponse {
  code?: unknown;
  message?: unknown;
  routes?: unknown;
  data_version?: unknown;
}

/** OSRM devuelve polyline con precisión 5 y coordenadas [lat, lon] en la codificación. */
export function createOsrmRoutingService(options: OsrmOptions = {}): RoutingService {
  const baseUrl = (options.baseUrl ?? 'https://router.project-osrm.org').replace(/\/$/, '');
  const profile = options.profile ?? 'driving';
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);

  return {
    async calculateRoute(origin: Coordinates, destination: Coordinates): Promise<RouteResult> {
      if (!isValidCoordinates(origin) || !isValidCoordinates(destination)) {
        throw new RouteError('Origen o destino no tienen coordenadas válidas');
      }
      const coordinates =
        `${origin.lon.toFixed(6)},${origin.lat.toFixed(6)};` +
        `${destination.lon.toFixed(6)},${destination.lat.toFixed(6)}`;
      const url =
        `${baseUrl}/route/v1/${profile}/${coordinates}` +
        '?overview=full&geometries=polyline&steps=false';

      let response: Response;
      try {
        response = await fetchImpl(url);
      } catch {
        throw new RouteError('No se ha podido contactar con el servicio de rutas');
      }
      if (!response.ok) throw new RouteError(`El servicio de rutas respondió HTTP ${response.status}`);

      let body: OsrmResponse;
      try {
        body = (await response.json()) as OsrmResponse;
      } catch {
        throw new RouteError('El servicio de rutas devolvió una respuesta no válida');
      }
      if (body.code !== 'Ok' || !Array.isArray(body.routes) || body.routes.length === 0) {
        throw new RouteError(
          typeof body.message === 'string' && body.message
            ? body.message
            : 'No se ha encontrado una ruta por carretera',
        );
      }

      const route = body.routes[0] as OsrmRoute;
      if (
        typeof route.geometry !== 'string' ||
        typeof route.distance !== 'number' ||
        !Number.isFinite(route.distance)
      ) {
        throw new RouteError('La ruta recibida no tiene geometría o distancia');
      }
      const geometry = decodePolyline(route.geometry);
      if (geometry.length < 2) throw new RouteError('La geometría de la ruta está vacía');

      return {
        distanceKm: route.distance / 1000,
        durationMinutes:
          typeof route.duration === 'number' && Number.isFinite(route.duration)
            ? route.duration / 60
            : null,
        geometry,
        provider: 'OSRM',
        ...(typeof body.data_version === 'string' ? { dataVersion: body.data_version } : {}),
      };
    },
  };
}
