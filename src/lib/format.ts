/** Formateo y enlaces externos. Las coordenadas siempre son numéricas y validadas antes de uso. */

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function googleMapsUrl(lat: number, lon: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
}

export function wazeUrl(lat: number, lon: number): string {
  return `https://www.waze.com/ul?ll=${lat}%2C${lon}&navigate=yes`;
}
