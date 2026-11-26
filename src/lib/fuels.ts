/** Contrato de combustibles del dataset generado (scripts/lib/types.ts). */

export const FUEL_KEYS = ['g95', 'g98', 'goa', 'gop', 'glp'] as const;
export type FuelKey = (typeof FUEL_KEYS)[number];

export const FUEL_LABELS: Record<FuelKey, string> = {
  g95: 'Gasolina 95 E5',
  g98: 'Gasolina 98 E5',
  goa: 'Gasóleo A',
  gop: 'Gasóleo Premium',
  glp: 'GLP',
};

export function isFuelKey(value: string | null | undefined): value is FuelKey {
  return value !== null && value !== undefined && (FUEL_KEYS as readonly string[]).includes(value);
}

export function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toLocaleString('es-ES', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

export function formatDistance(km: number | null | undefined): string {
  if (km === null || km === undefined || !Number.isFinite(km)) return '—';
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toLocaleString('es-ES', { maximumFractionDigits: 1 })} km`;
  return `${Math.round(km)} km`;
}
