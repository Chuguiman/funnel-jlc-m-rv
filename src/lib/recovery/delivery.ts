import { shouldNotify, notificationText, RETENTION_MS, type Lead } from './model.ts';
export interface Outbox { startedAt: number; text: string; from: string; to: string; }
export interface DeliveryDependencies {
  now: number;
  latest: () => Promise<Lead | null>;
  alreadySent: () => Promise<boolean>;
  cartState: (id: string) => Promise<string>;
  getOutbox: () => Promise<Outbox | null>;
  saveOutbox: (outbox: Outbox) => Promise<void>;
  send: (outbox: Outbox, idempotencyKey: string) => Promise<void>;
  markSent: () => Promise<void>;
  removeFromQueue: () => Promise<void>;
  from: string;
  to: string;
}
/** Caller must hold the same distributed lease used by updates/deletion. */
export async function processLead(deps: DeliveryDependencies): Promise<string> {
  const lead = await deps.latest();
  if (!lead || lead.expiresAt <= deps.now || ['complete', 'review'].includes(lead.stage) || await deps.alreadySent()) {
    await deps.removeFromQueue(); return 'skipped';
  }
  if (!shouldNotify(lead, deps.now)) return 'active';
  if (lead.cartId) {
    // An unavailable core is not proof of abandonment. Never send on an unknown state.
    const state = await deps.cartState(lead.cartId);
    if (['paid', 'cancelled', 'emission_error'].includes(state)) { await deps.removeFromQueue(); return 'skipped'; }
    if (state !== 'emitted') return 'deferred';
  }
  let outbox = await deps.getOutbox();
  if (outbox && deps.now - outbox.startedAt >= 23 * 60 * 60 * 1000) {
    // Provider idempotency expires at 24 h. Do not risk another delivery after that.
    await deps.removeFromQueue(); return 'manual-review';
  }
  if (!outbox) {
    outbox = { startedAt: deps.now, text: notificationText(lead), from: deps.from, to: deps.to };
    await deps.saveOutbox(outbox);
  }
  await deps.send(outbox, `jlc-abandoned/${lead.id}`);
  await deps.markSent();
  await deps.removeFromQueue();
  return 'sent';
}
export const retentionSeconds = RETENTION_MS / 1000;
