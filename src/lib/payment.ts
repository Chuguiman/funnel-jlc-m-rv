import type {
  CartSummary,
  CartSummaryPolicy,
  EmitPolicyStatus,
  NotifyPaymentPayload,
  PaymentQuote,
} from './types';

type NotifyPolicy = NotifyPaymentPayload['policy'][number];
type PaymentCurrency = NotifyPaymentPayload['payment']['currency'];

function asText(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim();
}

export function normalizePolicyNumber(value: unknown): string {
  return asText(value).replace(/\D/g, '');
}

/** Clave canónica para asociar el resumen de una póliza con su estado de emisión. */
export function policyKey(policy: CartSummaryPolicy): string {
  const explicit = normalizePolicyNumber(policy.policyNumber);
  if (explicit) return explicit;
  return normalizePolicyNumber(policy.number?.split('-').at(-1));
}

export function findEmittedPolicy(
  policy: CartSummaryPolicy,
  emittedPolicies: readonly EmitPolicyStatus[],
): EmitPolicyStatus | undefined {
  const key = policyKey(policy);
  if (!key) return undefined;
  return emittedPolicies.find(
    (item) => normalizePolicyNumber(item.policyPaymentData?.nu_poliza) === key,
  );
}

/** Selecciona la cuota realmente pagable, aunque no sea el primer elemento del arreglo. */
export function duePaymentQuote(policy: CartSummaryPolicy): PaymentQuote | null {
  const quotes = policy.paymentQuotes ?? [];
  return (
    quotes.find((quote) => quote.isNextDuePayment === true && Boolean(quote.quote) && !quote.isPaid)
    ?? quotes.find((quote) => Boolean(quote.quote) && !quote.isPaid)
    ?? null
  );
}

export function displayPaymentQuote(policy: CartSummaryPolicy): PaymentQuote | null {
  return duePaymentQuote(policy) ?? policy.paymentQuotes?.[0] ?? null;
}

/**
 * Clave canónica de la cuota pagable: póliza + cuota que informa el core (o la
 * vigente del resumen). Evita que un pago de la cuota 1 tape las cuotas 2..n de
 * una póliza mensual o trimestral.
 */
export function paymentQuoteKey(
  policy: CartSummaryPolicy,
  emittedPolicy: EmitPolicyStatus | undefined,
): string {
  const base = policyKey(policy);
  const quote = normalizePolicyNumber(emittedPolicy?.policyPaymentData?.cuota?.nu_cuota)
    || normalizePolicyNumber(duePaymentQuote(policy)?.quote);
  return quote ? `${base}#${quote}` : base;
}

function hasKey(keys: ReadonlySet<string>, policy: CartSummaryPolicy, emittedPolicy: EmitPolicyStatus | undefined): boolean {
  if (keys.size === 0) return false;
  const base = policyKey(policy);
  return keys.has(paymentQuoteKey(policy, emittedPolicy)) || (base !== '' && keys.has(base));
}

/** Saldo pendiente que informa el core; `null` cuando no vino o no es un número. */
export function pendingBalance(emittedPolicy: EmitPolicyStatus | undefined): number | null {
  const raw = emittedPolicy?.policyPaymentData?.cuota?.mt_pendiente;
  if (raw === null || raw === undefined || asText(raw) === '') return null;
  const amount = Number(raw);
  return Number.isFinite(amount) ? amount : null;
}

/**
 * Una póliza está pagada si el core lo confirma, si ya registramos la aceptación
 * de ESA cuota, o si el resumen trae todas sus cuotas pagadas.
 *
 * Un `isPaid` explícito del core manda sobre el resumen: en pólizas mensuales el
 * resumen puede traer la cuota anterior pagada mientras la vigente sigue pendiente.
 */
export function isPolicyPaid(
  policy: CartSummaryPolicy,
  emittedPolicy: EmitPolicyStatus | undefined,
  locallyPaidKeys: ReadonlySet<string> = new Set(),
): boolean {
  if (hasKey(locallyPaidKeys, policy, emittedPolicy)) return true;
  if (emittedPolicy?.isPaid === true) return true;
  if (emittedPolicy?.isPaid === false) return false;
  const balance = pendingBalance(emittedPolicy);
  if (balance !== null && balance <= 0) return false;
  const quotes = policy.paymentQuotes ?? [];
  return quotes.length > 0 && quotes.every(
    (quote) => quote.isPaid === true || quote.receiptStatus === 'paid' || quote.quoteStatus === 'paid',
  );
}

/**
 * `submittedKeys` son notificaciones cuyo resultado se desconoce (el core pudo
 * aplicar el pago aunque perdiéramos la respuesta). Se excluyen de las pendientes
 * porque repetirlas duplicaría el cobro.
 */
export function isPaymentPending(
  policy: CartSummaryPolicy,
  emittedPolicies: readonly EmitPolicyStatus[],
  locallyPaidKeys: ReadonlySet<string> = new Set(),
  submittedKeys: ReadonlySet<string> = new Set(),
): boolean {
  const emitted = findEmittedPolicy(policy, emittedPolicies);
  if (hasKey(submittedKeys, policy, emitted)) return false;
  if (isPolicyPaid(policy, emitted, locallyPaidKeys)) return false;
  const balance = pendingBalance(emitted);
  // Saldo explícito en cero: no hay nada que cobrar aunque el resumen traiga cuota.
  if (balance !== null && balance <= 0) return false;
  if (emitted) {
    return asText(emitted.policyPaymentData?.cuota?.nu_cuota) !== ''
      || duePaymentQuote(policy) !== null;
  }
  return duePaymentQuote(policy) !== null;
}

export function selectPendingPolicies(
  policies: readonly CartSummaryPolicy[],
  emittedPolicies: readonly EmitPolicyStatus[],
  locallyPaidKeys: ReadonlySet<string> = new Set(),
  submittedKeys: ReadonlySet<string> = new Set(),
): CartSummaryPolicy[] {
  return policies.filter((policy) => isPaymentPending(
    policy,
    emittedPolicies,
    locallyPaidKeys,
    submittedKeys,
  ));
}

export function policyTotal(policy: CartSummaryPolicy, emittedPolicies: readonly EmitPolicyStatus[]): number | null {
  const amount = pendingBalance(findEmittedPolicy(policy, emittedPolicies));
  return amount !== null && amount > 0 ? amount : null;
}

export function roundPaymentAmount(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

export function sumPolicyTotals(
  policies: readonly CartSummaryPolicy[],
  emittedPolicies: readonly EmitPolicyStatus[],
): number | null {
  if (policies.length === 0) return null;
  const amounts = policies.map((policy) => policyTotal(policy, emittedPolicies));
  if (amounts.some((amount) => amount === null)) return null;
  return roundPaymentAmount(amounts.reduce<number>((sum, amount) => sum + (amount ?? 0), 0));
}

/** USD siempre usa el total del core; Bs exige una tasa válida y positiva. */
export function calculatePaymentAmount(
  totalUsd: number | null,
  currency: PaymentCurrency,
  rate: unknown,
): number | null {
  if (totalUsd === null || !Number.isFinite(totalUsd) || totalUsd <= 0) return null;
  if (currency === 'USD') return payableAmount(totalUsd);
  const parsedRate = Number(rate);
  if (!Number.isFinite(parsedRate) || parsedRate <= 0) return null;
  return payableAmount(totalUsd * parsedRate);
}

/** Un total redondeado a 0 o a Infinity no se puede pagar ni serializar en JSON. */
function payableAmount(amount: number): number | null {
  const rounded = roundPaymentAmount(amount);
  return Number.isFinite(rounded) && rounded > 0 ? rounded : null;
}

function requiredNotifyField(
  value: unknown,
  field: string,
  policyNumber: string,
  maxLength: number,
): string {
  const result = asText(value);
  if (!result) throw new Error(`La póliza ${policyNumber || '(sin número)'} no tiene ${field}.`);
  if (result.length > maxLength) {
    throw new Error(`${field} de la póliza ${policyNumber} excede ${maxLength} caracteres.`);
  }
  return result;
}

/**
 * Construye una fila de notify exclusivamente con los identificadores del estado
 * de emisión. No reutiliza datos del summary: evitaría enviar referencias de una
 * respuesta stale o Nullable cuando el core ya dispone de la póliza emitida.
 */
export function buildNotifyPolicy(
  policy: CartSummaryPolicy,
  emittedPolicies: readonly EmitPolicyStatus[],
): NotifyPolicy {
  const emitted = findEmittedPolicy(policy, emittedPolicies);
  if (!emitted) {
    throw new Error(`No se encontró la emisión de la póliza ${policyKey(policy) || '(sin número)'}.`);
  }
  const data = emitted.policyPaymentData;
  const number = normalizePolicyNumber(data?.nu_poliza);

  const entity = requiredNotifyField(data?.cd_entidad, 'entidad', number, 1);
  if (entity !== '1' && entity !== '2') {
    throw new Error(`Entidad inválida (${entity}) en la póliza ${number}.`);
  }
  const area = requiredNotifyField(data?.cd_area, 'área', number, 2);
  if (!number || number.length > 20) {
    throw new Error(`Número de póliza inválido para notificar: ${number || '(vacío)'}.`);
  }
  const certificate = requiredNotifyField(data?.certificateNumber, 'certificado', number, 10);
  const receipt = requiredNotifyField(data?.recibo?.cd_recibo, 'recibo', number, 10);
  const agreement = requiredNotifyField(
    data?.recibo?.nu_convenio_pago,
    'convenio de pago',
    number,
    10,
  );
  const quote = requiredNotifyField(data?.cuota?.nu_cuota, 'cuota', number, 10);

  return { entity, area, number, certificate, receipt, agreement, quote };
}

export function buildNotifyPolicies(
  policies: readonly CartSummaryPolicy[],
  emittedPolicies: readonly EmitPolicyStatus[],
): NotifyPolicy[] {
  return policies.map((policy) => buildNotifyPolicy(policy, emittedPolicies));
}

/**
 * Refleja de inmediato una notificación aceptada. El resumen se persiste en el
 * funnel y evita que un segundo clic o un regreso a Paga repitan el pago aunque
 * el core todavía no haya actualizado `isPaid`.
 *
 * Sólo se marca la cuota que corresponde a la clave bloqueada, y `status: 'paid'`
 * se escribe únicamente cuando todas las cuotas de todas las pólizas quedaron
 * pagadas: en una póliza mensual con la cuota 3 pendiente, marcar `paid` global
 * escondería esa cuota.
 */
export function markSummaryPaid(
  summary: CartSummary,
  paidKeys: ReadonlySet<string>,
): CartSummary {
  const policies = (summary.policies ?? []).map((policy) => {
    if (!hasKey(paidKeys, policy, undefined)) return policy;
    const due = duePaymentQuote(policy);
    if (!due) return policy;
    return {
      ...policy,
      paymentQuotes: (policy.paymentQuotes ?? []).map((quote) => quote === due
        ? {
            ...quote,
            isPaid: true,
            receiptStatus: 'paid',
            quoteStatus: 'paid',
            isNextDuePayment: false,
          }
        : quote),
    };
  });
  const allPaid = policies.length > 0
    && policies.every((policy) => isPolicyPaid(policy, undefined, paidKeys));
  return { ...summary, status: allPaid ? 'paid' : summary.status, policies };
}