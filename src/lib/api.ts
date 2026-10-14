/**
 * Cliente HTTP del navegador → proxy local de Astro (`/api/mercantil/...`).
 * Nunca toca la API de Mercantil directamente ni ve la API key.
 */

import type {
  ApiErrorBody,
  AddProductPayload,
  CartSummary,
  ClientExists,
  CompleteClientPayload,
  CompleteVehicleInfoPayload,
  CreateClientPayload,
  CountryLocations,
  EmitStatus,
  EmitPayload,
  EmissionError,
  PlanCategory,
  Shopcart,
  VehicleColor,
  VehicleInformationResponse,
  VehicleLocation,
} from './types';

const PROXY = '/api/mercantil';

export class ApiError extends Error {
  status: number;
  body: ApiErrorBody;
  constructor(status: number, body: ApiErrorBody) {
    super(body?.cause || body?.title || body?.message || `Error ${status}`);
    this.status = status;
    this.body = body;
  }
  /** Lista de errores de validación si el API la devuelve */
  get fieldErrors(): string[] {
    return this.body?.errors ?? [];
  }
}

async function call<T>(
  method: string,
  path: string,
  opts?: { query?: Record<string, string | number | undefined>; body?: unknown; raw?: boolean },
): Promise<T> {
  const url = new URL(window.location.origin + PROXY + '/' + path.replace(/^\//, ''));
  if (opts?.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
    }
  }

  const res = await fetch(url.toString(), {
    method,
    headers:
      opts?.body !== undefined && !(opts.body instanceof FormData)
        ? { 'Content-Type': 'application/json' }
        : undefined,
    body:
      opts?.body instanceof FormData
        ? opts.body
        : opts?.body !== undefined
          ? JSON.stringify(opts.body)
          : undefined,
  });

  if (opts?.raw) {
    if (!res.ok) throw new ApiError(res.status, { message: `HTTP ${res.status}` });
    return (await res.blob()) as unknown as T;
  }

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text };
  }

  if (!res.ok) throw new ApiError(res.status, data as ApiErrorBody);
  return data as T;
}

export interface AdminEmissionSyncPayload {
  cartId: string;
  customer: {
    mercantilClientId?: string;
    documentType?: string;
    documentNumber: string;
    firstName?: string;
    lastName?: string;
    birthDate?: string;
    gender?: string;
    email?: string;
    phone?: string;
    /** Solo para clientes nuevos en Mercantil: los mismos datos que se registraron allá. */
    address?: {
      line1: string;
      state?: string;
      municipality?: string;
      locality?: string;
      postalCode?: string;
    };
  };
}

async function syncAdminEmission(payload: AdminEmissionSyncPayload): Promise<{ ok: boolean }> {
  const res = await fetch('/api/admin/emission', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data as ApiErrorBody);
  return data as { ok: boolean };
}

/* ---------- Lectura catálogos ---------- */
export const api = {
  /** Registra en el admin una emisión que Mercantil ya confirmó. No bloquea el checkout. */
  syncAdminEmission,
  /** Planes tentativos (sin cliente creado) — filtros opcionales */
  tentativePlans: (q: {
    dniType?: string;
    dniNumber?: string;
    dniVenNationality?: string;
    birthDate?: string;
    genderId?: string;
    phoneCountryId?: string;
    addressCountryId?: string;
    countryId?: string;
  }) => call<PlanCategory[]>('GET', 'products/plans/tentative-client', { query: q }),

  /** Planes para cliente ya existente en Mercantil */
  clientPlans: (clientId: string) =>
    call<PlanCategory[]>('GET', `products/plans/client/${clientId}`),

  countries: () => call<unknown>('GET', 'countries'),
  locations: (countryId: string) =>
    call<CountryLocations>('GET', `countries/${countryId}/locations`),

  /* ---------- Clientes ---------- */
  clientExists: (q: {
    birthDate: string;
    dniType: string;
    dniNumber: string;
    dniVenNationality?: string;
  }) => call<ClientExists>('GET', 'clients/exists', { query: q }),

  createClient: (payload: CreateClientPayload) =>
    call<{ clientId: string }>('POST', 'clients', { body: payload }),

  completeClient: (clientId: string, payload: CompleteClientPayload) =>
    call<unknown>('PUT', `clients/${clientId}/complete`, { body: payload }),

  /* ---------- Vehículos ---------- */
  vehicleInfo: (q: {
    year?: number;
    brand?: string;
    model?: string;
    version?: string;
    tariffId?: string;
  }) => call<VehicleInformationResponse>('GET', 'auto-products/vehicles/vehicle-information', { query: q }),

  vehicleColors: () => call<VehicleColor[]>('GET', 'auto-products/vehicles/colors'),
  vehicleLocations: () => call<VehicleLocation[]>('GET', 'auto-products/vehicles/locations'),
  autoPlans: (vehicleTypeId: string, q?: Record<string, string | number | undefined>) =>
    call<PlanCategory[]>('GET', 'auto-products/plans/client', { query: { vehicleTypeId, ...q } }),

  /* ---------- Carrito ---------- */
  createCart: (clientId: string, salesChannelId: string) =>
    call<Shopcart>('POST', 'shopcarts', { body: { clientId, salesChannelId } }),

  addProduct: (cartId: string, payload: AddProductPayload) =>
    call<{ success: boolean }>('POST', `shopcarts/${cartId}/products`, { body: payload }),

  completeVehicleInfo: (cartId: string, payload: CompleteVehicleInfoPayload) =>
    call<{ success: boolean }>('POST', 'auto-products/vehicles/complete-vehicle-info', {
      query: { shopcartId: cartId },
      body: payload,
    }),

  /** Sube el título de propiedad del vehículo (multipart, máx 9 MB: PNG/JPG/PDF). Requerido para emitir Auto. */
  uploadVehicleTitle: (cartId: string, file: File) => {
    const form = new FormData();
    form.append('vehiclePropertyFile', file, file.name);
    return call<{ success: boolean }>('POST', `shopcarts/${cartId}/vehicle-property-title`, {
      body: form,
    });
  },

  emit: (cartId: string, payload: EmitPayload) =>
    call<{ success: boolean; asyncEmissionId: string }>('POST', `shopcarts/${cartId}/emit`, {
      body: payload,
    }),

  emitStatus: (cartId: string) => call<EmitStatus>('GET', `shopcarts/${cartId}/emit`),

  cartErrors: (shopcartId: string) =>
    call<EmissionError[]>('GET', 'shopcarts/errors', { query: { shopcartId } }),

  summary: (cartId: string) => call<CartSummary>('GET', `shopcarts/${cartId}/summary`),

  policyPdf: (cartId: string, policyId: string) =>
    call<Blob>('GET', `shopcarts/${cartId}/policies/${policyId}/pdf`, { raw: true }).then(
      (blob) => URL.createObjectURL(blob),
    ),
};
