import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { persistPaymentAttempt } from '../../../lib/recovery/model';
import { api, ApiError } from '../../../lib/api';
import { CURRENCIES, PAYMENT_TYPES, formatMoney } from '../../../lib/config';
import {
  buildNotifyPolicies,
  calculatePaymentAmount,
  displayPaymentQuote,
  findEmittedPolicy,
  isPolicyPaid,
  markSummaryPaid,
  paymentQuoteKey,
  policyKey,
  policyTotal,
  roundPaymentAmount,
  selectPendingPolicies,
  sumPolicyTotals,
} from '../../../lib/payment';
import type {
  CartSummary,
  EmitPolicyStatus,
  ExchangeRate,
  NotifyPaymentPayload,
} from '../../../lib/types';
import { Alert, Badge, Button, Card, Divider, FieldWrapper, Input, Option, Select } from '../ui';
import type { PaymentDraft, PaymentLocks, Setter } from '../types';

export interface PagaStepProps {
  cartId: string | null;
  summary: CartSummary | null;
  setSummary: Setter<CartSummary | null>;
  rates: ExchangeRate[] | null;
  paymentLocks: PaymentLocks;
  setPaymentLocks: Setter<PaymentLocks>;
  onBack: () => void;
}

interface PayResult {
  ok: string[];
  errors: string[];
  warnings: string[];
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const details = error.fieldErrors;
    return details.length > 0 ? `${error.message}: ${details.join(', ')}` : error.message;
  }
  return error instanceof Error ? error.message : 'Error desconocido';
}

/**
 * Un 4xx significa que el core rechazó la notificación y no aplicó el pago: se
 * puede reintentar. Una caída de red, un 502 del proxy o un 5xx dejan el resultado
 * sin saber, así que la cuota queda bloqueada para no duplicar el cobro.
 */
function isAmbiguousNotifyError(error: unknown): boolean {
  if (error instanceof ApiError) return error.status >= 500;
  return true;
}

export function PagaStep({
  cartId,
  summary,
  setSummary,
  rates,
  paymentLocks,
  setPaymentLocks,
  onBack,
}: PagaStepProps) {
  const [draft, setDraft] = useState<PaymentDraft>({
    type: 'TDC',
    currency: 'USD',
    amount: 0,
    approvalNumber: '',
    payeeFirstName: '',
    payeeLastName: '',
  });
  const [paying, setPaying] = useState(false);
  const [payResult, setPayResult] = useState<PayResult | null>(null);
  const [pdfLoading, setPdfLoading] = useState<string | null>(null);
  const [emitPolicies, setEmitPolicies] = useState<EmitPolicyStatus[]>([]);
  const [emitCartStatus, setEmitCartStatus] = useState<string | null>(null);
  const paidKeys = useMemo(() => new Set(paymentLocks.paid), [paymentLocks.paid]);
  const submittedKeys = useMemo(() => new Set(paymentLocks.submitted), [paymentLocks.submitted]);
  const [totalsLoading, setTotalsLoading] = useState(false);
  const [totalsError, setTotalsError] = useState<string | null>(null);
  const [totalsAttempt, setTotalsAttempt] = useState(0);

  const tasa = rates?.[0]?.tasa_venta;
  const parsedRate = Number(tasa);
  const rateAvailable = Number.isFinite(parsedRate) && parsedRate > 0;
  const policies = summary?.policies ?? [];
  const policyKeySignature = useMemo(
    () => policies.map((policy) => policyKey(policy)).join('|'),
    [policies],
  );

  /**
   * Mientras se consulta `emit`, una cuota pendiente del summary permite iniciar
   * la carga. Cuando ya llegó el core, `isPaid` y los identificables de emisión
   * son la fuente de verdad. `summary.status` no interviene: `markSummaryPaid`
   * puede dejarlo en `emitted` con la cuota anterior pagada, y una póliza mensual
   * con la cuota vigente pendiente debe seguir apareciendo.
   */
  const pending = useMemo(() => {
    if (emitCartStatus === 'paid') return [];
    return selectPendingPolicies(policies, emitPolicies, paidKeys, submittedKeys);
  }, [policies, emitPolicies, emitCartStatus, paidKeys, submittedKeys]);
  const pendingKeySignature = useMemo(
    () => pending.map((policy) => policyKey(policy)).join('|'),
    [pending],
  );

  /**
   * `paymentQuotes[].amount` es la prima sin IGTF. El total autoritativo viene en
   * GET shopcarts/{id}/emit como policyPaymentData.cuota.mt_pendiente. El mismo
   * estado de emisión aporta recibo, convenio, cuota, entidad, área, certificado
   * y número de póliza para construir el notify sin depender de nulls del summary.
   */
  useEffect(() => {
    let cancelled = false;

    if (!cartId || policies.length === 0) {
      setEmitPolicies([]);
      setEmitCartStatus(null);
      setTotalsError(null);
      setTotalsLoading(false);
      return;
    }

    setEmitPolicies([]);
    setEmitCartStatus(null);
    setTotalsError(null);
    setTotalsLoading(true);

    api.emitStatus(cartId)
      .then((st) => {
        if (cancelled) return;
        if (!st || (st.status !== 'emitted' && st.status !== 'paid')) {
          throw new Error(`La emisión figura como "${st?.status ?? 'desconocida'}"; no hay un total confirmado.`);
        }

        const nextPolicies = Array.isArray(st.policies) ? st.policies : [];
        const keyless = policies.find((policy) => !policyKey(policy));
        if (keyless) {
          throw new Error(`El summary no identificó la póliza ${keyless.title ?? keyless.id}.`);
        }

        const targets = st.status === 'paid'
          ? []
          : selectPendingPolicies(policies, nextPolicies, paidKeys, submittedKeys);
        const missing = targets.filter((policy) => policyTotal(policy, nextPolicies) === null);
        if (missing.length > 0) {
          throw new Error(`El core no devolvió el total de ${missing.length} póliza(s).`);
        }

        setEmitCartStatus(st.status);
        setEmitPolicies(nextPolicies);
      })
      .catch((error) => {
        if (!cancelled) setTotalsError(`No se pudo consultar el total con IGTF: ${errorMessage(error)}`);
      })
      .finally(() => {
        if (!cancelled) setTotalsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [cartId, policyKeySignature, totalsAttempt, paidKeys, submittedKeys]);

  const totalUsd = useMemo(
    () => sumPolicyTotals(pending, emitPolicies),
    [pending, emitPolicies],
  );
  const totalsReady = totalUsd !== null && totalUsd > 0;

  /** USD conserva el total del core; Bs se bloquea si no hay tasa válida. */
  const expectedAmount = useMemo(
    () => calculatePaymentAmount(totalUsd, draft.currency, parsedRate),
    [totalUsd, draft.currency, parsedRate],
  );
  const paymentReady = pending.length > 0 && totalsReady
    && expectedAmount !== null && expectedAmount > 0;

  /** Rellena el monto exacto mientras el usuario no lo edite a mano. */
  const amountTouched = useRef(false);
  const notifyInFlight = useRef(false);
  useEffect(() => {
    if (amountTouched.current || expectedAmount === null) return;
    setDraft((current) => (
      current.amount === expectedAmount
        ? current
        : { ...current, amount: expectedAmount }
    ));
  }, [expectedAmount]);

  const setDraftField = <K extends keyof PaymentDraft>(key: K, value: PaymentDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  /**
   * Construye una sola notificación con todas las pólizas pendientes. Los
   * identificadores y el total salen del estado de emisión, no del summary.
   */
  const buildNotifyPayload = (target: CartSummary['policies']): NotifyPaymentPayload => {
    if (!target || expectedAmount === null) throw new Error('El total a pagar no está disponible.');
    const exchangeRate = draft.currency === 'BS' ? parsedRate : null;
    return {
      policy: buildNotifyPolicies(target, emitPolicies),
      payment: {
        type: draft.type,
        currency: draft.currency,
        amount: expectedAmount,
        approvalNumber: draft.approvalNumber,
        payeeFirstName: draft.payeeFirstName,
        payeeLastName: draft.payeeLastName,
      },
      receipt: {
        amount: expectedAmount,
        currency: draft.currency,
      },
      exchangeRate,
    };
  };

  const notifyPayments = useCallback(async () => {
    if (notifyInFlight.current || paying) return;
    if (!cartId || policies.length === 0 || !summary) {
      setPayResult({ ok: [], errors: ['No hay pólizas emitidas para notificar.'], warnings: [] });
      return;
    }
    if (pending.length === 0) {
      setPayResult({ ok: [], errors: ['No hay cuotas pendientes: todas las pólizas ya están pagadas.'], warnings: [] });
      return;
    }
    if (!totalsReady || expectedAmount === null) {
      setPayResult({
        ok: [],
        errors: [totalsError ?? 'El total a pagar aún no está disponible. Intenta consultarlo de nuevo.'],
        warnings: [],
      });
      return;
    }
    if (!draft.approvalNumber.trim()) {
      setPayResult({ ok: [], errors: ['Ingresa el código de aprobación del pago.'], warnings: [] });
      return;
    }
    if (!draft.payeeFirstName.trim() || !draft.payeeLastName.trim()) {
      setPayResult({ ok: [], errors: ['Ingresa el nombre y apellido del pagador.'], warnings: [] });
      return;
    }
    if (!(draft.amount > 0)) {
      setPayResult({ ok: [], errors: ['Ingresa el monto pagado.'], warnings: [] });
      return;
    }
    if (roundPaymentAmount(draft.amount) !== roundPaymentAmount(expectedAmount)) {
      setPayResult({
        ok: [],
        errors: [`El monto (${formatMoney(draft.amount)}) no coincide con el total a pagar (${formatMoney(expectedAmount)}).`],
        warnings: [],
      });
      return;
    }

    notifyInFlight.current = true;
    setPaying(true);
    /** Claves póliza#cuota de lo que se está notificando: bloquean el reintento. */
    const attemptKeys = new Set(
      pending
        .map((policy) => paymentQuoteKey(policy, findEmittedPolicy(policy, emitPolicies)))
        .filter(Boolean),
    );
    try {
      const payload = buildNotifyPayload(pending);
      // Persist before crossing the network boundary; closing the tab must not erase this attempt.
      persistPaymentAttempt(sessionStorage, [...attemptKeys], localStorage);
      setPaymentLocks((current) => ({ paid: current.paid, submitted: [...new Set([...current.submitted, ...attemptKeys])] }));
      // Este componente quedó fuera del flujo activo al migrar al checkout
      // hospedado. No se permite volver a notificar pagos externos desde JLC.
      void payload;
      throw new Error('El pago se realiza en la plataforma Mercantil. Usa el checkout hospedado.');

      setPaymentLocks((current) => ({
        paid: [...new Set([...current.paid, ...attemptKeys])],
        submitted: current.submitted.filter((key) => !attemptKeys.has(key)),
      }));
      setSummary(markSummaryPaid(summary!, attemptKeys));
      setPayResult({
        ok: pending.map((policy) => policy.title ?? 'Póliza'),
        errors: [],
        warnings: [],
      });

      try {
        const fresh = await api.summary(cartId!);
        const acknowledged = pending.every((policy) => {
          const key = policyKey(policy);
          const freshPolicy = (fresh.policies ?? []).find((item) => policyKey(item) === key);
          return freshPolicy ? isPolicyPaid(freshPolicy, undefined, new Set()) : false;
        });
        setSummary(acknowledged ? fresh : markSummaryPaid(fresh, attemptKeys));
        if (!acknowledged) {
          setPayResult((current) => ({
            ...(current ?? { ok: [], errors: [] }),
            warnings: ['Mercantil aceptó la notificación, pero el resumen aún no refleja el pago. No reintentes para evitar duplicarlo.'],
          }));
        }
      } catch (error) {
        setPayResult((current) => ({
          ...(current ?? { ok: [], errors: [] }),
          warnings: [`El pago fue aceptado, pero no se pudo refrescar el resumen: ${errorMessage(error)}`],
        }));
      }
    } catch (error) {
      const message = `Notificación de pago: ${errorMessage(error)}`;
      if (isAmbiguousNotifyError(error)) {
        // El core pudo aplicar el pago aunque perdiéramos la respuesta. Se bloquea
        // la cuota y se reconcilia contra GET shopcarts/{id}/emit antes de permitir
        // otro intento: reenviar a ciegas cobraría dos veces.
        setPaymentLocks((current) => ({
          paid: current.paid,
          submitted: [...new Set([...current.submitted, ...attemptKeys])],
        }));
        setTotalsAttempt((attempt) => attempt + 1);
        setPayResult({
          ok: [],
          errors: [message],
          warnings: [
            'No pudimos confirmar el resultado de la notificación, así que quedó bloqueada para no duplicar el cobro. Si ya pagaste, espera la confirmación de Mercantil; no vuelvas a notificar.',
          ],
        });
      } else {
        setPaymentLocks((current) => ({ paid: current.paid, submitted: current.submitted.filter(key => !attemptKeys.has(key)) }));
        setPayResult({ ok: [], errors: [message], warnings: [] });
      }
    } finally {
      notifyInFlight.current = false;
      setPaying(false);
    }
  }, [
    cartId,
    policies.length,
    summary,
    pending,
    pendingKeySignature,
    emitPolicies,
    expectedAmount,
    totalsReady,
    totalsError,
    draft,
    parsedRate,
    paying,
    setSummary,
    setPaymentLocks,
  ]);

  /** Descarga el PDF de la póliza. */
  const downloadPdf = async (policyId: string) => {
    setPdfLoading(policyId);
    try {
      if (!cartId) return;
      const url = await api.policyPdf(cartId, policyId);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `poliza-${policyId}.pdf`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (error) {
      setPayResult({
        ok: payResult?.ok ?? [],
        errors: [`No fue posible descargar el PDF: ${errorMessage(error)}`],
        warnings: payResult?.warnings ?? [],
      });
    } finally {
      setPdfLoading(null);
    }
  };

  return (
    <div id="paga" className="grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
      {/* ---- Columna principal ---- */}
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="font-display text-lg font-bold text-slate-900">Paga tu póliza</h3>
            <p className="mt-1 text-sm text-slate-500">
              Consulta el importe y registra un pago ya realizado. La vigencia de tu cobertura depende de la confirmación y las condiciones de Mercantil.
            </p>
          </div>
          <Badge tone="emerald">{policies.length} póliza(s)</Badge>
        </div>

        {/* Pólizas emitidas */}
        {policies.map((policy, index) => {
          const bucket = displayPaymentQuote(policy);
          const emitted = findEmittedPolicy(policy, emitPolicies);
          const paid = isPolicyPaid(policy, emitted, paidKeys);
          const submitted = !paid && submittedKeys.has(paymentQuoteKey(policy, emitted));
          const paymentTotal = policyTotal(policy, emitPolicies);
          const hasQuote = Boolean(bucket?.quote);
          return (
            <Card key={policy.id} className="p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-bold text-slate-900">{policy.title ?? `Póliza ${index + 1}`}</p>
                  <p className="mt-0.5 text-sm text-slate-500">
                    Certificado #{policy.certificateNumber} · Póliza {policy.number}
                  </p>
                </div>
                <Badge tone={paid ? 'emerald' : submitted ? 'brand' : hasQuote ? 'amber' : 'slate'}>
                  {paid ? 'Pagada' : submitted ? 'Notificación en curso' : hasQuote ? 'Pendiente' : 'Sin cuota'}
                </Badge>
              </div>
              {bucket && (
                <div className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-3">
                  <Stat label="Cuota (quote)" value={bucket.quote?.toString() ?? '—'} />
                  <Stat label="Recibo" value={bucket.receipt?.toString() ?? '—'} />
                  <Stat
                    label="Prima sin IGTF"
                    value={typeof bucket.amount === 'number' ? formatMoney(bucket.amount) : 'No informado'}
                  />
                  <Stat
                    label="Total a pagar"
                    value={paymentTotal === null ? (paid ? 'Pagada' : 'No disponible') : formatMoney(paymentTotal)}
                  />
                  {bucket.expirationDate && (
                    <Stat label="Vence" value={new Date(bucket.expirationDate).toLocaleDateString('es-VE')} />
                  )}
                </div>
              )}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  loading={pdfLoading === policy.id}
                  onClick={() => downloadPdf(policy.id)}
                >
                  📄 Descargar póliza (PDF)
                </Button>
              </div>
            </Card>
          );
        })}

        {/* Resultado del pago */}
        {payResult && (payResult.ok.length > 0 || payResult.errors.length > 0 || payResult.warnings.length > 0) && (
          <div className="space-y-3">
            {payResult.ok.length > 0 && (
              <Alert tone="success" title="Pago notificado correctamente">
                {payResult.ok.map((title) => <p key={title}>✓ {title}</p>)}
              </Alert>
            )}
            {payResult.warnings.length > 0 && (
              <Alert tone="warning" title="Pago aceptado; actualización pendiente">
                {payResult.warnings.map((warning) => <p key={warning}>{warning}</p>)}
              </Alert>
            )}
            {payResult.errors.length > 0 && (
              <Alert tone="error" title="No pudimos notificar el pago">
                {payResult.errors.map((error) => <p key={error}>{error}</p>)}
              </Alert>
            )}
          </div>
        )}
      </div>

      {/* ---- Columna lateral: pago ---- */}
      <div className="lg:sticky lg:top-28 h-fit space-y-6">
        <Card className="jlc-summary">
          <h4 className="font-display text-lg font-bold">Notificar pago externo</h4>
          <p className="mt-1 text-sm text-slate-400">
            Tasa informada por Mercantil:{' '}
            <span className="font-semibold text-accent-400">
              {rateAvailable
                ? `1 $ = ${new Intl.NumberFormat('es-VE', { maximumFractionDigits: 2 }).format(parsedRate)} Bs`
                : 'No disponible'}
            </span>
          </p>

          {totalsError && (
            <Alert tone="warning" title="Total no disponible" className="mt-4">
              <p>{totalsError}</p>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="mt-3"
                onClick={() => setTotalsAttempt((attempt) => attempt + 1)}
              >
                Reintentar consulta
              </Button>
            </Alert>
          )}

          {draft.currency === 'BS' && !rateAvailable && !totalsLoading && (
            <Alert tone="warning" title="Tasa BCV no disponible" className="mt-4">
              Selecciona USD o espera a que la tasa esté disponible para convertir el total a Bs.
            </Alert>
          )}

          <div className="mt-5 space-y-4">
            <FieldWrapper label="Instrumento de pago" required>
              <Select value={draft.type} onChange={(event) => setDraftField('type', event.target.value as PaymentDraft['type'])}>
                {PAYMENT_TYPES.map((type) => (
                  <Option key={type.value} value={type.value} label={type.label} />
                ))}
              </Select>
            </FieldWrapper>
            <div className="grid grid-cols-2 gap-3">
              <FieldWrapper label="Moneda" required>
                <Select
                  value={draft.currency}
                  onChange={(event) => {
                    const currency = event.target.value as PaymentDraft['currency'];
                    amountTouched.current = false;
                    setDraft((current) => ({
                      ...current,
                      currency,
                      amount: currency === 'BS' && !rateAvailable ? 0 : current.amount,
                    }));
                  }}
                >
                  {CURRENCIES.map((currency) => (
                    <Option key={currency.value} value={currency.value} label={currency.label} />
                  ))}
                </Select>
              </FieldWrapper>
              <FieldWrapper label="Monto pagado" required>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={draft.amount || ''}
                  onChange={(event) => {
                    amountTouched.current = true;
                    setDraftField('amount', Number(event.target.value));
                  }}
                  placeholder="0.00"
                />
                <p className="mt-1 text-xs text-slate-400">
                  {totalsLoading
                    ? 'Consultando el total con IGTF…'
                    : pending.length === 0
                      ? 'No hay cuotas pendientes.'
                      : expectedAmount === null
                        ? 'No se puede calcular el total en la moneda elegida.'
                        : `Total a pagar: ${formatMoney(expectedAmount)} ${draft.currency} (${pending.length} póliza(s))`}
                </p>
              </FieldWrapper>
            </div>
            <FieldWrapper label="Código de aprobación" required>
              <Input
                value={draft.approvalNumber}
                onChange={(event) => setDraftField('approvalNumber', event.target.value)}
                placeholder="Ej: 123456"
              />
            </FieldWrapper>
            <div className="grid grid-cols-2 gap-3">
              <FieldWrapper label="Nombre del pagador" required>
                <Input
                  value={draft.payeeFirstName}
                  onChange={(event) => setDraftField('payeeFirstName', event.target.value)}
                  placeholder="Nombre"
                />
              </FieldWrapper>
              <FieldWrapper label="Apellido del pagador" required>
                <Input
                  value={draft.payeeLastName}
                  onChange={(event) => setDraftField('payeeLastName', event.target.value)}
                  placeholder="Apellido"
                />
              </FieldWrapper>
            </div>
          </div>

          <Divider label="Importante" />
          <p className="text-xs leading-relaxed text-slate-400">
            Registra únicamente un pago que ya hayas realizado por un canal autorizado.
            Este formulario no carga tu tarjeta ni realiza transferencias. El importe mostrado
            incluye los impuestos informados por Mercantil. Si necesitas instrucciones para pagar,
            contacta con tu asesor JLC.
          </p>

          <Button
            className="mt-5 w-full"
            size="lg"
            variant="success"
            loading={paying || totalsLoading}
            disabled={!paymentReady}
            onClick={notifyPayments}
          >
            {payResult?.ok.length ? 'Pago notificado' : 'Notificar pago realizado'}
          </Button>
          <Button variant="ghost" className="mt-2 w-full" onClick={onBack}>
            <ArrowLeft aria-hidden="true" className="h-4 w-4" strokeWidth={2.25} /> Volver a Emisión
          </Button>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 font-semibold text-slate-800">{value}</p>
    </div>
  );
}
