/**
 * Lectura server-side de una emisión en Mercantil con el formato que espera el admin de JLC.
 * La usan la sincronización al emitir y la conciliación de pagos que dispara el admin.
 */
import { mercantilFetch } from './mercantil';
import type { CartSummary, CartSummaryPolicy, EmitPolicyStatus, EmitStatus } from './types';

export type AdminQuote = {
  receipt: string | null;
  amount: number | null;
  dueDate: string | null;
  isPaid: boolean;
};

export type AdminPolicy = {
  id: string;
  /** Número completo de Mercantil (entidad-ramo-póliza, ej. 1-50-230289): así lo guarda el admin y así llegan las liquidaciones. */
  policyNumber: string;
  certificateNumber: string;
  receiptNumber: string;
  /** Ramo comercial de Mercantil (Vida, Accidentes Personales…); el funnel solo distingue la categoría. */
  product: string;
  category: string;
  paymentFrequency: string;
  /** Prima de cada cuota sin IGTF (lo que el admin guarda como `prima`). */
  installmentPremium: number;
  installments: number;
  annualPremium: number;
  assuredSum: number;
  currency: string;
  startDate: string | null;
  endDate: string | null;
  quotes: AdminQuote[];
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
  const items = summary.policies ?? [];
  const number = String(policy.policyPaymentData?.nu_poliza ?? '');
  // Por id; si no, por número. Nunca por certificado: todas las pólizas individuales tienen el certificado 1.
  return items.find((item) => item.id === policy.id)
    ?? (number ? items.find((item) => item.policyNumber === number || item.contractNumber === number) : undefined);
}

function serializePolicy(policy: EmitPolicyStatus, summaryItem: CartSummaryPolicy | undefined, frequency: string): AdminPolicy {
  const details = policy.policyPaymentData;
  const quotes = summaryItem?.paymentQuotes ?? [];
  const quote = quotes.find((item) => item.isNextDuePayment) ?? quotes[0];
  const shortNumber = String(details?.nu_poliza ?? summaryItem?.policyNumber ?? summaryItem?.contractNumber ?? '');
  const entity = summaryItem?.entity ?? details?.cd_entidad;
  const area = summaryItem?.area ?? details?.cd_area;
  const fullNumber = summaryItem?.number ?? (entity != null && area != null && shortNumber ? `${entity}-${area}-${shortNumber}` : shortNumber);
  return {
    id: policy.id,
    policyNumber: fullNumber,
    certificateNumber: String(details?.certificateNumber ?? summaryItem?.certificateNumber ?? ''),
    receiptNumber: String(details?.recibo?.cd_recibo ?? quote?.receipt ?? ''),
    product: summaryItem?.title || policy.product || 'Póliza Mercantil',
    category: policy.category,
    paymentFrequency: frequency,
    installmentPremium: summaryItem?.quotedAmount ?? 0,
    installments: quotes.length,
    annualPremium: summaryItem?.annualPremium ?? 0,
    assuredSum: summaryItem?.assuredSum ?? 0,
    currency: 'USD',
    startDate: summaryItem?.startDate ?? null,
    endDate: summaryItem?.endDate ?? null,
    quotes: quotes.map((item) => ({
      receipt: item.receipt ?? null,
      amount: item.amount ?? null,
      dueDate: item.expirationDate ?? null,
      isPaid: item.isPaid === true,
    })),
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
