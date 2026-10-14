import { useEffect, useState } from 'react';
import { ArrowRight, Heart, HeartPulse, Pencil, Ribbon, ShieldCheck, ShoppingBasket, Siren, Syringe, type LucideIcon } from 'lucide-react';
import { api, ApiError } from '../../../lib/api';
import { DNI_TYPES, EMAIL_REGEX, PAYMENT_FREQUENCIES, PRODUCT_VITALES, VEN_CEDULA_NATIONALITIES, VITAL_PRODUCT_OPTIONS, formatMoney } from '../../../lib/config';
import type {
  ClientExists,
  PlanCategory,
  PlanProduct,
  VehicleBrand,
  VehicleDataItem,
  VehicleModel,
  VehicleVersion,
} from '../../../lib/types';
import { clsx } from '../clsx';
import { Alert, Badge, Button, Card, Divider, FieldWrapper, Input, Option, SearchableSelect, Select } from '../ui';
import type {
  EmitConfig,
  ClientInfo,
  IdentityData,
  PlanChoice as FPlanChoice,
  Setter,
  VehicleFlowSelection as FVehicleFlow,
} from '../types';

const VITAL_VISUALS = {
  vida: { icon: Heart, tone: 'bg-rose-50 text-rose-600 ring-rose-100', active: 'bg-rose-500 text-white', border: 'border-rose-300 ring-rose-100', surface: 'bg-rose-50/50', accent: 'border-rose-200 group-hover:border-rose-400 group-hover:bg-rose-50/40', choiceCard: 'border-rose-600 bg-rose-600 hover:bg-rose-700', choiceIcon: 'bg-white/15 text-white ring-white/30' },
  accidentes: { icon: Siren, tone: 'bg-indigo-50 text-indigo-600 ring-indigo-100', active: 'bg-indigo-500 text-white', border: 'border-indigo-300 ring-indigo-100', surface: 'bg-indigo-50/50', accent: 'border-indigo-200 group-hover:border-indigo-400 group-hover:bg-indigo-50/40', choiceCard: 'border-indigo-600 bg-indigo-600 hover:bg-indigo-700', choiceIcon: 'bg-white/15 text-white ring-white/30' },
  funerario: { icon: Ribbon, tone: 'bg-violet-50 text-violet-600 ring-violet-100', active: 'bg-violet-500 text-white', border: 'border-violet-300 ring-violet-100', surface: 'bg-violet-50/50', accent: 'border-violet-200 group-hover:border-violet-400 group-hover:bg-violet-50/40', choiceCard: 'border-violet-600 bg-violet-600 hover:bg-violet-700', choiceIcon: 'bg-white/15 text-white ring-white/30' },
  hospitalizacion: { icon: HeartPulse, tone: 'bg-cyan-50 text-cyan-700 ring-cyan-100', active: 'bg-cyan-600 text-white', border: 'border-cyan-300 ring-cyan-100', surface: 'bg-cyan-50/50', accent: 'border-cyan-200 group-hover:border-cyan-400 group-hover:bg-cyan-50/40', choiceCard: 'border-cyan-600 bg-cyan-600 hover:bg-cyan-700', choiceIcon: 'bg-white/15 text-white ring-white/30' },
  cancer: { icon: Syringe, tone: 'bg-amber-500 text-white ring-amber-200', active: 'bg-amber-500 text-white', border: 'border-amber-300 ring-amber-100', surface: 'bg-amber-50/50', accent: 'border-amber-200 group-hover:border-amber-400 group-hover:bg-amber-50/40', choiceCard: 'border-amber-600 bg-amber-600 hover:bg-amber-700', choiceIcon: 'bg-white/15 text-white ring-white/30' },
} as const;

const FREQUENCY_VISUALS = {
  monthly: { circle: 'bg-sky-500 text-white ring-sky-200', card: 'border-sky-200 hover:border-sky-400 hover:bg-sky-50/40' },
  quarterly: { circle: 'bg-indigo-500 text-white ring-indigo-200', card: 'border-indigo-200 hover:border-indigo-400 hover:bg-indigo-50/40' },
  biannual: { circle: 'bg-violet-500 text-white ring-violet-200', card: 'border-violet-200 hover:border-violet-400 hover:bg-violet-50/40' },
  yearly: { circle: 'bg-emerald-500 text-white ring-emerald-200', card: 'border-emerald-200 hover:border-emerald-400 hover:bg-emerald-50/40' },
} as const;
const FREQUENCY_BADGE_COLORS = {
  monthly: '!bg-sky-500 !text-white !ring-sky-500',
  quarterly: '!bg-indigo-500 !text-white !ring-indigo-500',
  biannual: '!bg-violet-500 !text-white !ring-violet-500',
  yearly: '!bg-emerald-500 !text-white !ring-emerald-500',
} as const;
const FALLBACK_PRODUCT_VISUAL = { icon: ShieldCheck, tone: 'bg-brand-50 text-brand-600', active: 'bg-brand-600 text-white', border: 'border-brand-400 ring-brand-100', surface: 'bg-brand-50/50' };
const PASSPORT_DNI_TYPES = new Set(['PVEN', 'PPAS', 'OPPA']);
const VALID_DNI_TYPES = new Set<string>(DNI_TYPES.map((type) => type.value));
const VALID_VEN_NATIONALITIES = new Set<string>(VEN_CEDULA_NATIONALITIES.map((nationality) => nationality.value));
const DOCUMENT_NUMBER_RE = /^[A-Z0-9-]{3,30}$/;
type PhoneCountry = { id: string; name: string; phonePrefix: string };
const DEFAULT_PHONE_COUNTRY: PhoneCountry = { id: '29', name: 'Venezuela', phonePrefix: '+58' };

function BackIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" className="h-4 w-4 shrink-0">
    <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

function ForwardIcon() {
  return <span aria-hidden="true" className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700 transition group-hover:bg-brand-600 group-hover:text-white">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" className="h-4 w-4">
      <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </span>;
}

function ProductIcon({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
  return <Icon aria-hidden="true" strokeWidth={2.25} className={clsx('h-5 w-5', className)} />;
}

const QUOTE_STAGE_LABELS = ['Perfil', 'Producto', 'Datos', 'Planes'] as const;

function QuoteStages({ current, onStageClick }: { current: 1 | 2 | 3 | 4; onStageClick?: (stage: 1 | 2 | 3 | 4) => void }) {
  return (
    <nav aria-label={`Progreso de cotización: ${QUOTE_STAGE_LABELS[current - 1]}`} className="mt-5 flex items-center justify-center gap-2.5">
      <span className="text-xs font-bold text-brand-700">{QUOTE_STAGE_LABELS[current - 1]}</span>
      <span className="flex items-center gap-1.5">
        {QUOTE_STAGE_LABELS.map((label, index) => (
          <button
            key={label}
            type="button"
            disabled={index + 1 >= current || !onStageClick}
            onClick={() => onStageClick?.((index + 1) as 1 | 2 | 3 | 4)}
            aria-label={index + 1 < current ? `Volver a ${label}` : index + 1 === current ? `Etapa actual: ${label}` : `${label}, pendiente`}
            className={clsx(
              'h-2 rounded-full transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2',
              index + 1 === current ? 'w-6 bg-brand-600' : index + 1 < current ? 'w-2 bg-emerald-400' : 'w-2 bg-slate-200',
              index + 1 < current && onStageClick ? 'cursor-pointer hover:scale-125 hover:bg-emerald-500' : 'cursor-default',
            )}
          />
        ))}
      </span>
      <span className="sr-only">Etapa {current} de 4</span>
    </nav>
  );
}

/** Convierte un número local o E.164 venezolano en los campos que Mercantil espera. */
function splitVenezuelanPhone(value: string) {
  const digits = value.replace(/\D/g, '');
  const local = digits.startsWith('58') ? digits.slice(2) : digits;
  const areaLength = local.startsWith('0') ? 4 : 3;
  return {
    areaCode: local.slice(0, areaLength),
    phoneNumber: local.slice(areaLength, areaLength + 7),
  };
}

function formatVenezuelanPhone(areaCode: string, phoneNumber: string) {
  const digits = `${areaCode}${phoneNumber}`.replace(/\D/g, '');
  if (!digits) return '';
  const areaLength = digits.startsWith('0') ? 4 : 3;
  const area = digits.slice(0, areaLength);
  const number = digits.slice(areaLength);
  if (!number) return area;
  return `${area} ${number.slice(0, 3)}${number.length > 3 ? ` ${number.slice(3, 7)}` : ''}`;
}

function DniNationalityPrefix({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const selected = VALID_VEN_NATIONALITIES.has(value) ? value : 'V';
  return (
    <span className="relative inline-flex h-12 w-[4.75rem] shrink-0" onBlur={() => window.setTimeout(() => setOpen(false), 120)}>
      <button
        type="button"
        aria-label="Nacionalidad de la cédula"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex h-full w-full items-center justify-between rounded-l-xl border border-r-0 border-slate-200 bg-slate-100 px-3 text-sm font-extrabold text-brand-800 transition hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        <span>{selected}</span>
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className={clsx('h-4 w-4 text-brand-600 transition', open && 'rotate-180')}>
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>
      {open && (
        <span role="listbox" className="absolute left-0 top-[calc(100%+0.5rem)] z-30 w-full rounded-xl border border-brand-100 bg-white p-1 shadow-xl shadow-brand-900/15">
          {VEN_CEDULA_NATIONALITIES.map((nationality) => (
            <button
              key={nationality.value}
              type="button"
              role="option"
              aria-selected={nationality.value === selected}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => { onChange(nationality.value); setOpen(false); }}
              className={clsx('flex min-h-9 w-full items-center justify-center rounded-lg text-sm font-extrabold transition hover:bg-brand-50', nationality.value === selected ? 'bg-brand-600 text-white hover:bg-brand-600' : 'text-brand-800')}
            >
              {nationality.value}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

function productVisual(productId: string) {
  const key = (Object.keys(PRODUCT_VITALES) as Array<keyof typeof PRODUCT_VITALES>)
    .find((candidate) => PRODUCT_VITALES[candidate] === productId);
  return key ? VITAL_VISUALS[key] : FALLBACK_PRODUCT_VISUAL;
}

function ageFromBirthDate(birthDate: string): number | null {
  const birth = new Date(`${birthDate}T00:00:00`);
  if (Number.isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const beforeBirthday = today.getMonth() < birth.getMonth()
    || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate());
  if (beforeBirthday) age -= 1;
  return age >= 0 ? age : null;
}

/** Ordena únicamente productos ya habilitados por Mercantil para el perfil. */
function recommendedVitalOffer(offers: PlanProduct[], birthDate: string, genderId: string): PlanProduct | undefined {
  const age = ageFromBirthDate(birthDate);
  const order = genderId === 'F' && age !== null && age <= 50
    ? [PRODUCT_VITALES.cancer, PRODUCT_VITALES.hospitalizacion, PRODUCT_VITALES.vida, PRODUCT_VITALES.accidentes, PRODUCT_VITALES.funerario]
    : genderId === 'F'
      ? [PRODUCT_VITALES.vida, PRODUCT_VITALES.hospitalizacion, PRODUCT_VITALES.accidentes, PRODUCT_VITALES.funerario, PRODUCT_VITALES.cancer]
      : age !== null && age >= 50
        ? [PRODUCT_VITALES.funerario, PRODUCT_VITALES.vida, PRODUCT_VITALES.accidentes, PRODUCT_VITALES.hospitalizacion, PRODUCT_VITALES.cancer]
        : [PRODUCT_VITALES.vida, PRODUCT_VITALES.accidentes, PRODUCT_VITALES.hospitalizacion, PRODUCT_VITALES.funerario, PRODUCT_VITALES.cancer];
  return order.map((id) => offers.find((offer) => offer.id === id)).find(Boolean);
}

export interface CotizaStepProps {
  identity: IdentityData;
  emitConfig: EmitConfig;
  setEmitConfig: Setter<EmitConfig>;
  setIdentity: Setter<IdentityData>;
  client: ClientInfo;
  setClient: Setter<ClientInfo>;
  plans: PlanCategory[] | null;
  setPlans: Setter<PlanCategory[] | null>;
  autoPlans: PlanCategory[] | null;
  setAutoPlans: Setter<PlanCategory[] | null>;
  selections: FPlanChoice[];
  setSelections: Setter<FPlanChoice[]>;
  vehicleFlow: FVehicleFlow | null;
  setVehicleFlow: Setter<FVehicleFlow | null>;
  apiGet: <T>(p: Promise<T>) => Promise<T>;
  onNext: () => void;
}

function quoteErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  if (/birthdate does not match|fecha de nacimiento/i.test(raw)) {
    return 'La fecha de nacimiento no coincide con el registro de Mercantil. Revísala e inténtalo de nuevo.';
  }
  if (/client.*not found|cliente.*no existe/i.test(raw)) {
    return 'No encontramos esos datos en Mercantil. Revisa el documento y la fecha de nacimiento.';
  }
  return raw || 'No fue posible cotizar. Intenta de nuevo.';
}

/** Paso 1 — Cotiza: datos del asegurado + selección de plan */
export function CotizaStep({
  identity,
  emitConfig,
  setEmitConfig,
  setIdentity,
  client,
  setClient,
  plans,
  setPlans,
  autoPlans,
  setAutoPlans,
  selections,
  setSelections,
  vehicleFlow,
  setVehicleFlow,
  apiGet,
  onNext,
}: CotizaStepProps) {
  const [route, setRoute] = useState<'auto' | 'vital' | null>(vehicleFlow ? 'auto' : plans || selections.length ? 'vital' : null);
  const [interest, setInterest] = useState<string | null>(selections.find((s) => !s.vehicle)?.productId ?? null);
  const [vitalGenderAnswered, setVitalGenderAnswered] = useState(!!plans || selections.some((selection) => !selection.vehicle));
  const [vehicleCategory, setVehicleCategory] = useState<'car' | 'motorcycle' | 'truck' | null>(vehicleFlow ? 'car' : null);
  const [frequencyConfirmed, setFrequencyConfirmed] = useState(!!plans || selections.length > 0);
  const [identityConfirmed, setIdentityConfirmed] = useState(!!plans);
  const [autoAddOnDecision, setAutoAddOnDecision] = useState<'add' | 'skip' | null>(
    selections.some((selection) => !selection.vehicle) ? 'add' : null,
  );
  const [autoVitalInterest, setAutoVitalInterest] = useState<string | null>(
    selections.find((selection) => !selection.vehicle)?.productId ?? null,
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [formErrorTarget, setFormErrorTarget] = useState<'vehicle' | 'identity' | null>(null);
  const [phoneCountries, setPhoneCountries] = useState<PhoneCountry[]>([DEFAULT_PHONE_COUNTRY]);
  const [openVitalProductId, setOpenVitalProductId] = useState<string | null>(interest);
  const [cartOpen, setCartOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void apiGet(api.countries()).then((response) => {
      if (!Array.isArray(response) || cancelled) return;
      const countries = response.flatMap((country): PhoneCountry[] => {
        if (!country || typeof country !== 'object') return [];
        const item = country as { id?: unknown; name?: unknown; phonePrefix?: unknown };
        return typeof item.id === 'string' && typeof item.name === 'string' && typeof item.phonePrefix === 'string' && /^\+\d{1,4}$/.test(item.phonePrefix)
          ? [{ id: item.id, name: item.name, phonePrefix: item.phonePrefix }]
          : [];
      });
      const unique = countries.filter((country, index) => countries.findIndex((other) => other.id === country.id) === index);
      const ordered = unique.sort((a, b) => (a.id === '29' ? -1 : b.id === '29' ? 1 : a.name.localeCompare(b.name, 'es')));
      setPhoneCountries(ordered.length ? ordered : [DEFAULT_PHONE_COUNTRY]);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [apiGet]);

  // Corrige sesiones abiertas antes de que la nacionalidad V/E fuera obligatoria.
  // También actualiza la vista sin requerir que el usuario recargue la página.
  useEffect(() => {
    if (identity.dniType !== 'VEN' || VALID_VEN_NATIONALITIES.has(identity.dniVenNationality)) return;
    setIdentity((current) => ({ ...current, dniVenNationality: 'V' }));
  }, [identity.dniType, identity.dniVenNationality, setIdentity]);

  useEffect(() => {
    if (interest) setOpenVitalProductId(interest);
  }, [interest]);

  /* ------- Vehículo (cascada) ------- */
  const [years] = useState(() => {
    const y = new Date().getFullYear();
    const arr: number[] = [];
    // Mercantil no publica marcas/modelos para años anteriores a 2000.
    // No mostramos años que llevarían al usuario a un selector vacío.
    for (let i = y; i >= 2000; i--) arr.push(i);
    return arr;
  });
  const [brands, setBrands] = useState<VehicleBrand[]>([]);
  const [models, setModels] = useState<VehicleModel[]>([]);
  const [versions, setVersions] = useState<VehicleVersion[]>([]);
  const [vehicleLoading, setVehicleLoading] = useState(false);

  // Recupera los catálogos de una selección guardada al volver o recargar.
  useEffect(() => {
    const saved = vehicleFlow;
    if (!saved?.year) return;
    let cancelled = false;
    setVehicleLoading(true);
    const restore = async () => {
      const levels = [
        { query: { year: saved.year }, field: 'brand' as const, set: setBrands },
        ...(saved.brandCode ? [{ query: { year: saved.year, brand: saved.brandCode }, field: 'model' as const, set: setModels }] : []),
        ...(saved.modelCode ? [{ query: { year: saved.year, brand: saved.brandCode, model: saved.modelCode }, field: 'version' as const, set: setVersions }] : []),
      ];
      for (const level of levels) {
        if (cancelled) return;
        const response = await api.vehicleInfo(level.query);
        const data = Array.isArray(response.vehicleData) ? response.vehicleData : [response.vehicleData];
        const items = data.map((item) => item?.[level.field]).filter(Boolean);
        const unique = items.filter((item, index) => items.findIndex((other) => other?.code === item?.code) === index);
        if (!cancelled) level.set(unique as VehicleVersion[] & VehicleModel[] & VehicleBrand[]);
      }
    };
    restore().catch(() => { if (!cancelled) { setFormErrorTarget('vehicle'); setFormError('No pudimos recuperar el catálogo del vehículo. Selecciona de nuevo el año para reintentar.'); } })
      .finally(() => { if (!cancelled) setVehicleLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const setIdentityField = (k: keyof IdentityData, v: string) => {
    setFormError(null);
    setFormErrorTarget(null);
    const nextIdentity = {
      ...identity,
      [k]: v,
      ...(k === 'dniType' && { dniVenNationality: v === 'VEN' ? (VALID_VEN_NATIONALITIES.has(identity.dniVenNationality) ? identity.dniVenNationality : 'V') : '' }),
    };
    setIdentity(nextIdentity);
    if (k !== 'email') {
      setIdentityConfirmed(false);
      setPlans(null);
      setSelections((current) => current.filter((item) => !!item.vehicle));
      setClient({});
      setAutoAddOnDecision(null);
    }
  };

  const pickVehicleYear = async (year: string) => {
    setSelections((current) => current.filter((item) => !item.vehicle));
    setAutoPlans(null);
    setVehicleFlow(null);
    setBrands([]);
    setModels([]);
    setVersions([]);
    setFormError(null);
    setFormErrorTarget(null);
    setAutoPlans(null);
    if (!year) return;
    const y = Number(year);
    setVehicleFlow({ year: y, brandCode: '', brandName: '', modelCode: '', modelName: '', versionCode: '', versionName: '' });
    setVehicleLoading(true);
    try {
      const res = await apiGet(api.vehicleInfo({ year: y }));
      const data = (Array.isArray(res.vehicleData) ? res.vehicleData : res.vehicleData ? [res.vehicleData] : []) as VehicleDataItem[];
      const list = data
        .map((d) => d.brand)
        .filter(Boolean)
        .filter((b, i, arr) => arr.findIndex((x) => x.code === b!.code) === i);
      setBrands(list as VehicleBrand[]);
    } catch (e) {
      setFormErrorTarget('vehicle');
      setFormError(quoteErrorMessage(e));
    } finally {
      setVehicleLoading(false);
    }
  };

  const pickVehicleBrand = async (code: string, year: number) => {
    setSelections((current) => current.filter((item) => !item.vehicle));
    setAutoPlans(null);
    const brand = brands.find((b) => b.code === code);
    setVehicleFlow({ year, brandCode: code, brandName: brand?.name ?? '', modelCode: '', modelName: '', versionCode: '', versionName: '' });
    setModels([]);
    setVersions([]);
    setAutoPlans(null);
    if (!code) return;
    setVehicleLoading(true);
    try {
      const res = await apiGet(api.vehicleInfo({ year, brand: code }));
      const data = Array.isArray(res.vehicleData) ? res.vehicleData : [res.vehicleData].flat();
      const list = (data as VehicleDataItem[])
        .map((d) => ('model' in d ? d.model : undefined))
        .filter(Boolean)
        .filter((m, i, arr) => arr.findIndex((x) => x!.code === m!.code) === i);
      setModels(list as VehicleModel[]);
    } catch (e) {
      setFormErrorTarget('vehicle');
      setFormError(quoteErrorMessage(e));
    } finally {
      setVehicleLoading(false);
    }
  };

  const pickVehicleModel = async (code: string, year: number, brandCode: string) => {
    setSelections((current) => current.filter((item) => !item.vehicle));
    setAutoPlans(null);
    const model = models.find((m) => m.code === code);
    setVehicleFlow((v) =>
      v ? { ...v, modelCode: code, modelName: model?.name ?? '', versionCode: '', versionName: '' } : v,
    );
    setVersions([]);
    setAutoPlans(null);
    if (!code) return;
    setVehicleLoading(true);
    try {
      const res = await apiGet(
        api.vehicleInfo({ year, brand: brandCode, model: code }),
      );
      const data = Array.isArray(res.vehicleData) ? res.vehicleData : [res.vehicleData].flat();
      const list = (data as VehicleDataItem[])
        .map((d) => ('version' in d ? d.version : undefined))
        .filter(Boolean)
        .filter((v, i, arr) => arr.findIndex((x) => x!.code === v!.code) === i);
      setVersions(list as VehicleVersion[]);
    } catch (e) {
      setFormErrorTarget('vehicle');
      setFormError(quoteErrorMessage(e));
    } finally {
      setVehicleLoading(false);
    }
  };

  const pickVehicleVersion = async (code: string) => {
    setSelections((current) => current.filter((item) => !item.vehicle));
    setAutoPlans(null);
    const version = versions.find((v) => v.code === code);
    const base = vehicleFlow;
    if (!base?.year || !base.brandCode || !base.modelCode) return;
    setVehicleFlow((v) =>
      v ? { ...v, typeId: undefined, versionCode: code, versionName: version?.name ?? '' } : v,
    );
    if (!code) return;
    setVehicleLoading(true);
    try {
      // El typeId/tariffId solo viene en la consulta completa (año+marca+modelo+versión)
      const res = await apiGet(
        api.vehicleInfo({
          year: base.year,
          brand: base.brandCode,
          model: base.modelCode,
          version: code,
        }),
      );
      const data = Array.isArray(res.vehicleData) ? res.vehicleData : [res.vehicleData].flat();
      const full = (data as VehicleDataItem[])[0] as VehicleDataItem & { version?: VehicleVersion };
      const typeId = full?.version?.typeId;
      const tariffId = full?.version?.tariffId;
      setVehicleFlow((v) => (v ? { ...v, typeId, tariffId } : v));

      if (!typeId) {
        setFormErrorTarget('vehicle');
        setFormError('Este vehículo no tiene planes disponibles.');
        setAutoPlans(null);
        return;
      }
      const plansRes = await apiGet(api.autoPlans(typeId));
      setAutoPlans(Array.isArray(plansRes) ? plansRes : []);
    } catch (e) {
      setFormErrorTarget('vehicle');
      setFormError(quoteErrorMessage(e));
    } finally {
      setVehicleLoading(false);
    }
  };

  /* ------- Cotización ------- */
  const [searching, setSearching] = useState(false);

  const doQuote = async () => {
    setFormError(null);
    setFormErrorTarget('identity');
    const documentNumber = identity.dniNumber.trim().toUpperCase();
    if (!VALID_DNI_TYPES.has(identity.dniType)) {
      setFormError('Selecciona un tipo de documento válido.');
      return;
    }
    if (!DOCUMENT_NUMBER_RE.test(documentNumber)) {
      setFormError('El número de documento debe tener entre 3 y 30 caracteres: letras, números o guiones.');
      return;
    }
    if (identity.dniType === 'VEN' && !VALID_VEN_NATIONALITIES.has(identity.dniVenNationality)) {
      setFormError('Selecciona V o E para la nacionalidad de la cédula venezolana.');
      return;
    }
    if (!identity.birthDate) {
      setFormError('Indica tu fecha de nacimiento para continuar.');
      return;
    }
    const email = identity.email.trim();
    const areaCode = identity.areaCode.trim();
    const phoneNumber = identity.phoneNumber.trim();
    const isVenezuelanPhone = identity.phoneCountryId === '29';
    const hasPhoneInput = Boolean(areaCode || phoneNumber);
    const hasValidPhone = isVenezuelanPhone
      ? /^0?\d{3}$/.test(areaCode) && /^\d{7}$/.test(phoneNumber)
      : /^\d{6,15}$/.test(phoneNumber);
    if (email && !EMAIL_REGEX.test(email)) {
      setFormError('Revisa el email: el formato no es válido.');
      return;
    }
    if (hasPhoneInput && !hasValidPhone) {
      setFormError(isVenezuelanPhone
        ? 'Completa el teléfono con código de área de 3 o 4 dígitos y número de 7 dígitos.'
        : 'Indica un número de teléfono válido para el país seleccionado.');
      return;
    }
    if (!email && !hasValidPhone) {
      setFormError('Indica al menos un medio de contacto: email o teléfono.');
      return;
    }
    // Validación fecha nacimiento
    const birth = new Date(identity.birthDate);
    if (Number.isNaN(birth.getTime()) || birth >= new Date()) {
      setFormError('Introduce una fecha de nacimiento válida y anterior a hoy.');
      return;
    }

    if (route !== 'auto') setSelections([]);
    setPlans(null);
    setIdentityConfirmed(false);
    setSearching(true);
    try {
      let exists: ClientExists;
      try {
        exists = await apiGet(
          api.clientExists({
            birthDate: identity.birthDate,
            dniType: identity.dniType,
            dniNumber: documentNumber,
            dniVenNationality: identity.dniType === 'VEN' ? identity.dniVenNationality : undefined,
          }),
        ) as ClientExists;
      } catch (e) {
        // El API de Mercantil responde 404 cuando el cliente NO existe.
        // Lo interpretamos como "cliente nuevo" y cotizamos con planes tentativos.
        if (e instanceof ApiError && e.status === 404) {
          exists = { exists: false };
        } else {
          throw e;
        }
      }

      setClient({
        clientId: exists.clientId,
        exists: exists.exists,
        // Si Mercantil no confirma expresamente que está completo, pedimos los
        // datos personales. Evita ocultar nombre/apellido por una respuesta parcial.
        needsCompletion: exists.needsCompletion !== false,
        existsInMs: exists.existsInMs,
      });

      // Planes: si el cliente existe usar planes de cliente, si no planes tentativos
      const res = exists.exists && exists.clientId
        ? await apiGet(api.clientPlans(exists.clientId))
        : await apiGet(
            api.tentativePlans({
              dniType: identity.dniType,
              dniNumber: documentNumber,
              dniVenNationality: identity.dniType === 'VEN' ? identity.dniVenNationality : undefined,
              birthDate: identity.birthDate,
              genderId: identity.genderId,
              phoneCountryId: identity.phoneCountryId || identity.countryId,
              addressCountryId: identity.countryId,
              countryId: identity.countryId,
            }),
          );
      setPlans(Array.isArray(res) ? res : []);
      setIdentityConfirmed(true);
    } catch (e) {
      setPlans(null);
      setFormErrorTarget('identity');
      setFormError(quoteErrorMessage(e));
    } finally {
      setSearching(false);
    }
  };

  const selectedPhoneCountry = phoneCountries.find((country) => country.id === identity.phoneCountryId)
    ?? (identity.phoneCountryId === '29' ? DEFAULT_PHONE_COUNTRY : { id: identity.phoneCountryId, name: 'Otro país', phonePrefix: identity.phonePrefix || '+' });
  const isVenezuelanPhone = identity.phoneCountryId === '29';

  /* ------- Selección de planes ------- */
  const togglePlan = (product: PlanProduct, plan: { id: string; assuredSum: number; totalPrime: number }) => {
    const existing = selections.find((s) => s.productId === product.id);
    let next: FPlanChoice[];
    if (existing && existing.planId === plan.id) {
      next = selections.filter((s) => s.productId !== product.id);
    } else {
      const item: FPlanChoice = {
        productId: product.id,
        planId: plan.id,
        productTitle: product.title ?? product.id,
        planTitle: plan.id,
        assuredSum: plan.assuredSum,
        totalPrime: plan.totalPrime,
        category: 'vital',
        isPreferentialBeneficiaryEnabled: false,
      };
      next = [...selections.filter((s) => s.productId !== product.id), item];
    }
    setSelections(next);
  };

  const toggleAutoPlan = (product: PlanProduct, plan: { id: string; assuredSum: number; totalPrime: number }) => {
    if (!vehicleFlow?.year || !vehicleFlow.brandCode || !vehicleFlow.modelCode || !vehicleFlow.versionCode) return;
    const existing = selections.find((s) => s.productId === product.id);
    let next: FPlanChoice[];
    if (existing && existing.planId === plan.id) {
      next = selections.filter((s) => s.productId !== product.id);
    } else {
      const item: FPlanChoice = {
        productId: product.id,
        planId: plan.id,
        productTitle: product.title ?? product.id,
        planTitle: plan.id,
        assuredSum: plan.assuredSum,
        totalPrime: plan.totalPrime,
        category: 'auto',
        isPreferentialBeneficiaryEnabled: false,
        vehicle: {
          year: String(vehicleFlow.year),
          brandCode: vehicleFlow.brandCode,
          brandName: vehicleFlow.brandName,
          modelCode: vehicleFlow.modelCode,
          modelName: vehicleFlow.modelName,
          versionCode: vehicleFlow.versionCode,
          versionName: vehicleFlow.versionName,
          typeId: vehicleFlow.typeId,
        },
      };
      // RCV Básica y Plus son alternativas para el mismo vehículo: se elige una.
      next = [...selections.filter((s) => !s.vehicle), item];
    }
    setSelections(next);
  };

  const removeSelection = (selection: FPlanChoice) => {
    setSelections((current) => current.filter((item) => item.productId !== selection.productId));
    if (!selection.vehicle && selection.productId === interest) {
      setInterest(selections.find((item) => !item.vehicle && item.productId !== selection.productId)?.productId ?? null);
    }
  };

  const total = selections.reduce((a, s) => a + s.totalPrime, 0);
  const selectedFrequency = PAYMENT_FREQUENCIES.find((item) => item.value === emitConfig.paymentFrequency) ?? PAYMENT_FREQUENCIES[3];
  const frequencyEquivalentTotal = total / selectedFrequency.per;
  const hasAutoSelection = selections.some((selection) => !!selection.vehicle);
  const hasVitalSelection = selections.some((selection) => !selection.vehicle);
  const vitalOffers = (plans ?? []).flatMap((category) => category.products)
    .filter((product) => Object.values(PRODUCT_VITALES).includes(product.id));
  const suggestedVitalProducts = vitalOffers
    .filter((product) => product.id !== interest && !selections.some((selection) => selection.productId === product.id))
    .slice(0, 4);
  const displayedVitalProducts = vitalOffers
    .filter((product) => !interest || product.id === interest || selections.some((selection) => selection.productId === product.id))
    .sort((left, right) => Number(left.id === interest) - Number(right.id === interest));
  const vitalRecommendation = recommendedVitalOffer(vitalOffers, identity.birthDate, identity.genderId);
  const vehicleCategoryLabel = vehicleCategory === 'motorcycle' ? 'moto' : vehicleCategory === 'truck' ? 'camión' : 'vehículo';
  const canContinue = selections.length > 0
    && identityConfirmed
    && !searching
    && !vehicleLoading
    && !!identity.dniNumber
    && !!identity.birthDate
    && (route !== 'auto' || (hasAutoSelection && (autoAddOnDecision === 'skip' || (autoAddOnDecision === 'add' && hasVitalSelection))));
  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const goToQuoteStage = (stage: 1 | 2 | 3 | 4) => {
    if (route === 'vital') {
      if (stage === 1) {
        setInterest(null);
        setFrequencyConfirmed(false);
        setVitalGenderAnswered(false);
        setPlans(null);
        setSelections((current) => current.filter((selection) => !!selection.vehicle));
        setIdentityConfirmed(false);
        return;
      }
      if (stage === 2) {
        setInterest(null);
        setFrequencyConfirmed(false);
        setPlans(null);
        setSelections((current) => current.filter((selection) => !!selection.vehicle));
        setIdentityConfirmed(false);
        return;
      }
      if (stage === 3) {
        setIdentityConfirmed(false);
        window.setTimeout(() => scrollTo('datos-asegurado'), 0);
      }
      return;
    }

    if (stage === 1) {
      setVehicleCategory(null);
      setVehicleFlow(null);
      setAutoPlans(null);
      setSelections((current) => current.filter((selection) => !selection.vehicle));
      setIdentityConfirmed(false);
      setAutoAddOnDecision(null);
      return;
    }
    if (stage === 2) {
      setSelections((current) => current.filter((selection) => !selection.vehicle));
      setIdentityConfirmed(false);
      setAutoAddOnDecision(null);
      window.setTimeout(() => scrollTo('cotiza'), 0);
      return;
    }
    if (stage === 3) {
      setIdentityConfirmed(false);
      window.setTimeout(() => scrollTo('datos-asegurado'), 0);
    }
  };

  if (route === 'vital' && !vitalGenderAnswered) {
    return <div id="cotiza" className="mx-auto max-w-xl py-3 sm:py-8">
      <h2 className="font-display mt-2 text-center text-3xl font-bold text-brand-900">¿Para quién es la protección?</h2>
      <p className="mx-auto mt-3 max-w-md text-center text-slate-600">Usaremos edad y género para consultar las coberturas Vitales disponibles en Mercantil.</p>
      <QuoteStages current={1} onStageClick={goToQuoteStage} />
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {[
          { value: 'M', label: 'Hombre', icon: '♂', tone: 'border-sky-200 bg-sky-50 text-sky-800 hover:border-sky-400' },
          { value: 'F', label: 'Mujer', icon: '♀', tone: 'border-rose-200 bg-rose-50 text-rose-800 hover:border-rose-400' },
        ].map((gender) => (
          <button key={gender.value} type="button" onClick={() => { setIdentityField('genderId', gender.value); setVitalGenderAnswered(true); }} className={clsx('group overflow-hidden rounded-3xl border text-center shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg', gender.tone)}>
            <span className="block h-40 overflow-hidden bg-white sm:h-44">
              <img src={gender.value === 'M' ? '/choice-man-real.webp' : '/choice-woman-real.webp'} alt="" fetchPriority="high" decoding="async" className="h-full w-full object-cover object-[center_20%] transition duration-300 group-hover:scale-105" />
            </span>
            <span className="block px-5 pb-5 pt-4 sm:px-6 sm:pb-6">
              <span className="block text-xl font-bold">{gender.label}</span>
              <span className="mt-1 block text-sm opacity-75">Ver opciones disponibles</span>
            </span>
          </button>
        ))}
      </div>
      <Button variant="ghost" className="mt-6 w-full" onClick={() => setRoute(null)}><BackIcon />Cambiar tipo de seguro</Button>
    </div>;
  }

  if (route === 'auto' && !vehicleCategory) {
    const choices = [
      { value: 'car' as const, label: 'Carro', description: 'Particular o familiar', image: '/vehicle-car-real.webp' },
      { value: 'motorcycle' as const, label: 'Moto', description: 'Dos ruedas', image: '/vehicle-motorcycle-real.webp' },
      { value: 'truck' as const, label: 'Carga', description: 'Camión o trabajo', image: '/vehicle-cargo-real.webp' },
    ];
    return <div id="cotiza" className="mx-auto max-w-2xl py-3 sm:py-8">
      <h2 className="font-display mt-2 text-center text-3xl font-bold text-brand-900">¿Qué vehículo quieres proteger?</h2>
      <p className="mx-auto mt-3 max-w-md text-center text-slate-600">Elige el tipo y luego buscaremos año, marca, modelo y versión.</p>
      <QuoteStages current={1} onStageClick={goToQuoteStage} />
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {choices.map((choice) => (
          <button key={choice.value} type="button" onClick={() => setVehicleCategory(choice.value)} className="group overflow-hidden rounded-3xl border border-brand-100 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:border-brand-400 hover:shadow-lg">
            <span className="block h-36 overflow-hidden bg-brand-50">
              <img src={choice.image} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover transition duration-300 group-hover:scale-105" />
            </span>
            <span className="block p-4">
              <span className="block text-lg font-bold text-brand-900">{choice.label}</span>
              <span className="mt-1 block text-sm text-slate-600">{choice.description}</span>
            </span>
          </button>
        ))}
      </div>
      <Button variant="ghost" className="mt-6 w-full" onClick={() => setRoute(null)}><BackIcon />Cambiar tipo de seguro</Button>
    </div>;
  }

  if (route === 'vital' && interest && !frequencyConfirmed) {
    return <div id="cotiza" className="mx-auto max-w-3xl py-3 sm:py-8">
      <p className="text-sm font-semibold text-brand-600">A tu ritmo</p>
      <h2 className="font-display mt-2 text-3xl font-bold text-brand-900">¿Cómo prefieres pagar tu seguro?</h2>
      <p className="mt-3 text-slate-600">Elige una frecuencia para continuar con tu cotización.</p>
      <QuoteStages current={2} onStageClick={goToQuoteStage} />
      <div className="mt-7 grid grid-cols-2 gap-3 sm:gap-4">
        {PAYMENT_FREQUENCIES.map((frequency) => {
          const visual = FREQUENCY_VISUALS[frequency.value];
          return <button type="button" key={frequency.value}
            className={clsx('group flex min-h-36 flex-col items-start gap-3 rounded-2xl border bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md sm:min-h-40 sm:p-5', visual.card)}
            onClick={() => { setEmitConfig({ ...emitConfig, paymentFrequency: frequency.value }); setFrequencyConfirmed(true); }}>
            <span className={clsx('flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-xl font-extrabold shadow-sm ring-4', visual.circle)}>{frequency.interval}</span>
            <span className="block min-w-0">
              <span className="block text-base font-bold text-brand-900">{frequency.label}</span>
              <span className="mt-1 block text-xs leading-snug text-slate-600">{frequency.description}</span>
            </span>
          </button>;
        })}
      </div>
      <p className="mt-5 text-sm text-slate-500">La frecuencia disponible y el importe de las cuotas están sujetos a confirmación de Mercantil para el plan elegido.</p>
      <Button variant="ghost" className="mt-5 w-full" onClick={() => setInterest(null)}><BackIcon />Cambiar protección Vital</Button>
    </div>;
  }

  if (!route || (route === 'vital' && !interest)) {
    return <div id="cotiza" className="mx-auto max-w-3xl py-3 sm:py-8">
      <p className="text-sm font-semibold text-brand-600">Empecemos por ti</p>
      <h2 className="font-display mt-2 text-3xl font-bold text-brand-900">{!route ? '¿Qué te gustaría proteger?' : '¿Qué protección buscas?'}</h2>
      <p className="mt-3 text-slate-600">Te haremos las preguntas necesarias para encontrar tus opciones.</p>
      {route === 'vital' && <QuoteStages current={2} onStageClick={goToQuoteStage} />}
      {!route ? <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <button type="button" className="group flex flex-col overflow-hidden rounded-2xl border border-brand-200 bg-white p-0 text-left leading-none transition hover:-translate-y-0.5 hover:border-brand-500 hover:shadow-lg hover:shadow-brand-900/10" onClick={() => { setVehicleCategory(null); setEmitConfig((current) => ({ ...current, paymentFrequency: 'yearly' })); setRoute('auto'); }}>
          <span className="block h-40 overflow-hidden bg-brand-100 sm:h-44">
            <img src="/auto-real-photo.webp" alt="Conductora junto a su vehículo" width="960" height="640" loading="lazy" decoding="async" className="h-full w-full object-cover object-[center_62%] transition duration-300 group-hover:scale-105" />
          </span>
          <span className="block p-5 sm:p-6">
            <span className="text-xs font-bold uppercase tracking-widest text-brand-600">Mi vehículo</span>
            <span className="mt-3 flex items-center gap-2 text-2xl font-bold leading-none text-brand-900">Auto RCV <ForwardIcon /></span>
            <span className="mt-2 block text-sm text-slate-600">Empieza con el año, marca, modelo y versión.</span>
          </span>
        </button>
        <button type="button" className="group flex flex-col overflow-hidden rounded-2xl border border-brand-200 bg-white p-0 text-left leading-none transition hover:-translate-y-0.5 hover:border-brand-500 hover:shadow-lg hover:shadow-brand-900/10" onClick={() => { setInterest(null); setVitalGenderAnswered(false); setRoute('vital'); }}>
          <span className="block h-40 overflow-hidden bg-brand-100 sm:h-44">
            <img src="/vital-real-photo.webp" alt="Pareja disfrutando de tranquilidad en casa" width="960" height="640" loading="lazy" decoding="async" className="h-full w-full object-cover transition duration-300 group-hover:scale-105" />
          </span>
          <span className="block p-5 sm:p-6">
            <span className="text-xs font-bold uppercase tracking-widest text-brand-600">Mi tranquilidad</span>
            <span className="mt-3 flex items-center gap-2 text-2xl font-bold leading-none text-brand-900">Protección Vital <ForwardIcon /></span>
            <span className="mt-2 block text-sm text-slate-600">Vida, accidentes, funerario, renta por hospitalización o cáncer.</span>
          </span>
        </button>
      </div> : <>
        <div className="mt-7 grid grid-cols-2 gap-3 lg:grid-cols-3">
          {VITAL_PRODUCT_OPTIONS.map((item) => {
            const visual = VITAL_VISUALS[item.key as keyof typeof VITAL_VISUALS];
            return <button key={item.key} type="button" onClick={() => setInterest(PRODUCT_VITALES[item.key])}
              className={clsx('group flex min-h-36 flex-col items-start rounded-2xl border p-3.5 text-left text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg sm:p-4', visual.choiceCard)}>
              <span className={clsx('flex h-9 w-9 shrink-0 aspect-square items-center justify-center rounded-full ring-1 sm:h-10 sm:w-10', visual.choiceIcon)}><ProductIcon icon={visual.icon} className="h-5 w-5" /></span>
              <span className="mt-3 block text-xs font-bold leading-snug sm:text-sm">{item.title}</span>
              <span className="mt-auto inline-flex rounded-full bg-white/15 px-2 py-1 text-[10px] font-bold text-white">Ver planes</span>
            </button>;
          })}
        </div>
        <p className="mt-4 text-sm text-slate-500">La disponibilidad y las condiciones se consultan con Mercantil.</p>
        <Button variant="primary" className="mt-5 w-full" onClick={() => setRoute(null)}><BackIcon />Cambiar tipo de seguro</Button>
      </>}
    </div>;
  }

  return (
    <div id="cotiza" className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
      {/* ---- Columna principal: formulario + planes ---- */}
      <div className="min-w-0 space-y-8">
        <QuoteStages current={route === 'auto'
          ? (!vehicleFlow?.typeId ? 1 : !hasAutoSelection ? 2 : !identityConfirmed ? 3 : 4)
          : plans && plans.length > 0 ? 4 : 3}
          onStageClick={goToQuoteStage}
        />
        {route === 'auto' ? (
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
            <Button className="w-full justify-center px-2 text-xs sm:w-auto sm:justify-start sm:px-4 sm:text-sm" variant="secondary" size="sm" disabled={searching || vehicleLoading} onClick={() => { setVehicleCategory(null); setVehicleFlow(null); setAutoPlans(null); setSelections((current) => current.filter((selection) => !selection.vehicle)); setIdentityConfirmed(false); setAutoAddOnDecision(null); }}><BackIcon /><span className="sm:hidden">Vehículo</span><span className="hidden sm:inline">Carro, moto o camión</span></Button>
            <Button className="w-full justify-center px-2 text-xs sm:w-auto sm:justify-start sm:px-4 sm:text-sm" variant="ghost" size="sm" disabled={searching || vehicleLoading} onClick={() => { setRoute(null); setVehicleCategory(null); setInterest(null); setFrequencyConfirmed(false); setSelections([]); setPlans(null); setAutoPlans(null); setVehicleFlow(null); setIdentityConfirmed(false); }}><BackIcon /><span className="sm:hidden">Protección</span><span className="hidden sm:inline">Cambiar protección</span></Button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <Button variant="ghost" disabled={searching || vehicleLoading} onClick={() => { setInterest(null); }}><BackIcon /><span className="sm:hidden">Vitales</span><span className="hidden sm:inline">Ver otras coberturas Vitales</span></Button>
            <button
              type="button"
              onClick={() => setCartOpen(true)}
              className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-brand-200 bg-brand-50 text-brand-700 shadow-sm transition hover:border-brand-400 hover:bg-brand-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 lg:hidden"
              aria-label={`Abrir cesta con ${selections.length} producto${selections.length === 1 ? '' : 's'}`}
            >
              <ShoppingBasket aria-hidden="true" className="h-5 w-5" strokeWidth={2.25} />
              {selections.length > 0 && <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-white bg-emerald-500 px-1 text-[10px] font-extrabold text-white">{selections.length}</span>}
            </button>
          </div>
        )}
        {/* Sección Auto */}
        {route === 'auto' && <Card>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-brand-600">Tu vehículo</p>
              <h4 className="font-display mt-1 font-bold text-slate-900">{vehicleFlow?.typeId ? 'Vehículo confirmado' : `Busca los planes para tu ${vehicleCategoryLabel}`}</h4>
              <p className="text-sm text-slate-500">{vehicleFlow?.typeId ? 'Usaremos estos datos para cotizar tu RCV.' : `Indica los datos de tu ${vehicleCategoryLabel}. Solo te mostraremos las opciones disponibles.`}</p>
            </div>
            {vehicleFlow?.versionName && <Badge tone="emerald">Listo</Badge>}
          </div>

          {vehicleFlow?.typeId ? (
            <div className="mt-5 flex flex-col items-start gap-2 rounded-xl bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
              <p className="w-full break-words text-sm font-bold leading-snug text-slate-800">{vehicleFlow.year} · {vehicleFlow.brandName} {vehicleFlow.modelName} · {vehicleFlow.versionName}</p>
              <button
                type="button"
                className="shrink-0 text-sm font-bold text-brand-700 underline underline-offset-4"
                onClick={() => { setVehicleFlow((current) => current ? { ...current, typeId: undefined, tariffId: undefined } : current); setAutoPlans(null); setSelections((current) => current.filter((selection) => !selection.vehicle)); setIdentityConfirmed(false); setAutoAddOnDecision(null); }}
              >
                Cambiar
              </button>
            </div>
          ) : (
            <fieldset disabled={vehicleLoading || searching} className="mt-5 grid min-w-0 border-0 p-0 gap-4 sm:grid-cols-2">
              <FieldWrapper label="Año" hint="Para vehículos anteriores a 2000, contáctanos y un asesor revisará tu caso.">
                <Select value={vehicleFlow?.year ? String(vehicleFlow.year) : ''} onChange={(e) => pickVehicleYear(e.target.value)}>
                  <option value="">Selecciona…</option>
                  {years.map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </Select>
              </FieldWrapper>
              {vehicleFlow?.year && <FieldWrapper label="Marca" hint={brands.length ? 'Escribe para buscar entre las marcas disponibles.' : undefined}>
                <SearchableSelect
                  value={vehicleFlow?.brandCode ?? ''}
                  options={brands.map((brand) => ({ value: brand.code, label: brand.name }))}
                  placeholder={vehicleLoading ? 'Cargando marcas…' : brands.length ? 'Busca una marca…' : 'No hay marcas disponibles'}
                  emptyMessage="No encontramos esa marca para el año seleccionado."
                  onChange={(code) => {
                    if (vehicleFlow?.year) pickVehicleBrand(code, vehicleFlow.year);
                    else setVehicleFlow(null);
                  }}
                  disabled={vehicleLoading || brands.length === 0}
                />
              </FieldWrapper>}
              {vehicleFlow?.brandCode && <FieldWrapper label="Modelo">
                <Select
                  value={vehicleFlow?.modelCode ?? ''}
                  onChange={(e) => {
                    if (vehicleFlow?.year && vehicleFlow?.brandCode)
                      pickVehicleModel(e.target.value, vehicleFlow.year, vehicleFlow.brandCode);
                    else setVehicleFlow((v) => (v ? { ...v, modelCode: '', modelName: '' } : v));
                  }}
                  disabled={models.length === 0}
                >
                  <option value="">{vehicleLoading ? 'Cargando…' : models.length ? 'Selecciona…' : 'Elige marca'}</option>
                  {models.map((m) => (
                    <option key={m.code} value={m.code}>{m.name}</option>
                  ))}
                </Select>
              </FieldWrapper>}
              {vehicleFlow?.modelCode && <FieldWrapper label="Versión">
                <Select
                  value={vehicleFlow?.versionCode ?? ''}
                  onChange={(e) => pickVehicleVersion(e.target.value)}
                  disabled={versions.length === 0}
                >
                  <option value="">{vehicleLoading ? 'Cargando…' : versions.length ? 'Selecciona…' : 'Elige modelo'}</option>
                  {versions.map((v) => (
                    <option key={v.code} value={v.code}>{v.name}</option>
                  ))}
                </Select>
              </FieldWrapper>}
            </fieldset>
          )}
          {vehicleFlow?.year && !vehicleLoading && brands.length === 0 && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <p className="font-bold">No encontramos marcas para el año {vehicleFlow.year}.</p>
              <p className="mt-1">Prueba otro año o vuelve a elegir el tipo de vehículo.</p>
              <div className="mt-3 flex flex-wrap gap-3">
                <button type="button" className="font-bold underline underline-offset-4" onClick={() => void pickVehicleYear('')}>Elegir otro año</button>
                <button type="button" className="font-bold underline underline-offset-4" onClick={() => setVehicleCategory(null)}>Carro, moto o camión</button>
              </div>
            </div>
          )}
        </Card>}

        {route === 'auto' && vehicleFlow?.typeId && !hasAutoSelection && autoPlans && autoPlans.length > 0 && (
          <section className="space-y-4">
            <div className="px-1">
              <p className="text-xs font-bold uppercase tracking-widest text-brand-600">Elige tu protección</p>
              <h3 className="font-display mt-1 text-2xl font-extrabold text-slate-900">Compara tus opciones</h3>
              <p className="mt-1 text-sm leading-relaxed text-slate-600">Elige una opción para tu Auto. Verás el precio anual y la suma asegurada antes de continuar.</p>
            </div>
            {autoPlans.flatMap((category) => category.products).map((product) => (
              <AutoPlanCard
                key={product.id}
                product={product}
                selected={selections.find((selection) => selection.productId === product.id && !!selection.vehicle)}
                onSelect={(plan) => toggleAutoPlan(product, plan)}
              />
            ))}
          </section>
        )}

        {route === 'auto' && hasAutoSelection && !identityConfirmed && (
          <CartNextStep
            count={selections.length}
            total={total}
            message="Tu seguro Auto ya está en el carrito. Completa tus datos para validar la cotización."
            action="Completar mis datos"
            onAction={() => scrollTo('datos-asegurado')}
          />
        )}
        {/* Datos del asegurado */}
        {(route === 'vital' || hasAutoSelection) && <>
        <Card id="datos-asegurado" className={clsx(identityConfirmed && 'border-emerald-200 bg-emerald-50/60')}>
          {!identityConfirmed && <>
          {route === 'auto' && <p className="text-xs font-bold uppercase tracking-widest text-brand-600">Tus datos</p>}
          <h3 className="font-display mt-1 text-lg font-bold text-slate-900">Datos del asegurado</h3>
          <p className="mt-1 text-sm text-slate-500">Necesitamos estos datos para cotizar tu seguro en Mercantil Seguros.</p>
          <fieldset disabled={searching || vehicleLoading} className="mt-5 grid gap-4 sm:grid-cols-2">
            <FieldWrapper label="Tipo de documento" required className="sm:col-span-2">
              <Select
                value={identity.dniType}
                onChange={(e) => setIdentityField('dniType', e.target.value)}
              >
                {DNI_TYPES.map((d) => (
                  <Option key={d.value} value={d.value} label={d.label} />
                ))}
              </Select>
            </FieldWrapper>
            <FieldWrapper
              label={PASSPORT_DNI_TYPES.has(identity.dniType) ? 'Número de pasaporte' : identity.dniType === 'VEN' ? 'Número de cédula' : 'Número de documento'}
              required
              hint={identity.dniType === 'VEN' ? undefined : 'Usa letras, números o guiones, tal como aparece en el documento.'}
            >
              <div className="flex min-w-0">
                {identity.dniType === 'VEN' && (
                  <DniNationalityPrefix
                    value={identity.dniVenNationality}
                    onChange={(value) => setIdentityField('dniVenNationality', value)}
                  />
                )}
                <Input
                  className={identity.dniType === 'VEN' ? 'rounded-l-none' : undefined}
                  value={identity.dniNumber}
                  onChange={(e) => setIdentityField('dniNumber', e.target.value.toUpperCase())}
                  placeholder={PASSPORT_DNI_TYPES.has(identity.dniType) ? 'Ej. AB123456' : 'Ej. 12345678'}
                  inputMode={PASSPORT_DNI_TYPES.has(identity.dniType) ? 'text' : 'numeric'}
                  maxLength={30}
                  autoCapitalize="characters"
                />
              </div>
            </FieldWrapper>
            <FieldWrapper label="Fecha de nacimiento" required>
              <BirthDateSelect
                value={identity.birthDate}
                onChange={(date) => setIdentityField('birthDate', date)}
                invalid={formErrorTarget === 'identity' && /fecha de nacimiento/i.test(formError ?? '')}
              />
            </FieldWrapper>
            <FieldWrapper label="Género" required>
              <div role="radiogroup" aria-label="Género" className="grid grid-cols-2 gap-2">
                {[
                  { value: 'F', label: 'Femenino' },
                  { value: 'M', label: 'Masculino' },
                ].map((gender) => {
                  const selected = identity.genderId === gender.value;
                  return <button
                    key={gender.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setIdentityField('genderId', gender.value)}
                    className={clsx('min-h-12 rounded-xl border px-3 text-sm font-bold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500', selected ? 'border-brand-600 bg-brand-600 text-white shadow-sm shadow-brand-600/25' : 'border-slate-200 bg-white text-slate-700 hover:border-brand-300 hover:bg-brand-50')}
                  >{gender.label}</button>;
                })}
              </div>
            </FieldWrapper>
            <FieldWrapper label="Email" hint="Obligatorio solo si no indicas un teléfono.">
              <Input
                type="email"
                value={identity.email}
                onChange={(e) => setIdentityField('email', e.target.value)}
                placeholder="tucorreo@ejemplo.com"
              />
            </FieldWrapper>
            <FieldWrapper label="País del teléfono">
              <SearchableSelect
                value={identity.phoneCountryId}
                options={phoneCountries.map((country) => ({ value: country.id, label: `${country.name} (${country.phonePrefix})` }))}
                placeholder="Busca un país…"
                emptyMessage="No encontramos ese país."
                onChange={(countryId) => {
                  const country = phoneCountries.find((item) => item.id === countryId) ?? DEFAULT_PHONE_COUNTRY;
                  setIdentity({ ...identity, phoneCountryId: country.id, phonePrefix: country.phonePrefix, areaCode: '', phoneNumber: '' });
                  setFormError(null);
                  setFormErrorTarget(null);
                  setIdentityConfirmed(false);
                  setPlans(null);
                  setSelections((current) => current.filter((item) => !!item.vehicle));
                  setClient({});
                  setAutoAddOnDecision(null);
                }}
              />
            </FieldWrapper>
            <FieldWrapper label="Teléfono móvil o WhatsApp" hint="Opcional si indicas email.">
              <div className="flex min-w-0">
                <span aria-hidden="true" className="inline-flex min-h-12 shrink-0 items-center rounded-l-xl border border-r-0 border-slate-200 bg-slate-100 px-3 text-sm font-bold text-slate-600">{selectedPhoneCountry.phonePrefix}</span>
                <Input
                  className="rounded-l-none"
                  inputMode="tel"
                  value={isVenezuelanPhone ? formatVenezuelanPhone(identity.areaCode, identity.phoneNumber) : identity.phoneNumber}
                  onChange={(e) => {
                    const next = isVenezuelanPhone
                      ? splitVenezuelanPhone(e.target.value)
                      : { areaCode: '', phoneNumber: e.target.value.replace(/\D/g, '').slice(0, 15) };
                    setIdentity({ ...identity, ...next });
                    setFormError(null);
                    setFormErrorTarget(null);
                    setIdentityConfirmed(false);
                    setPlans(null);
                    setSelections((current) => current.filter((item) => !!item.vehicle));
                    setClient({});
                    setAutoAddOnDecision(null);
                  }}
                  placeholder={isVenezuelanPhone ? '0414 123 4567' : 'Número de teléfono'}
                  aria-label="Número de teléfono"
                  maxLength={isVenezuelanPhone ? 13 : 15}
                />
              </div>
            </FieldWrapper>
          </fieldset>

          <p className="mt-4 text-xs text-slate-500">Para cotizar basta con email o teléfono. Mercantil podrá solicitar ambos datos antes de emitir la póliza.</p>
          <div className="mt-6">
            <Button size="lg" loading={searching} onClick={doQuote} className="w-full sm:w-auto">
              {route === 'auto' ? 'Confirmar mis datos' : 'Ver mis planes'}
            </Button>
            <p className="mt-2 text-xs text-slate-400">
              Si ya eres cliente de Mercantil Seguros, lo detectamos automáticamente.
            </p>
          </div>
          </>}
          {identityConfirmed && (
            <>
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white shadow-sm" aria-hidden="true">
                    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-4 w-4"><path d="m5 10 3 3 7-7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </span>
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-800">Datos validados</p>
                    <p className="mt-0.5 truncate text-sm font-extrabold text-emerald-950">{identity.dniType === 'VEN' ? `${identity.dniVenNationality || 'V'}-${identity.dniNumber}` : `${identity.dniType} ${identity.dniNumber}`}</p>
                  </div>
                </div>
                <button
                  type="button"
                  className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl border border-brand-200 bg-white px-3 text-sm font-bold text-brand-700 shadow-sm transition hover:border-brand-400 hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                  onClick={() => setIdentityConfirmed(false)}
                >
                  <Pencil aria-hidden="true" className="h-4 w-4" strokeWidth={2.25} />
                  Editar
                </button>
              </div>
              {route === 'vital' && (
                <div className="mt-4 border-t border-emerald-200 pt-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-emerald-900">Frecuencia preferida</p>
                    <p className="text-xs font-semibold text-emerald-800">{PAYMENT_FREQUENCIES.find((item) => item.value === emitConfig.paymentFrequency)?.label}</p>
                  </div>
                  <div role="radiogroup" aria-label="Frecuencia de pago" className="grid grid-cols-4 gap-2">
                    {PAYMENT_FREQUENCIES.map((frequency) => {
                      const visual = FREQUENCY_VISUALS[frequency.value];
                      const selectedFrequency = emitConfig.paymentFrequency === frequency.value;
                      return (
                        <button
                          key={frequency.value}
                          type="button"
                          role="radio"
                          aria-checked={selectedFrequency}
                          onClick={() => setEmitConfig((current) => ({ ...current, paymentFrequency: frequency.value }))}
                          className={clsx('flex min-h-[4.5rem] flex-col items-center justify-center rounded-xl border px-1 py-2 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500', selectedFrequency ? 'border-emerald-500 bg-white shadow-sm' : 'border-transparent hover:bg-white/70')}
                        >
                          <span className={clsx('flex h-8 w-8 items-center justify-center rounded-full text-xs font-extrabold ring-2', visual.circle, selectedFrequency && 'ring-4')}>{frequency.interval}</span>
                          <span className="mt-1 text-[10px] font-bold leading-none text-emerald-900">{frequency.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </Card>

        {route === 'auto' && identityConfirmed && (
          <Card id="coberturas-vitales" className="border-brand-200 bg-gradient-to-br from-brand-50 to-white">
            <p className="text-xs font-bold uppercase tracking-widest text-brand-600">Recomendación para ti</p>
            <h3 className="font-display mt-1 text-xl font-bold text-slate-900">¿Quieres ver una cobertura Vital recomendada?</h3>
            <p className="mt-2 text-sm text-slate-600">Con tu edad y género, Mercantil ya nos indicó cuáles coberturas están disponibles. Es opcional y no añadiremos nada sin tu elección.</p>

            {autoAddOnDecision === null && (
              <div className="mt-5 grid gap-3">
                <Button size="lg" onClick={() => { setAutoAddOnDecision('add'); setAutoVitalInterest(vitalRecommendation?.id ?? null); }}>
                  {vitalRecommendation ? 'Sí, ver mi recomendación' : 'Sí, ver coberturas Vitales'}
                </Button>
                <Button variant="secondary" size="lg" onClick={() => { setAutoAddOnDecision('skip'); setAutoVitalInterest(null); setSelections((current) => current.filter((selection) => !!selection.vehicle)); }}>
                  No, continuar solo con Auto
                </Button>
              </div>
            )}

            {autoAddOnDecision === 'add' && !autoVitalInterest && (
              <div className="mt-5">
                <p className="text-sm font-bold text-slate-800">Elige una cobertura adicional</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {VITAL_PRODUCT_OPTIONS.map((option) => {
                    const productId = PRODUCT_VITALES[option.key];
                    const available = vitalOffers.some((product) => product.id === productId);
                    const inCart = selections.some((selection) => selection.productId === productId && !selection.vehicle);
                    const visual = VITAL_VISUALS[option.key as keyof typeof VITAL_VISUALS];
                    return (
                      <button
                        key={option.key}
                        type="button"
                        disabled={!available}
                        onClick={() => setAutoVitalInterest(productId)}
                        className={clsx('group relative min-h-32 rounded-2xl border p-4 text-left transition', available ? clsx('bg-white shadow-sm hover:-translate-y-0.5 hover:shadow-md', visual.accent) : 'cursor-not-allowed opacity-45')}
                      >
                        <span className={clsx('flex h-10 w-10 shrink-0 aspect-square items-center justify-center rounded-full ring-1', visual.tone)}><ProductIcon icon={visual.icon} className="h-5 w-5" /></span>
                        <span className="mt-3 block pr-5 text-sm font-bold leading-snug text-slate-900">{option.title}</span>
                        <span className={clsx('mt-1 block text-xs font-medium', inCart ? 'text-emerald-700' : 'text-slate-500')}>{available ? (inCart ? '✓ Agregada a tu compra' : 'Ver opciones y precio') : 'No disponible para estos datos'}</span>
                        <ArrowRight aria-hidden="true" className="absolute bottom-4 right-4 h-5 w-5 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-brand-600" strokeWidth={2.25} />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {autoAddOnDecision === 'add' && autoVitalInterest && (
              <div className="mt-5 space-y-3">
                {vitalRecommendation?.id === autoVitalInterest && (
                  <p className="rounded-xl border border-brand-100 bg-white/80 px-4 py-3 text-sm font-semibold text-brand-800">✦ Recomendación disponible para tu perfil</p>
                )}
                {hasVitalSelection && (
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                    <span className="text-sm font-semibold text-emerald-900">✓ {selections.filter((selection) => !selection.vehicle).length} cobertura{selections.filter((selection) => !selection.vehicle).length === 1 ? '' : 's'} en tu compra</span>
                    <span className="text-sm font-extrabold text-emerald-700">{formatMoney(selections.filter((selection) => !selection.vehicle).reduce((sum, selection) => sum + selection.totalPrime, 0))}</span>
                  </div>
                )}
                {vitalOffers.filter((product) => product.id === autoVitalInterest).map((product) => (
                  <PlanCard
                    key={product.id}
                    product={product}
                    selected={selections.find((selection) => selection.productId === product.id && !selection.vehicle)}
                    onSelect={(plan) => togglePlan(product, plan)}
                    paymentFrequency={emitConfig.paymentFrequency}
                    defaultOpen
                  />
                ))}
                <Button variant="secondary" className="w-full" onClick={() => setAutoVitalInterest(null)}>＋ Agregar otra cobertura</Button>
              </div>
            )}

            {autoAddOnDecision === 'add' && <button type="button" className="mt-5 text-sm font-semibold text-slate-600 underline underline-offset-4" onClick={() => { setAutoAddOnDecision('skip'); setAutoVitalInterest(null); setSelections((current) => current.filter((selection) => !!selection.vehicle)); }}>{hasVitalSelection ? 'Quitar coberturas y continuar solo con Auto' : 'No, continuar solo con Auto'}</button>}

            {autoAddOnDecision === 'skip' && (
              <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                <p className="text-sm font-bold text-emerald-900">✓ Seguirás solo con tu seguro Auto</p>
                <p className="mt-1 text-sm text-emerald-800">Puedes emitir tu póliza cuando estés listo.</p>
                <Button className="mt-4 w-full lg:hidden" size="lg" onClick={onNext}>Continuar a emisión</Button>
              </div>
            )}

            {autoAddOnDecision === 'add' && hasVitalSelection && (
              <Button className="mt-5 w-full lg:hidden" size="lg" onClick={onNext}>Continuar con mis coberturas</Button>
            )}
          </Card>
        )}

        </>}
        {/* Planes Vitales */}
        {route === 'vital' && plans && plans.length > 0 && (
          <div>
            <h3 className="font-display text-lg font-bold text-slate-900">Planes para ti</h3>
            <div className="mt-4 space-y-4">
              {displayedVitalProducts.map((product) => {
                const selected = selections.find((selection) => selection.productId === product.id && !selection.vehicle);
                return (
                  <PlanCard
                    key={product.id}
                    product={product}
                    selected={selected}
                    onSelect={(plan) => togglePlan(product, plan)}
                    paymentFrequency={emitConfig.paymentFrequency}
                    open={openVitalProductId === product.id}
                    onToggle={() => setOpenVitalProductId((current) => current === product.id ? null : product.id)}
                    onRemove={() => {
                      if (selected) togglePlan(product, { id: selected.planId, assuredSum: selected.assuredSum, totalPrime: selected.totalPrime });
                      if (product.id === interest) setInterest(selections.find((selection) => !selection.vehicle && selection.productId !== product.id)?.productId ?? null);
                    }}
                  />
                );
              })}
            </div>
            {suggestedVitalProducts.length > 0 && (
              <section className="mt-6 rounded-2xl border border-brand-100 bg-brand-50/50 p-4 sm:p-5" aria-labelledby="add-product-title">
                <div>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-brand-700">Complementa tu protección</p>
                    <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-xs font-bold text-brand-700 shadow-sm">Opcional</span>
                  </div>
                  <h4 id="add-product-title" className="font-display mt-2 text-base font-bold leading-snug text-slate-900">¿Quieres incluir otro producto?</h4>
                </div>
                <div className="mt-3 -mr-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-3 pt-2 pr-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:-mr-5 sm:pr-5">
                  {suggestedVitalProducts.map((product) => {
                    const plan = [...(product.plans ?? [])].sort((a, b) => a.totalPrime - b.totalPrime)[0];
                    if (!plan) return null;
                    const visual = productVisual(product.id);
                    const frequency = PAYMENT_FREQUENCIES.find((item) => item.value === emitConfig.paymentFrequency) ?? PAYMENT_FREQUENCIES[3];
                    return (
                      <button
                        key={product.id}
                        type="button"
                        onClick={() => { setInterest(product.id); setOpenVitalProductId(product.id); }}
                        className="w-56 shrink-0 snap-start rounded-2xl border border-brand-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-brand-400 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className={clsx('flex h-9 w-9 items-center justify-center rounded-full', visual.tone)}><ProductIcon icon={visual.icon} className="h-5 w-5" /></span>
                          <span className="rounded-full bg-brand-50 px-2 py-1 text-[10px] font-bold text-brand-700">Vital</span>
                        </div>
                        <p className="mt-3 line-clamp-2 text-sm font-bold leading-snug text-slate-900">{product.title}</p>
                        <p className="mt-1 text-xs text-slate-500">Suma asegurada: {formatMoney(plan.assuredSum)}</p>
                        <div className="mt-3 border-t border-slate-100 pt-3">
                          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Equivalente {frequency.label.toLowerCase()}</p>
                          <p className="mt-0.5 text-lg font-extrabold text-brand-700">{formatMoney(plan.totalPrime / frequency.per)}</p>
                        </div>
                        <span className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-brand-700">Ver opciones <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-3.5 w-3.5"><path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}
          </div>
        )}

        {plans && plans.length === 0 && !searching && (
          <Alert tone="info">No encontramos planes para estos datos. Comprueba que tus datos sean correctos o consulta con un asesor.</Alert>
        )}


      </div>

      {/* ---- Resumen lateral ---- */}
      <div className={clsx('lg:sticky lg:top-28 h-fit', route === 'auto' && 'hidden lg:block')}>
        <Card className="jlc-summary">
          <h4 className="font-display text-lg font-bold">Tus productos</h4>
          {selections.length === 0 ? (
            <p className="mt-3 text-sm text-slate-300">
              Aún no has elegido ningún plan. Cotiza y selecciona el que mejor se ajuste a ti.
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {selections.map((s) => {
                const visual = s.vehicle ? FALLBACK_PRODUCT_VISUAL : productVisual(s.productId);
                return (
                  <li key={s.productId} className="flex items-start gap-3 rounded-xl bg-white/5 p-3">
                    <span className={clsx('flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg font-bold', visual.active)} aria-hidden="true">
                      {s.vehicle ? '🚗' : <ProductIcon icon={visual.icon} className="h-5 w-5" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="min-w-0 pr-1 text-sm font-semibold leading-snug text-white">{s.productTitle}</p>
                        <div className="shrink-0 text-right">
                          <p className="text-[9px] font-bold uppercase tracking-wide text-slate-300">{selectedFrequency.label}</p>
                          <p className="text-lg font-extrabold leading-tight text-accent-400">{formatMoney(s.totalPrime / selectedFrequency.per)}</p>
                        </div>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <Badge tone="slate" className={clsx('sm:hidden', FREQUENCY_BADGE_COLORS[selectedFrequency.value])}>{selectedFrequency.label}</Badge>
                        <Badge tone={s.vehicle ? 'amber' : 'brand'} className="hidden sm:inline-flex">{s.vehicle ? 'Auto' : 'Vital'}</Badge>
                        <span className="hidden text-xs text-slate-300 sm:inline">{selectedFrequency.label}</span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] font-medium">
                        <span className="text-slate-300">SA: {formatMoney(s.assuredSum)}</span>
                        {selectedFrequency.per > 1 && <span className="font-extrabold text-amber-200">Anual: {formatMoney(s.totalPrime)}</span>}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeSelection(s)}
                      className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-300 transition hover:bg-rose-500/20 hover:text-rose-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
                      aria-label={`Quitar ${s.productTitle} de mis productos`}
                      title="Quitar producto"
                    >
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><path d="M4 7h16M10 11v6m4-6v6M9 7l1-2h4l1 2m-9 0 1 13h10l1-13" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <Divider label="Total" />
          <div className="flex items-center justify-between gap-3 text-lg">
            <span className="font-semibold text-slate-200">Pago {selectedFrequency.label.toLowerCase()}</span>
            <div className="text-right">
              <span className="font-display block whitespace-nowrap text-3xl font-extrabold text-accent-400">{formatMoney(frequencyEquivalentTotal)}</span>
              {selectedFrequency.per > 1 && <p className="mt-0.5 whitespace-nowrap text-xs font-extrabold text-amber-200">Prima anual: {formatMoney(total)}</p>}
            </div>
          </div>

          <p className="mt-3 text-xs text-slate-300">El equivalente cambia con la frecuencia elegida. Mercantil confirma el importe final e impuestos al emitir.</p>
          <Button className="mt-6 w-full" size="lg" disabled={!canContinue} onClick={onNext}>
            Continuar <ArrowRight aria-hidden="true" className="h-4 w-4" strokeWidth={2.25} />
          </Button>
          {!canContinue && (
            <p className="mt-2 text-center text-xs text-slate-400">
              {route === 'auto' && identityConfirmed && hasAutoSelection
                ? 'Elige una de las dos opciones de protección para continuar.'
                : 'Selecciona al menos un plan para continuar.'}
            </p>
          )}
        </Card>
      </div>
      <MobileCartSheet
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        selections={selections}
        frequency={selectedFrequency}
        canContinue={canContinue}
        onContinue={() => { setCartOpen(false); onNext(); }}
        onRemove={removeSelection}
      />
      {formError && formErrorTarget && (
        <QuoteErrorDialog
          target={formErrorTarget}
          message={formError}
          onClose={() => { setFormError(null); setFormErrorTarget(null); }}
          onReview={() => {
            scrollTo(formErrorTarget === 'identity' ? 'datos-asegurado' : 'cotiza');
            setFormError(null);
            setFormErrorTarget(null);
          }}
        />
      )}
    </div>
  );
}

function MobileCartSheet({
  open,
  onClose,
  selections,
  frequency,
  canContinue,
  onContinue,
  onRemove,
}: {
  open: boolean;
  onClose: () => void;
  selections: FPlanChoice[];
  frequency: (typeof PAYMENT_FREQUENCIES)[number];
  canContinue: boolean;
  onContinue: () => void;
  onRemove: (selection: FPlanChoice) => void;
}) {
  if (!open) return null;
  const total = selections.reduce((sum, selection) => sum + selection.totalPrime, 0);
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-slate-950/45 p-0 lg:hidden" role="presentation" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-cart-title"
        className="max-h-[82vh] w-full overflow-y-auto rounded-t-3xl bg-white px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mx-auto h-1.5 w-12 rounded-full bg-slate-200" />
        <div className="mt-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-white"><ShoppingBasket aria-hidden="true" className="h-5 w-5" strokeWidth={2.25} /></span>
            <div>
              <h2 id="mobile-cart-title" className="font-display text-lg font-bold text-slate-900">Tus productos</h2>
              <p className="text-xs text-slate-500">{selections.length} seleccionado{selections.length === 1 ? '' : 's'}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-sm font-bold text-slate-500 hover:bg-slate-100 hover:text-slate-700">Cerrar</button>
        </div>

        {selections.length === 0 ? (
          <p className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">Aún no has elegido un producto.</p>
        ) : (
          <ul className="mt-5 space-y-2.5">
            {selections.map((selection) => {
              const visual = selection.vehicle ? FALLBACK_PRODUCT_VISUAL : productVisual(selection.productId);
              return (
                <li key={selection.productId} className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto_2rem] items-center gap-3 rounded-xl border border-slate-100 p-3">
                  <span className={clsx('flex h-9 w-9 items-center justify-center rounded-full', visual.active)}>{selection.vehicle ? '🚗' : <ProductIcon icon={visual.icon} className="h-4 w-4" />}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold text-slate-900">{selection.productTitle}</span>
                    <span className="block text-xs text-slate-500">{frequency.label} · SA: {formatMoney(selection.assuredSum)}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-[9px] font-bold uppercase tracking-wide text-slate-400">{frequency.label}</span>
                    <span className="block text-base font-extrabold text-brand-700">{formatMoney(selection.totalPrime / frequency.per)}</span>
                    {frequency.per > 1 && <span className="block text-[10px] font-extrabold text-amber-700">Anual: {formatMoney(selection.totalPrime)}</span>}
                  </span>
                  <button
                    type="button"
                    onClick={() => onRemove(selection)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
                    aria-label={`Quitar ${selection.productTitle} de mis productos`}
                    title="Quitar producto"
                  >
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><path d="M4 7h16M10 11v6m4-6v6M9 7l1-2h4l1 2m-9 0 1 13h10l1-13" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-5 flex items-center justify-between border-t border-slate-200 pt-4">
          <p className="text-sm font-bold text-slate-900">Pago {frequency.label.toLowerCase()}</p>
          <div className="text-right">
            <p className="font-display text-3xl font-extrabold text-brand-700">{formatMoney(total / frequency.per)}</p>
            {frequency.per > 1 && <p className="mt-0.5 text-xs font-extrabold text-amber-700">Prima anual: {formatMoney(total)}</p>}
          </div>
        </div>
        <Button className="mt-5 w-full" size="lg" disabled={!canContinue} onClick={onContinue}>Continuar <ArrowRight aria-hidden="true" className="h-4 w-4" strokeWidth={2.25} /></Button>
        {!canContinue && <p className="mt-2 text-center text-xs text-slate-500">Selecciona al menos un plan para continuar.</p>}
      </section>
    </div>
  );
}

function QuoteErrorDialog({
  target,
  message,
  onClose,
  onReview,
}: {
  target: 'vehicle' | 'identity';
  message: string;
  onClose: () => void;
  onReview: () => void;
}) {
  const title = target === 'identity' ? 'Revisa tus datos' : 'No pudimos consultar tu vehículo';
  const action = target === 'identity' ? 'Revisar mis datos' : 'Revisar vehículo';
  return (
    <div className="quote-error-dialog" role="presentation" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="quote-error-title"
        className="quote-error-sheet"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mx-auto h-1.5 w-12 rounded-full bg-slate-200 sm:hidden" />
        <div className="mt-5 flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-rose-100 text-xl text-rose-600">!</span>
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-rose-600">Necesitamos corregir algo</p>
            <h2 id="quote-error-title" className="font-display mt-1 text-xl font-extrabold text-slate-900">{title}</h2>
          </div>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-slate-600">{message}</p>
        <Button className="mt-6 w-full" size="lg" onClick={onReview}>{action}</Button>
        <button type="button" className="mt-3 w-full py-2 text-sm font-semibold text-slate-500" onClick={onClose}>Cerrar</button>
      </section>
    </div>
  );
}

function BirthDateSelect({
  value,
  onChange,
  invalid,
}: {
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
}) {
  const read = (date: string) => {
    const [year = '', month = '', day = ''] = date.split('-');
    return { day: day.replace(/^0/, ''), month: month.replace(/^0/, ''), year };
  };
  const [parts, setParts] = useState(() => read(value));
  const [openPart, setOpenPart] = useState<'day' | 'month' | 'year' | null>(null);

  useEffect(() => {
    if (value) setParts(read(value));
  }, [value]);

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: currentYear - 1919 }, (_, index) => String(currentYear - index));
  const daysInMonth = parts.month && parts.year
    ? new Date(Number(parts.year), Number(parts.month), 0).getDate()
    : 31;
  const update = (field: 'day' | 'month' | 'year', nextValue: string) => {
    const next = { ...parts, [field]: nextValue };
    const maxDay = next.month && next.year ? new Date(Number(next.year), Number(next.month), 0).getDate() : 31;
    if (Number(next.day) > maxDay) next.day = '';
    setParts(next);
    if (next.day && next.month && next.year) {
      const iso = `${next.year}-${next.month.padStart(2, '0')}-${next.day.padStart(2, '0')}`;
      const parsed = new Date(`${iso}T00:00:00`);
      onChange(Number.isNaN(parsed.getTime()) ? '' : iso);
    } else {
      onChange('');
    }
  };
  const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const options = openPart === 'day'
    ? Array.from({ length: daysInMonth }, (_, index) => ({ value: String(index + 1), label: String(index + 1) }))
    : openPart === 'month'
      ? months.map((month, index) => ({ value: String(index + 1), label: month }))
      : openPart === 'year'
        ? years.map((year) => ({ value: year, label: year }))
        : [];
  const labels = {
    day: parts.day || 'Día',
    month: parts.month ? months[Number(parts.month) - 1] : 'Mes',
    year: parts.year || 'Año',
  };

  return (
    <div className="birth-date-picker">
      <div className="grid grid-cols-[0.85fr_1.2fr_1fr] gap-2">
        {(['day', 'month', 'year'] as const).map((part) => (
          <button
            key={part}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={openPart === part}
            className={clsx('birth-date-trigger', parts[part] && 'birth-date-trigger-filled', invalid && 'birth-date-trigger-invalid')}
            onClick={() => setOpenPart(part)}
          >
            <span className="truncate">{labels[part]}</span>
            <Chevron />
          </button>
        ))}
      </div>
      {openPart && (
        <div className="date-picker-dialog" role="presentation" onMouseDown={() => setOpenPart(null)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-label={`Selecciona ${openPart === 'day' ? 'el día' : openPart === 'month' ? 'el mes' : 'el año'} de nacimiento`}
            className="date-picker-sheet"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="mx-auto h-1.5 w-12 rounded-full bg-slate-200 sm:hidden" />
            <div className="mt-4 flex items-center justify-between gap-4">
              <h3 className="font-display text-xl font-extrabold text-slate-900">Selecciona {openPart === 'day' ? 'el día' : openPart === 'month' ? 'el mes' : 'el año'}</h3>
              <button type="button" className="text-sm font-bold text-brand-700" onClick={() => setOpenPart(null)}>Cerrar</button>
            </div>
            <div className={clsx('date-picker-options mt-4', openPart === 'month' && 'date-picker-options-months')}>
              {options.map((option) => {
                const selected = parts[openPart] === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={clsx('date-picker-option', selected && 'date-picker-option-selected')}
                    onClick={() => { update(openPart, option.value); setOpenPart(null); }}
                  >
                    {option.label}{selected && <span aria-hidden="true">✓</span>}
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

/* ---------- Tarjeta de producto+planes ---------- */
function PlanCard({
  product,
  selected,
  onSelect,
  paymentFrequency = 'yearly',
  open: controlledOpen,
  onToggle,
  onRemove,
  defaultOpen = false,
}: {
  product: PlanProduct;
  selected?: FPlanChoice;
  onSelect: (plan: { id: string; assuredSum: number; totalPrime: number }) => void;
  paymentFrequency?: EmitConfig['paymentFrequency'];
  open?: boolean;
  onToggle?: () => void;
  onRemove?: () => void;
  defaultOpen?: boolean;
}) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const open = controlledOpen ?? internalOpen;
  const hasPlans = !!product.plans?.length;
  const lowestPrime = hasPlans ? Math.min(...product.plans!.map((plan) => plan.totalPrime)) : null;
  const visual = productVisual(product.id);
  const frequency = PAYMENT_FREQUENCIES.find((item) => item.value === paymentFrequency) ?? PAYMENT_FREQUENCIES[3];
  const selectedPlan = selected ? product.plans?.find((plan) => plan.id === selected.planId) : undefined;
  const headerPrime = selectedPlan?.totalPrime ?? lowestPrime;

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition">
      <div className={clsx('flex items-stretch', selected && visual.surface)}>
        <button
          type="button"
          className="grid min-w-0 flex-1 grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-4 text-left sm:px-5"
          onClick={() => onToggle ? onToggle() : setInternalOpen((current) => !current)}
        >
        <span className={clsx('flex h-10 w-10 shrink-0 aspect-square items-center justify-center rounded-full text-xl font-bold', selected ? visual.active : visual.tone)} aria-hidden="true">
          <ProductIcon icon={visual.icon} className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="break-words text-sm font-bold leading-snug text-slate-900 sm:text-base">{product.title}</p>
          {product.description && <p className="mt-0.5 line-clamp-2 break-words text-xs leading-snug text-slate-500 sm:text-sm">{product.description}</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {selected ? <Badge tone="emerald">Elegido</Badge> : headerPrime !== null && <span className="text-xs font-semibold text-slate-500">Desde</span>}
          {headerPrime !== null && <span className="text-sm font-extrabold text-brand-700">{formatMoney(selected ? headerPrime / frequency.per : headerPrime)}</span>}
          {headerPrime !== null && <span className="text-[10px] font-semibold text-slate-500">{selected ? frequency.label : '/ año'}</span>}
          <span className="text-slate-400">{open ? <Chevron className="rotate-180" /> : <Chevron />}</span>
        </div>
        </button>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="m-2 shrink-0 self-center rounded-lg p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
            aria-label={`Quitar ${product.title} de mi selección`}
            title="Quitar producto"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5"><path d="M4 7h16M10 11v6m4-6v6M9 7l1-2h4l1 2m-9 0 1 13h10l1-13" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        )}
      </div>

      {open && hasPlans && (
        <div className="border-t border-slate-100 bg-slate-50 px-4 py-4 sm:px-5">
          <p className="mb-3 text-xs font-semibold text-slate-500">Elige una cobertura. Mostramos el equivalente {frequency.label.toLowerCase()} de la prima anual; Mercantil confirma la cuota al emitir.</p>
          <div role="radiogroup" aria-label={`Opciones para ${product.title}`} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="grid grid-cols-[minmax(0,1fr)_auto_2rem] items-center gap-3 bg-slate-100 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-slate-500">
              <span>Protección</span>
              <span>Equivalente</span>
              <span aria-hidden="true" />
            </div>
            {product.plans!.map((plan) => {
              const isSel = selected?.planId === plan.id;
              const installment = plan.totalPrime / frequency.per;
              return (
                <button
                  key={plan.id}
                  type="button"
                  role="radio"
                  aria-checked={isSel}
                  onClick={() => onSelect({ id: plan.id, assuredSum: plan.assuredSum, totalPrime: plan.totalPrime })}
                  className={clsx(
                    'grid min-h-[4.75rem] w-full grid-cols-[minmax(0,1fr)_auto_2rem] items-center gap-3 border-t border-slate-100 px-3 py-2.5 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500',
                    isSel ? clsx(visual.surface, 'border-l-4 border-l-brand-600') : 'hover:bg-slate-50',
                  )}
                >
                  <span className="min-w-0">
                    <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Suma asegurada</span>
                    <span className="font-display mt-0.5 block text-base font-bold leading-tight text-slate-900">{formatMoney(plan.assuredSum)}</span>
                    <span className="mt-0.5 block text-[11px] text-slate-500">Anual: {formatMoney(plan.totalPrime)}</span>
                  </span>
                  <span className="text-right">
                    <span className="block text-sm font-extrabold text-brand-700">{formatMoney(installment)}</span>
                    <span className="block text-[10px] font-semibold text-slate-500">{frequency.label}</span>
                  </span>
                  <span className={clsx('flex h-7 w-7 items-center justify-center rounded-full border-2 transition', isSel ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white text-transparent')} aria-hidden="true">
                    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-4 w-4"><path d="m5 10 3 3 7-7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Auto se compra como una elección principal, no como un acordeón. La tarjeta
 * deja comparables precio, suma asegurada y descripción que devuelve Mercantil.
 */
function AutoPlanCard({
  product,
  selected,
  onSelect,
}: {
  product: PlanProduct;
  selected?: FPlanChoice;
  onSelect: (plan: { id: string; assuredSum: number; totalPrime: number }) => void;
}) {
  const plans = product.plans ?? [];
  const label = /plus|elite/i.test(product.title ?? '') ? 'Plus' : /b[aá]sic/i.test(product.title ?? '') ? 'Básica' : 'Auto';
  const recommended = label === 'Plus';
  const description = recommended
    ? 'Adquiérela con asistencia en viajes a nivel nacional, defensa legal, atención en emergencias viales y servicio de grúa.'
    : product.description || 'Consulta las condiciones disponibles para esta cobertura.';

  return (
    <article className={clsx(
      'relative overflow-hidden rounded-2xl border-2 p-4 transition sm:p-5',
      selected ? 'border-brand-600 bg-brand-50/60 shadow-md shadow-brand-900/10' : recommended ? 'border-emerald-400 bg-emerald-50/40' : 'border-slate-200 bg-white',
    )}>
      {recommended && <div className="absolute right-0 top-0 rounded-bl-xl bg-emerald-500 px-3 py-1.5 text-xs font-extrabold text-white">RECOMENDADO</div>}
      <div className="pr-24">
        <p className={clsx('text-xs font-bold uppercase tracking-widest', recommended ? 'text-emerald-700' : 'text-brand-700')}>RCV {label}</p>
        <h4 className="font-display mt-1 break-words text-xl font-extrabold leading-tight text-slate-900">{product.title}</h4>
      </div>
      <p className="mt-3 min-h-10 break-words text-sm leading-relaxed text-slate-600">
        {description}
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {plans.map((plan) => {
          const chosen = selected?.planId === plan.id;
          return (
            <button
              key={plan.id}
              type="button"
              onClick={() => onSelect({ id: plan.id, assuredSum: plan.assuredSum, totalPrime: plan.totalPrime })}
              className={clsx(
                'rounded-xl border p-4 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
                chosen ? 'border-brand-600 bg-white ring-2 ring-brand-100' : 'border-slate-200 bg-white hover:border-brand-400 hover:shadow-sm',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Prima estimada</span>
                {chosen && <Badge tone="emerald">En carrito</Badge>}
              </div>
              <strong className="font-display mt-1 block text-2xl font-extrabold text-slate-900">{formatMoney(plan.totalPrime)}</strong>
              <span className="mt-3 block border-t border-slate-100 pt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Suma asegurada</span>
              <span className="mt-0.5 block text-base font-bold text-brand-800">{formatMoney(plan.assuredSum)}</span>
              <span className={clsx('mt-4 flex min-h-11 items-center justify-center rounded-lg px-3 text-sm font-bold', chosen ? 'bg-emerald-500 text-white' : recommended ? 'bg-emerald-600 text-white' : 'bg-brand-600 text-white')}>
                {chosen ? '✓ Agregado al carrito' : `Elegir RCV ${label}`}
              </span>
            </button>
          );
        })}
      </div>
    </article>
  );
}

function CartNextStep({
  count,
  total,
  message,
  action,
  onAction,
}: {
  count: number;
  total: number;
  message: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500 font-bold text-white">✓</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-emerald-900">Agregado al carrito</p>
          <p className="mt-0.5 text-sm leading-snug text-emerald-800">{message}</p>
          <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-white/75 px-3 py-2">
            <span className="text-xs font-semibold text-slate-600">{count} cobertura{count === 1 ? '' : 's'}</span>
            <span className="text-sm font-extrabold text-emerald-800">{formatMoney(total)}</span>
          </div>
          <Button className="mt-3 w-full sm:w-auto" size="sm" onClick={onAction}>{action} <ArrowRight aria-hidden="true" className="h-4 w-4" strokeWidth={2.25} /></Button>
        </div>
      </div>
    </div>
  );
}

function Chevron({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={clsx('h-5 w-5 transition', className)}>
      <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
    </svg>
  );
}












