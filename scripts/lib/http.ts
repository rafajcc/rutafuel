export interface FetchOptions {
  timeoutMs?: number;
  attempts?: number;
  maxBytes?: number;
  signal?: AbortSignal;
  /** Cabeceras adicionales. Las credenciales deben viajar aquí, nunca en la URL. */
  headers?: Record<string, string>;
  method?: 'GET' | 'POST';
  body?: string;
}

export interface FetchedJson<T> {
  data: T;
  fetchedAt: string;
  bytes: number;
  finalUrl: string;
}

export interface FetchedBinary {
  bytes: Buffer;
  fetchedAt: string;
  finalUrl: string;
  headers: Headers;
  contentType: string | null;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_ATTEMPTS = 3;
const DEFAULT_MAX_BYTES = 40 * 1024 * 1024;
const USER_AGENT = 'rutafuel/0.1 (+https://github.com/rafajcc/rutafuel)';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestHeaders(options: FetchOptions, accept: string): Record<string, string> {
  return { accept, 'user-agent': USER_AGENT, ...options.headers };
}

async function readResponse(response: Response, options: FetchOptions, url: string): Promise<Buffer> {
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText} al descargar ${url}`);
  }

  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (contentLength > maxBytes) {
    throw new Error(`Respuesta demasiado grande (${contentLength} bytes > ${maxBytes})`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > maxBytes) {
    throw new Error(`Respuesta demasiado grande (${buffer.byteLength} bytes > ${maxBytes})`);
  }
  return buffer;
}

/** Descarga JSON con timeout, reintentos y límite de tamaño. */
export async function fetchJson<T>(url: string, options: FetchOptions = {}): Promise<FetchedJson<T>> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: options.method ?? 'GET',
        body: options.body,
        signal: options.signal ?? AbortSignal.timeout(timeoutMs),
        headers: requestHeaders(options, 'application/json'),
      });

      const buffer = await readResponse(response, options, url);
      const text = buffer.toString('utf8');
      let data: T;
      try {
        data = JSON.parse(text) as T;
      } catch (error) {
        throw new Error(`JSON inválido en ${url}: ${(error as Error).message}`);
      }

      return {
        data,
        fetchedAt: new Date().toISOString(),
        bytes: buffer.byteLength,
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

/** Descarga bytes (CSV, por ejemplo) con los mismos controles que `fetchJson`. */
export async function fetchBinary(url: string, options: FetchOptions = {}): Promise<FetchedBinary> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: options.method ?? 'GET',
        body: options.body,
        signal: options.signal ?? AbortSignal.timeout(timeoutMs),
        headers: requestHeaders(options, '*/*'),
      });
      const bytes = await readResponse(response, options, url);
      return {
        bytes,
        fetchedAt: new Date().toISOString(),
        finalUrl: response.url || url,
        headers: response.headers,
        contentType: response.headers.get('content-type'),
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
