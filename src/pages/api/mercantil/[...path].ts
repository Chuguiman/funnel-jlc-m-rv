import type { APIRoute } from 'astro';
import { mercantilFetch, mercantilPdf } from '../../../lib/mercantil';

/**
 * Proxy inverso hacia la API de Aliados de Mercantil.
 * La API key vive sólo en el servidor (env vars de Vercel).
 * La isla React llama a `/api/mercantil/<path>` y este reenvía.
 */

/** Allowlist: [método, regex del path relativo] */
const ALLOW: [string, RegExp][] = [
  ['GET', /^health$/],
  ['GET', /^products\/plans\/tentative-client$/],
  ['GET', /^products\/plans\/client\/[^/]+$/],
  ['GET', /^countries$/],
  ['GET', /^countries\/[^/]+\/locations$/],
  ['GET', /^clients\/exists$/],
  ['POST', /^clients$/],
  ['PUT', /^clients\/[^/]+\/complete$/],
  ['GET', /^auto-products\/vehicles\/vehicle-information$/],
  ['GET', /^auto-products\/vehicles\/colors$/],
  ['GET', /^auto-products\/vehicles\/locations$/],
  ['POST', /^auto-products\/vehicles\/complete-vehicle-info$/],
  ['GET', /^auto-products\/plans\/client$/],
  ['POST', /^shopcarts$/],
  ['GET', /^shopcarts\/[^/]+\/summary$/],
  ['GET', /^shopcarts\/[^/]+\/products$/],
  ['POST', /^shopcarts\/[^/]+\/products$/],
  ['POST', /^shopcarts\/[^/]+\/emit$/],
  ['GET', /^shopcarts\/[^/]+\/emit$/],
  ['GET', /^shopcarts\/[^/]+\/policies\/[^/]+\/pdf$/],
  ['POST', /^shopcarts\/[^/]+\/vehicle-property-title$/],
  ['GET', /^shopcarts\/errors$/],
  ['GET', /^payments\/exchange-rate$/],
];

export const prerender = false;

function allowed(method: string, path: string): boolean {
  if (path.includes('..')) return false;
  return ALLOW.some(([m, re]) => m === method && re.test(path));
}

/**
 * Las peticiones que mutan estado (POST/PUT/DELETE) deben venir de nuestro propio
 * sitio. Astro 7 sólo aplica su origin-check a los content-types "form-like"
 * (multipart, urlencoded, text/plain), así que un POST con `Content-Type:
 * application/json` (crear clientes, carritos, emitir, notificar pagos) se
 * aceptaba desde cualquier origen usando nuestra API key.
 *
 * Los navegadores siempre envían `Sec-Fetch-Site: same-origin` y `Origin` en
 * peticiones same-origin, así que exigir uno de los dos no afecta al funnel
 * real y bloquea el abuso desde terceros.
 *
 * Nota: un cliente no-navegador puede falsificar estas cabeceras, por lo que esto
 * es defensa en profundidad, NO un límite de seguridad. Ver docs/mercantil-inconvenientes-IT.md.
 */
function isSameOrigin(request: Request): boolean {
  if (request.headers.get('sec-fetch-site') === 'same-origin') return true;
  const origin = request.headers.get('origin');
  if (origin) {
    try {
      return new URL(origin).origin === new URL(request.url).origin;
    } catch {
      return false;
    }
  }
  return false;
}

async function handle(method: string, params: Record<string, string | undefined>, request: Request) {
  const raw = params.path;
  const path = Array.isArray(raw) ? raw.join('/') : (raw ?? '');

  if (!path) {
    return json(400, { message: 'Falta el path del recurso' });
  }
  if (!allowed(method, path)) {
    return json(403, { message: `Recurso no permitido: ${method} /${path}` });
  }
  if (method !== 'GET' && method !== 'HEAD' && !isSameOrigin(request)) {
    return json(403, { message: 'Origen no permitido: las peticiones que modifican datos deben venir del funnel.' });
  }

  // Descarga de PDF: Mercantil responde JSON { pdfName, pdfBase64 } → se decodifica y se sirve binario
  if (method === 'GET' && /\/policies\/[^/]+\/pdf$/.test(path)) {
    const query: Record<string, string> = {};
    const url = new URL(request.url);
    for (const [k, v] of url.searchParams) query[k] = v;
    const pdf = await mercantilPdf(path, query);
    if (!pdf.data) {
      return json(pdf.status >= 400 ? pdf.status : 502, { message: 'No fue posible descargar el PDF de la póliza' });
    }
    const fallbackName = `poliza-${path.split('/').at(-2)}.pdf`;
    const fileName = pdf.pdfName?.trim() ? pdf.pdfName.replace(/[^\w.\- ]+/g, '_') : fallbackName;
    return new Response(pdf.data, {
      status: pdf.status,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'Cache-Control': 'no-store',
      },
    });
  }

  // Querystring del cliente → reenvío tal cual
  const query: Record<string, string> = {};
  const url = new URL(request.url);
  for (const [k, v] of url.searchParams) query[k] = v;

  // Body: multipart (título de propiedad) se reenvía crudo; lo demás como JSON
  let rawBody: ArrayBuffer | undefined;
  let body: unknown;
  const contentType = request.headers.get('content-type') ?? '';
  const isMultipart = contentType.toLowerCase().startsWith('multipart/form-data');
  if (method !== 'GET' && method !== 'HEAD') {
    if (isMultipart) {
      if (!path.endsWith('/vehicle-property-title')) {
        return json(403, { message: 'Solo se acepta multipart en vehicle-property-title' });
      }
      rawBody = await request.arrayBuffer();
    } else {
      try {
        const text = await request.text();
        body = text ? JSON.parse(text) : undefined;
      } catch {
        return json(400, { message: 'Body JSON inválido' });
      }
    }
  }

  const result = await mercantilFetch(
    method,
    path,
    query,
    body,
    rawBody !== undefined ? { rawBody, contentType } : undefined,
  );
  return json(result.status, result.body);
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body ?? null), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

export const GET: APIRoute = (ctx) => handle('GET', ctx.params, ctx.request);
export const POST: APIRoute = (ctx) => handle('POST', ctx.params, ctx.request);
export const PUT: APIRoute = (ctx) => handle('PUT', ctx.params, ctx.request);
export const DELETE: APIRoute = (ctx) => handle('DELETE', ctx.params, ctx.request);
