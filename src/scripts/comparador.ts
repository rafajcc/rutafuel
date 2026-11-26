import { priceColor, priceLevel, priceScale } from '../lib/colors.js';
import { FUEL_LABELS, formatDistance, formatPrice, isFuelKey, type FuelKey } from '../lib/fuels.js';
import { googleMapsUrl, wazeUrl } from '../lib/format.js';
import { haversineKm, isValidCoordinates, withinRadius, type Coordinates } from '../lib/geo.js';
import type { MapController, MapStation } from './mapa.js';

interface WebStation extends Coordinates {
  id: string;
  name?: string;
  address?: string;
  locality?: string;
  municipality: string;
  province: string;
  postalCode?: string;
  schedule?: string;
  prices: Record<FuelKey, number | null>;
}

interface WebIndex {
  id: string;
  name: string;
  slug: string;
  stationCount: number;
  stations: WebStation[];
}

type SortMode = 'price' | 'distance' | 'price-radius';

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
    // Sin almacenamiento la selección se mantiene durante la sesión.
  }
}

function urlCoordinates(fallback: Coordinates): Coordinates {
  const params = new URLSearchParams(window.location.search);
  const lat = Number(params.get('lat'));
  const lon = Number(params.get('lon'));
  const candidate = { lat, lon };
  return isValidCoordinates(candidate) && params.has('lat') && params.has('lon') ? candidate : fallback;
}

function distanceOf(origin: Coordinates, station: WebStation): number | null {
  const distance = haversineKm(origin, station);
  return Number.isFinite(distance) ? distance : null;
}

function externalLinks(station: WebStation): HTMLSpanElement {
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

async function init(root: HTMLElement): Promise<void> {
  const source = root.dataset.source;
  if (!source) return;

  const fuelSelect = root.querySelector<HTMLSelectElement>('[data-fuel-select]');
  const sortSelect = root.querySelector<HTMLSelectElement>('[data-sort-select]');
  const radiusSelect = root.querySelector<HTMLSelectElement>('[data-radius-select]');
  const radiusField = root.querySelector<HTMLElement>('[data-radius-field]');
  const status = root.querySelector<HTMLElement>('[data-results-status]');
  const tbody = root.querySelector<HTMLTableSectionElement>('[data-results-body]');
  const geolocate = root.querySelector<HTMLButtonElement>('[data-geolocate]');
  const mapToggle = root.querySelector<HTMLButtonElement>('[data-map-toggle]');
  const mapContainer = root.querySelector<HTMLElement>('[data-map-container]');
  if (!fuelSelect || !sortSelect || !radiusSelect || !radiusField || !status || !tbody || !mapToggle || !mapContainer) return;

  const savedFuel = read('rf-fuel');
  if (isFuelKey(savedFuel)) fuelSelect.value = savedFuel;
  const savedSort = read('rf-sort');
  if (savedSort === 'price' || savedSort === 'distance' || savedSort === 'price-radius') {
    sortSelect.value = savedSort;
  }

  const fallback: Coordinates = {
    lat: Number(root.dataset.centerLat ?? 0),
    lon: Number(root.dataset.centerLon ?? 0),
  };
  let origin = urlCoordinates(fallback);
  let stations: WebStation[] = [];
  let map: MapController | null = null;

  const mapStations = (items: WebStation[], fuel: FuelKey): MapStation[] =>
    items.map((station) => ({
      id: station.id,
      name: station.name,
      address: station.address,
      lat: station.lat,
      lon: station.lon,
      price: station.prices[fuel] ?? null,
    }));

  const filtered = (): WebStation[] => {
    const fuel = isFuelKey(fuelSelect.value) ? fuelSelect.value : 'g95';
    const sort = sortSelect.value as SortMode;
    const radius = Number(radiusSelect.value);
    const withDistance = stations.map((station) => ({ station, distance: distanceOf(origin, station) }));

    let selected = withDistance;
    if (sort === 'price-radius') {
      selected = withDistance.filter(
        ({ station }) => withinRadius(origin, station, radius) && station.prices[fuel] !== null,
      );
    }

    selected.sort((a, b) => {
      if (sort === 'distance') {
        return (a.distance ?? Infinity) - (b.distance ?? Infinity) || a.station.name?.localeCompare(b.station.name ?? '', 'es') || 0;
      }
      const priceA = a.station.prices[fuel];
      const priceB = b.station.prices[fuel];
      if (priceA === null && priceB === null) return (a.distance ?? Infinity) - (b.distance ?? Infinity);
      if (priceA === null) return 1;
      if (priceB === null) return -1;
      return priceA - priceB || (a.distance ?? Infinity) - (b.distance ?? Infinity);
    });

    return selected.map(({ station }) => station);
  };

  const render = () => {
    const fuel = isFuelKey(fuelSelect.value) ? fuelSelect.value : 'g95';
    radiusField.hidden = sortSelect.value !== 'price-radius';
    const items = filtered();
    const scale = priceScale(items.map((station) => station.prices[fuel]).filter((price): price is number => price !== null));

    tbody.replaceChildren();
    for (const station of items) {
      const price = station.prices[fuel] ?? null;
      const row = document.createElement('tr');

      const nameCell = document.createElement('td');
      nameCell.className = 'py-2 pr-3';
      const name = document.createElement('span');
      name.className = 'font-medium';
      name.textContent = station.name || `Estación ${station.id}`;
      nameCell.append(name);
      const detail = document.createElement('span');
      detail.className = 'block text-xs text-slate-500 dark:text-slate-400';
      detail.textContent = [station.address, station.schedule].filter(Boolean).join(' · ');
      nameCell.append(detail);

      const priceCell = document.createElement('td');
      priceCell.className = 'py-2 pr-3 font-semibold tabular-nums';
      priceCell.textContent = `${formatPrice(price)} €/l`;
      const color = priceColor(priceLevel(price, scale));
      if (color) priceCell.style.color = color;

      const distanceCell = document.createElement('td');
      distanceCell.className = 'py-2 pr-3 tabular-nums';
      distanceCell.textContent = formatDistance(distanceOf(origin, station));

      const linksCell = document.createElement('td');
      linksCell.className = 'py-2 text-sm';
      linksCell.append(externalLinks(station));

      row.append(nameCell, priceCell, distanceCell, linksCell);
      tbody.append(row);
    }

    status.textContent = `${items.length.toLocaleString('es-ES')} estaciones con precio para ${FUEL_LABELS[fuel]}.`;
    map?.update(mapStations(items, fuel), FUEL_LABELS[fuel]);
  };

  try {
    const response = await fetch(source);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const index = (await response.json()) as WebIndex;
    stations = Array.isArray(index.stations) ? index.stations : [];
  } catch {
    status.textContent = 'No se han podido cargar las estaciones. Vuelve a intentarlo más tarde.';
    return;
  }

  fuelSelect.addEventListener('change', () => {
    store('rf-fuel', fuelSelect.value);
    render();
  });
  sortSelect.addEventListener('change', () => {
    store('rf-sort', sortSelect.value);
    render();
  });
  radiusSelect.addEventListener('change', render);

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
        status.textContent = 'No se ha concedido permiso. La distancia se calcula desde el centro de la localidad.';
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
      const { createStationMap } = await import('./mapa.js');
      const fuel = isFuelKey(fuelSelect.value) ? fuelSelect.value : 'g95';
      map = await createStationMap(
        mapContainer,
        mapStations(filtered(), fuel),
        FUEL_LABELS[fuel],
        origin,
      );
    } catch {
      mapContainer.hidden = true;
      mapToggle.setAttribute('aria-expanded', 'false');
      status.textContent = 'El mapa no se ha podido cargar. El listado sigue disponible.';
    }
  });

  render();
}

const root = document.querySelector<HTMLElement>('[data-comparador]');
if (root) void init(root);
