import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, Heart, HeartPulse, Pencil, Ribbon, ShieldCheck, Siren, Syringe, type LucideIcon } from 'lucide-react';
import { api, ApiError, type AdminEmissionSyncPayload } from '../../../lib/api';
import {
  CIVIL_STATES,
  EMAIL_REGEX,
  formatMoney,
  PAYMENT_FREQUENCIES,
  PRODUCT_VITALES,
  SALES_CHANNEL_ID,
} from '../../../lib/config';
import type { CartSummary, ClientExists, CountryLocations, EmissionError, EmitStatus, VehicleColor, VehicleLocation } from '../../../lib/types';
import { clsx } from '../clsx';
import { Alert, Badge, Button, Card, Checkbox, Divider, FieldWrapper, Input, Option, SearchableSelect, Select } from '../ui';
import type { ClientInfo, CompleteData, EmitConfig, IdentityData, PlanChoice, Setter, VehicleDetailData, VehicleFlowSelection } from '../types';

/** Formatos aceptados para el título de propiedad (especificación de Mercantil) */
const TITLE_FILE_TYPES = ['image/png', 'image/jpeg', 'application/pdf'];
const TITLE_MAX_BYTES = 9 * 1024 * 1024; // 9 MB

/** Serie de chasis: 17 caracteres alfanuméricos en mayúsculas */
const CHASSIS_RE = /^[A-Z0-9]{17}$/;
/** Serie de motor: 18 caracteres alfanuméricos en mayúsculas */
const ENGINE_RE = /^[A-Z0-9]{18}$/;

type DeclarationKey = 'health' | 'terms' | 'pep';

const DECLARATION_COPY: Record<DeclarationKey, string> = {
  health: 'Confirma que el titular goza de buena salud.',
  terms: 'Acepta los términos y condiciones de la póliza.',
  pep: 'Confirma que el titular no es una persona políticamente expuesta.',
};

const PRODUCT_SUMMARY_VISUALS = {
  vida: { icon: Heart, active: 'bg-rose-500 text-white' },
  accidentes: { icon: Siren, active: 'bg-indigo-500 text-white' },
  funerario: { icon: Ribbon, active: 'bg-violet-500 text-white' },
  hospitalizacion: { icon: HeartPulse, active: 'bg-cyan-600 text-white' },
  cancer: { icon: Syringe, active: 'bg-amber-500 text-white' },
} as const;
const FALLBACK_PRODUCT_SUMMARY_VISUAL = { icon: ShieldCheck, active: 'bg-brand-600 text-white' };
const FREQUENCY_BADGE_COLORS = {
  monthly: '!bg-sky-500 !text-white !ring-sky-500',
  quarterly: '!bg-indigo-500 !text-white !ring-indigo-500',
  biannual: '!bg-violet-500 !text-white !ring-violet-500',
  yearly: '!bg-emerald-500 !text-white !ring-emerald-500',
} as const;

function productSummaryVisual(productId: string) {
  const key = (Object.keys(PRODUCT_VITALES) as Array<keyof typeof PRODUCT_VITALES>)
    .find((candidate) => PRODUCT_VITALES[candidate] === productId);
  return key ? PRODUCT_SUMMARY_VISUALS[key] : FALLBACK_PRODUCT_SUMMARY_VISUAL;
}

function ProductSummaryIcon({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
  return <Icon aria-hidden="true" strokeWidth={2.25} className={clsx('h-5 w-5', className)} />;
}

/** Convierte rechazos internos de Mercantil en una instrucción accionable. */
function emissionMessage(detail?: string, hasAuto = false): string {
  const normalized = (detail ?? '').toLocaleUpperCase('es');
  if (normalized.includes('NUMERO DE PLACA') && normalized.includes('EXISTE')) {
    return 'La placa indicada ya está asociada a una póliza o solicitud. Revisa que la placa sea correcta antes de intentar nuevamente.';
  }
  if (normalized.includes('MSQUOTEERROR') || normalized.includes('QUOTE ERROR')) {
    return hasAuto
      ? 'Mercantil no pudo calcular esta cotización con los datos del vehículo. Revísalos e inténtalo nuevamente.'
      : 'Mercantil no pudo calcular esta cotización con los datos recibidos. Revísalos e inténtalo nuevamente.';
  }
  if (normalized.includes('MSEMITERROR') || normalized.includes('EMISSION ERROR OCURRED')) {
    return 'Tus datos ya quedaron registrados en Mercantil. El problema ocurrió después, al emitir este carrito: Mercantil lo rechazó sin indicar un dato específico. Puedes reintentar sin crear otro asegurado o contactar a JLC con la referencia de la solicitud.';
  }
  return 'Mercantil no pudo emitir la póliza. Revisa los datos e inténtalo nuevamente.';
}

function titleFileError(file: File): string | null {
  if (!TITLE_FILE_TYPES.includes(file.type)) {
    return 'El título de propiedad debe ser PNG, JPG o PDF.';
  }
  if (file.size > TITLE_MAX_BYTES) {
    return 'El título de propiedad supera el límite de 9 MB.';
  }
  return null;
}

/**
 * El core de Mercantil puede tardar unos instantes en replicar un cliente que
 * acaba de completarse. Antes de crear su primer carrito confirmamos que la
 * consulta de existencia ya devuelve un ID utilizable.
 */
async function confirmClientReady(input: {
  birthDate: string;
  dniType: string;
  dniNumber: string;
  dniVenNationality?: string;
  fallbackClientId: string;
}): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await api.clientExists(input);
      if (result.exists && result.clientId) return result.clientId;
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) throw error;
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 900));
  }
  // La creación devolvió un ID válido; se conserva como respaldo si la lectura
  // aún no se actualizó, pero la espera anterior cubre la réplica normal.
  return input.fallbackClientId;
}

export interface EmiteStepProps {
  identity: IdentityData;
  setIdentity: Setter<IdentityData>;
  client: ClientInfo;
  setClient: Setter<ClientInfo>;
  complete: CompleteData;
  setComplete: Setter<CompleteData>;
  vehicleDetail: VehicleDetailData;
  setVehicleDetail: Setter<VehicleDetailData>;
  emitConfig: EmitConfig;
  setEmitConfig: Setter<EmitConfig>;
  selections: PlanChoice[];
  vehicleFlow: VehicleFlowSelection | null;
  hasAuto: boolean;
  hasVital: boolean;
  cartId: string | null;
  setCartId: Setter<string | null>;
  summary: CartSummary | null;
  setSummary: Setter<CartSummary | null>;
  emissionDone: boolean;
  setEmissionDone: Setter<boolean>;
  onDone: () => void;
  onBack: () => void;
}

type Phase =
  | 'idle'
  | 'creating-client'
  | 'completing-client'
  | 'creating-cart'
  | 'adding-products'
  | 'completing-vehicle'
  | 'uploading-title'
  | 'emitting'
  | 'polling'
  | 'done'
  | 'error';

const PHASE_LABEL: Record<Phase, string> = {
  idle: 'Listo para emitir',
  'creating-client': 'Creando cliente en Mercantil…',
  'completing-client': 'Completando tus datos…',
  'creating-cart': 'Creando carrito de compra…',
  'adding-products': 'Añadiendo productos al carrito…',
  'completing-vehicle': 'Registrando datos del vehículo…',
  'uploading-title': 'Cargando título de propiedad…',
  emitting: 'Emisión en curso…',
  polling: 'Esperando confirmación de Mercantil…',
  done: '¡Póliza emitida con éxito!',
  error: 'La emisión no pudo completarse',
};

export function EmiteStep(props: EmiteStepProps) {
  const emissionInFlight = useRef(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [missingDeclarations, setMissingDeclarations] = useState<DeclarationKey[]>([]);
  const [progress, setProgress] = useState(0);
  const [statusDetail, setStatusDetail] = useState<string | null>(null);

  /* ------- Título de propiedad (solo Auto) ------- */
  const [titleFile, setTitleFile] = useState<File | null>(null);
  const [titleUploaded, setTitleUploaded] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);

  /* ------- Ubicaciones para el cliente (dirección) ------- */
  const [locations, setLocations] = useState<CountryLocations | null>(null);
  const [colors, setColors] = useState<VehicleColor[]>([]);
  const [vehicleLocations, setVehicleLocations] = useState<VehicleLocation[]>([]);

  useEffect(() => {
    if (!locations) {
      api.locations('29').then(setLocations).catch(() => setLocations(null));
    }
  }, [locations]);

  useEffect(() => {
    if (props.hasAuto && colors.length === 0) {
      api.vehicleColors().then(setColors).catch(() => setColors([]));
    }
    if (props.hasAuto && vehicleLocations.length === 0) {
      api.vehicleLocations().then(setVehicleLocations).catch(() => setVehicleLocations([]));
    }
  }, [props.hasAuto, colors.length, vehicleLocations.length]);

  const setCompleteField = <K extends keyof CompleteData>(k: K, v: CompleteData[K]) =>
    props.setComplete({ ...props.complete, [k]: v });
  const setAddressField = (k: keyof CompleteData['address'], v: string) =>
    props.setComplete({ ...props.complete, address: {
      ...props.complete.address,
      ...(k === 'administrativeAreaId' ? { subadministrativeAreaId: '', localityId: '', zoneId: '' } : {}),
      [k]: v,
    } });
  const setVehicleField = <K extends keyof VehicleDetailData>(k: K, v: VehicleDetailData[K]) =>
    props.setVehicleDetail({ ...props.vehicleDetail, [k]: v });

  const handleTitleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setTitleFile(f);
    setTitleUploaded(false);
    setTitleError(f ? titleFileError(f) : null);
  };

  const needsComplete =
    !props.client.exists || props.client.needsCompletion !== false || !props.client.clientId;
  const selectedFrequency = PAYMENT_FREQUENCIES.find((item) => item.value === props.emitConfig.paymentFrequency)
    ?? PAYMENT_FREQUENCIES[3];
  const declarationsRecorded = Boolean(props.cartId && props.emissionDone);

  /** Dirección con nombres legibles: el admin no conoce los ids de ubicación de Mercantil. */
  const adminSyncAddress = useCallback((): AdminEmissionSyncPayload['customer']['address'] => {
    const addr = props.complete.address;
    if (!addr.address1?.trim()) return undefined;
    const state = locations?.administrativeAreas.find((area) => area.id === addr.administrativeAreaId);
    return {
      line1: addr.address1.trim(),
      state: state?.name,
      municipality: state?.subAdministrativeAreas.find((item) => item.id === addr.subadministrativeAreaId)?.name,
      locality: state?.localities.find((item) => item.id === addr.localityId)?.name,
      postalCode: addr.postalCode?.trim() || undefined,
    };
  }, [locations, props.complete.address]);

  const adminSyncPayload = useCallback((cartId: string, clientId?: string): AdminEmissionSyncPayload => ({
    cartId,
    customer: {
      mercantilClientId: clientId ?? props.client.clientId,
      documentType: props.identity.dniType === 'VEN' ? props.identity.dniVenNationality : props.identity.dniType,
      documentNumber: props.identity.dniNumber.trim().toUpperCase(),
      firstName: props.complete.firstName.trim() || undefined,
      lastName: props.complete.lastName.trim() || undefined,
      birthDate: props.identity.birthDate || undefined,
      gender: props.identity.genderId || undefined,
      email: props.identity.email.trim() || undefined,
      phone: [props.identity.phonePrefix, props.identity.areaCode, props.identity.phoneNumber].filter(Boolean).join('') || undefined,
      address: needsComplete ? adminSyncAddress() : undefined,
    },
  }), [adminSyncAddress, needsComplete, props.client.clientId, props.complete.firstName, props.complete.lastName, props.identity]);

  const syncEmissionToAdmin = useCallback((cartId: string, clientId?: string) => {
    void api.syncAdminEmission(adminSyncPayload(cartId, clientId)).catch((syncError) => {
      console.error('[admin-sync] No fue posible sincronizar la emisión', { cartId, syncError });
    });
  }, [adminSyncPayload]);

  /* ------- Orquestación de emisión ------- */
  const emitNow = useCallback(async () => {
    if (emissionInFlight.current) return;
    if (props.cartId) {
      setError(null);
      try {
        const status = await api.emitStatus(props.cartId);
        if (status.status === 'emitted' || status.status === 'paid') {
          props.setSummary(await api.summary(props.cartId));
          props.setEmissionDone(true);
          syncEmissionToAdmin(props.cartId);
          props.onDone();
        } else {
          setError('Tu solicitud ya existe. Estamos pendientes de su resolución. Contacta con JLC indicando la referencia ' + props.cartId + '.');
        }
      } catch {
        setError('No pudimos consultar tu solicitud. Conservamos la referencia para evitar otra emisión. Vuelve a consultar su estado.');
      }
      return;
    }
    const missing = [
      ...(props.hasVital && !props.emitConfig.holderEnjoysGoodHealth ? ['health' as const] : []),
      ...(!props.emitConfig.holderAcceptedTermsAndConditions ? ['terms' as const] : []),
      ...(!props.emitConfig.isHolderNotPoliticallyExposed ? ['pep' as const] : []),
    ];
    if (missing.length > 0) {
      setMissingDeclarations(missing);
      setError(null);
      return;
    }
    setMissingDeclarations([]);
    // Si el cliente ya está completo en Mercantil no hace falta pedir nombre/apellido
    const needsData = !props.client.exists || props.client.needsCompletion !== false || !props.client.clientId;
    if (needsData) {
      const isVenezuelanPhone = props.identity.phoneCountryId === '29';
      const hasValidPhone = isVenezuelanPhone
        ? /^0?\d{3}$/.test(props.identity.areaCode.trim()) && /^\d{7}$/.test(props.identity.phoneNumber.trim())
        : /^\d{6,15}$/.test(props.identity.phoneNumber.trim());
      if (!EMAIL_REGEX.test(props.identity.email.trim()) || !hasValidPhone) {
        setError(isVenezuelanPhone
          ? 'Para emitir, Mercantil requiere correo y teléfono: código de área de 3 o 4 dígitos y número de 7 dígitos.'
          : 'Para emitir, Mercantil requiere correo y un teléfono válido para el país seleccionado.');
        return;
      }
      const addr = props.complete.address;
      if (!props.complete.firstName || !props.complete.lastName) {
        setError('Agrega el nombre y apellido del titular para poder emitir.');
        return;
      }
      if (!addr.administrativeAreaId || !addr.subadministrativeAreaId || !addr.localityId || !addr.postalCode?.trim() || !addr.address1) {
        setError('Completa la dirección: estado, municipio, localidad, código postal y dirección son obligatorios.');
        return;
      }
    }
    // Con vehículo: necesitamos el flujo de vehículo completo (año/marca/modelo/versión)
    if (props.hasAuto) {
      const vf = props.vehicleFlow;
      if (!vf?.year || !vf.brandCode || !vf.modelCode || !vf.versionCode) {
        setError('Falta la información del vehículo. Vuelve a Cotiza y selecciona año, marca, modelo y versión.');
        return;
      }
      const vd = props.vehicleDetail;
      if (!vd.commonLocationId || !vd.plate || !vd.colorId) {
        setError('Completa la información del vehículo: estado donde circula, placa y color.');
        return;
      }
      const chassis = vd.chassisSerial.trim().toUpperCase();
      const engine = vd.engineSerial.trim().toUpperCase();
      if (!CHASSIS_RE.test(chassis)) {
        setError('La serie del chasis debe tener 17 caracteres alfanuméricos (A–Z, 0–9), en mayúsculas.');
        return;
      }
      if (!ENGINE_RE.test(engine)) {
        setError('La serie del motor debe tener 18 caracteres alfanuméricos (A–Z, 0–9), en mayúsculas.');
        return;
      }
      if (!titleFile) {
        setError('Para emitir un seguro Auto debes cargar el título de propiedad del vehículo (PNG, JPG o PDF, máx 9 MB).');
        return;
      }
      const tErr = titleFileError(titleFile);
      if (tErr) {
        setError(tErr);
        return;
      }
    }

    setError(null);
    emissionInFlight.current = true;
    setPhase('creating-client');
    setProgress(5);
    const dniVenNationality = props.identity.dniType === 'VEN' ? props.identity.dniVenNationality : undefined;
    const dniNumber = props.identity.dniNumber.trim().toUpperCase();

    try {
      /* 1) Crear o completar cliente */
      let clientId = props.client.clientId;
      let exists: ClientExists;
      try {
        exists = await api.clientExists({
          birthDate: props.identity.birthDate,
          dniType: props.identity.dniType,
          dniNumber,
          dniVenNationality,
        });
      } catch (e) {
        // 404 = el cliente NO existe todavía → lo creamos
        if (e instanceof ApiError && e.status === 404) {
          exists = { exists: false };
        } else {
          throw e;
        }
      }

      if (!exists.exists || !exists.clientId) {
        setPhase('creating-client');
        const created = await api.createClient({
          email: props.identity.email.trim(),
          dniType: props.identity.dniType,
          dniNumber,
          dniVenNationality,
          birthDate: props.identity.birthDate,
          phone: {
            countryId: props.identity.phoneCountryId || props.identity.countryId,
            areaCode: props.identity.areaCode.trim(),
            number: props.identity.phoneNumber.trim(),
          },
          genderId: props.identity.genderId,
          address: { countryId: props.identity.countryId },
        });
        clientId = created.clientId;
        props.setClient({ ...props.client, clientId, exists: true, needsCompletion: true });
        setProgress(15);
      } else {
        clientId = exists.clientId;
        props.setClient({ ...props.client, clientId, exists: true, needsCompletion: exists.needsCompletion !== false });
      }

      if (!clientId) throw new Error('No se obtuvo ID de cliente');

      /* 2) Completar información del cliente (solo si es nuevo o está pendiente) */
      const shouldComplete = !exists.exists || exists.needsCompletion !== false;
      if (shouldComplete) {
        setPhase('completing-client');
        await api.completeClient(clientId, {
          email: props.identity.email.trim(),
          firstName: props.complete.firstName,
          lastName: props.complete.lastName,
          dniType: props.identity.dniType,
          dniNumber,
          dniVenNationality,
          birthDate: props.identity.birthDate,
          phone: {
            countryId: props.identity.phoneCountryId || props.identity.countryId,
            areaCode: props.identity.areaCode.trim(),
            number: props.identity.phoneNumber.trim(),
          },
          genderId: props.identity.genderId,
          countryOfBirthId: props.complete.countryOfBirthId,
          civilStateId: props.complete.civilStateId,
          address: {
            countryId: props.identity.countryId,
            administrativeAreaId: props.complete.address.administrativeAreaId,
            subadministrativeAreaId: props.complete.address.subadministrativeAreaId,
            localityId: props.complete.address.localityId,
            // Mercantil rechaza `zoneId: ""` como CUID inválido. La zona es
            // opcional, así que se omite cuando la localidad no la requiere.
            zoneId: props.complete.address.zoneId || undefined,
            postalCode: props.complete.address.postalCode,
            address1: props.complete.address.address1,
          },
        });
        setStatusDetail('Confirmando el registro del titular…');
        clientId = await confirmClientReady({
          birthDate: props.identity.birthDate,
          dniType: props.identity.dniType,
          dniNumber,
          dniVenNationality,
          fallbackClientId: clientId,
        });
      }
      props.setClient({ ...props.client, clientId, needsCompletion: false });
      setProgress(25);

      /* 3) Crear carrito */
      setPhase('creating-cart');
      setStatusDetail(null);
      const cart = await api.createCart(clientId, SALES_CHANNEL_ID);
      props.setCartId(cart.id);
      setProgress(35);

      /* 4) Agregar productos */
      setPhase('adding-products');
      for (const sel of props.selections) {
        await api.addProduct(cart.id, {
          productId: sel.productId,
          planId: sel.planId,
          isPreferentialBeneficiaryEnabled: sel.isPreferentialBeneficiaryEnabled,
          vehicleInformation: sel.vehicle
            ? {
                year: sel.vehicle.year,
                brandCode: sel.vehicle.brandCode,
                modelCode: sel.vehicle.modelCode,
                versionCode: sel.vehicle.versionCode,
              }
            : undefined,
        });
      }
      setProgress(50);

      /* 5) Completar info del vehículo (solo Auto) */
      if (props.hasAuto) {
        setPhase('completing-vehicle');
        await api.completeVehicleInfo(cart.id, {
          vehicleInformation: {
            year: props.vehicleFlow?.year ? String(props.vehicleFlow.year) : '',
            brand: props.vehicleFlow?.brandCode ?? '',
            model: props.vehicleFlow?.modelCode ?? '',
            version: props.vehicleFlow?.versionCode ?? '',
            commonLocationId: props.vehicleDetail.commonLocationId,
            isArmored: props.vehicleDetail.isArmored,
            plate: props.vehicleDetail.plate,
            colorId: props.vehicleDetail.colorId,
            chassisSerial: props.vehicleDetail.chassisSerial.trim().toUpperCase(),
            engineSerial: props.vehicleDetail.engineSerial.trim().toUpperCase(),
          },
        });
      }
      setProgress(55);

      /* 5.1) Título de propiedad (solo Auto — Mercantil exige su confirmación antes de emitir) */
      if (props.hasAuto) {
        setPhase('uploading-title');
        if (!titleFile) throw new Error('Selecciona el título de propiedad del vehículo.');
        const tErr = titleFileError(titleFile);
        if (tErr) throw new Error(tErr);
        await api.uploadVehicleTitle(cart.id, titleFile);
        setTitleUploaded(true);
        setTitleError(null);
      }
      setProgress(60);

      /* 6) Emitir (asíncrono) */
      setPhase('emitting');
      await api.emit(cart.id, {
        paymentFrequency: props.emitConfig.paymentFrequency,
        sendEmailConfirmation: props.emitConfig.sendEmailConfirmation,
        isHolderThePayee: props.emitConfig.isHolderThePayee,
        holderAcceptedTermsAndConditions: props.emitConfig.holderAcceptedTermsAndConditions,
        isHolderNotPoliticallyExposed: props.emitConfig.isHolderNotPoliticallyExposed,
        holderEnjoysGoodHealth: props.hasVital ? props.emitConfig.holderEnjoysGoodHealth : undefined,
      });
      setProgress(70);

      /* 7) Polling de estado */
      setPhase('polling');
      // Las emisiones multi-póliza de staging pueden tardar varios minutos en
      // completar. No declarar timeout antes de que el job asíncrono termine.
      const maxAttempts = 90;
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        const st: EmitStatus = await api.emitStatus(cart.id);
        const progPct = Math.min(95, 70 + (i + 1) * 5);
        setProgress(progPct);
        if (st.status === 'emitted') {
          setProgress(100);
          setPhase('done');
          props.setEmissionDone(true);
          const sum = await api.summary(cart.id);
          props.setSummary(sum);
          syncEmissionToAdmin(cart.id, clientId);
          setTimeout(props.onDone, 800);
          return;
        }
        if (st.status === 'emission_error') {
          let detail: string | undefined;
          // El registro del error tarda unos segundos en persistir: reintentar hasta 3 veces.
          for (let a = 0; a < 3; a++) {
            try {
              const errs: EmissionError[] = await api.cartErrors(cart.id);
              const err = errs?.[0];
              if (err) {
                const parts: string[] = [];
                if (err.errorId) parts.push(err.errorId);
                if (err.extraData) {
                  try {
                    const parsed = JSON.parse(err.extraData);
                    const data = Array.isArray(parsed?.data) ? parsed.data : [];
                    if (data.length > 0) parts.push(data.join(' · '));
                    else parts.push(err.extraData);
                  } catch {
                    parts.push(err.extraData);
                  }
                }
                detail = parts.join(' — ');
                break;
              }
            } catch {
              /* sin detalle adicional en este intento */
            }
            if (a < 2) await new Promise((r) => setTimeout(r, 3000));
          }
          throw new EmitErrorResponses(cart.id, detail);
        }
      }
      throw new Error('La emisión tardó demasiado. Revisa más tarde el estado de tu póliza.');
    } catch (e) {
      setPhase('error');
      if (e instanceof Error && (e as { isEmissionError?: boolean }).isEmissionError) {
        const err = e as unknown as EmitErrorResponses;
        setStatusDetail(err.detail ?? null);
        setError(err.detail ? `La emisión fue rechazada por Mercantil: ${err.detail}` : err.message);
      } else if (e instanceof ApiError) {
        setError(e.fieldErrors?.join(', ') || e.message);
      } else {
        setError(e instanceof Error ? e.message : 'Error inesperado durante la emisión.');
      }
    } finally {
      emissionInFlight.current = false;
    }
  }, [props, syncEmissionToAdmin, titleFile]);

  const correctEmissionData = () => {
    // La solicitud fue rechazada: conservamos los datos en pantalla, pero el
    // siguiente intento debe iniciar un carrito nuevo y no reutilizarla.
    props.setCartId(null);
    props.setSummary(null);
    props.setEmissionDone(false);
    setError(null);
    setStatusDetail(null);
    setPhase('idle');
  };

  return (
    <div id="emite" className="grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
      {/* ---- Columna principal ---- */}
      <fieldset disabled={!['idle', 'error', 'done'].includes(phase)} className="min-w-0 space-y-6">
        {/* Estado del cliente */}
        <Card className="emission-holder-card">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-brand-600">Titular</p>
              <h3 className="font-display mt-1 text-lg font-bold text-slate-900">
                {props.client.exists && props.client.needsCompletion === false && props.client.clientId
                  ? 'Datos verificados'
                  : 'Completa tus datos'}
              </h3>
            </div>
            <Badge tone={props.client.exists && props.client.needsCompletion === false && props.client.clientId ? 'emerald' : 'slate'}>
              {props.client.exists && props.client.needsCompletion === false && props.client.clientId ? 'Listo' : 'Pendiente'}
            </Badge>
          </div>

          {props.client.exists && props.client.needsCompletion === false && props.client.clientId ? (
            <p className="mt-2 text-sm text-slate-600">
              Ya te identificamos. Solo completa los datos del vehículo y confirma la emisión.
            </p>
          ) : (
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <FieldWrapper className="sm:col-span-2" label="Correo electrónico" required hint="Aquí recibirás las comunicaciones de tu póliza.">
                <Input type="email" autoComplete="email" value={props.identity.email} onChange={(e) => props.setIdentity({ ...props.identity, email: e.target.value })} />
              </FieldWrapper>
              {props.identity.phoneCountryId === '29' ? (
                <div className="grid grid-cols-[4.5rem_5.5rem_minmax(0,1fr)] items-end gap-2 sm:col-span-2 sm:gap-3">
                  <FieldWrapper label="Cód. país">
                    <span aria-label="Código de país Venezuela" className="flex min-h-12 items-center justify-center rounded-xl border border-slate-200 bg-slate-100 px-2 text-sm font-bold text-slate-700">{props.identity.phonePrefix || '+58'}</span>
                  </FieldWrapper>
                  <FieldWrapper label="Cód. área" required>
                    <Input inputMode="numeric" placeholder="0414" value={props.identity.areaCode} onChange={(e) => props.setIdentity({ ...props.identity, areaCode: e.target.value.replace(/\D/g, '').slice(0, 4) })} />
                  </FieldWrapper>
                  <FieldWrapper label="Número" required>
                    <Input inputMode="numeric" placeholder="123 4567" value={props.identity.phoneNumber} onChange={(e) => props.setIdentity({ ...props.identity, phoneNumber: e.target.value.replace(/\D/g, '').slice(0, 7) })} />
                  </FieldWrapper>
                </div>
              ) : (
                <div className="grid grid-cols-[5rem_minmax(0,1fr)] items-end gap-3 sm:col-span-2">
                  <FieldWrapper label="Cód. país">
                    <span aria-label="Código de país" className="flex min-h-12 items-center justify-center rounded-xl border border-slate-200 bg-slate-100 px-2 text-sm font-bold text-slate-700">{props.identity.phonePrefix || '+'}</span>
                  </FieldWrapper>
                  <FieldWrapper label="Número de teléfono" required>
                    <Input inputMode="tel" placeholder="Número de teléfono" value={props.identity.phoneNumber} onChange={(e) => props.setIdentity({ ...props.identity, areaCode: '', phoneNumber: e.target.value.replace(/\D/g, '').slice(0, 15) })} />
                  </FieldWrapper>
                </div>
              )}
              <FieldWrapper label="Nombre" required>
                <Input
                  value={props.complete.firstName}
                  onChange={(e) => setCompleteField('firstName', e.target.value)}
                  placeholder="Nombre del titular"
                />
              </FieldWrapper>
              <FieldWrapper label="Apellido" required>
                <Input
                  value={props.complete.lastName}
                  onChange={(e) => setCompleteField('lastName', e.target.value)}
                  placeholder="Apellido del titular"
                />
              </FieldWrapper>
              <FieldWrapper label="País de nacimiento">
                <Select
                  value={props.complete.countryOfBirthId}
                  onChange={(e) => setCompleteField('countryOfBirthId', e.target.value)}
                >
                  <Option value="29" label="Venezuela" />
                  <Option value="1" label="Panamá" />
                </Select>
              </FieldWrapper>
              <FieldWrapper label="Estado civil">
                <Select
                  value={props.complete.civilStateId}
                  onChange={(e) => setCompleteField('civilStateId', e.target.value)}
                >
                  {CIVIL_STATES.map((c) => (
                    <Option key={c.value} value={c.value} label={c.label} />
                  ))}
                </Select>
              </FieldWrapper>
            </div>
          )}
        </Card>

        {/* Dirección (solo si el cliente necesita completarse) */}
        {!props.client.exists || props.client.needsCompletion !== false || !props.client.clientId ? (
          <Card>
            <h4 className="font-display font-bold text-slate-900">Dirección de residencia</h4>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <FieldWrapper label="Estado" required>
                <SearchableSelect
                  id="address-state"
                  value={props.complete.address.administrativeAreaId ?? ''}
                  options={(locations?.administrativeAreas ?? []).map((area) => ({ value: area.id, label: area.name }))}
                  placeholder="Busca un estado…"
                  emptyMessage="No encontramos ese estado."
                  onChange={(value) => setAddressField('administrativeAreaId', value)}
                />
              </FieldWrapper>
              <FieldWrapper label="Municipio" required>
                <SearchableSelect
                  id="address-municipality"
                  value={props.complete.address.subadministrativeAreaId ?? ''}
                  onChange={(value) => setAddressField('subadministrativeAreaId', value)}
                  disabled={!props.complete.address.administrativeAreaId}
                  options={locations?.administrativeAreas
                    .find((a) => a.id === props.complete.address.administrativeAreaId)
                    ?.subAdministrativeAreas.map((municipality) => ({ value: municipality.id, label: municipality.name })) ?? []}
                  placeholder={props.complete.address.administrativeAreaId ? 'Busca un municipio…' : 'Elige estado primero'}
                  emptyMessage="No encontramos ese municipio."
                />
              </FieldWrapper>
              <FieldWrapper label="Localidad" required>
                <SearchableSelect
                  id="address-locality"
                  value={props.complete.address.localityId ?? ''}
                  onChange={(value) => setAddressField('localityId', value)}
                  disabled={!props.complete.address.administrativeAreaId}
                  options={locations?.administrativeAreas
                    .find((a) => a.id === props.complete.address.administrativeAreaId)
                    ?.localities.map((locality) => ({ value: locality.id, label: locality.name })) ?? []}
                  placeholder={props.complete.address.administrativeAreaId ? 'Busca una localidad…' : 'Elige estado primero'}
                  emptyMessage="No encontramos esa localidad."
                />
              </FieldWrapper>
              <FieldWrapper label="Código postal" required hint="Ejemplo: 1020">
                <Input
                  value={props.complete.address.postalCode ?? ''}
                  onChange={(e) => setAddressField('postalCode', e.target.value)}
                />
              </FieldWrapper>
              <FieldWrapper label="Dirección (calle, casa, sector)" required className="sm:col-span-2">
                <Input
                  value={props.complete.address.address1 ?? ''}
                  onChange={(e) => setAddressField('address1', e.target.value)}
                  placeholder="Calle, número, urbanización…"
                />
              </FieldWrapper>
            </div>
          </Card>
        ) : null}

        {/* Datos del vehículo (Auto) */}
        {props.hasAuto && (
          <Card>
            <p className="text-xs font-bold uppercase tracking-widest text-brand-600">1. Datos del vehículo</p>
            <h4 className="font-display mt-1 font-bold text-slate-900">Completa lo necesario para emitir</h4>
            <p className="mt-1 text-sm text-slate-500">
              {props.vehicleFlow
                ? `${props.vehicleFlow.year} · ${props.vehicleFlow.brandName} ${props.vehicleFlow.modelName} ${props.vehicleFlow.versionName}`
                : 'Selecciona tu vehículo en Cotiza.'}
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <FieldWrapper label="Placa" required>
                <Input
                  value={props.vehicleDetail.plate}
                  onChange={(e) => setVehicleField('plate', e.target.value.toUpperCase())}
                  placeholder="AB123CD"
                  maxLength={12}
                />
              </FieldWrapper>
              <FieldWrapper label="Color" required>
                <Select value={props.vehicleDetail.colorId} onChange={(e) => setVehicleField('colorId', e.target.value)}>
                  <option value="">Selecciona…</option>
                  {colors.map((c) => (
                    <option key={c.code} value={c.code}>{c.name}</option>
                  ))}
                </Select>
              </FieldWrapper>
              <FieldWrapper label="Estado donde circula" required>
                <Select
                  value={props.vehicleDetail.commonLocationId}
                  onChange={(e) => setVehicleField('commonLocationId', e.target.value)}
                >
                  <option value="">Selecciona…</option>
                  {vehicleLocations.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </Select>
              </FieldWrapper>
              <FieldWrapper label="¿Vehículo blindado?">
                <Select value={props.vehicleDetail.isArmored ? '1' : '0'} onChange={(e) => setVehicleField('isArmored', e.target.value === '1')}>
                  <option value="0">No</option>
                  <option value="1">Sí</option>
                </Select>
              </FieldWrapper>
              <FieldWrapper label="Serie del chasis" required>
                <Input
                  value={props.vehicleDetail.chassisSerial}
                  onChange={(e) => setVehicleField('chassisSerial', e.target.value.toUpperCase())}
                  placeholder="JHMFA16586S000000"
                />
              </FieldWrapper>
              <FieldWrapper label="Serie del motor" required>
                <Input
                  value={props.vehicleDetail.engineSerial}
                  onChange={(e) => setVehicleField('engineSerial', e.target.value.toUpperCase())}
                  placeholder="1NZ123456789123456"
                />
              </FieldWrapper>
            </div>

            {/* Título de propiedad — obligatorio para emitir Auto */}
            <div className="mt-5 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-800">Título de propiedad del vehículo</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Mercantil exige este documento para emitir el seguro Auto. PNG, JPG o PDF (máx 9 MB).
                  </p>
                </div>
                {titleUploaded && <Badge tone="emerald">Cargado</Badge>}
              </div>
              <input
                type="file"
                accept=".png,.jpg,.jpeg,.pdf,image/png,image/jpeg,application/pdf"
                className="mt-3 block w-full cursor-pointer text-sm text-slate-600 file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-brand-600 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-brand-700"
                onChange={handleTitleFileChange}
              />
              {titleFile && !titleError && (
                <p className="mt-2 text-xs font-medium text-emerald-600">
                  ✓ {titleFile.name} ({Math.round(titleFile.size / 1024)} KB)
                  {titleUploaded ? ' — cargado a Mercantil' : ' — listo para emitir'}
                </p>
              )}
              {titleError && <p className="mt-2 text-xs font-medium text-red-600">{titleError}</p>}
            </div>
          </Card>
        )}

        {/* Condiciones de emisión */}
        <Card className="emission-confirmation-card">
          <p className="text-xs font-bold uppercase tracking-widest text-brand-600">2. Confirma y emite</p>
          <h4 className="font-display mt-1 text-xl font-bold text-slate-900">Casi listo</h4>
          <p className="mt-1 text-sm text-slate-500">Revisa tus declaraciones antes de emitir. La frecuencia seleccionada se confirmará con Mercantil.</p>
          {!declarationsRecorded && <p className="mt-3 text-xs font-semibold text-slate-500"><span className="text-rose-600">*</span> Declaraciones obligatorias</p>}
          {missingDeclarations.length > 0 && !declarationsRecorded && (
            <Alert tone="error" title="Te faltan confirmaciones" className="mt-3">
              <p>Marca cada declaración pendiente para poder emitir tu póliza.</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {missingDeclarations.map((key) => <li key={key}>{DECLARATION_COPY[key]}</li>)}
              </ul>
            </Alert>
          )}
          {declarationsRecorded ? (
            <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-sm font-bold text-emerald-900">Confirmaciones registradas</p>
              <div className="mt-3 space-y-2 text-sm font-medium text-emerald-800">
                {props.hasVital && <p className="flex items-start gap-2"><CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" strokeWidth={2.5} /> El titular goza de buena salud</p>}
                <p className="flex items-start gap-2"><CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" strokeWidth={2.5} /> Términos y condiciones aceptados</p>
                <p className="flex items-start gap-2"><CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" strokeWidth={2.5} /> Declaración de persona no expuesta confirmada</p>
              </div>
            </div>
          ) : <div className="mt-4 space-y-3">
            {props.hasVital && (
              <Checkbox
                label={<><span>El titular goza de buena salud</span> <span className="text-rose-600">*</span></>}
                checked={props.emitConfig.holderEnjoysGoodHealth}
                invalid={missingDeclarations.includes('health')}
                onChange={(v) => {
                  setError(null);
                  setMissingDeclarations((current) => current.filter((key) => key !== 'health'));
                  props.setEmitConfig({ ...props.emitConfig, holderEnjoysGoodHealth: v });
                }}
              />
            )}
            <Checkbox
              label={<><span>Acepto los términos y condiciones de la póliza</span> <span className="text-rose-600">*</span></>}
              checked={props.emitConfig.holderAcceptedTermsAndConditions}
              invalid={missingDeclarations.includes('terms')}
              onChange={(v) => {
                setError(null);
                setMissingDeclarations((current) => current.filter((key) => key !== 'terms'));
                props.setEmitConfig({ ...props.emitConfig, holderAcceptedTermsAndConditions: v });
              }}
            />
            <Checkbox
              label={<><span>Confirmo que el titular NO es una persona políticamente expuesta</span> <span className="text-rose-600">*</span></>}
              checked={props.emitConfig.isHolderNotPoliticallyExposed}
              invalid={missingDeclarations.includes('pep')}
              onChange={(v) => {
                setError(null);
                setMissingDeclarations((current) => current.filter((key) => key !== 'pep'));
                props.setEmitConfig({ ...props.emitConfig, isHolderNotPoliticallyExposed: v });
              }}
            />
          </div>}
        </Card>
      </fieldset>

      {/* ---- Columna de progreso / resumen ---- */}
      <div className="lg:sticky lg:top-28 h-fit space-y-6">
        <Card className="jlc-summary">
          <h4 className="font-display text-lg font-bold">Emisión de póliza</h4>
          <ul className="mt-4 space-y-3">
            {props.selections.map((selection) => {
              const visual = selection.vehicle ? FALLBACK_PRODUCT_SUMMARY_VISUAL : productSummaryVisual(selection.productId);
              const equivalent = selection.totalPrime / selectedFrequency.per;
              return (
                <li key={selection.productId} className="flex items-start gap-3 rounded-xl bg-white/5 p-3">
                  <span className={clsx('flex h-10 w-10 shrink-0 items-center justify-center rounded-full', visual.active)} aria-hidden="true">
                    {selection.vehicle ? '🚗' : <ProductSummaryIcon icon={visual.icon} className="h-5 w-5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 text-sm font-semibold leading-snug text-white">{selection.productTitle}</p>
                      <div className="shrink-0 text-right">
                        <p className="text-[9px] font-bold uppercase tracking-wide text-slate-300">{selectedFrequency.label}</p>
                        <p className="text-lg font-extrabold leading-tight text-accent-400">{formatMoney(equivalent)}</p>
                      </div>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <Badge tone="slate" className={clsx('sm:hidden', FREQUENCY_BADGE_COLORS[selectedFrequency.value])}>{selectedFrequency.label}</Badge>
                      <Badge tone={selection.vehicle ? 'amber' : 'brand'} className="hidden sm:inline-flex">{selection.vehicle ? 'Auto' : 'Vital'}</Badge>
                      <span className="hidden text-xs text-slate-300 sm:inline">{selectedFrequency.label}</span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] font-medium text-slate-300">
                      <span>SA: {formatMoney(selection.assuredSum)}</span>
                      {selectedFrequency.per > 1 && <span className="font-extrabold text-amber-200">Anual: {formatMoney(selection.totalPrime)}</span>}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          {error && phase === 'idle' && <Alert tone="error" className="mt-4">{error}</Alert>}
          {phase === 'idle' && !props.emissionDone ? (
            <>
              <Button className="emission-cta mt-6 w-full" size="lg" onClick={emitNow}>
                {props.cartId ? 'Consultar mi solicitud' : 'Emitir mi póliza'}
              </Button>
              <Button variant="ghost" className="emission-back-button mt-3 w-full" onClick={props.onBack}>
                <Pencil aria-hidden="true" className="h-4 w-4" strokeWidth={2.25} /> Editar mi cotización
              </Button>
            </>
          ) : (
            <div className="mt-6">
              {phase !== 'idle' && (
                <div>
                  <p className="text-sm font-semibold">{PHASE_LABEL[phase]}</p>
                  <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-accent-400 transition-all duration-500"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  {statusDetail && phase !== 'error' && <p className="mt-2 text-xs text-slate-300">{statusDetail}</p>}
                </div>
              )}

              {error && (
                <Alert tone="error" title={props.hasAuto ? 'Revisa los datos del vehículo' : 'Mercantil no pudo emitir la póliza'} className="mt-4 bg-white/90">
                  {phase === 'error' && statusDetail ? emissionMessage(statusDetail, props.hasAuto) : error}
                </Alert>
              )}

              {phase === 'error' && (
                <Button className="mt-4 w-full" onClick={correctEmissionData}>
                  Reintentar la emisión
                </Button>
              )}
            </div>
          )}

          {props.emissionDone && props.cartId && (
            <div className="mt-4 space-y-2">
              <Button variant="ghost" className="w-full" onClick={() => props.onDone()}>
                Ir a Pagar mi póliza <ArrowRight aria-hidden="true" className="h-4 w-4" strokeWidth={2.25} />
              </Button>
              <Button variant="ghost" className="emission-back-button w-full" onClick={props.onBack}>
                <ArrowLeft aria-hidden="true" className="h-4 w-4" strokeWidth={2.25} /> Volver a cotización
              </Button>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

/** Error específico de rechazo de emisión con detalle del servicio */
class EmitErrorResponses extends Error {
  isEmissionError = true;
  detail?: string;
  constructor(public shopcartId: string, detail?: string) {
    super('La póliza fue rechazada por Mercantil Seguros (emission_error).');
    this.detail = detail;
    this.name = 'EmitErrorResponses';
  }
}

