/** Constantes de negocio compartidas */

/** Canal de ventas de la alianza (Plataforma de Aliados) */
export const SALES_CHANNEL_ID = 'cms6dz7170n84pc43oeg44aym';

/** Alias: "Vida Mercantil", "Accidentes Personales", etc. */
export const PRODUCT_VITALES = {
  vida: 'cm23o270j0920ujopmmicjn2c',
  accidentes: 'cm23o270j0922ujop2ik7ryq1',
  funerario: 'cm23o270j0924ujopcki7bxdo',
  cancer: 'cm23o270j0921ujophujfkgit',
  hospitalizacion: 'cm23o270j0923ujop8tjgv0pl',
};

/** Productos Vital disponibles para el canal de pruebas de JLCamejo. */
export const VITAL_PRODUCT_OPTIONS = [
  { key: 'vida', title: 'Vida' },
  { key: 'accidentes', title: 'Accidentes personales' },
  { key: 'funerario', title: 'Servicio funerario' },
  { key: 'hospitalizacion', title: 'Renta por hospitalización' },
  { key: 'cancer', title: 'Pago único por cáncer' },
] as const;

/** País por defecto: Venezuela */
export const DEFAULT_COUNTRY_ID = '29';

export const DNI_TYPES = [
  { value: 'VEN', label: 'Cédula venezolana' },
  { value: 'PVEN', label: 'Venezolano (Pasaporte)' },
  { value: 'PAN', label: 'Documento de identidad panameño' },
  { value: 'PPAS', label: 'Pasaporte panameño' },
  { value: 'OPCD', label: 'Documento de identidad de otro país' },
  { value: 'OPPA', label: 'Pasaporte de otro país' },
] as const;

/** La nacionalidad V/E solo aplica cuando Mercantil recibe una cédula venezolana (VEN). */
export const VEN_CEDULA_NATIONALITIES = [
  { value: 'V', label: 'Venezolano' },
  { value: 'E', label: 'Extranjero con cédula venezolana' },
] as const;

export const GENDERS = [
  { value: 'M', label: 'Masculino' },
  { value: 'F', label: 'Femenino' },
] as const;

export const CIVIL_STATES = [
  { value: 'S', label: 'Soltero(a)' },
  { value: 'C', label: 'Casado(a)' },
  { value: 'D', label: 'Divorciado(a)' },
  { value: 'V', label: 'Viudo(a)' },
] as const;

export const PAYMENT_FREQUENCIES = [
  { value: 'monthly', label: 'Mensual', description: 'Se paga cada mes', interval: 1, unit: 'mes', per: 12 },
  { value: 'quarterly', label: 'Trimestral', description: 'Se paga cada 3 meses', interval: 3, unit: 'meses', per: 4 },
  { value: 'biannual', label: 'Semestral', description: 'Se paga cada 6 meses', interval: 6, unit: 'meses', per: 2 },
  { value: 'yearly', label: 'Anual', description: 'Se paga una vez al año', interval: 12, unit: 'meses', per: 1 },
] as const;

export const PAYMENT_TYPES = [
  { value: 'TDC', label: 'Tarjeta de Crédito' },
  { value: 'TDD', label: 'Tarjeta de Débito' },
  { value: 'C2P', label: 'Pago Móvil (C2P)' },
  { value: 'PDBDV', label: 'Pago Directo Banesco' },
  { value: 'PDMER', label: 'Pago Directo Mercantil' },
] as const;

export const CURRENCIES = [
  { value: 'USD', label: '$ USD' },
  { value: 'BS', label: 'Bs.' },
] as const;

export function formatMoney(n: number, currency = 'USD'): string {
  return new Intl.NumberFormat('es-VE', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(n);
}

/** Regex mínima de email (formato estándar). */
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;


