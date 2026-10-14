/* Tipos compartidos entre isla React y rutas API (derivados del OpenAPI spec) */

export interface Health {
  apiStatus: string;
  sirwebStatus: string;
  docs: string;
  version: string;
  ally: string;
  allyId: string;
  system: string;
}

export interface Plan {
  id: string;
  assuredSum: number;
  totalPrime: number;
  rates?: unknown[];
}

export interface PlanProduct {
  id: string;
  title?: string;
  description?: string;
  country?: { id: string; name: string; iso: string };
  mercantilAreaCode?: string;
  mercantilProductCode?: string;
  allowsVehicleArmor?: boolean;
  allowsAccessories?: boolean;
  plans: Plan[];
}

export interface PlanCategory {
  category: string;
  categoryTitle: string;
  products: PlanProduct[];
}

export interface ClientExists {
  exists: boolean;
  clientId?: string;
  needsCompletion?: boolean;
  existsInMs?: boolean;
}

export interface Shopcart {
  id: string;
  status: 'in_progress' | 'cancelled' | 'emitted' | 'quoted' | 'paid' | string;
  active: boolean;
}

export interface EmitPaymentStatus {
  nu_cuota?: string | number | null;
  /** Monto pendiente total, incluyendo IGTF. */
  mt_pendiente?: number | string | null;
  /** Prima pendiente antes de IGTF. */
  mt_pendiente_sin_igtf?: number | string | null;
  dueDate?: string;
  de_status_cuota?: string;
  fe_vencimiento_cuota?: string;
}

export interface EmitPolicyPaymentData {
  certificateNumber?: string | number | null;
  nu_poliza?: string | number | null;
  cd_area?: string | number | null;
  cd_entidad?: string | number | null;
  recibo?: {
    cd_recibo?: string | number | null;
    fe_desde_recibo?: string | null;
    nu_convenio_pago?: string | number | null;
  } | null;
  cuota?: EmitPaymentStatus | null;
}

export interface EmitPolicyStatus {
  id: string;
  isQuoted: boolean;
  isEmitted: boolean;
  /** Estado de pago informado por el core; puede no estar presente en respuestas antiguas. */
  isPaid?: boolean;
  product: string;
  category: string;
  policyPaymentData?: EmitPolicyPaymentData;
}

export interface EmitStatus {
  id: string;
  status: 'emission_error' | 'emitted' | string;
  emissionProgress: number;
  policies?: EmitPolicyStatus[];
}

export interface EmissionError {
  id: string;
  type: string;
  shopcartId: string;
  errorId: string;
  extraData: string;
  createdAt: string;
  allyId: string;
}

export interface PaymentQuote {
  id?: string;
  quote?: string;
  agreement?: string | null;
  receipt?: string | null;
  receiptStatus?: string;
  quoteStatus?: string;
  isNextDuePayment?: boolean;
  isPaid?: boolean;
  amount?: number;
  expirationDate?: string;
}

export interface CartSummaryPolicy {
  id: string;
  title?: string;
  status?: string;
  contractNumber?: string;
  policyNumber?: string;
  certificateNumber?: string;
  entity?: string;
  area?: string;
  number?: string;
  certificate?: string;
  quotedAmount?: number;
  assuredSum?: number;
  annualPremium?: number;
  startDate?: string;
  endDate?: string;
  paymentQuotes?: PaymentQuote[];
}

export interface CartSummary {
  id: string;
  resumeUrl?: string;
  paymentUrl?: string;
  status: string;
  paymentFrequency?: string;
  quotedAmount?: number;
  policies?: CartSummaryPolicy[];
}

export interface ExchangeRate {
  tasa_venta: number;
  tasa_compra: number;
  fe_tasa: string;
}

/* ---- Vehículos ---- */

export interface VehicleBrand {
  code: string;
  name: string;
}
export interface VehicleModel {
  code: string;
  name: string;
}
export interface VehicleVersion {
  code: string;
  name: string;
  tariffId?: string;
  typeId?: string;
}

export interface VehicleDataItem {
  year: number;
  brand: VehicleBrand;
  model?: VehicleModel;
  version?: VehicleVersion;
}

export type VehicleData = VehicleDataItem | VehicleDataItem[];

export interface VehicleInformationResponse {
  vehicleData: VehicleData | null;
}

export interface VehicleColor {
  code: string;
  name: string;
}
export interface VehicleLocation {
  id: string;
  name: string;
}

/* ---- Ubicaciones de dirección ---- */

export interface Zone {
  id: string;
  name: string;
}
export interface SubAdministrativeArea {
  id: string;
  name: string;
  zones: Zone[];
}
export interface AdministrativeArea {
  id: string;
  name: string;
  subAdministrativeAreas: SubAdministrativeArea[];
  localities: { id: string; name: string }[];
}
export interface CountryLocations {
  id: string;
  name: string;
  administrativeAreas: AdministrativeArea[];
}

/* ---- Payloads ---- */

export interface CreateClientPayload {
  email: string;
  dniType: string;
  dniNumber: string;
  dniVenNationality?: string;
  birthDate: string;
  phone: { countryId: string; areaCode: string; number: string };
  genderId: string;
  address: { countryId: string };
}

export interface CompleteClientPayload extends CreateClientPayload {
  firstName: string;
  lastName: string;
  countryOfBirthId: string;
  civilStateId: string;
  address: {
    countryId: string;
    administrativeAreaId?: string;
    subadministrativeAreaId?: string;
    localityId?: string;
    zoneId?: string;
    /** Código postal del domicilio — obligatorio para el core de Mercantil. */
    postalCode: string;
    address1?: string;
  };
}

export interface AddProductPayload {
  productId: string;
  planId: string;
  isPreferentialBeneficiaryEnabled: boolean;
  vehicleInformation?: { year: string; brandCode: string; modelCode: string; versionCode: string };
}

export interface CompleteVehicleInfoPayload {
  vehicleInformation: {
    year: string;
    brand: string;
    model: string;
    version: string;
    commonLocationId: string;
    isArmored: boolean;
    plate: string;
    colorId: string;
    chassisSerial: string;
    engineSerial: string;
  };
}

export interface EmitPayload {
  paymentFrequency: 'monthly' | 'quarterly' | 'biannual' | 'yearly';
  sendEmailConfirmation: boolean;
  isHolderThePayee: boolean;
  holderAcceptedTermsAndConditions: boolean;
  isHolderNotPoliticallyExposed: boolean;
  holderEnjoysGoodHealth?: boolean;
  holderAcceptsToLoadDniDocumentLater?: boolean;
}

export interface NotifyPaymentPayload {
  policy: {
    entity: string;
    area: string;
    number: string;
    certificate: string;
    receipt: string;
    agreement: string;
    quote: string;
  }[];
  payment: {
    type: 'TDC' | 'TDD' | 'C2P' | 'PDBDV' | 'PDMER';
    currency: 'USD' | 'BS';
    amount: number;
    approvalNumber: string;
    payeeFirstName: string;
    payeeLastName: string;
  };
  receipt: { amount: number; currency: 'USD' | 'BS' };
  exchangeRate: number | null;
}

/** Respuesta genérica de error estándar del API */
export interface ApiErrorBody {
  status?: number;
  type?: string;
  title?: string;
  cause?: string;
  errors?: string[];
  message?: string;
}

/** Respuesta del upload de título de propiedad del vehículo */
export interface VehicleTitleUploadResponse {
  success: boolean;
}
