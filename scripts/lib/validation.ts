import { MAX_PRICE, MIN_PRICE, isValidCoordinate } from './gasolineras.js';
import { FUEL_KEYS } from './types.js';
import type {
  ChargerIndex,
  ChargerSummaryStats,
  ChargingStation,
  DatasetMetadata,
  FuelStation,
  NormalizeResult,
  ValidationResult,
} from './types.js';

export interface ChargerValidationInput {
  stations: ChargingStation[];
  index: ChargerIndex;
  stats: ChargerSummaryStats;
  malformedRipreeRows: number;
  duplicatesRemoved: number;
}

export interface DatasetValidationInput {
  stations: FuelStation[];
  normalized: NormalizeResult;
  files: Record<string, unknown>;
  previous?: DatasetMetadata;
  generatedAt: string;
  dataVersion: number;
  chargers?: ChargerValidationInput;
}

type Check = ValidationResult['checks'][number];

export function validateDataset(input: DatasetValidationInput): ValidationResult {
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail: string, severity: Check['severity'] = 'error') => {
    checks.push({ name, ok, detail, severity });
  };

  const { stations, normalized } = input;
  add('registros-mínimos', stations.length >= 1000, `${stations.length} estaciones válidas`);

  const ids = new Set(stations.map((station) => station.id));
  add('identificadores-únicos', ids.size === stations.length, `${ids.size} IDs únicos para ${stations.length} estaciones`);
  add(
    'identificadores-presentes',
    stations.every((station) => Boolean(station.id.trim())),
    'Todas las estaciones tienen IDEESS',
  );

  const badCoordinates = stations.filter((station) => !isValidCoordinate(station.lat, station.lon));
  add(
    'coordenadas-válidas',
    badCoordinates.length === 0,
    `${badCoordinates.length} coordenadas inválidas en el resultado`,
  );

  const missingLocation = stations.filter(
    (station) => !station.municipality || !station.province || !station.municipalityId || !station.provinceId,
  );
  add(
    'localización-presente',
    missingLocation.length === 0,
    `${missingLocation.length} estaciones sin municipio/provincia`,
  );

  const badPrices = stations.flatMap((station) =>
    FUEL_KEYS.filter((fuel) => {
      const price = station.prices[fuel];
      return price !== null && (!Number.isFinite(price) || price < MIN_PRICE || price > MAX_PRICE);
    }),
  );
  add('precios-en-rango', badPrices.length === 0, `${badPrices.length} precios fuera de rango`);

  const discardRatio = normalized.discarded.length / (normalized.discarded.length + stations.length || 1);
  add(
    'descartes-proporción',
    discardRatio <= 0.1,
    `${(discardRatio * 100).toFixed(2)}% registros descartados`,
    discardRatio > 0.02 && discardRatio <= 0.1 ? 'warning' : 'error',
  );

  const duplicateRatio = normalized.duplicateIds.length / (stations.length || 1);
  add(
    'duplicados-proporción',
    duplicateRatio <= 0.05,
    `${(duplicateRatio * 100).toFixed(2)}% IDs duplicados`,
    duplicateRatio > 0.01 && duplicateRatio <= 0.05 ? 'warning' : 'error',
  );

  if (input.previous?.totals.stations) {
    const previous = input.previous.totals.stations;
    const change = Math.abs(stations.length - previous) / previous;
    add(
      'variación-vs-anterior',
      change <= 0.3,
      `${(change * 100).toFixed(2)}% de variación respecto a ${previous} estaciones`,
      change > 0.1 && change <= 0.3 ? 'warning' : 'error',
    );
    const previousDate = input.previous.sources[0]?.sourceUpdatedAt;
    const currentDate = input.files['metadata.json']
      ? (input.files['metadata.json'] as { sources?: Array<{ sourceUpdatedAt?: string }> }).sources?.[0]
          ?.sourceUpdatedAt
      : undefined;
    if (previousDate && currentDate) {
      add(
        'fecha-fuente-no-regresiva',
        currentDate >= previousDate,
        `fuente anterior ${previousDate}, actual ${currentDate}`,
        'warning',
      );
    }
  }

  const master = input.files['gasolineras/estaciones.json'];
  add(
    'fichero-maestro',
    Array.isArray(master) && master.length === stations.length,
    `estaciones.json con ${Array.isArray(master) ? master.length : 0} registros`,
  );

  const provinceFiles = Object.entries(input.files).filter(([path]) =>
    path.startsWith('gasolineras/provincias/'),
  );
  const municipalityFiles = Object.entries(input.files).filter(([path]) =>
    path.startsWith('gasolineras/municipios/'),
  );
  add(
    'índices-generados',
    provinceFiles.length > 0 && municipalityFiles.length > 0,
    `${provinceFiles.length} índices de provincia, ${municipalityFiles.length} de municipio`,
  );

  const indexedCount = provinceFiles.reduce(
    (total, [, value]) => total + ((value as { stationCount?: number }).stationCount ?? 0),
    0,
  );
  add('índices-coherentes', indexedCount === stations.length, `${indexedCount} estaciones indexadas`);

  const searchIndex = input.files['buscador/municipios.json'];
  if (searchIndex) {
    const entries = Array.isArray(searchIndex) ? searchIndex : [];
    const invalid = entries.filter(
      (entry) =>
        typeof entry !== 'object' ||
        entry === null ||
        !('name' in entry) ||
        !('provinceSlug' in entry) ||
        !Number.isFinite((entry as { lat?: number }).lat) ||
        !Number.isFinite((entry as { lon?: number }).lon),
    );
    add(
      'buscador-coherente',
      entries.length > 0 && invalid.length === 0,
      `${entries.length} entradas de búsqueda, ${invalid.length} inválidas`,
    );
  }

  const emptyFiles = Object.entries(input.files).filter(
    ([, value]) => typeof value === 'string' && value.trim().length === 0,
  );
  add('ficheros-no-vacíos', emptyFiles.length === 0, `${emptyFiles.length} ficheros vacíos`);

  if (input.chargers) {
    const chargers = input.chargers;
    add(
      'cargadores-registros-mínimos',
      chargers.stations.length >= 1000,
      `${chargers.stations.length} estaciones de recarga válidas`,
    );

    const chargerIds = new Set(chargers.stations.map((station) => station.id));
    add(
      'cargadores-ids-únicos',
      chargerIds.size === chargers.stations.length,
      `${chargerIds.size} IDs únicos para ${chargers.stations.length} estaciones`,
    );

    const badChargerCoordinates = chargers.stations.filter(
      (station) => !isValidCoordinate(station.lat, station.lon),
    );
    add(
      'cargadores-coordenadas-válidas',
      badChargerCoordinates.length === 0,
      `${badChargerCoordinates.length} coordenadas inválidas`,
    );

    const withoutProvenance = chargers.stations.filter(
      (station) => !station.officialId || station.sources.length === 0,
    );
    add(
      'cargadores-procedencia',
      withoutProvenance.length === 0,
      `${withoutProvenance.length} estaciones sin ID oficial o procedencia`,
    );

    const badConnectors = chargers.stations.flatMap((station) =>
      station.connectors.filter(
        (connector) =>
          !connector.type || !connector.rawType || (connector.powerKw !== null &&
            (!Number.isFinite(connector.powerKw) || connector.powerKw < 0 || connector.powerKw > 1000)),
      ),
    );
    add(
      'cargadores-conectores-válidos',
      badConnectors.length === 0,
      `${badConnectors.length} conectores con tipo o potencia inválidos`,
    );

    const master = input.files['cargadores/estaciones.json'];
    add(
      'cargadores-fichero-maestro',
      Array.isArray(master) && master.length === chargers.stations.length,
      `cargadores/estaciones.json con ${Array.isArray(master) ? master.length : 0} registros`,
    );

    const indexedChargers = chargers.index.provinces.reduce(
      (total, province) => total + province.stationCount,
      0,
    );
    add(
      'cargadores-índice-coherente',
      indexedChargers === chargers.stations.length,
      `${indexedChargers} estaciones indexadas por provincia`,
    );
    add(
      'cargadores-estadísticas-coherentes',
      chargers.stats.totals.stations === chargers.stations.length,
      `${chargers.stats.totals.stations} estaciones en estadísticas`,
    );
    add(
      'cargadores-filas-malformadas',
      chargers.malformedRipreeRows <= chargers.stations.length * 0.1,
      `${chargers.malformedRipreeRows} filas malformadas descartadas de RIPREE`,
      chargers.malformedRipreeRows > 0 ? 'warning' : 'error',
    );

    const metadataSources = (input.files['metadata.json'] as { sources?: Array<{ url?: string; note?: string }> })
      ?.sources ?? [];
    const leakedSecrets = metadataSources.filter((source) =>
      /[?&](key|apikey)=/i.test(source.url ?? '') || /x-api-key/i.test(source.url ?? ''),
    );
    add(
      'secretos-no-expuestos',
      leakedSecrets.length === 0,
      `${leakedSecrets.length} URLs con credenciales`,
    );

    if (input.previous?.totals.chargingStations) {
      const previous = input.previous.totals.chargingStations;
      const change = Math.abs(chargers.stations.length - previous) / previous;
      add(
        'cargadores-variación-vs-anterior',
        change <= 0.3,
        `${(change * 100).toFixed(2)}% de variación respecto a ${previous} estaciones de recarga`,
        change > 0.1 && change <= 0.3 ? 'warning' : 'error',
      );
    }
  }

  const ok = checks.every((check) => check.ok || check.severity === 'warning');
  return { ok, checkedAt: input.generatedAt, checks };
}
