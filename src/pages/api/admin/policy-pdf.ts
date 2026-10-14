import type { APIRoute } from 'astro';
import { adminAuthorized } from '../../../lib/admin-sync';
import { mercantilPdf } from '../../../lib/mercantil';

export const prerender = false;

const ID = /^[A-Za-z0-9_-]{1,64}$/;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

/** Cuadro póliza - recibo en PDF, para que el admin lo archive junto a la póliza. */
export const POST: APIRoute = async ({ request }) => {
  if (!adminAuthorized(request.headers.get('authorization'))) return json(401, { message: 'No autorizado' });
  let input: { shopcartId?: unknown; policyId?: unknown };
  try { input = await request.json() as typeof input; } catch { return json(400, { message: 'JSON inválido' }); }
  if (typeof input.shopcartId !== 'string' || !ID.test(input.shopcartId) || typeof input.policyId !== 'string' || !ID.test(input.policyId)) {
    return json(400, { message: 'shopcartId y policyId son obligatorios' });
  }
  const pdf = await mercantilPdf(`shopcarts/${input.shopcartId}/policies/${input.policyId}/pdf`);
  if (!pdf.data) return json(pdf.status >= 400 ? pdf.status : 502, { message: 'No fue posible descargar el PDF de la póliza' });
  return new Response(pdf.data, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Cache-Control': 'no-store',
      'X-Pdf-Name': encodeURIComponent(pdf.pdfName?.trim() || `${input.policyId}.pdf`),
    },
  });
};
