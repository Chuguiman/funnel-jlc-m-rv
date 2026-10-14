/**
 * Lectura server-side de una emisión en Mercantil con el formato que espera el admin de JLC.
 * La usan la sincronización al emitir y la conciliación de pagos que dispara el admin.
 */
import { mercantilFetch } from './mercantil';
import type { CartSummary, CartSummaryPolicy, EmitPolicyStatus, EmitStatus } from './types';

export type AdminPolicy = {
  id: string;
  policyNumber: string;
  certificateNumber: string;
  receiptNumber: string;
  product: string;
  category: string;
  paymentFrequency: string;
  annualPremium: number;
  assuredSum: number;
  currency: string;
  isPaid: boolean;
};

export type AdminEmissionState = {
  shopcartId: string;
  status: string;
  paymentFrequency: string;
  policies: AdminPolicy[];
};

function normalizeFrequency(value?: string) {
  const frequencies: Record<string, string> = { monthly: 'mensual', quarterly: 'trimestral', biannual: 'semestral', yearly: 'anual' };
  return frequencies[value ?? ''] ?? value ?? 'anual';
}

function policyMatch(policy: EmitPolicyStatus, summary: CartSummary) {
  const details = policy.policyPaymentData;
  const number = String(details?.nu_poliza ?? '');
  const certificate = String(details?.certificateNumber ?? '');
  return summary.policies?.find((item) =>
    item.id === policy.id || item.policyNumber === number || item.contractNumber === number || item.certificateNumber === certificate,
  );
}

function serializePolicy(policy: EmitPolicyStatus, summaryItem: CartSummaryPolicy | undefined, frequency: string): AdminPolicy {
  const details = policy.policyPaymentData;
  const quote = summaryItem?.paymentQuotes?.find((item) => item.isNextDuePayment) ?? summaryItem?.paymentQuotes?.[0];
  return {
    id: policy.id,
    policyNumber: String(details?.nu_poliza ?? summaryItem?.policyNumber ?? summaryItem?.contractNumber ?? ''),
    certificateNumber: String(details?.certificateNumber ?? summaryItem?.certificateNumber ?? ''),
    receiptNumber: String(details?.recibo?.cd_recibo ?? quote?.receipt ?? ''),
    product: policy.product || summaryItem?.title || 'Póliza Mercantil',
    category: policy.category,
    paymentFrequency: frequency,
    annualPremium: summaryItem?.annualPremium ?? 0,
    assuredSum: summaryItem?.assuredSum ?? 0,
    currency: 'USD',
    isPaid: policy.isPaid === true || quote?.isPaid === true,
  };
}

/** Consulta emisión y resumen; `null` si Mercantil no responde. */
export async function readEmission(cartId: string): Promise<AdminEmissionState | null> {
  const [emittedResult, summaryResult] = await Promise.all([
    mercantilFetch('GET', `shopcarts/${encodeURIComponent(cartId)}/emit`),
    mercantilFetch('GET', `shopcarts/${encodeURIComponent(cartId)}/summary`),
  ]);
  if (emittedResult.status >= 400 || summaryResult.status >= 400) return null;
  const emitted = emittedResult.body as EmitStatus;
  const summary = summaryResult.body as CartSummary;
  const frequency = normalizeFrequency(summary.paymentFrequency);
  return {
    shopcartId: cartId,
    status: emitted.status,
    paymentFrequency: frequency,
    policies: (emitted.policies ?? [])
      .map((policy) => serializePolicy(policy, policyMatch(policy, summary), frequency))
      .filter((policy) => policy.policyNumber),
  };
}

/** Autenticación servidor a servidor con el secreto compartido con el admin. */
export function adminAuthorized(header: string | null): boolean {
  const secret = (import.meta.env.ADMIN_SYNC_SECRET as string | undefined)?.trim() ?? '';
  if (!secret || !header?.startsWith('Bearer ')) return false;
  const received = new TextEncoder().encode(header.slice(7));
  const expected = new TextEncoder().encode(secret);
  if (received.length !== expected.length) return false;
  // Comparación en tiempo constante.
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= received[i] ^ expected[i];
  return diff === 0;
}
