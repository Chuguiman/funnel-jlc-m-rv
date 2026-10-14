import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Clock3, Download, ExternalLink, Heart, HeartPulse, LoaderCircle, LockKeyhole, Ribbon, ShieldCheck, Siren, Syringe, type LucideIcon } from 'lucide-react';
import { api, ApiError } from '../../../lib/api';
import { formatMoney } from '../../../lib/config';
import { displayPaymentQuote, findEmittedPolicy, policyTotal } from '../../../lib/payment';
import type { CartSummary, EmitPolicyStatus } from '../../../lib/types';
import { Alert, Badge, Button, Card } from '../ui';
import type { Setter } from '../types';

export interface PagaCheckoutStepProps {
  cartId: string | null;
  summary: CartSummary | null;
  setSummary: Setter<CartSummary | null>;
  onBack: () => void;
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : 'Error desconocido';
}

function paymentProductVisual(title?: string): { icon: LucideIcon; tone: string } {
  const normalized = title?.toLocaleLowerCase('es') ?? '';
  if (normalized.includes('accidente')) return { icon: Siren, tone: 'bg-indigo-500 text-white' };
  if (normalized.includes('funerar')) return { icon: Ribbon, tone: 'bg-violet-500 text-white' };
  if (normalized.includes('hospital')) return { icon: HeartPulse, tone: 'bg-cyan-600 text-white' };
  if (normalized.includes('cáncer') || normalized.includes('cancer')) return { icon: Syringe, tone: 'bg-amber-500 text-white' };
  if (normalized.includes('vida')) return { icon: Heart, tone: 'bg-rose-500 text-white' };
  return { icon: ShieldCheck, tone: 'bg-brand-600 text-white' };
}

/**
 * Checkout hospedado de Mercantil.
 * El aliado sólo muestra la emisión y entrega al cliente el paymentUrl: no cobra,
 * no pide datos del pagador y no llama notify-external-payment.
 */
export function PagaCheckoutStep({ cartId, summary, setSummary, onBack }: PagaCheckoutStepProps) {
  const refreshInFlight = useRef(false);
  const [emitPolicies, setEmitPolicies] = useState<EmitPolicyStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState<string | null>(null);
  const [allPdfsLoading, setAllPdfsLoading] = useState(false);

  const policies = summary?.policies ?? [];
  const paymentUrl = summary?.paymentUrl;
  const canOpenCheckout = typeof paymentUrl === 'string' && paymentUrl.startsWith('https://');

  const refresh = useCallback(async () => {
    if (!cartId || refreshInFlight.current) return;
    refreshInFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      const [nextSummary, emitted] = await Promise.all([api.summary(cartId), api.emitStatus(cartId)]);
      if (emitted.status !== 'emitted' && emitted.status !== 'paid') {
        throw new Error(`La emisión figura como "${emitted.status}". Vuelve a Emite para revisar la solicitud.`);
      }
      setSummary(nextSummary);
      setEmitPolicies(emitted.policies ?? []);
    } catch (reason) {
      setError(`No pudimos actualizar la información de pago: ${errorMessage(reason)}`);
    } finally {
      setLoading(false);
      refreshInFlight.current = false;
    }
  }, [cartId, setSummary]);

  const total = useMemo(() => policies.reduce((sum, policy) => {
    const value = policyTotal(policy, emitPolicies);
    return sum + (value ?? 0);
  }, 0), [policies, emitPolicies]);
  const allPoliciesPaid = policies.length > 0 && policies.every((policy) => {
    const emitted = findEmittedPolicy(policy, emitPolicies);
    const quote = displayPaymentQuote(policy);
    return emitted?.isPaid === true || quote?.isPaid === true;
  });

  useEffect(() => {
    if (allPoliciesPaid) return;
    const checkPayment = () => { void refresh(); };
    checkPayment();
    const interval = window.setInterval(checkPayment, 15_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') checkPayment();
    };
    window.addEventListener('focus', checkPayment);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', checkPayment);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [allPoliciesPaid, refresh]);

  const savePolicyPdf = async (policyId: string) => {
    if (!cartId) return;
    const url = await api.policyPdf(cartId, policyId);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `poliza-${policyId}.pdf`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };

  const downloadPdf = async (policyId: string) => {
    setPdfLoading(policyId);
    try {
      await savePolicyPdf(policyId);
    } catch (reason) {
      setError(`No fue posible descargar el PDF: ${errorMessage(reason)}`);
    } finally {
      setPdfLoading(null);
    }
  };

  const downloadAllPdfs = async () => {
    if (policies.length === 0) return;
    setAllPdfsLoading(true);
    setError(null);
    let downloaded = 0;
    try {
      for (const policy of policies) {
        await savePolicyPdf(policy.id);
        downloaded += 1;
      }
    } catch (reason) {
      setError(`Se descargaron ${downloaded} de ${policies.length} pólizas. ${errorMessage(reason)}`);
    } finally {
      setAllPdfsLoading(false);
    }
  };

  return (
    <div id="paga" className="grid min-w-0 gap-6 pb-6 lg:gap-8 lg:pb-0 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
      <div className="min-w-0 space-y-6">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div>
            <p className="text-sm font-semibold text-brand-600">Paso 3 de 3</p>
            <h3 className="font-display mt-1 text-2xl font-bold text-slate-900">Continúa al pago seguro</h3>
            <p className="mt-2 text-sm text-slate-600">
              Tu póliza ya fue emitida. Mercantil te mostrará los métodos de pago y la moneda disponibles.
            </p>
          </div>
          {allPoliciesPaid && policies.length > 1 ? (
            <Button
              size="sm"
              variant="success"
              className="w-full shrink-0 sm:w-auto"
              loading={allPdfsLoading}
              disabled={pdfLoading !== null}
              onClick={() => void downloadAllPdfs()}
            >
              <Download aria-hidden="true" className="h-4 w-4" strokeWidth={2.25} /> Descargar {policies.length} pólizas
            </Button>
          ) : (
            <span
              aria-label={`${policies.length} póliza emitida`}
              className="inline-flex h-10 shrink-0 items-center justify-center rounded-full bg-emerald-500 px-3 text-sm font-extrabold text-white shadow-sm shadow-emerald-600/25 ring-4 ring-emerald-100"
            >
              {policies.length} Póliza
            </span>
          )}
        </div>

        {!allPoliciesPaid && canOpenCheckout && paymentUrl && (
          <a href={paymentUrl} className="mercantil-checkout-button inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-brand-600/25 transition hover:bg-brand-700 lg:hidden">
            Ir a pagar <ExternalLink aria-hidden="true" className="h-4 w-4" strokeWidth={2.25} />
          </a>
        )}

        {allPoliciesPaid ? (
          <Alert tone="success" title="Pago confirmado por Mercantil">
            Tus pólizas están pagadas. Ya puedes descargar sus PDF desde esta pantalla.
          </Alert>
        ) : (
          <Alert tone="info" title="Después de pagar">
            Mercantil mostrará su comprobante. Luego usa Atrás para volver a JLCamejo: verificaremos el carrito automáticamente y habilitaremos las pólizas pagadas.
          </Alert>
        )}

        {error && <Alert tone="warning" title="Revisa la solicitud"><p>{error}</p></Alert>}

        {policies.map((policy, index) => {
          const quote = displayPaymentQuote(policy);
          const emitted = findEmittedPolicy(policy, emitPolicies);
          const payable = policyTotal(policy, emitPolicies);
          const paid = emitted?.isPaid === true || quote?.isPaid === true;
          const amount = payable ?? quote?.amount ?? policy.annualPremium ?? policy.quotedAmount;
          const visual = paymentProductVisual(policy.title);
          const ProductIcon = visual.icon;
          return (
            <Card key={policy.id} className="overflow-hidden p-0">
              <div className="min-w-0 p-4 sm:p-5">
                <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${visual.tone}`} aria-hidden="true">
                      <ProductIcon className="h-5 w-5" strokeWidth={2.25} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-base font-bold leading-snug text-slate-900">{policy.title ?? `Póliza ${index + 1}`}</p>
                      <p className="mt-1 text-xs leading-relaxed text-slate-500">Certificado #{policy.certificateNumber ?? '—'} · Póliza {policy.number ?? policy.policyNumber ?? '—'}</p>
                    </div>
                  </div>
                  <Badge tone={paid ? 'emerald' : 'amber'} className="w-fit shrink-0 leading-tight">{paid ? 'Pagada' : 'Por pagar'}</Badge>
                </div>
                <div className="mt-4 rounded-2xl bg-slate-50 p-4">
                  <div className="flex flex-col items-start gap-1 sm:flex-row sm:items-end sm:justify-between sm:gap-3">
                    <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Total a pagar</span>
                    <span className="font-display whitespace-nowrap text-2xl font-extrabold text-brand-800">{typeof amount === 'number' ? formatMoney(amount) : 'Consultando…'}</span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 border-t border-slate-200 pt-3 text-xs">
                    <div>
                      <p className="font-semibold uppercase tracking-wide text-slate-400">Suma asegurada</p>
                      <p className="mt-0.5 font-bold text-slate-700">{typeof policy.assuredSum === 'number' ? formatMoney(policy.assuredSum) : 'Según póliza'}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold uppercase tracking-wide text-slate-400">Recibo</p>
                      <p className="mt-0.5 font-bold text-slate-700">{quote?.receipt?.toString() ?? 'Pendiente'}</p>
                    </div>
                  </div>
                </div>
                {paid ? (
                  <Button size="sm" variant="primary" className="mt-4 w-full shadow-md shadow-brand-600/20 sm:w-auto" loading={pdfLoading === policy.id} disabled={allPdfsLoading} onClick={() => downloadPdf(policy.id)}>
                    <Download aria-hidden="true" className="h-4 w-4" strokeWidth={2.25} /> Descargar póliza (PDF)
                  </Button>
                ) : (
                  <p className="mt-4 inline-flex items-center gap-2 text-xs font-semibold text-slate-500">
                    <LockKeyhole aria-hidden="true" className="h-4 w-4 text-slate-400" strokeWidth={2.25} /> Disponible al confirmar el pago
                  </p>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      <div className="hidden h-fit space-y-4 lg:sticky lg:top-28 lg:block">
        <Card className="jlc-summary">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-accent-300">Pago protegido</p>
              <h4 className="font-display mt-1 text-xl font-bold">Finaliza en Mercantil</h4>
            </div>
            <div className="mercantil-logo-lockup" aria-label="Mercantil Seguros">
              <img src="/mercantil-logo.png" alt="Mercantil Seguros" width="752" height="215" />
            </div>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-slate-300">
            JLCamejo gestiona tu emisión; Mercantil procesa el pago. Allí eliges el método y la moneda habilitados para esta emisión.
          </p>
          <div className="mt-5 rounded-xl bg-white/10 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">Total pendiente informado por Mercantil</p>
            <p className="mt-1 text-2xl font-bold text-white">{total > 0 ? formatMoney(total) : 'Consultando…'}</p>
            <p className="mt-1 text-xs text-slate-300">El checkout aplica la moneda y condiciones disponibles.</p>
          </div>
          {!canOpenCheckout && !loading && (
            <Alert tone="warning" title="Enlace de pago no disponible" className="mt-4 bg-white/95">
              Actualiza la emisión. Si el enlace sigue ausente, comparte el carrito con Mercantil.
            </Alert>
          )}
          {canOpenCheckout && paymentUrl && !allPoliciesPaid ? (
            <a href={paymentUrl} className="mercantil-checkout-button mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-emerald-600 px-8 py-3.5 text-base font-semibold text-white shadow-md shadow-emerald-600/25 transition hover:bg-emerald-700">
              Continuar al pago seguro <ExternalLink aria-hidden="true" className="h-4 w-4" strokeWidth={2.25} />
            </a>
          ) : (
            <Button className="mercantil-checkout-button mt-5 w-full" size="lg" variant="success" disabled>
              {allPoliciesPaid ? 'Pago confirmado' : 'Enlace de pago no disponible'}
            </Button>
          )}
          {!allPoliciesPaid && (
            <p className="mt-4 flex items-center gap-2 text-xs font-semibold text-slate-300">
              {loading ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" strokeWidth={2.25} /> : <Clock3 aria-hidden="true" className="h-4 w-4" strokeWidth={2.25} />}
              {loading ? 'Verificando el pago…' : 'Esperando confirmación de Mercantil. Revisamos automáticamente.'}
            </p>
          )}
          <Button className="mt-2 w-full" variant="ghost" onClick={onBack}><ArrowLeft aria-hidden="true" className="h-4 w-4" strokeWidth={2.25} /> Volver a Emisión</Button>
        </Card>
        <p className="px-2 text-center text-xs leading-relaxed text-slate-500">
          JLCamejo no solicita ni procesa datos de tarjeta, códigos de aprobación ni información bancaria.
        </p>
      </div>
      <div className="min-w-0 lg:hidden">
        <Card className="overflow-hidden border-brand-100 p-0 shadow-lg shadow-brand-900/10">
          <div className="flex min-w-0 flex-col items-start gap-3 bg-brand-900 px-5 py-4 text-white sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/12 text-accent-400 ring-1 ring-white/15"><ShieldCheck aria-hidden="true" className="h-5 w-5" strokeWidth={2.25} /></span>
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-wider text-accent-300">Pago protegido</p>
                <h4 className="font-display truncate text-lg font-bold">Finaliza en Mercantil</h4>
              </div>
            </div>
            <div className="mercantil-logo-lockup w-24 min-h-10 shrink-0" aria-label="Mercantil Seguros">
              <img src="/mercantil-logo.png" alt="Mercantil Seguros" width="752" height="215" />
            </div>
          </div>
          <div className="p-5">
            <p className="text-sm leading-relaxed text-slate-600">Mercantil procesa el pago y te mostrará los métodos y moneda disponibles para tu emisión.</p>
            <div className="mt-4 flex flex-col items-start gap-2 rounded-2xl bg-brand-50 p-4 sm:flex-row sm:items-end sm:justify-between sm:gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-brand-700">Total pendiente</p>
                <p className="mt-1 text-xs text-slate-500">Importe informado por Mercantil</p>
              </div>
              <p className="font-display whitespace-nowrap text-2xl font-extrabold text-brand-800">{total > 0 ? formatMoney(total) : 'Consultando…'}</p>
            </div>
            {!canOpenCheckout && !loading && (
              <Alert tone="warning" title="Enlace de pago no disponible" className="mt-4">
                Actualiza la emisión. Si el enlace sigue ausente, comparte el carrito con Mercantil.
              </Alert>
            )}
            {canOpenCheckout && paymentUrl && !allPoliciesPaid ? (
              <a href={paymentUrl} className="mercantil-checkout-button mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-8 py-3.5 text-base font-semibold text-white shadow-md shadow-brand-600/25 transition hover:bg-brand-700">
                Ir al pago seguro <ExternalLink aria-hidden="true" className="h-4 w-4" strokeWidth={2.25} />
              </a>
            ) : (
              <Button className="mercantil-checkout-button mt-5 w-full" size="lg" disabled>
                {allPoliciesPaid ? 'Pago confirmado' : 'Enlace de pago no disponible'}
              </Button>
            )}
            {!allPoliciesPaid && (
              <p className="mt-4 flex items-center justify-center gap-2 text-center text-xs font-semibold text-brand-700">
                {loading ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" strokeWidth={2.25} /> : <Clock3 aria-hidden="true" className="h-4 w-4" strokeWidth={2.25} />}
                {loading ? 'Verificando el pago…' : 'Esperando confirmación de Mercantil.'}
              </p>
            )}
            <Button variant="ghost" className="mt-3 w-full px-3" onClick={onBack}>
              <ArrowLeft aria-hidden="true" className="h-4 w-4" strokeWidth={2.25} /> Volver a Emisión
            </Button>
            <p className="mt-4 text-center text-xs leading-relaxed text-slate-500">JLCamejo no solicita ni procesa datos de tarjeta ni información bancaria.</p>
          </div>
        </Card>
      </div>
    </div>
  );
}
