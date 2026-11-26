/** Cliente del planificador: resuelve puntos, calcula la ruta y lista estaciones sobre la geometría. */

import type { RouteEntry, RouteGridIndex } from '../../scripts/lib/route-index.js';
import { tierColor, powerTier } from '../lib/charging.js';
import { formatDistance, formatPrice, FUEL_LABELS, isFuelKey, type FuelKey } from '../lib/fuels.js';
import { googleMapsUrl, wazeUrl } from '../lib/format.js';
import {
  createLocalGeocoder,
  createNominatimGeocoder,
  parseCoordinates,
  type GeocodeResult,
  type LocalPlace,
} from '../lib/geocoding.js';
import type { Coordinates } from '../lib/geo.js';
import { sampleRoute, stationsAlongRoute, type RouteMatch, type RouteQuery } from '../lib/route.js';
import { createOsrmRoutingService, type RouteResult } from '../lib/routing.js';
import type { RouteMapController } from './mapa.js';

type Energy = 'fuel' | 'electric';
type Which = 'origin' | 'destination';

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

function isEnergy(value: string | null): value is Energy {
  return value === 'fuel' || value === 'electric';
}

function isPowerOption(value: string | null): value is '0' | '22' | '50' | '150' {
  return value === '0' || value === '22' || value === '50' || value === '150';
}

function externalLinks(point: Coordinates): HTMLSpanElement {
  const span = document.createElement('span');
  for (const [label, href] of [
    ['Google Maps', googleMapsUrl(point.lat, point.lon)],
    ['Waze', wazeUrl(point.lat, point.lon)],
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

function entryDetail(entry: RouteEntry): string {
  const location = [entry.municipality, entry.province].filter(Boolean).join(', ');
  if (entry.kind === 'fuel') return location;
  return [entry.operator, location].filter(Boolean).join(' · ');
}

async function init(): Promise<void> {
  const planner = document.querySelector<HTMLElement>('[data-route-planner]');
  const results = document.querySelector<HTMLElement>('[data-route-results]');
  const status = document.querySelector<HTMLElement>('[data-route-status]');
  const summary = document.querySelector<HTMLElement>('[data-route-summary]');
  const tbody = document.querySelector<HTMLTableSectionElement>('[data-route-results-body]');
  const suggestions = document.querySelector<HTMLDataListElement>('[data-route-suggestions]');
  const mapToggle = document.querySelector<HTMLButtonElement>('[data-route-map-toggle]');
  const mapContainer = document.querySelector<HTMLElement>('[data-route-map]');
  const submit = document.querySelector<HTMLButtonElement>('[data-route-submit]');
  const locate = document.querySelector<HTMLButtonElement>('[data-route-locate]');
  if (!planner || !results || !status || !summary || !tbody || !suggestions || !mapToggle || !mapContainer || !submit) {
    return;
  }

  const originInput = planner.querySelector<HTMLInputElement>('[data-route-input="origin"]');
  const destinationInput = planner.querySelector<HTMLInputElement>('[data-route-input="destination"]');
  const energySelect = planner.querySelector<HTMLSelectElement>('[data-route-energy]');
  const fuelSelect = planner.querySelector<HTMLSelectElement>('[data-route-fuel]');
  const fuelField = planner.querySelector<HTMLElement>('[data-route-fuel-field]');
  const minPowerSelect = planner.querySelector<HTMLSelectElement>('[data-route-min-power]');
  const tierSelect = planner.querySelector<HTMLSelectElement>('[data-route-tier]');
  const radiusSelect = planner.querySelector<HTMLSelectElement>('[data-route-radius]');
  const chargingFields = planner.querySelectorAll<HTMLElement>('[data-route-charging-field]');
  if (
    !originInput ||
    !destinationInput ||
    !energySelect ||
    !fuelSelect ||
    !fuelField ||
    !minPowerSelect ||
    !tierSelect ||
    !radiusSelect
  ) {
    return;
  }

  const inputs: Record<Which, HTMLInputElement> = { origin: originInput, destination: destinationInput };
  const overrides: Partial<Record<Which, GeocodeResult>> = {};
  let places: LocalPlace[] = [];
  let placesPromise: Promise<void> | null = null;
  let localGeocoder = createLocalGeocoder([]);
  const nominatim = createNominatimGeocoder();
  const routing = createOsrmRoutingService();
  let grid: RouteGridIndex | null = null;
  let route: RouteResult | null = null;
  let matches: RouteMatch[] = [];
  let map: RouteMapController | null = null;

  const savedEnergy = read('rf-route-energy');
  if (isEnergy(savedEnergy)) energySelect.value = savedEnergy;
  const savedFuel = read('rf-route-fuel');
  if (isFuelKey(savedFuel)) fuelSelect.value = savedFuel;
  const savedTier = read('rf-route-tier');
  if (['all', 'slow', 'fast', 'ultra'].includes(savedTier ?? '')) tierSelect.value = savedTier!;
  const savedPower = read('rf-route-power');
  if (isPowerOption(savedPower)) minPowerSelect.value = savedPower;
  const savedRadius = read('rf-route-radius');
  if (['2', '5', '10', '20'].includes(savedRadius ?? '')) radiusSelect.value = savedRadius!;

  const energy = (): Energy => (isEnergy(energySelect.value) ? energySelect.value : 'fuel');
  const fuel = (): FuelKey => (isFuelKey(fuelSelect.value) ? fuelSelect.value : 'g95');
  const radiusKm = (): number => Number(radiusSelect.value) || 5;

  const updateEnergyFields = () => {
    const electric = energy() === 'electric';
    fuelField.hidden = electric;
    for (const field of chargingFields) field.hidden = !electric;
    store('rf-route-energy', energy());
  };
  updateEnergyFields();
  energySelect.addEventListener('change', updateEnergyFields);
  fuelSelect.addEventListener('change', () => store('rf-route-fuel', fuelSelect.value));
  tierSelect.addEventListener('change', () => store('rf-route-tier', tierSelect.value));
  minPowerSelect.addEventListener('change', () => store('rf-route-power', minPowerSelect.value));
  radiusSelect.addEventListener('change', () => store('rf-route-radius', radiusSelect.value));

  for (const which of ['origin', 'destination'] as const) {
    inputs[which].addEventListener('input', () => {
      delete overrides[which];
    });
  }

  const loadPlaces = (): Promise<void> => {
    if (places.length > 0) return Promise.resolve();
    if (placesPromise) return placesPromise;
    placesPromise = (async () => {
      try {
        const response = await fetch('/data/buscador/municipios.json');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        places = (await response.json()) as LocalPlace[];
        localGeocoder = createLocalGeocoder(places);
        const options = [...places]
          .sort((a, b) => (b.stationCount ?? 0) - (a.stationCount ?? 0))
          .slice(0, 400)
          .map((place) => {
            const option = document.createElement('option');
            option.value = place.provinceName ? `${place.name} (${place.provinceName})` : place.name;
            return option;
          });
        suggestions.replaceChildren(...options);
      } catch {
        status.textContent =
          'No se ha podido cargar el índice local de localidades. Puedes escribir coordenadas o usar la búsqueda de direcciones.';
      }
    })();
    return placesPromise;
  };
  for (const which of ['origin', 'destination'] as const) {
    inputs[which].addEventListener('focus', () => void loadPlaces());
  }

  const loadGrid = async (): Promise<RouteGridIndex> => {
    if (grid) return grid;
    const response = await fetch('/data/rutas/estaciones.json');
    if (!response.ok) throw new Error(`No se ha podido cargar el índice de estaciones (HTTP ${response.status})`);
    const loaded = (await response.json()) as RouteGridIndex;
    if (!loaded.cells || typeof loaded.cells !== 'object') {
      throw new Error('El índice de estaciones no tiene el formato esperado');
    }
    grid = loaded;
    return loaded;
  };

  const resolve = async (which: Which, allowNominatim: boolean): Promise<GeocodeResult | null> => {
    if (overrides[which]) return overrides[which]!;
    const typed = inputs[which].value.trim();
    if (!typed) return null;
    const coordinates = parseCoordinates(typed);
    if (coordinates) return { ...coordinates, label: typed, provider: 'local' };

    await loadPlaces();
    const local = await localGeocoder.geocode(typed);
    if (local) return local;
    if (!allowNominatim) return null;
    status.textContent = `Buscando «${typed}» con Nominatim…`;
    return nominatim.geocode(typed);
  };

  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-route-geocode]')) {
    button.addEventListener('click', async () => {
      const which = button.dataset.routeGeocode as Which | undefined;
      if (which !== 'origin' && which !== 'destination') return;
      const typed = inputs[which].value.trim();
      if (!typed) {
        status.textContent = 'Escribe primero una localidad o dirección.';
        return;
      }
      if (parseCoordinates(typed)) {
        status.textContent = 'Ya has introducido coordenadas; no hace falta geocodificar.';
        return;
      }
      status.textContent = 'Consultando Nominatim (máximo una petición por segundo)…';
      try {
        const result = await nominatim.geocode(typed);
        if (!result) {
          status.textContent = 'Nominatim no ha encontrado esa dirección. Prueba con otro texto.';
          return;
        }
        overrides[which] = result;
        inputs[which].value = result.label;
        status.textContent = `Ubicación resuelta con Nominatim: ${result.label}`;
      } catch (error) {
        status.textContent = `No se ha podido geocodificar: ${error instanceof Error ? error.message : 'error desconocido'}`;
      }
    });
  }

  locate?.addEventListener('click', () => {
    if (!navigator.geolocation) {
      status.textContent = 'Tu navegador no permite obtener la ubicación.';
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const point = {
          lat: position.coords.latitude,
          lon: position.coords.longitude,
        };
        const label = `${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}`;
        overrides.origin = { ...point, label, provider: 'local' };
        originInput.value = label;
        status.textContent = 'Origen fijado con tu ubicación.';
      },
      () => {
        status.textContent = 'No se ha concedido permiso. Puedes escribir la localidad o coordenadas.';
      },
      { timeout: 8000, maximumAge: 300000 },
    );
  });

  const resetMap = () => {
    map?.destroy();
    map = null;
    mapContainer.hidden = true;
    mapToggle.setAttribute('aria-expanded', 'false');
  };

  const render = (result: RouteResult, closest: RouteMatch[], query: RouteQuery) => {
    const fuelKey = fuel();
    const label = query.energy === 'fuel' ? FUEL_LABELS[fuelKey] : 'recarga eléctrica';
    const minutes = result.durationMinutes === null ? '' : ` · ${Math.round(result.durationMinutes)} min`;
    summary.textContent =
      `${Math.round(result.distanceKm)} km${minutes} · ${closest.length.toLocaleString('es-ES')} ` +
      `${query.energy === 'fuel' ? 'gasolineras' : 'cargadores'} a ≤ ${query.radiusKm} km de la ruta · ` +
      `${label} · ruta calculada con ${result.provider}.`;

    tbody.replaceChildren();
    for (const item of closest) {
      const row = document.createElement('tr');
      const values: HTMLElement[] = [];

      const distanceCell = document.createElement('td');
      distanceCell.className = 'py-2 pr-3 tabular-nums';
      distanceCell.textContent = formatDistance(item.alongRouteKm);
      values.push(distanceCell);

      const nameCell = document.createElement('td');
      nameCell.className = 'py-2 pr-3';
      const name = document.createElement('span');
      name.className = 'font-medium';
      name.textContent = item.entry.name ?? `Estación ${item.entry.id}`;
      nameCell.append(name);
      const detail = entryDetail(item.entry);
      if (detail) {
        const small = document.createElement('span');
        small.className = 'block text-xs text-slate-500 dark:text-slate-400';
        small.textContent = detail;
        nameCell.append(small);
      }
      values.push(nameCell);

      const offRouteCell = document.createElement('td');
      offRouteCell.className = 'py-2 pr-3 tabular-nums';
      offRouteCell.textContent = formatDistance(item.distanceKm);
      values.push(offRouteCell);

      const detourCell = document.createElement('td');
      detourCell.className = 'py-2 pr-3 tabular-nums';
      detourCell.textContent = formatDistance(item.detourKm);
      values.push(detourCell);

      const valueCell = document.createElement('td');
      valueCell.className = 'py-2 pr-3 font-semibold tabular-nums';
      if (item.entry.kind === 'fuel') {
        const price = item.entry.prices[fuelKey];
        valueCell.textContent = price === undefined ? '—' : `${formatPrice(price)} €/l`;
      } else {
        valueCell.textContent =
          item.entry.maxPowerKw === null
            ? '—'
            : `${item.entry.maxPowerKw.toLocaleString('es-ES')} kW`;
        valueCell.style.color = tierColor(powerTier(item.entry.maxPowerKw));
      }
      values.push(valueCell);

      const linksCell = document.createElement('td');
      linksCell.className = 'py-2 text-sm';
      linksCell.append(externalLinks(item.entry));
      values.push(linksCell);

      row.append(...values);
      tbody.append(row);
    }

    results.hidden = false;
    status.textContent = `Ruta calculada. ${closest.length.toLocaleString('es-ES')} estaciones en el corredor.`;
  };

  submit.addEventListener('click', async () => {
    resetMap();
    results.hidden = true;
    try {
      const origin = await resolve('origin', true);
      if (!origin) {
        status.textContent = 'No se ha podido resolver el origen. Usa un nombre del listado, una dirección o coordenadas.';
        return;
      }
      const destination = await resolve('destination', true);
      if (!destination) {
        status.textContent = 'No se ha podido resolver el destino. Usa un nombre del listado, una dirección o coordenadas.';
        return;
      }
      status.textContent = 'Calculando ruta por carretera…';
      route = await routing.calculateRoute(origin, destination);
      status.textContent = 'Ruta obtenida. Buscando estaciones cercanas a la geometría…';
      const index = await loadGrid();
      const query: RouteQuery = {
        radiusKm: radiusKm(),
        energy: energy(),
        fuel: fuel(),
        ...(energy() === 'electric'
          ? {
              tier: tierSelect.value as RouteQuery['tier'],
              minPowerKw: Number(minPowerSelect.value),
            }
          : {}),
      };
      matches = stationsAlongRoute(index, sampleRoute(route.geometry, 1), query);
      render(route, matches, query);
    } catch (error) {
      status.textContent = `No se ha podido completar la ruta: ${error instanceof Error ? error.message : 'error desconocido'}`;
    }
  });

  mapToggle.addEventListener('click', async () => {
    const willShow = mapContainer.hidden;
    mapContainer.hidden = !willShow;
    mapToggle.setAttribute('aria-expanded', String(willShow));
    if (!willShow || map || !route) return;
    try {
      const { createRouteMap } = await import('./mapa.js');
      map = await createRouteMap(
        mapContainer,
        route.geometry,
        matches.map((item) => ({
          id: item.entry.id,
          lat: item.entry.lat,
          lon: item.entry.lon,
          name: item.entry.name,
          detail:
            `${formatDistance(item.distanceKm)} de la ruta · ` +
            (item.entry.kind === 'fuel'
              ? `${formatPrice(item.entry.prices[fuel()])} €/l`
              : `${item.entry.maxPowerKw?.toLocaleString('es-ES') ?? '—'} kW`),
        })),
      );
    } catch {
      resetMap();
      status.textContent = 'El mapa no se ha podido cargar. El listado sigue disponible.';
    }
  });
}

void init();
