import type { APIRoute } from 'astro';
import { mercantilFetch } from '../../../lib/mercantil';
import { processLead, retentionSeconds, type Outbox } from '../../../lib/recovery/delivery';
import { getLead, queue, randomToken, recoveryConfigured, redis, seal, unseal } from '../../../lib/recovery/store';
export const prerender = false;
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
export const GET: APIRoute = async ({ request }) => {
  const env = import.meta.env;
  if (!env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${env.CRON_SECRET}`) return reply(401, { error: 'No autorizado' });
  if (!recoveryConfigured() || env.RECOVERY_ENABLED !== 'true' || env.RECOVERY_EMAIL_ENABLED !== 'true' || !env.RESEND_API_KEY || !env.RECOVERY_EMAIL_FROM || !env.RECOVERY_NOTIFY_TO) return reply(503, { error: 'Avisos no activados o configuración incompleta' });
  let id: string | undefined;
  let owner: string | undefined;
  try {
    // One record per call keeps execution bounded on serverless. Schedule accordingly.
    [id] = await redis<string[]>('ZRANGEBYSCORE', queue, '-inf', Date.now(), 'LIMIT', 0, 1);
    if (!id) return reply(200, { result: 'empty' });
    owner = randomToken();
    if (await redis('SET', `jlc:recovery:lock:${id}`, owner, 'NX', 'EX', 120) !== 'OK') return reply(200, { result: 'busy' });
    const result = await processLead({
      now: Date.now(), latest: () => getLead(id!),
      alreadySent: async () => !!await redis('GET', `jlc:recovery:sent:${id}`),
      cartState: async (cartId) => {
        const response = await mercantilFetch('GET', `shopcarts/${cartId}/emit`, undefined, undefined, { maxRetries: 0 });
        if (response.status !== 200) throw new Error('Core no disponible');
        return String((response.body as { status?: string })?.status ?? 'unknown');
      },
      getOutbox: async () => {
        const raw = await redis<string | null>('GET', `jlc:recovery:outbox:${id}`);
        return raw ? unseal<Outbox>(raw) : null;
      },
      saveOutbox: async (outbox) => { await redis('SET', `jlc:recovery:outbox:${id}`, await seal(outbox), 'EX', retentionSeconds); },
      send: async (outbox, key) => {
        const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify({ from: outbox.from, to: [outbox.to], subject: 'JLC · Solicitud sin finalizar', text: outbox.text }), signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error('Envío no confirmado');
      },
      markSent: async () => { await redis('SET', `jlc:recovery:sent:${id}`, '1', 'EX', retentionSeconds); },
      removeFromQueue: async () => { await redis('ZREM', queue, id!); },
      from: env.RECOVERY_EMAIL_FROM, to: env.RECOVERY_NOTIFY_TO,
    });
    if (['deferred', 'active'].includes(result)) await redis('ZADD', queue, Date.now() + 15 * 60 * 1000, id);
    return reply(200, { result });
  } catch {
    if (id) await redis('ZADD', queue, Date.now() + 15 * 60 * 1000, id).catch(() => {});
    return reply(503, { error: 'Revisión o envío pendiente; no se confirmó la entrega' });
  } finally {
    if (id && owner) await redis('EVAL', `if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0`, 1, `jlc:recovery:lock:${id}`, owner).catch(() => {});
  }
};
