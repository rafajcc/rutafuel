const LOWERCASE_WORDS = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y']);

function capitalizeWord(word: string): string {
  if (!word) return word;
  return word[0]!.toLocaleUpperCase('es-ES') + word.slice(1).toLocaleLowerCase('es-ES');
}

/**
 * Convierte los nombres de provincia de la API (en mayúsculas, con artículos
 * entre paréntesis según la denominación del INE) a forma legible.
 * Ej.: "PALMAS (LAS)" -> "Las Palmas"; "CORUÑA (A)" -> "A Coruña".
 */
export function titleCaseProvince(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^(.*?)\s+\(([^)]+)\)$/);
  const base = match ? match[1]!.trim() : trimmed;
  const article = match ? match[2]!.trim() : '';

  const words = base.replace(/\s*\/\s*/g, ' / ').split(/\s+/).map((word, index) => {
    if (word === '/') return '/';
    const plain = word.toLocaleLowerCase('es-ES');
    if (index > 0 && LOWERCASE_WORDS.has(plain)) return plain;
    return capitalizeWord(word);
  });

  const result = words.join(' ');
  return article ? `${capitalizeWord(article)} ${result}` : result;
}

/** Slug URL seguro, sin acentos ni caracteres especiales. */
export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es-ES')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Slug con sufijo de ID para garantizar unicidad cuando dos entidades
 * distintas comparten denominación.
 */
export function uniqueSlug(name: string, id: string): string {
  const base = slugify(name) || 'sin-nombre';
  return `${base}-${id}`;
}
