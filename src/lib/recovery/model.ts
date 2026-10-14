export const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const ABANDON_AFTER_MS = 30 * 60 * 1000;
export const RECOVERY_KEY = 'jlcamejo.recovery.v1';
export const SESSION_KEY = 'jlcamejo.funnel.v1';
export type LeadStage = 'quote' | 'details' | 'payment' | 'complete' | 'review';
export interface LeadInput {
  /** Correo opcional si el cliente autorizó WhatsApp como canal de seguimiento. */
  email?: string;
  consent: true;
  /** Número E.164 sin +, sólo si autorizó seguimiento manual por WhatsApp. */
  whatsapp?: string;
  stage: LeadStage;
  products: string[];
  frequency: string;
  cartId: string | null;
}
export interface Lead extends LeadInput {
  id: string;
  updatedAt: number;
  expiresAt: number;
  notifiedAt?: number;
}
export function parseLead(value: unknown): LeadInput {
  if (!value || typeof value !== 'object') throw new Error('Datos inválidos');
  const v = value as Record<string, unknown>;
  if (v.consent !== true) throw new Error('Se requiere autorización');
  if (!['quote', 'details', 'payment', 'complete', 'review'].includes(String(v.stage))) throw new Error('Etapa inválida');
  if (!['monthly', 'quarterly', 'biannual', 'yearly'].includes(String(v.frequency))) throw new Error('Frecuencia inválida');
  if (!Array.isArray(v.products) || v.products.length > 4 || v.products.some(p => typeof p !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(p))) throw new Error('Productos inválidos');
  if (v.cartId !== null && (typeof v.cartId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(v.cartId))) throw new Error('Carrito inválido');
  const whatsapp = typeof v.whatsapp === 'string' && /^[1-9]\d{7,14}$/.test(v.whatsapp) ? v.whatsapp : undefined;
  if (v.whatsapp !== undefined && whatsapp === undefined) throw new Error('WhatsApp inválido');
  const email = typeof v.email === 'string' && v.email.trim() ? v.email.trim() : undefined;
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))) throw new Error('Correo inválido');
  if (!email && !whatsapp) throw new Error('Se requiere correo o WhatsApp autorizado');
  return { ...(email ? { email } : {}), consent: true, ...(whatsapp ? { whatsapp } : {}), stage: v.stage as LeadStage, products: v.products as string[], frequency: String(v.frequency), cartId: v.cartId as string | null };
}
export function shouldNotify(lead: Lead, now: number): boolean {
  return lead.consent === true && !lead.notifiedAt && lead.expiresAt > now
    && lead.updatedAt + ABANDON_AFTER_MS <= now
    && ['quote', 'details', 'payment'].includes(lead.stage);
}
export function notificationText(lead: Lead): string {
  const stage = { quote: 'Cotización', details: 'Datos / emisión', payment: 'Pago por confirmar', complete: 'Completado', review: 'Revisión de operación' }[lead.stage];
  const whatsappLink = lead.whatsapp
    ? `https://wa.me/${lead.whatsapp}?text=${encodeURIComponent('Hola, te escribimos de JLCamejo para ayudarte a continuar tu solicitud de seguro.')}`
    : null;
  return [
    'Solicitud JLC sin actividad durante al menos 30 minutos.',
    `Contacto autorizado: ${lead.email ?? 'WhatsApp autorizado'}`,
    ...(whatsappLink ? [`WhatsApp autorizado (contacto manual): ${whatsappLink}`] : []),
    `Etapa observada: ${stage}`,
    `Frecuencia preferida: ${lead.frequency}`,
    `Productos (IDs): ${lead.products.join(', ') || 'Sin selección todavía'}`,
    `Referencia interna: ${lead.id.slice(0, 12)}`,
    `Carrito: ${lead.cartId || 'Todavía no creado'}`,
    `Última actividad: ${new Date(lead.updatedAt).toISOString()}`,
    'Antes de contactar, comprueba que la solicitud siga pendiente. Este aviso no demuestra impago ni rechazo.',
    'El cliente puede retomar su avance en el mismo navegador. No emitir ni notificar pagos desde este correo. El enlace de WhatsApp abre un chat para que un asesor lo envíe manualmente.',
  ].join('\n');
}
export function recoveryEnvelope<T>(draft: T, now = Date.now()) {
  return { version: 1, expiresAt: now + RETENTION_MS, draft };
}
export function readRecovery(raw: string | null, now = Date.now()): unknown | null {
  try {
    const v = JSON.parse(raw ?? 'null');
    return v?.version === 1 && Number.isFinite(v.expiresAt) && v.expiresAt > now ? v.draft : null;
  } catch { return null; }
}
/** Write-ahead: a refresh during the request must not permit a blind retry. */
export function persistPaymentAttempt(storage: Pick<Storage, 'getItem' | 'setItem'>, keys: string[], durable?: Pick<Storage, 'getItem' | 'setItem'>): void {
  const raw = storage.getItem(SESSION_KEY);
  if (!raw) throw new Error('No se pudo guardar el estado de la operación. Recarga antes de notificar.');
  const draft = JSON.parse(raw);
  const locks = draft.paymentLocks ?? { paid: [], submitted: [] };
  draft.paymentLocks = { paid: locks.paid, submitted: [...new Set([...locks.submitted, ...keys])] };
  storage.setItem(SESSION_KEY, JSON.stringify(draft));
  if (durable) {
    const saved = readRecovery(durable.getItem(RECOVERY_KEY));
    if (saved && typeof saved === 'object') {
      durable.setItem(RECOVERY_KEY, JSON.stringify(recoveryEnvelope({ ...saved, paymentLocks: draft.paymentLocks })));
    }
  }
}
