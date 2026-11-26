export interface FetchOptions {
  timeoutMs?: number;
  attempts?: number;
  maxBytes?: number;
  signal?: AbortSignal;
}

export interface FetchedJson<T> {
  data: T;
  fetchedAt: string;
  bytes: number;
  finalUrl: string;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_ATTEMPTS = 3;
const DEFAULT_MAX_BYTES = 40 * 1024 * 1024;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Descarga JSON con timeout, reintentos y límite de tamaño. */
export async function fetchJson<T>(url: string, options: FetchOptions = {}): Promise<FetchedJson<T>> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: options.signal ?? AbortSignal.timeout(timeoutMs),
        headers: { accept: 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText} al descargar ${url}`);
      }

      const contentLength = Number(response.headers.get('content-length') ?? 0);
      if (contentLength > maxBytes) {
        throw new Error(`Respuesta demasiado grande (${contentLength} bytes > ${maxBytes})`);
      }

      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > maxBytes) {
        throw new Error(`Respuesta demasiado grande (> ${maxBytes} bytes)`);
      }

      let data: T;
      try {
        data = JSON.parse(text) as T;
      } catch (error) {
        throw new Error(`JSON inválido en ${url}: ${(error as Error).message}`);
      }

      return {
        data,
        fetchedAt: new Date().toISOString(),
        bytes: Buffer.byteLength(text, 'utf8'),
        finalUrl: response.url || url,
      };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await sleep(500 * 2 ** (attempt - 1));
      }
    }
  }

  throw new Error(`No se pudo descargar ${url} tras ${attempts} intentos: ${String(lastError)}`);
}
