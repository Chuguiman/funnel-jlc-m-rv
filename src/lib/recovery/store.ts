/** Server-only: Redis REST gives durable storage on serverless; never use /tmp as a database. */
import { ABANDON_AFTER_MS, RETENTION_MS, type Lead, type LeadInput } from './model';
const env = import.meta.env;
export function recoveryConfigured() {
  return !!(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN && /^[a-f0-9]{64}$/i.test(env.RECOVERY_ENCRYPTION_KEY ?? ''));
}
export async function redis<T = unknown>(...command: (string | number)[]): Promise<T> {
  if (!recoveryConfigured()) throw new Error('Recuperación no configurada');
  const url = new URL(env.UPSTASH_REDIS_REST_URL);
  if (url.protocol !== 'https:') throw new Error('Redis requiere HTTPS');
  const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(command), signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error('Almacenamiento no disponible');
  const data = await response.json();
  if (data.error) throw new Error('Error de almacenamiento');
  return data.result as T;
}
const bytes = (hex: string) => new Uint8Array(hex.match(/.{2}/g)!.map(x => parseInt(x, 16)));
const hex = (value: Uint8Array) => Array.from(value, b => b.toString(16).padStart(2, '0')).join('');
async function encryptionKey() {
  return crypto.subtle.importKey('raw', bytes(env.RECOVERY_ENCRYPTION_KEY), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function seal(value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(), new TextEncoder().encode(JSON.stringify(value)));
  return hex(iv) + ':' + hex(new Uint8Array(encrypted));
}
export async function unseal<T>(value: string): Promise<T> {
  const [iv, ciphertext] = value.split(':');
  const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(iv) }, await encryptionKey(), bytes(ciphertext));
  return JSON.parse(new TextDecoder().decode(raw));
}
export const queue = 'jlc:recovery:due';
export const leadKey = (id: string) => `jlc:recovery:lead:${id}`;
export async function getLead(id: string): Promise<Lead | null> {
  const data = await redis<string | null>('GET', leadKey(id));
  return data ? unseal<Lead>(data) : null;
}
export async function putLead(id: string, input: LeadInput) {
  const now = Date.now();
  const lead: Lead = { ...input, id, updatedAt: now, expiresAt: now + RETENTION_MS };
  const payload = await seal(lead);
  // The sent marker is separate, so updates never erase a delivered notification.
  await redis('EVAL', `redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2]); redis.call('ZADD', KEYS[2], ARGV[3], ARGV[4]); return 1`, 2,
    leadKey(id), queue, payload, Math.ceil(RETENTION_MS / 1000), now + ABANDON_AFTER_MS, id);
}
export async function removeLead(id: string) {
  await redis('EVAL', `redis.call('DEL', KEYS[1], KEYS[3], KEYS[4]); redis.call('ZREM', KEYS[2], ARGV[1]); return 1`, 4, leadKey(id), queue, `jlc:recovery:outbox:${id}`, `jlc:recovery:sent:${id}`, id);
}
export function randomToken() { return hex(crypto.getRandomValues(new Uint8Array(32))); }
export async function sessionId(token: string) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))));
}
