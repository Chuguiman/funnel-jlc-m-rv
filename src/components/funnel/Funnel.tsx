import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { formatMoney, PAYMENT_FREQUENCIES, SALES_CHANNEL_ID } from '../../lib/config';
import type {
  CartSummary,
  ClientExists,
  EmissionError,
  EmitStatus,
  PlanCategory,
} from '../../lib/types';
import { clsx } from './clsx';
import { Button } from './ui';
import { RecoveryPanel } from './RecoveryPanel';
import { RECOVERY_KEY, SESSION_KEY, readRecovery } from '../../lib/recovery/model';
import { CotizaStep } from './steps/CotizaStep';
import { EmiteStep } from './steps/EmiteStep';
import { PagaCheckoutStep } from './steps/PagaCheckoutStep';
import type {
  ClientInfo,
  CompleteData,
  EmitConfig,
  IdentityData,
  PlanChoice,
  PaymentLocks,
  VehicleDetailData,
  VehicleFlowSelection,
} from './types';

const STEPS = [
  { n: 1, label: 'Cotiza', sub: 'Cotiza y compara' },
  { n: 2, label: 'Emite', sub: 'Confirma tus datos' },
  { n: 3, label: 'Paga', sub: 'Checkout Mercantil' },
] as const;

/* ---------- Estado global del funnel ---------- */

const defaultIdentity: IdentityData = {
  dniType: 'VEN',
  dniNumber: '',
  dniVenNationality: 'V',
  birthDate: '',
  genderId: 'M',
  countryId: '29',
  email: '',
  phoneCountryId: '29',
  phonePrefix: '+58',
  areaCode: '',
  phoneNumber: '',
};

function normalizeIdentity(identity?: Partial<IdentityData>): IdentityData {
  const dniType = identity?.dniType ?? defaultIdentity.dniType;
  const dniVenNationality = identity?.dniVenNationality;
  return {
    ...defaultIdentity,
    ...identity,
    dniType,
    // Las cotizaciones guardadas antes de este campo podían traerlo vacío.
    dniVenNationality: dniType === 'VEN' && dniVenNationality !== 'V' && dniVenNationality !== 'E'
      ? 'V'
      : (dniVenNationality ?? ''),
  };
}

const STORAGE_KEY = SESSION_KEY;

interface Persisted {
  step: number;
  paymentFrequency?: EmitConfig['paymentFrequency'];
  emitConfig?: EmitConfig;
  identity: IdentityData;
  client: ClientInfo;
  plans: PlanCategory[] | null;
  autoPlans: PlanCategory[] | null;
  selections: PlanChoice[];
  vehicleFlow: VehicleFlowSelection | null;
  cartId: string | null;
  summary: CartSummary | null;
  emissionDone: boolean;
  /** Bloqueos de pago por póliza#cuota: sobreviven al refresco. */
  paymentLocks?: PaymentLocks;
}

function loadPersisted(): Persisted | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Persisted;
    const saved = readRecovery(localStorage.getItem(RECOVERY_KEY)) as Persisted | null;
    if (!saved?.identity || !saved.client || !Array.isArray(saved.selections)) return null;
    // A stored quote is not an authoritative price. Existing carts must be reconciled.
    return { ...saved, step: saved.cartId ? 2 : 1, emissionDone: false, summary: null,
      plans: null, autoPlans: null, selections: saved.cartId ? saved.selections : [] };
  } catch {
    return null;
  }
}

/** Número venezolano para enlace wa.me; se conserva sólo con autorización expresa. */
function whatsappNumber(identity: IdentityData): string | undefined {
  const prefix = (identity.phonePrefix || (identity.phoneCountryId === '29' ? '+58' : '')).replace(/\D/g, '');
  const local = `${identity.areaCode}${identity.phoneNumber}`.replace(/\D/g, '').replace(/^0/, '');
  const value = `${prefix}${local}`;
  return /^[1-9]\d{7,14}$/.test(value) ? value : undefined;
}

export default function Funnel() {
  const persisted = useRef<Persisted | null>(typeof window !== 'undefined' ? loadPersisted() : null);

  const [step, setStep] = useState<number>(persisted.current?.step ?? 1);
  const [identity, setIdentity] = useState<IdentityData>(
    normalizeIdentity(persisted.current?.identity),
  );
  const [client, setClient] = useState<ClientInfo>(persisted.current?.client ?? {});
  const [plans, setPlans] = useState<PlanCategory[] | null>(persisted.current?.plans ?? null);
  const [autoPlans, setAutoPlans] = useState<PlanCategory[] | null>(
    persisted.current?.autoPlans ?? null,
  );
  const [selections, setSelections] = useState<PlanChoice[]>(persisted.current?.selections ?? []);
  const [vehicleFlow, setVehicleFlow] = useState<VehicleFlowSelection | null>(
    persisted.current?.vehicleFlow ?? null,
  );

  const [complete, setComplete] = useState<CompleteData>({
    firstName: '',
    lastName: '',
    countryOfBirthId: '29',
    civilStateId: 'S',
    address: { postalCode: '' },
  });
  const [vehicleDetail, setVehicleDetail] = useState<VehicleDetailData>({
    plate: '',
    colorId: '',
    commonLocationId: '',
    isArmored: false,
    chassisSerial: '',
    engineSerial: '',
  });
  const [emitConfig, setEmitConfig] = useState<EmitConfig>({
    paymentFrequency: PAYMENT_FREQUENCIES.some((frequency) => frequency.value === (persisted.current?.emitConfig?.paymentFrequency ?? persisted.current?.paymentFrequency))
      ? (persisted.current?.emitConfig?.paymentFrequency ?? persisted.current!.paymentFrequency!)
      : 'yearly',
    sendEmailConfirmation: persisted.current?.emitConfig?.sendEmailConfirmation ?? true,
    isHolderThePayee: persisted.current?.emitConfig?.isHolderThePayee ?? true,
    holderAcceptedTermsAndConditions: persisted.current?.emitConfig?.holderAcceptedTermsAndConditions ?? false,
    isHolderNotPoliticallyExposed: persisted.current?.emitConfig?.isHolderNotPoliticallyExposed ?? false,
    holderEnjoysGoodHealth: persisted.current?.emitConfig?.holderEnjoysGoodHealth ?? false,
  });

  const [cartId, setCartId] = useState<string | null>(persisted.current?.cartId ?? null);
  const [summary, setSummary] = useState<CartSummary | null>(persisted.current?.summary ?? null);
  const [emissionDone, setEmissionDone] = useState<boolean>(
    persisted.current?.emissionDone ?? false,
  );
  const [paymentLocks, setPaymentLocks] = useState<PaymentLocks>(
    persisted.current?.paymentLocks ?? { paid: [], submitted: [] },
  );

  // Persistencia automática (rehidrata al refrescar)
  useEffect(() => {
    const data: Persisted = {
      step,
      paymentFrequency: emitConfig.paymentFrequency,
      emitConfig,
      identity,
      client,
      plans,
      autoPlans,
      selections,
      vehicleFlow,
      cartId,
      summary,
      emissionDone,
      paymentLocks,
    };
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      /* noop */
    }
  }, [step, emitConfig, identity, client, plans, autoPlans, selections, vehicleFlow, cartId, summary, emissionDone, paymentLocks]);

  const hasAuto = selections.some((s) => !!s.vehicle);
  const hasVital = selections.some((s) => !s.vehicle);
  const total = selections.reduce((acc, s) => acc + s.totalPrime, 0);

  const goToStep = useCallback((n: number) => {
    // Un carrito que aún no se emitió pertenece a la selección anterior. Al
    // volver a Cotiza para editar productos, nunca debe reutilizarse.
    if (n === 1 && cartId && !emissionDone) {
      setCartId(null);
      setSummary(null);
    }
    setStep(n);
    if (n === 3) {
      setEmissionDone(true);
    }
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [cartId, emissionDone]);

  const apiGet = useCallback(async <T,>(p: Promise<T>): Promise<T> => {
    try {
      return await p;
    } catch (e) {
      // Conservar el ApiError (con .status) para que los pasos puedan
      // distinguir 404 (cliente inexistente) de otros errores
      throw e instanceof ApiError ? e : e instanceof Error ? new Error(e.message) : e;
    }
  }, []);

  return (
    <section id="funnel" className="mx-auto min-w-0 max-w-6xl px-4 pb-16 sm:px-6 sm:pb-20">
      {/* Stepper */}
      <div className="relative z-10 -mt-5 sm:-mt-8">
        <div className="rounded-[1.75rem] border border-white/80 bg-white p-4 shadow-[0_18px_44px_rgb(15_53_80_/_0.16)] sm:rounded-3xl sm:p-8">
          <ol className="flex items-start justify-between">
            {STEPS.map((s, i) => {
              const active = step === s.n;
              const done = step > s.n;
              return (
                <Fragment key={s.n}>
                  <li aria-current={active ? 'step' : undefined} className="flex w-14 shrink-0 sm:w-auto sm:flex-1">
                    <button
                      type="button"
                      onClick={() => done && goToStep(s.n)}
                      disabled={!done}
                      aria-label={done ? `Volver al paso ${s.n}: ${s.label}` : undefined}
                      className={clsx(
                        'flex w-full flex-col items-center gap-1 text-center sm:flex-1 sm:flex-row sm:gap-3 sm:text-left',
                        done && 'cursor-pointer',
                        !done && 'cursor-default',
                      )}
                    >
                      <span
                        className={clsx(
                          'flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold transition',
                          active && 'bg-brand-600 text-white shadow-md shadow-brand-600/30 ring-4 ring-brand-100',
                          done && 'bg-emerald-500 text-white',
                          !active && !done && 'bg-slate-100 text-slate-400',
                        )}
                      >
                        {done ? <Check aria-hidden="true" className="h-5 w-5" strokeWidth={3} /> : s.n}
                      </span>
                      <span>
                        <span className={clsx('block text-xs font-bold sm:text-sm', active ? 'text-brand-700' : 'text-slate-500')}>
                          {s.label}
                        </span>
                        <span className="hidden text-xs text-slate-500 sm:block">{s.sub}</span>
                      </span>
                    </button>
                  </li>
                  {i < STEPS.length - 1 && (
                    <div aria-hidden="true" className={clsx('mt-5 h-1 min-w-3 flex-1 rounded-full sm:mx-2', step > s.n ? 'bg-emerald-300' : 'bg-slate-200')} />
                  )}
                </Fragment>
              );
            })}
          </ol>

          {/* Contenido del paso */}
          <div className="mt-6 sm:mt-8">
            {step === 1 && (
              <CotizaStep
                emitConfig={emitConfig}
                setEmitConfig={setEmitConfig}
                identity={identity}
                setIdentity={setIdentity}
                client={client}
                setClient={setClient}
                plans={plans}
                setPlans={setPlans}
                autoPlans={autoPlans}
                setAutoPlans={setAutoPlans}
                selections={selections}
                setSelections={setSelections}
                vehicleFlow={vehicleFlow}
                setVehicleFlow={setVehicleFlow}
                apiGet={apiGet}
                onNext={() => goToStep(2)}
              />
            )}

            {step === 2 && (
              <EmiteStep
                identity={identity}
                client={client}
                setIdentity={setIdentity}
                setClient={setClient}
                complete={complete}
                setComplete={setComplete}
                vehicleDetail={vehicleDetail}
                setVehicleDetail={setVehicleDetail}
                emitConfig={emitConfig}
                setEmitConfig={setEmitConfig}
                selections={selections}
                vehicleFlow={vehicleFlow}
                hasAuto={hasAuto}
                hasVital={hasVital}
                cartId={cartId}
                setCartId={setCartId}
                summary={summary}
                setSummary={setSummary}
                emissionDone={emissionDone}
                setEmissionDone={setEmissionDone}
                onDone={() => goToStep(3)}
                onBack={() => goToStep(1)}
              />
            )}

            {step === 3 && (
              <PagaCheckoutStep
                cartId={cartId}
                summary={summary}
                setSummary={setSummary}
                onBack={() => goToStep(2)}
              />
            )}
          </div>
          <RecoveryPanel
            draft={{ step, identity, client, plans: null, autoPlans: null, selections, vehicleFlow, cartId, summary: null, emissionDone, paymentLocks, paymentFrequency: emitConfig.paymentFrequency }}
            lead={{ email: identity.email, products: selections.map(item => item.productId), frequency: emitConfig.paymentFrequency, cartId,
              whatsapp: whatsappNumber(identity),
              stage: paymentLocks.submitted.length ? 'review' : summary?.status === 'paid' || paymentLocks.paid.length > 0 ? 'complete' : step === 3 ? 'payment' : step === 2 ? 'details' : 'quote' }}
          />
        </div>
      </div>
    </section>
  );
}

