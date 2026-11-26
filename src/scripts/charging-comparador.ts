import {
  connectorLabel,
  filterChargingStations,
  hasRecentKnownStatus,
  powerTier,
  sortChargingStations,
  tierColor,
  type ChargingStationLike,
  type ChargingSort,
  type PowerTier,
} from '../lib/charging.js';
import { googleMapsUrl, wazeUrl } from '../lib/format.js';
import { haversineKm, isValidCoordinates, type Coordinates } from '../lib/geo.js';
import { formatDistance } from '../lib/fuels.js';
import type { ChargingMapController } from './mapa.js';

interface WebIndex {
  stations: ChargingStationLike[];
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // La selección se mantiene durante la sesión aunque no haya almacenamiento.
  }
}

function urlCoordinates(fallback: Coordinates): Coordinates {
  const params = new URLSearchParams(window.location.search);
  const candidate = { lat: Number(params.get('lat')), lon: Number(params.get('lon')) };
  return isValidCoordinates(candidate) && params.has('lat') && params.has('lon') ? candidate : fallback;
}

function isTier(value: string | null): value is PowerTier | 'all' {
  return value === 'all' || value === 'slow' || value === 'fast' || value === 'ultra';
}

function isSort(value: string | null): value is ChargingSort {
  return value === 'distance' || value === 'power';
}

function externalLinks(station: ChargingStationLike): HTMLSpanElement {
  const span = document.createElement('span');
  for (const [label, href] of [
    ['Google Maps', googleMapsUrl(station.lat, station.lon)],
    ['Waze', wazeUrl(station.lat, station.lon)],
  ]) {
    if (span.childElementCount > 0) span.append(document.createTextNode(' · '));
    const link = document.createElement('a');
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = label;
    span.append(link);
  }
  return span;
}

function powerText(station: ChargingStationLike): string {
  return station.maxPowerKw === null
    ? '—'
    : `${station.maxPowerKw.toLocaleString('es-ES')} kW`;
}

async function init(root: HTMLElement): Promise<void> {
  const source = root.dataset.source;
  if (!source) return;

  const sortSelect = root.querySelector<HTMLSelectElement>('[data-sort-select]');
  const tierSelect = root.querySelector<HTMLSelectElement>('[data-tier-select]');
  const minPowerSelect = root.querySelector<HTMLSelectElement>('[data-min-power-select]');
  const connectorSelect = root.querySelector<HTMLSelectElement>('[data-connector-select]');
  const operatorSelect = root.querySelector<HTMLSelectElement>('[data-operator-select]');
  const statusField = root.querySelector<HTMLElement>('[data-status-field]');
  const statusSelect = root.querySelector<HTMLSelectElement>('[data-status-select]');
  const status = root.querySelector<HTMLElement>('[data-results-status]');
  const tbody = root.querySelector<HTMLTableSectionElement>('[data-results-body]');
  const geolocate = root.querySelector<HTMLButtonElement>('[data-geolocate]');
  const mapToggle = root.querySelector<HTMLButtonElement>('[data-map-toggle]');
  const mapContainer = root.querySelector<HTMLElement>('[data-map-container]');
  if (
    !sortSelect ||
    !tierSelect ||
    !minPowerSelect ||
    !connectorSelect ||
    !operatorSelect ||
    !statusField ||
    !statusSelect ||
    !status ||
    !tbody ||
    !mapToggle ||
    !mapContainer
  ) {
    return;
  }

  const referenceDate = root.dataset.referenceDate || undefined;
  const fallback = {
    lat: Number(root.dataset.centerLat ?? 0),
    lon: Number(root.dataset.centerLon ?? 0),
  };
  let origin = urlCoordinates(fallback);
  let stations: ChargingStationLike[] = [];
  let map: ChargingMapController | null = null;

  const savedSort = read('rf-sort');
  if (isSort(savedSort)) sortSelect.value = savedSort;
  const savedTier = read('rf-charge');
  if (isTier(savedTier)) tierSelect.value = savedTier;

  const selected = (): ChargingStationLike[] => {
    const statusFilter = statusSelect.value as 'all' | 'operational' | 'out-of-service';
    const filtered = filterChargingStations(
      stations,
      {
        tier: tierSelect.value as PowerTier | 'all',
        connector: connectorSelect.value || undefined,
        minPowerKw: Number(minPowerSelect.value),
        operator: operatorSelect.value || undefined,
        status: statusFilter,
        referenceDate,
      },
      origin,
    );
    return sortChargingStations(filtered, origin, isSort(sortSelect.value) ? sortSelect.value : 'distance');
  };

  const render = () => {
    const showStatus = stations.some((station) => hasRecentKnownStatus(station, referenceDate));
    statusField.hidden = !showStatus;
    if (!showStatus) statusSelect.value = 'all';

    const items = selected();
    tbody.replaceChildren();
    for (const station of items) {
      const row = document.createElement('tr');

      const nameCell = document.createElement('td');
      nameCell.className = 'py-2 pr-3';
      const name = document.createElement('span');
      name.className = 'font-medium';
      name.textContent = station.name ?? `Punto ${station.id}`;
      nameCell.append(name);
      if (station.address) {
        const detail = document.createElement('span');
        detail.className = 'block text-xs text-slate-500 dark:text-slate-400';
        detail.textContent = station.address;
        nameCell.append(detail);
      }

      const operatorCell = document.createElement('td');
      operatorCell.className = 'py-2 pr-3';
      operatorCell.textContent = station.operator ?? '—';

      const powerCell = document.createElement('td');
      powerCell.className = 'py-2 pr-3 font-semibold tabular-nums';
      powerCell.textContent = powerText(station);
      const color = tierColor(powerTier(station.maxPowerKw));
      if (station.maxPowerKw !== null) powerCell.style.color = color;

      const connectorCell = document.createElement('td');
      connectorCell.className = 'py-2 pr-3 text-xs';
      connectorCell.textContent =
        station.connectors.map((connector) => connectorLabel(connector.type)).join(', ') || '—';

      const distanceCell = document.createElement('td');
      distanceCell.className = 'py-2 pr-3 tabular-nums';
      distanceCell.textContent = formatDistance(haversineKm(origin, station));

      const linksCell = document.createElement('td');
      linksCell.className = 'py-2 text-sm';
      linksCell.append(externalLinks(station));

      row.append(nameCell, operatorCell, powerCell, connectorCell, distanceCell, linksCell);
      tbody.append(row);
    }

    const unknownStatus = stations.length - stations.filter((station) => hasRecentKnownStatus(station, referenceDate)).length;
    status.textContent =
      `${items.length.toLocaleString('es-ES')} cargadores visibles. ` +
      (showStatus
        ? `${unknownStatus.toLocaleString('es-ES')} sin estado reciente publicado.`
        : 'La fuente no publica estados recientes: no se muestra disponibilidad.');
    map?.update(items);
  };

  try {
    const response = await fetch(source);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const index = (await response.json()) as WebIndex;
    stations = Array.isArray(index.stations) ? index.stations : [];
  } catch {
    status.textContent = 'No se han podido cargar los cargadores. Vuelve a intentarlo más tarde.';
    return;
  }

  sortSelect.addEventListener('change', () => {
    store('rf-sort', sortSelect.value);
    render();
  });
  for (const field of [tierSelect, minPowerSelect, connectorSelect, operatorSelect, statusSelect]) {
    field.addEventListener('change', () => {
      if (field === tierSelect) store('rf-charge', tierSelect.value);
      render();
    });
  }

  geolocate?.addEventListener('click', () => {
    if (!navigator.geolocation) {
      status.textContent = 'Tu navegador no permite obtener la ubicación.';
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        origin = { lat: position.coords.latitude, lon: position.coords.longitude };
        render();
      },
      () => {
        status.textContent = 'No se ha concedido permiso. La distancia se calcula desde el centro de la zona.';
      },
      { timeout: 8000, maximumAge: 300000 },
    );
  });

  mapToggle.addEventListener('click', async () => {
    const willShow = mapContainer.hidden;
    mapContainer.hidden = !willShow;
    mapToggle.setAttribute('aria-expanded', String(willShow));
    if (!willShow || map) return;
    try {
      const { createChargingMap } = await import('./mapa.js');
      map = await createChargingMap(mapContainer, selected(), origin, referenceDate);
    } catch {
      mapContainer.hidden = true;
      mapToggle.setAttribute('aria-expanded', 'false');
      status.textContent = 'El mapa no se ha podido cargar. El listado sigue disponible.';
    }
  });

  render();
}

const root = document.querySelector<HTMLElement>('[data-charging-comparador]');
if (root) void init(root);
