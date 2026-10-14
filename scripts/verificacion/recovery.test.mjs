import test from 'node:test';
import assert from 'node:assert/strict';
import { ABANDON_AFTER_MS, RETENTION_MS, notificationText, parseLead, shouldNotify, readRecovery, recoveryEnvelope, persistPaymentAttempt, SESSION_KEY, RECOVERY_KEY } from '../../src/lib/recovery/model.ts';
import { processLead } from '../../src/lib/recovery/delivery.ts';
const now = 2_000_000_000_000;
const input = { email: 'cliente@example.com', consent: true, stage: 'details', products: ['vida'], frequency: 'quarterly', cartId: null };
const lead = (overrides = {}) => ({ ...input, id: 'test-session', updatedAt: now - ABANDON_AFTER_MS, expiresAt: now + RETENTION_MS, ...overrides });
function scenario(overrides = {}) {
  const state = { sent: 0, removed: 0, saved: null, marked: false, keys: [], messages: [] };
  const deps = {
    now, latest: async () => lead(), alreadySent: async () => state.marked,
    cartState: async () => 'emitted', getOutbox: async () => state.saved,
    saveOutbox: async value => { state.saved = value; },
    send: async (body, key) => { state.sent++; state.keys.push(key); state.messages.push(body); },
    markSent: async () => { state.marked = true; }, removeFromQueue: async () => { state.removed++; },
    from: 'JLC <avisos@example.com>', to: 'asesor@example.com', ...overrides,
  };
  return { deps, state };
}
function memory(seed = {}) {
  const map = new Map(Object.entries(seed));
  return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) };
}
test('no permite seguimiento sin consentimiento ni inyección de cabeceras', () => {
  assert.throws(() => parseLead({ ...input, consent: false }));
  assert.throws(() => parseLead({ ...input, email: 'cliente@example.com\r\nBcc: otro@example.com' }));
  assert.throws(() => parseLead({ ...input, cartId: '../secreto' }));
  assert.equal(parseLead({ ...input, dniNumber: 'NO-GUARDAR', health: true }).dniNumber, undefined);
  assert.throws(() => parseLead({ ...input, whatsapp: '+584141234567' }));
  assert.equal(parseLead({ ...input, whatsapp: '584141234567' }).whatsapp, '584141234567');
  assert.deepEqual(parseLead({ ...input, email: '', whatsapp: '584141234567' }).whatsapp, '584141234567');
  assert.throws(() => parseLead({ ...input, email: '' }));
});
test('el aviso interno añade enlace de WhatsApp sólo con autorización', () => {
  assert.doesNotMatch(notificationText(lead()), /wa\.me/);
  const text = notificationText(lead({ whatsapp: '584141234567' }));
  assert.match(text, /https:\/\/wa\.me\/584141234567/);
  assert.match(text, /contacto manual/);
});
test('abandonado solo después de 30 minutos, no ante actividad, vencimiento o finalización', () => {
  assert.equal(shouldNotify(lead(), now), true);
  for (const change of [{ updatedAt: now }, { expiresAt: now }, { stage: 'complete' }, { stage: 'review' }, { notifiedAt: now - 1 }]) assert.equal(shouldNotify(lead(change), now), false);
});
test('borrador expira a los siete días y tolera almacenamiento corrupto', () => {
  const raw = JSON.stringify(recoveryEnvelope({ step: 2 }, now));
  assert.deepEqual(readRecovery(raw, now + RETENTION_MS - 1), { step: 2 });
  assert.equal(readRecovery(raw, now + RETENTION_MS), null);
  assert.equal(readRecovery('{mal', now), null);
});
test('escribe el bloqueo antes de la red y también en la recuperación optativa', () => {
  const session = memory({ [SESSION_KEY]: JSON.stringify({ paymentLocks: { paid: ['a#1'], submitted: [] } }) });
  const durable = memory({ [RECOVERY_KEY]: JSON.stringify(recoveryEnvelope({ step: 3 })) });
  persistPaymentAttempt(session, ['b#1', 'b#1'], durable);
  assert.deepEqual(JSON.parse(session.getItem(SESSION_KEY)).paymentLocks, { paid: ['a#1'], submitted: ['b#1'] });
  assert.deepEqual(readRecovery(durable.getItem(RECOVERY_KEY)).paymentLocks.submitted, ['b#1']);
  assert.throws(() => persistPaymentAttempt(memory(), ['b#1']));
});
test('un solo aviso interno, destinatario desde configuración, nunca el cliente', async () => {
  const { deps, state } = scenario();
  assert.equal(await processLead(deps), 'sent');
  assert.equal(state.sent, 1);
  assert.equal(state.messages[0].to, 'asesor@example.com');
  assert.equal(await processLead(deps), 'skipped');
  assert.equal(state.sent, 1);
});
test('no avisa si hay actividad reciente, revocación o pago confirmado en Mercantil', async () => {
  for (const override of [
    { latest: async () => lead({ updatedAt: now }) },
    { latest: async () => null },
    { latest: async () => lead({ stage: 'review' }) },
    { latest: async () => lead({ cartId: 'cart' }), cartState: async () => 'paid' },
    { latest: async () => lead({ cartId: 'cart' }), cartState: async () => 'emission_error' },
    { latest: async () => lead({ cartId: 'cart' }), cartState: async () => 'processing' },
  ]) { const { deps, state } = scenario(override); await processLead(deps); assert.equal(state.sent, 0); }
});
test('una caída de Mercantil no se interpreta como carrito abandonado', async () => {
  const { deps, state } = scenario({ latest: async () => lead({ cartId: 'cart' }), cartState: async () => { throw new Error('offline'); } });
  await assert.rejects(() => processLead(deps));
  assert.equal(state.sent, 0);
});
test('respuesta de correo perdida conserva payload e idempotencia para el reintento', async () => {
  const { deps, state } = scenario();
  const original = deps.send;
  deps.send = async (body, key) => { await original(body, key); throw new Error('respuesta perdida'); };
  await assert.rejects(() => processLead(deps));
  assert.equal(state.marked, false);
  deps.send = original;
  deps.to = 'nuevo-destino@example.com';
  assert.equal(await processLead(deps), 'sent');
  assert.equal(state.keys[0], state.keys[1]);
  assert.deepEqual(state.messages[0], state.messages[1]);
});
test('no reenvía fuera de la ventana segura de idempotencia del proveedor', async () => {
  const { deps, state } = scenario({ getOutbox: async () => ({ startedAt: now - 23 * 60 * 60 * 1000, text: 'mismo', from: 'a', to: 'b' }) });
  assert.equal(await processLead(deps), 'manual-review');
  assert.equal(state.sent, 0);
});
