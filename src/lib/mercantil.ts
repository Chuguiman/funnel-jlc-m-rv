/**
 * Cliente server-side de la API de Aliados de Mercantil Seguros.
 * La API key nunca sale del servidor (Vercel env vars / .env local).
 * Incluye reintentos con backoff para el rate-limit del WAF (403 "Request not authorized").
 */

const BASE_URL = (import.meta.env.MERCANTIL_API_URL as string) ||
  'https://imajev78v9.execute-api.us-east-2.amazonaws.com/ally-api';
const API_KEY = import.meta.env.MERCANTIL_API_KEY as string;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Cuerpo que devuelve el WAF cuando hay exceso de ráfaga */
function isWafForbidden(text: string): boolean {
  return text.includes('Request not authorized');
}

export interface ProxyResult {
  status: number;
  body: unknown;
}

/** Para descargas binarias (PDF de póliza) */
export interface BinaryResult {
  status: number;
  contentType: string;
  data: ArrayBuffer | null;
  /** Nombre sugerido por Mercantil para el archivo descargado */
  pdfName?: string;
}

/**
 * Proxy hacia la API de Mercantil.
 * @param method método HTTP
 * @param path   path relativo a la base (ej. "clients/exists", "shopcarts/abc/emit")
 * @param query  parámetros de querystring
 * @param body   body JSON (opcional)
 * @param init   overrides extra (rawBody para multipart, contentType, reintentos, espera)
 */
export async function mercantilFetch(
  method: string,
  path: string,
  query?: Record<string, string | undefined>,
  body?: unknown,
  init?: {
    maxRetries?: number;
    baseDelayMs?: number;
    /** Body crudo (multipart/form-data): se reenvía tal cual. */
    rawBody?: ArrayBuffer | string;
    /** Content-Type a usar cuando se reenvía rawBody (p.ej. con su boundary). */
    contentType?: string;
  },
): Promise<ProxyResult> {
  const url = new URL(BASE_URL.replace(/\/$/, '') + '/' + path.replace(/^\//, ''));
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== '') url.searchParams.set(k, v);
    }
  }

  const maxRetries = init?.maxRetries ?? 3;
  const baseDelay = init?.baseDelayMs ?? 2000;
  /**
   * Un GET es idempotente: ante un error de red se reintenta. Una mutación
   * (emit, notify-external-payment, alta de producto) puede haberse aplicado en el
   * core aunque la respuesta se perdiera; reenviarla a ciegas duplica el pago.
   * El WAF sí es seguro de reintentar en cualquier método: rechaza antes de que la
   * petición llegue a la aplicación.
   */
  const idempotent = method === 'GET' || method === 'HEAD';

  const headers: Record<string, string> = {
    'x-api-key': API_KEY,
    Accept: 'application/json',
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (init?.rawBody !== undefined && init?.contentType) headers['Content-Type'] = init.contentType;

  let last: ProxyResult = { status: 500, body: { message: 'Sin respuesta del proveedor' } };

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) await sleep(baseDelay * attempt);
    try {
      const res = await fetch(url.toString(), {
        method,
        headers,
        signal: AbortSignal.timeout(12000),
        body:
          init?.rawBody !== undefined
            ? init.rawBody
            : body !== undefined
              ? JSON.stringify(body)
              : undefined,
      });
      const text = await res.text();
      let parsed: unknown;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = { message: text };
      }

      // WAF rate-limit (403 por ráfaga) → reintentar con espera creciente
      if (res.status === 403 && isWafForbidden(text) && attempt < maxRetries) {
        last = { status: 403, body: parsed };
        continue;
      }
      return { status: res.status, body: parsed };
    } catch (err) {
      last = {
        status: 502,
        body: { message: 'Error de red llamando al proveedor', detail: String(err) },
      };
      if (!idempotent) return last;
    }
  }
  return last;
}

/**
 * Descarga el PDF de una póliza.
 * El endpoint de Mercantil NO devuelve binario: responde JSON `{ pdfName, pdfBase64 }`.
 * Aquí se decodifica el base64 y se devuelve el ArrayBuffer del PDF listo para reenviar.
 */
export async function mercantilPdf(
  path: string,
  query?: Record<string, string | undefined>,
): Promise<BinaryResult> {
  const url = new URL(BASE_URL.replace(/\/$/, '') + '/' + path.replace(/^\//, ''));
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== '') url.searchParams.set(k, v);
    }
  }

  const headers: Record<string, string> = {
    'x-api-key': API_KEY,
    Accept: 'application/json',
  };

  for (let attempt = 0; attempt <= 3; attempt++) {
    if (attempt > 0) await sleep(2000 * attempt);
    try {
      const res = await fetch(url.toString(), { method: 'GET', headers, signal: AbortSignal.timeout(12000) });

      if (res.status === 403 && isWafForbidden((await res.clone().text()))) {
        continue;
      }
      const text = await res.text();
      let parsed: { pdfName?: string; pdfBase64?: string } | null = null;
      try {
        parsed = text ? (JSON.parse(text) as { pdfName?: string; pdfBase64?: string }) : null;
      } catch {
        parsed = null;
      }
      if (!res.ok || !parsed?.pdfBase64) {
        return {
          status: res.status,
          contentType: 'application/pdf',
          data: null,
          pdfName: parsed?.pdfName,
        };
      }
      return {
        status: res.status,
        contentType: 'application/pdf',
        data: base64ToArrayBuffer(parsed.pdfBase64),
        pdfName: parsed.pdfName,
      };
    } catch {
      /* reintentar */
    }
  }
  return { status: 502, contentType: 'application/pdf', data: null };
}

/** Decodifica base64 (o base64url) a ArrayBuffer */
function base64ToArrayBuffer(b64: string): ArrayBuffer {
  let clean = b64.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  while (clean.length % 4 !== 0) clean += '=';
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
