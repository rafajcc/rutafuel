import { isFuelKey } from '../lib/fuels.js';
import { haversineKm, nearest, type Coordinates } from '../lib/geo.js';
import { normalizeSearchText } from '../lib/search.js';

interface SearchEntry extends Coordinates {
  id: string;
  name: string;
  slug: string;
  provinceId: string;
  provinceName: string;
  provinceSlug: string;
  postalCodes: string[];
  stationCount: number;
}

/** Índice ligero generado por la ingesta; no incluye estaciones ni auditoría. */
interface ChargingEntry extends Coordinates {
  id: string;
  name: string;
  slug: string;
  provinceId: string;
  provinceName: string;
  provinceSlug: string;
  stationCount: number;
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // El modo sin almacenamiento sigue siendo funcional.
  }
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function pageUrl(entry: SearchEntry, coords?: Coordinates): string {
  const base = `/gasolineras/${entry.provinceSlug}/${entry.slug}/`;
  if (!coords) return base;
  return `${base}${geoUrl(coords)}`;
}

function chargingPageUrl(entry: ChargingEntry, coords?: Coordinates): string {
  const base = `/recarga-electrica/${entry.provinceSlug}/${entry.slug}/`;
  if (!coords) return base;
  return `${base}${geoUrl(coords)}`;
}

function geoUrl(coords: Coordinates): string {
  return `?lat=${coords.lat.toFixed(5)}&lon=${coords.lon.toFixed(5)}`;
}

function initMode(): void {
  const tabs = document.querySelectorAll<HTMLButtonElement>('[data-mode-tab]');
  const panels = document.querySelectorAll<HTMLElement>('[data-mode-panel]');

  const apply = (mode: string) => {
    for (const tab of tabs) tab.setAttribute('aria-selected', String(tab.dataset.modeTab === mode));
    for (const panel of panels) panel.hidden = panel.dataset.modePanel !== mode;
  };

  const saved = read('rf-mode');
  apply(saved === 'electric' || window.location.hash === '#recarga' ? 'electric' : 'fuel');

  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      const mode = tab.dataset.modeTab ?? 'fuel';
      apply(mode);
      store('rf-mode', mode);
    });
  }

  const fuelSelect = document.querySelector<HTMLSelectElement>('[data-fuel-select]');
  const savedFuel = read('rf-fuel');
  if (fuelSelect && isFuelKey(savedFuel)) fuelSelect.value = savedFuel;
  fuelSelect?.addEventListener('change', () => store('rf-fuel', fuelSelect.value));

  const chargeSelect = document.querySelector<HTMLSelectElement>('[data-charge-select]');
  const savedCharge = read('rf-charge');
  if (chargeSelect && ['all', 'slow', 'fast', 'ultra'].includes(savedCharge ?? '')) {
    chargeSelect.value = savedCharge!;
  }
  chargeSelect?.addEventListener('change', () => store('rf-charge', chargeSelect.value));
}

async function initSearch(): Promise<void> {
  const input = document.querySelector<HTMLInputElement>('#localidad');
  const datalist = document.querySelector<HTMLDataListElement>('[data-search-options]');
  const submit = document.querySelector<HTMLButtonElement>('[data-search-submit]');
  const status = document.querySelector<HTMLElement>('[data-search-status]');
  if (!input || !datalist || !submit || !status) return;

  let entries: SearchEntry[] = [];
  let loaded = false;

  const load = async () => {
    if (loaded) return;
    loaded = true;
    try {
      const response = await fetch('/data/buscador/municipios.json');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      entries = (await response.json()) as SearchEntry[];
      status.textContent = `${entries.length.toLocaleString('es-ES')} localidades disponibles.`;
    } catch {
      status.textContent = 'No se ha podido cargar el buscador. Inténtalo de nuevo más tarde.';
    }
  };

  const label = (entry: SearchEntry) => `${entry.name} (${entry.provinceName})`;

  const suggest = () => {
    const query = normalizeSearchText(input.value);
    if (!query) {
      datalist.replaceChildren();
      return;
    }
    const matches = entries
      .filter(
        (entry) =>
          normalizeSearchText(entry.name).includes(query) ||
          entry.postalCodes.some((code) => code.startsWith(query)),
      )
      .sort((a, b) => b.stationCount - a.stationCount)
      .slice(0, 40);
    const options = matches.map((entry) => {
      const option = document.createElement('option');
      option.value = label(entry);
      option.dataset.url = pageUrl(entry);
      return option;
    });
    datalist.replaceChildren(...options);
  };

  const resolve = (): SearchEntry | undefined => {
    const typed = normalizeSearchText(input.value);
    const selected = datalist.querySelector<HTMLOptionElement>(
      `option[value="${CSS.escape(input.value)}"]`,
    );
    if (selected?.dataset.url) {
      const url = selected.dataset.url;
      const match = entries.find((entry) => pageUrl(entry) === url);
      if (match) return match;
    }
    if (!typed) return undefined;
    return entries
      .filter(
        (entry) =>
          normalizeSearchText(entry.name) === typed || entry.postalCodes.includes(input.value.trim()),
      )
      .sort((a, b) => b.stationCount - a.stationCount)[0];
  };

  input.addEventListener('focus', () => void load());
  input.addEventListener('input', suggest);
  submit.addEventListener('click', () => {
    const entry = resolve();
    if (!entry) {
      status.textContent = 'No encontramos esa localidad. Prueba con otro nombre o código postal.';
      return;
    }
    window.location.assign(pageUrl(entry));
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') submit.click();
  });

  const geolocate = document.querySelector<HTMLButtonElement>('[data-geolocate]');
  geolocate?.addEventListener('click', () => {
    if (!navigator.geolocation) {
      status.textContent = 'Tu navegador no permite obtener la ubicación. Busca por localidad.';
      return;
    }
    status.textContent = 'Obteniendo ubicación…';
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coords = {
          lat: position.coords.latitude,
          lon: position.coords.longitude,
        };
        void load().then(() => {
          const closest = nearest(coords, entries);
          if (!closest) {
            status.textContent = 'No hay localidades cargadas todavía. Inténtalo de nuevo.';
            return;
          }
          const distance = Math.round(haversineKm(coords, closest));
          status.textContent = `Localidad más cercana: ${closest.name} (${distance} km).`;
          window.location.assign(pageUrl(closest, coords));
        });
      },
      () => {
        status.textContent = 'No se ha concedido permiso. Puedes buscar por localidad o código postal.';
      },
      { timeout: 8000, maximumAge: 300000 },
    );
  });
}

async function initChargingSearch(): Promise<void> {
  const input = document.querySelector<HTMLInputElement>('#charging-localidad');
  const datalist = document.querySelector<HTMLDataListElement>('[data-charging-options]');
  const submit = document.querySelector<HTMLButtonElement>('[data-charging-submit]');
  const status = document.querySelector<HTMLElement>('[data-charging-status]');
  const geolocate = document.querySelector<HTMLButtonElement>('[data-charging-geolocate]');
  if (!input || !datalist || !submit || !status) return;

  let entries: ChargingEntry[] = [];
  let loaded = false;

  const load = async () => {
    if (loaded) return;
    loaded = true;
    try {
      const response = await fetch('/data/cargadores/buscador.json');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      entries = (await response.json()) as ChargingEntry[];
      status.textContent = `${entries.length.toLocaleString('es-ES')} municipios con cargadores disponibles.`;
    } catch {
      status.textContent = 'No se ha podido cargar el buscador de recarga. Inténtalo de nuevo más tarde.';
    }
  };

  const label = (entry: ChargingEntry) => `${entry.name} (${entry.provinceName})`;

  const suggest = () => {
    const query = normalizeSearchText(input.value);
    if (!query) {
      datalist.replaceChildren();
      return;
    }
    const matches = entries
      .filter((entry) => normalizeSearchText(entry.name).includes(query))
      .sort((a, b) => b.stationCount - a.stationCount)
      .slice(0, 40);
    const options = matches.map((entry) => {
      const option = document.createElement('option');
      option.value = label(entry);
      option.dataset.url = chargingPageUrl(entry);
      return option;
    });
    datalist.replaceChildren(...options);
  };

  const resolve = (): ChargingEntry | undefined => {
    const typed = normalizeSearchText(input.value);
    const selected = datalist.querySelector<HTMLOptionElement>(
      `option[value="${CSS.escape(input.value)}"]`,
    );
    if (selected?.dataset.url) {
      const url = selected.dataset.url;
      const match = entries.find((entry) => chargingPageUrl(entry) === url);
      if (match) return match;
    }
    if (!typed) return undefined;
    return entries
      .filter((entry) => normalizeSearchText(entry.name) === typed)
      .sort((a, b) => b.stationCount - a.stationCount)[0];
  };

  input.addEventListener('focus', () => void load());
  input.addEventListener('input', suggest);
  submit.addEventListener('click', () => {
    const entry = resolve();
    if (!entry) {
      status.textContent = 'No encontramos esa localidad con cargadores. Prueba con otro nombre.';
      return;
    }
    window.location.assign(chargingPageUrl(entry));
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') submit.click();
  });

  geolocate?.addEventListener('click', () => {
    if (!navigator.geolocation) {
      status.textContent = 'Tu navegador no permite obtener la ubicación. Busca por localidad.';
      return;
    }
    status.textContent = 'Obteniendo ubicación…';
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coords = { lat: position.coords.latitude, lon: position.coords.longitude };
        void load().then(() => {
          const closest = nearest(coords, entries);
          if (!closest) {
            status.textContent = 'No hay municipios con cargadores cargados todavía. Inténtalo de nuevo.';
            return;
          }
          const distance = Math.round(haversineKm(coords, closest));
          status.textContent = `Municipio con cargadores más cercano: ${closest.name} (${distance} km).`;
          window.location.assign(chargingPageUrl(closest, coords));
        });
      },
      () => {
        status.textContent = 'No se ha concedido permiso. Puedes buscar por localidad.';
      },
      { timeout: 8000, maximumAge: 300000 },
    );
  });
}

initMode();
void initSearch();
void initChargingSearch();
