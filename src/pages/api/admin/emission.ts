import type { APIRoute } from 'astro';
import { readEmission } from '../../../lib/admin-sync';
import type { AdminEmissionSyncPayload } from '../../../lib/api';

export const prerender = false;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

function sameOrigin(request: Request) {
  if (request.headers.get('sec-fetch-site') === 'same-origin') return true;
  const origin = request.headers.get('origin');
  try { return !!origin && new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}

export const POST: APIRoute = async ({ request }) => {
  if (!sameOrigin(request)) return json(403, { message: 'Origen no permitido' });
  let input: AdminEmissionSyncPayload;
  try { input = await request.json() as AdminEmissionSyncPayload; } catch { return json(400, { message: 'JSON inválido' }); }
  if (!input?.cartId || !input.customer?.documentNumber) return json(400, { message: 'Faltan datos de emisión' });

  const emission = await readEmission(input.cartId);
  if (!emission) return json(502, { message: 'No fue posible consultar la emisión en Mercantil' });
  if (!['emitted', 'paid'].includes(emission.status)) return json(409, { message: 'La emisión aún no está confirmada' });

  const url = import.meta.env.ADMIN_SYNC_URL?.trim();
  const secret = import.meta.env.ADMIN_SYNC_SECRET?.trim();
  if (!url || !secret) return json(503, { message: 'La integración con el admin aún no está configurada' });
  const payload = {
    shopcartId: input.cartId,
    mercantilClientId: input.customer.mercantilClientId,
    // Cada funnel es una campaña del admin: define origen de cartera y ejecutivo.
    campaignCode: import.meta.env.ADMIN_CAMPAIGN_CODE?.trim() || undefined,
    status: emission.status,
    paymentFrequency: emission.paymentFrequency,
    customer: input.customer,
    policies: emission.policies,
  };
  const target = new URL('/api/integrations/mercantil/funnel', url).toString();
  try {
    const response = await fetch(target, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      console.error('[admin-sync] admin rechazó la emisión', { cartId: input.cartId, status: response.status });
      return json(502, { message: 'El admin no pudo registrar la emisión' });
    }
  } catch (error) {
    console.error('[admin-sync] error al registrar emisión', { cartId: input.cartId, error });
    return json(502, { message: 'No fue posible conectar con el admin' });
  }
  return json(200, { ok: true });
};
