/** Lógica pura del comparador eléctrico: tramos de potencia, filtros y ordenación. */

import { haversineKm, type Coordinates } from './geo.js';

export interface ChargingConnectorLike {
  type: string;
  powerKw?: number | null;
  chargeMode?: string;
}

export interface ChargingStationLike extends Coordinates {
  id: string;
  name?: string;
  address?: string;
  operator?: string;
  municipality?: string;
  province?: string;
  status: string;
  updatedAt?: string;
  maxPowerKw: number | null;
  pointCount: number;
  connectors: ChargingConnectorLike[];
}

export type PowerTier = 'slow' | 'fast' | 'ultra' | 'unknown';

/** Tramos coherentes con la terminología de la portada (lenta/rápida/ultrarrápida). */
export const POWER_TIERS: Record<Exclude<PowerTier, 'unknown'>, { label: string; color: string; min: number; max: number | null }> = {
  slow: { label: 'Carga lenta', color: '#2563eb', min: 0, max: 22 },
  fast: { label: 'Carga rápida', color: '#7c3aed', min: 22, max: 150 },
  ultra: { label: 'Ultrarrápida', color: '#059669', min: 150, max: null },
};

export function powerTier(powerKw: number | null | undefined): PowerTier {
  if (powerKw === null || powerKw === undefined || !Number.isFinite(powerKw)) return 'unknown';
  if (powerKw < 0) return 'unknown';
  if (powerKw >= POWER_TIERS.ultra.min) return 'ultra';
  if (powerKw >= POWER_TIERS.fast.min) return 'fast';
  return 'slow';
}

export function tierColor(tier: PowerTier): string {
  return tier === 'unknown' ? '#475569' : POWER_TIERS[tier].color;
}

const CONNECTOR_LABELS: Record<string, string> = {
  CCS2: 'CCS2 (Combo 2)',
  CCS1: 'CCS1 (Combo 1)',
  CHADEMO: 'CHAdeMO',
  TYPE1: 'Tipo 1 (Yazaki)',
  TYPE2: 'Tipo 2 (Mennekes)',
  TYPE3A: 'Tipo 3A',
  TYPE3C: 'Tipo 3C',
  TESLA_EU: 'Tesla (Europa)',
  DOMESTIC_A: 'Enchufe doméstico A',
  DOMESTIC_E: 'Enchufe doméstico E',
  DOMESTIC_F: 'Enchufe doméstico F',
  DOMESTIC_L: 'Enchufe doméstico L',
  IEC60309_1P16: 'IEC 60309 1P16',
  IEC60309_3P16: 'IEC 60309 3P16',
  IEC60309_3P32: 'IEC 60309 3P32',
};

/** Las etiquetas son convenciones de nombre; el tipo original siempre se conserva en los datos. */
export function connectorLabel(type: string): string {
  return CONNECTOR_LABELS[type] ?? type;
}

/**
 * Sólo se considera fiable un estado declarado y reciente respecto a la fecha de la fuente.
 * RIPREE deja `status: unknown` en la mayoría de registros: nunca se presenta como operativo.
 */
export function hasRecentKnownStatus(
  station: Pick<ChargingStationLike, 'status' | 'updatedAt'>,
  referenceDate: string | undefined,
  maxAgeDays = 365,
): boolean {
  if (!station.status || station.status === 'unknown' || !station.updatedAt || !referenceDate) {
    return false;
  }
  const updated = Date.parse(station.updatedAt);
  const reference = Date.parse(referenceDate);
  if (!Number.isFinite(updated) || !Number.isFinite(reference)) return false;
  const ageDays = (reference - updated) / 86_400_000;
  return ageDays >= 0 && ageDays <= maxAgeDays;
}

export interface ChargingFilters {
  tier?: PowerTier | 'all';
  connector?: string;
  minPowerKw?: number;
  operator?: string;
  status?: 'all' | 'operational' | 'out-of-service';
  referenceDate?: string;
}

export function filterChargingStations<T extends ChargingStationLike>(
  stations: T[],
  filters: ChargingFilters,
  origin?: Coordinates,
  radiusKm?: number,
): T[] {
  const minPower =
    typeof filters.minPowerKw === 'number' && Number.isFinite(filters.minPowerKw)
      ? filters.minPowerKw
      : null;
  const operator = filters.operator?.toLocaleLowerCase('es-ES').trim();
  const tier = filters.tier && filters.tier !== 'all' ? filters.tier : null;

  return stations.filter((station) => {
    if (tier && powerTier(station.maxPowerKw) !== tier) return false;
    if (minPower !== null && (station.maxPowerKw === null || station.maxPowerKw < minPower)) {
      return false;
    }
    if (
      filters.connector &&
      !station.connectors.some((connector) => connector.type === filters.connector)
    ) {
      return false;
    }
    if (operator && !station.operator?.toLocaleLowerCase('es-ES').includes(operator)) return false;
    if (filters.status && filters.status !== 'all') {
      if (!hasRecentKnownStatus(station, filters.referenceDate)) return false;
      if (station.status !== filters.status) return false;
    }
    if (origin && typeof radiusKm === 'number' && Number.isFinite(radiusKm)) {
      if (haversineKm(origin, station) > radiusKm) return false;
    }
    return true;
  });
}

export type ChargingSort = 'distance' | 'power';

export function sortChargingStations<T extends ChargingStationLike>(
  stations: T[],
  origin: Coordinates,
  sort: ChargingSort,
): T[] {
  return [...stations].sort((a, b) => {
    if (sort === 'power') {
      return (
        (b.maxPowerKw ?? -1) - (a.maxPowerKw ?? -1) ||
        haversineKm(origin, a) - haversineKm(origin, b) ||
        a.id.localeCompare(b.id)
      );
    }
    return (
      haversineKm(origin, a) - haversineKm(origin, b) ||
      (b.maxPowerKw ?? -1) - (a.maxPowerKw ?? -1) ||
      a.id.localeCompare(b.id)
    );
  });
}
