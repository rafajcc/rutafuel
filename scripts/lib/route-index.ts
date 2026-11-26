/** Rejilla espacial compacta para el planificador. Sin `raw` ni URLs de auditoría. */

import { FUEL_KEYS, type ChargingStation, type FuelKey, type FuelStation } from './types.js';

/** 0,25° ≈ 28 km en latitud: suficiente para consultar corredores con radio ≤ 20 km. */
export const ROUTE_CELL_SIZE_DEG = 0.25;

export interface RouteCoordinates {
  lat: number;
  lon: number;
}

export interface RouteFuelEntry extends RouteCoordinates {
  kind: 'fuel';
  id: string;
  name?: string;
  municipality?: string;
  province?: string;
  /** Sólo combustibles con precio publicado; `null` no se emite. */
  prices: Partial<Record<FuelKey, number>>;
}

export interface RouteChargeEntry extends RouteCoordinates {
  kind: 'charging';
  id: string;
  name?: string;
  municipality?: string;
  province?: string;
  operator?: string;
  maxPowerKw: number | null;
  connectors: string[];
}

export type RouteEntry = RouteFuelEntry | RouteChargeEntry;

export interface RouteGridIndex {
  cellSizeDeg: number;
  generatedAt: string;
  sourceUpdatedAt: { fuel?: string; charging?: string };
  totals: { fuel: number; charging: number; cells: number };
  cells: Record<string, RouteEntry[]>;
}

function validCoordinates(point: RouteCoordinates): boolean {
  return (
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lon) &&
    Math.abs(point.lat) <= 90 &&
    Math.abs(point.lon) <= 180
  );
}

/** Clave estable de celda. Se usa tanto al generar como al consultar el índice. */
export function routeCellId(point: RouteCoordinates, cellSizeDeg = ROUTE_CELL_SIZE_DEG): string {
  return `${Math.floor(point.lat / cellSizeDeg)}:${Math.floor(point.lon / cellSizeDeg)}`;
}

function fuelEntry(station: FuelStation): RouteFuelEntry {
  const prices: Partial<Record<FuelKey, number>> = {};
  for (const fuel of FUEL_KEYS) {
    const price = station.prices[fuel];
    if (price !== null && Number.isFinite(price)) prices[fuel] = price;
  }
  return {
    kind: 'fuel',
    id: station.id,
    ...(station.name ? { name: station.name } : {}),
    ...(station.municipality ? { municipality: station.municipality } : {}),
    ...(station.province ? { province: station.province } : {}),
    lat: station.lat,
    lon: station.lon,
    prices,
  };
}

function chargeEntry(station: ChargingStation): RouteChargeEntry {
  return {
    kind: 'charging',
    id: station.id,
    ...(station.name ? { name: station.name } : {}),
    ...(station.municipality ? { municipality: station.municipality } : {}),
    ...(station.province ? { province: station.province } : {}),
    ...(station.operator ? { operator: station.operator } : {}),
    lat: station.lat,
    lon: station.lon,
    maxPowerKw: station.maxPowerKw,
    connectors: [...new Set(station.connectors.map((connector) => connector.type))],
  };
}

/**
 * Agrupa estaciones reales en celdas. El resultado es un único fichero ligero: una rejilla
 * permite explorar sólo las celdas cercanas a la ruta sin descargar ficheros por estación.
 */
export function buildRouteIndex(
  fuelStations: FuelStation[],
  chargingStations: ChargingStation[],
  generatedAt: string,
  sourceUpdatedAt: { fuel?: string; charging?: string } = {},
  cellSizeDeg = ROUTE_CELL_SIZE_DEG,
): RouteGridIndex {
  const cells: Record<string, RouteEntry[]> = {};
  let fuel = 0;
  let charging = 0;

  const add = (entry: RouteEntry) => {
    if (!validCoordinates(entry)) return;
    const key = routeCellId(entry, cellSizeDeg);
    (cells[key] ??= []).push(entry);
    if (entry.kind === 'fuel') fuel += 1;
    else charging += 1;
  };

  for (const station of fuelStations) add(fuelEntry(station));
  for (const station of chargingStations) add(chargeEntry(station));

  return {
    cellSizeDeg,
    generatedAt,
    sourceUpdatedAt,
    totals: { fuel, charging, cells: Object.keys(cells).length },
    cells,
  };
}
