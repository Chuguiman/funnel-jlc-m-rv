/** Modelo de datos del funnel (estado compartido entre pasos) */

import type { Dispatch, SetStateAction } from 'react';

/** Setter de estado que acepta valor directo o updater funcional (igual que useState). */
export type Setter<T> = Dispatch<SetStateAction<T>>;

/** Datos de identidad capturados en Cotiza (también usados para crear el cliente). */
export interface IdentityData {
  dniType: string;
  dniNumber: string;
  dniVenNationality: string;
  birthDate: string;
  genderId: string;
  countryId: string;
  email: string;
  phoneCountryId: string;
  /** Prefijo internacional del teléfono, para formar el enlace de WhatsApp. */
  phonePrefix: string;
  areaCode: string;
  phoneNumber: string;
}

export interface PlanChoice {
  productId: string;
  planId: string;
  productTitle: string;
  planTitle?: string;
  assuredSum: number;
  totalPrime: number;
  category: string;
  isPreferentialBeneficiaryEnabled: boolean;
  /** Presente si es un producto Auto */
  vehicle?: {
    year: string;
    brandCode: string;
    brandName: string;
    modelCode: string;
    modelName: string;
    versionCode: string;
    versionName: string;
    typeId?: string;
  };
}

export interface VehicleFlowSelection {
  year: number;
  brandCode: string;
  brandName: string;
  modelCode: string;
  modelName: string;
  versionCode: string;
  versionName: string;
  typeId?: string;
  tariffId?: string;
}

export interface ClientInfo {
  clientId?: string;
  exists?: boolean;
  needsCompletion?: boolean;
  existsInMs?: boolean;
}

export interface CompleteData {
  firstName: string;
  lastName: string;
  countryOfBirthId: string;
  civilStateId: string;
  address: {
    administrativeAreaId?: string;
    subadministrativeAreaId?: string;
    localityId?: string;
    zoneId?: string;
    /** Código postal del domicilio — obligatorio para el core de Mercantil. */
    postalCode: string;
    address1?: string;
  };
}

export interface VehicleDetailData {
  plate: string;
  colorId: string;
  commonLocationId: string;
  isArmored: boolean;
  chassisSerial: string;
  engineSerial: string;
}

export interface EmitConfig {
  paymentFrequency: 'monthly' | 'quarterly' | 'biannual' | 'yearly';
  sendEmailConfirmation: boolean;
  isHolderThePayee: boolean;
  holderAcceptedTermsAndConditions: boolean;
  isHolderNotPoliticallyExposed: boolean;
  holderEnjoysGoodHealth: boolean;
}

export type EmissionPhase =
  | 'idle'
  | 'creating-cart'
  | 'adding-products'
  | 'completing-vehicle'
  | 'emitting'
  | 'polling'
  | 'done'
  | 'error';

export interface EmissionProgress {
  phase: EmissionPhase;
  detail?: string;
  cartId?: string;
  status?: string;
  progress?: number;
  error?: string;
}

export interface PaymentDraft {
  type: 'TDC' | 'TDD' | 'C2P' | 'PDBDV' | 'PDMER';
  currency: 'USD' | 'BS';
  amount: number;
  approvalNumber: string;
  payeeFirstName: string;
  payeeLastName: string;
}

/**
 * Bloqueos de pago por clave `póliza#cuota`. Se persisten en sessionStorage:
 * sobreviven a un refresco para que un segundo intento no duplique el cobro.
 *   - `paid`: notificaciones aceptadas (el core aún no ha marcado `isPaid`).
 *   - `submitted`: notificaciones con resultado desconocido (red/5xx). El core
 *     pudo aplicarlas, así que no se reintentan dentro de la misma sesión.
 */
export interface PaymentLocks {
  paid: string[];
  submitted: string[];
}
