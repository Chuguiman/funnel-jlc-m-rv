import type { APIRoute } from 'astro';
import { parseLead, RETENTION_MS } from '../../../lib/recovery/model';
import { randomToken, recoveryConfigured, redis, sessionId, putLead, removeLead, getLead } from '../../../lib/recovery/store';
export const prerender = false;
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
export const GET: APIRoute = async ({ cookies }) => {
  const enabled = recoveryConfigured() && import.meta.env.RECOVERY_ENABLED === 'true';
  const token = cookies.get('jlc_recovery')?.value;
  try {
    const existing = enabled && token && /^[a-f0-9]{64}$/.test(token) ? await getLead(await sessionId(token)) : null;
    return reply(200, { enabled, optedIn: existing?.consent === true, whatsappOptedIn: !!existing?.whatsapp });
  } catch { return reply(503, { enabled: false, error: 'Seguimiento no disponible' }); }
};
const mutate: APIRoute = async ({ request, cookies }) => {
  if (request.headers.get('origin') !== new URL(request.url).origin) return reply(403, { error: 'Origen no permitido' });
  if (!recoveryConfigured() || import.meta.env.RECOVERY_ENABLED !== 'true') return reply(503, { error: 'Seguimiento no activado' });
  let token = cookies.get('jlc_recovery')?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) token = randomToken();
  const id = await sessionId(token);
  const lock = `jlc:recovery:lock:${id}`;
  const owner = randomToken();
  let locked = false;
  try {
    // A fixed per-minute bucket also limits requests before a cookie exists.
    const bucket = Math.floor(Date.now() / 60000);
    const source = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const rateKey = `jlc:recovery:rate:${await sessionId(source)}:${bucket}`;
    const count = await redis<number>('EVAL', `local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('EXPIRE', KEYS[1], 120) end return n`, 1, rateKey);
    if (count > 40) return reply(429, { error: 'Demasiadas solicitudes' });
    locked = await redis('SET', lock, owner, 'NX', 'EX', 120) === 'OK';
    if (!locked) return reply(409, { error: 'Actualización en curso; reintenta' });
    if (request.method === 'DELETE') {
      await removeLead(id);
      cookies.delete('jlc_recovery', { path: '/' });
      return reply(200, { saved: false });
    }
    if (!request.headers.get('content-type')?.startsWith('application/json')) return reply(415, { error: 'Se requiere JSON' });
    if (Number(request.headers.get('content-length')) > 4096) return reply(413, { error: 'Solicitud demasiado grande' });
    const body = await request.text();
    if (new TextEncoder().encode(body).length > 4096) return reply(413, { error: 'Solicitud demasiado grande' });
    let input;
    try { input = parseLead(JSON.parse(body)); } catch { return reply(400, { error: 'Revisa correo, autorización y datos de seguimiento' }); }
    await putLead(id, input);
    cookies.set('jlc_recovery', token, { path: '/', httpOnly: true, secure: new URL(request.url).protocol === 'https:', sameSite: 'strict', maxAge: RETENTION_MS / 1000 });
    return reply(200, { saved: true });
  } catch { return reply(503, { error: 'No se pudo guardar el seguimiento. Tu cotización puede continuar.' }); }
  finally {
    if (locked) await redis('EVAL', `if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0`, 1, lock, owner).catch(() => {});
  }
};
export const POST = mutate;
export const DELETE = mutate;
