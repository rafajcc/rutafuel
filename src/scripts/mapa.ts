import {
  connectorLabel,
  hasRecentKnownStatus,
  powerTier,
  tierColor,
  type ChargingStationLike,
} from '../lib/charging.js';
import { priceColor, priceLevel, priceScale } from '../lib/colors.js';
import { escapeHtml, googleMapsUrl, wazeUrl } from '../lib/format.js';
import type { Coordinates } from '../lib/geo.js';

type LeafletModule = typeof import('leaflet');

export interface MapStation extends Coordinates {
  id: string;
  name?: string;
  address?: string;
  price: number | null;
}

export interface MapController {
  update(stations: MapStation[], fuelLabel: string): void;
  destroy(): void;
}

/** Proveedor configurable: cambiar de teselas no obliga a reescribir los marcadores. */
export const TILE_PROVIDERS = {
  osm: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  },
} as const;

export type TileProviderId = keyof typeof TILE_PROVIDERS;

async function loadLeaflet(): Promise<LeafletModule> {
  const L: LeafletModule = await import('leaflet');
  await import('leaflet/dist/leaflet.css');
  return L;
}

function popupHtml(station: MapStation, fuelLabel: string): string {
  const name = escapeHtml(station.name ?? 'Estación de servicio');
  const address = station.address ? `<p>${escapeHtml(station.address)}</p>` : '';
  const price =
    station.price === null
      ? '<p>Precio no disponible</p>'
      : `<p><strong>${station.price.toFixed(3).replace('.', ',')} €/l</strong> · ${escapeHtml(fuelLabel)}</p>`;
  return (
    `<strong>${name}</strong>${address}${price}` +
    `<p><a target="_blank" rel="noopener noreferrer" href="${googleMapsUrl(station.lat, station.lon)}">Google Maps</a> · ` +
    `<a target="_blank" rel="noopener noreferrer" href="${wazeUrl(station.lat, station.lon)}">Waze</a></p>`
  );
}

/**
 * Leaflet y sus estilos se importan dinámicamente: no se descargan hasta que el usuario
 * pulsa «Ver en el mapa».
 */
export async function createStationMap(
  container: HTMLElement,
  initialStations: MapStation[],
  fuelLabel: string,
  center: Coordinates,
  providerId: TileProviderId = 'osm',
): Promise<MapController> {
  const L = await loadLeaflet();

  const provider = TILE_PROVIDERS[providerId];
  const map = L.map(container, { scrollWheelZoom: false }).setView([center.lat, center.lon], 12);
  L.tileLayer(provider.url, {
    attribution: provider.attribution,
    maxZoom: provider.maxZoom,
  }).addTo(map);

  let group = L.layerGroup().addTo(map);
  let stations = initialStations;
  let label = fuelLabel;

  const render = () => {
    map.removeLayer(group);
    group = L.layerGroup().addTo(map);
    const scale = priceScale(
      stations.map((station) => station.price).filter((price): price is number => price !== null),
    );
    const cluster = stations.length > 120 && map.getZoom() < 12;

    if (cluster) {
      const cells = new Map<string, { lat: number; lon: number; count: number }>();
      for (const station of stations) {
        const key = `${Math.round(station.lat / 0.02)}:${Math.round(station.lon / 0.02)}`;
        const cell = cells.get(key) ?? { lat: 0, lon: 0, count: 0 };
        cell.lat += station.lat;
        cell.lon += station.lon;
        cell.count += 1;
        cells.set(key, cell);
      }
      for (const cell of cells.values()) {
        const lat = cell.lat / cell.count;
        const lon = cell.lon / cell.count;
        const icon = L.divIcon({
          html: `<div class="map-pin map-pin--cluster">${cell.count}</div>`,
          className: '',
          iconSize: [42, 24],
          iconAnchor: [21, 12],
        });
        L.marker([lat, lon], { icon })
          .on('click', () => map.setView([lat, lon], map.getZoom() + 2))
          .addTo(group);
      }
      return;
    }

    for (const station of stations) {
      const color = priceColor(priceLevel(station.price, scale)) ?? '#475569';
      const text = station.price === null ? '—' : station.price.toFixed(2).replace('.', ',');
      const icon = L.divIcon({
        html: `<div class="map-pin" style="--pin-color:${color}">${text}</div>`,
        className: '',
        iconSize: [48, 24],
        iconAnchor: [24, 12],
      });
      L.marker([station.lat, station.lon], { icon }).bindPopup(popupHtml(station, label)).addTo(group);
    }
  };

  map.on('zoomend', render);
  render();

  if (stations.length > 1) {
    map.fitBounds(
      L.latLngBounds(stations.map((station) => [station.lat, station.lon] as [number, number])),
      { padding: [24, 24], maxZoom: 14 },
    );
  }

  return {
    update(nextStations, nextFuelLabel) {
      stations = nextStations;
      label = nextFuelLabel;
      render();
    },
    destroy() {
      map.remove();
    },
  };
}

export interface ChargingMapController {
  update(stations: ChargingStationLike[]): void;
  destroy(): void;
}

function chargingPopupHtml(
  station: ChargingStationLike,
  referenceDate: string | undefined,
): string {
  const name = escapeHtml(station.name ?? `Punto de recarga ${station.id}`);
  const address = station.address ? `<p>${escapeHtml(station.address)}</p>` : '';
  const operator = station.operator ? `<p>Operador: ${escapeHtml(station.operator)}</p>` : '';
  const power =
    station.maxPowerKw === null
      ? '<p>Potencia no publicada</p>'
      : `<p><strong>${station.maxPowerKw.toLocaleString('es-ES')} kW</strong> · potencia máxima registrada</p>`;
  const connectors =
    station.connectors.length > 0
      ? `<p>Conectores: ${station.connectors.map((connector) => escapeHtml(connectorLabel(connector.type))).join(', ')}</p>`
      : '';
  const status = hasRecentKnownStatus(station, referenceDate)
    ? `<p>Estado declarado por la fuente: ${escapeHtml(station.status)} · ${escapeHtml(station.updatedAt ?? '')}</p>`
    : '';
  return (
    `<strong>${name}</strong>${address}${operator}${power}${connectors}${status}` +
    `<p><a target="_blank" rel="noopener noreferrer" href="${googleMapsUrl(station.lat, station.lon)}">Google Maps</a> · ` +
    `<a target="_blank" rel="noopener noreferrer" href="${wazeUrl(station.lat, station.lon)}">Waze</a></p>`
  );
}

/** Mapa de recarga con el mismo proveedor de teselas y carga diferida que el de carburantes. */
export async function createChargingMap(
  container: HTMLElement,
  initialStations: ChargingStationLike[],
  center: Coordinates,
  referenceDate?: string,
  providerId: TileProviderId = 'osm',
): Promise<ChargingMapController> {
  const L = await loadLeaflet();
  const provider = TILE_PROVIDERS[providerId];
  const map = L.map(container, { scrollWheelZoom: false }).setView([center.lat, center.lon], 12);
  L.tileLayer(provider.url, {
    attribution: provider.attribution,
    maxZoom: provider.maxZoom,
  }).addTo(map);

  let group = L.layerGroup().addTo(map);
  let stations = initialStations;

  const render = () => {
    map.removeLayer(group);
    group = L.layerGroup().addTo(map);

    if (stations.length > 120 && map.getZoom() < 12) {
      const cells = new Map<string, { lat: number; lon: number; count: number }>();
      for (const station of stations) {
        const key = `${Math.round(station.lat / 0.02)}:${Math.round(station.lon / 0.02)}`;
        const cell = cells.get(key) ?? { lat: 0, lon: 0, count: 0 };
        cell.lat += station.lat;
        cell.lon += station.lon;
        cell.count += 1;
        cells.set(key, cell);
      }
      for (const cell of cells.values()) {
        const lat = cell.lat / cell.count;
        const lon = cell.lon / cell.count;
        const icon = L.divIcon({
          html: `<div class="map-pin map-pin--cluster">${cell.count}</div>`,
          className: '',
          iconSize: [42, 24],
          iconAnchor: [21, 12],
        });
        L.marker([lat, lon], { icon })
          .on('click', () => map.setView([lat, lon], map.getZoom() + 2))
          .addTo(group);
      }
      return;
    }

    for (const station of stations) {
      const tier = powerTier(station.maxPowerKw);
      const color = tierColor(tier);
      const text = station.maxPowerKw === null ? '⚡ ?' : `⚡ ${Math.round(station.maxPowerKw)}`;
      const icon = L.divIcon({
        html: `<div class="map-pin map-pin--charging" style="--pin-color:${color}">${text}</div>`,
        className: '',
        iconSize: [64, 24],
        iconAnchor: [32, 12],
      });
      L.marker([station.lat, station.lon], { icon })
        .bindPopup(chargingPopupHtml(station, referenceDate))
        .addTo(group);
    }
  };

  map.on('zoomend', render);
  render();
  if (stations.length > 1) {
    map.fitBounds(
      L.latLngBounds(stations.map((station) => [station.lat, station.lon] as [number, number])),
      { padding: [24, 24], maxZoom: 14 },
    );
  }

  return {
    update(nextStations) {
      stations = nextStations;
      render();
    },
    destroy() {
      map.remove();
    },
  };
}

export interface RouteMapStation extends Coordinates {
  id: string;
  name?: string;
  detail: string;
}

export interface RouteMapController {
  destroy(): void;
}

/** Mapa del planificador: polilinea de la ruta y estaciones cercanas, con Leaflet diferido. */
export async function createRouteMap(
  container: HTMLElement,
  geometry: Coordinates[],
  stations: RouteMapStation[],
  providerId: TileProviderId = 'osm',
): Promise<RouteMapController> {
  const L = await loadLeaflet();
  const provider = TILE_PROVIDERS[providerId];
  const center = geometry[0] ?? { lat: 40, lon: -3 };
  const map = L.map(container, { scrollWheelZoom: false }).setView([center.lat, center.lon], 7);
  L.tileLayer(provider.url, {
    attribution: provider.attribution,
    maxZoom: provider.maxZoom,
  }).addTo(map);

  const line: [number, number][] = geometry.map((point) => [point.lat, point.lon]);
  if (line.length > 1) {
    L.polyline(line, { color: '#0f766e', weight: 4, opacity: 0.85 }).addTo(map);
  }
  for (const station of stations) {
    const name = escapeHtml(station.name ?? station.id);
    L.circleMarker([station.lat, station.lon], {
      radius: 6,
      color: '#ffffff',
      weight: 1,
      fillColor: '#b45309',
      fillOpacity: 1,
    })
      .bindPopup(`<strong>${name}</strong><p>${escapeHtml(station.detail)}</p>`)
      .addTo(map);
  }
  if (line.length > 1) {
    map.fitBounds(L.latLngBounds(line), { padding: [24, 24], maxZoom: 13 });
  } else if (stations.length > 0) {
    map.fitBounds(
      L.latLngBounds(stations.map((station) => [station.lat, station.lon] as [number, number])),
      { padding: [24, 24], maxZoom: 13 },
    );
  }

  return { destroy: () => map.remove() };
}
