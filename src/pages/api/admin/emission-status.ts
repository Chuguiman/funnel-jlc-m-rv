import type { APIRoute } from 'astro';
import { adminAuthorized, readEmission } from '../../../lib/admin-sync';

export const prerender = false;

/** Máximo de carritos por llamada: cada uno son dos consultas a Mercantil y el WAF limita ráfagas. */
const MAX_CARTS = 10;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

/**
 * Estado de pago de emisiones ya sincronizadas. Lo llama el admin (servidor a servidor) porque el
 * checkout de Mercantil termina en su propio sitio y nunca vuelve al funnel.
 */
export const POST: APIRoute = async ({ request }) => {
  if (!adminAuthorized(request.headers.get('authorization'))) return json(401, { message: 'No autorizado' });
  let input: { shopcartIds?: unknown };
  try { input = await request.json() as { shopcartIds?: unknown }; } catch { return json(400, { message: 'JSON inválido' }); }
  const ids = Array.isArray(input?.shopcartIds)
    ? [...new Set(input.shopcartIds.filter((id): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id)))]
    : [];
  if (ids.length === 0 || ids.length > MAX_CARTS) return json(400, { message: `Envía entre 1 y ${MAX_CARTS} shopcartIds` });

  const emissions = [];
  const failed: string[] = [];
  // Secuencial a propósito: el WAF de Mercantil rechaza ráfagas.
  for (const id of ids) {
    const emission = await readEmission(id);
    if (emission) emissions.push(emission);
    else failed.push(id);
  }
  return json(200, { emissions, failed });
};
