/**
 * Autoriza el acceso de un navegador únicamente a los carritos que creó desde
 * este funnel. El contenido de la cookie no es secreto, pero va firmado para
 * que no se pueda añadir un identificador de carrito ajeno.
 */
const COOKIE_NAME = 'jlc_cart_access';
const MAX_CARTS = 8;
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const encoder = new TextEncoder();

type CookieStore = {
  get(name: string): { value: string } | undefined;
  set(name: string, value: string, options: Record<string, unknown>): void;
};

type CartAccess = { ids: string[]; exp: number };

function base64UrlEncode(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value: string): Uint8Array | null {
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

async function signingKey(): Promise<CryptoKey | null> {
  // ADMIN_SYNC_SECRET mantiene la instalación existente funcional. En
  // producción se recomienda configurar un CART_ACCESS_SECRET independiente.
  const secret = (import.meta.env.CART_ACCESS_SECRET || import.meta.env.ADMIN_SYNC_SECRET || '').trim();
  if (!secret) return null;
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export function cartAccessConfigured(): boolean {
  return Boolean((import.meta.env.CART_ACCESS_SECRET || import.meta.env.ADMIN_SYNC_SECRET || '').trim());
}

async function sign(value: string): Promise<string | null> {
  const key = await signingKey();
  if (!key) return null;
  return base64UrlEncode(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value))));
}

async function read(cookies: CookieStore): Promise<CartAccess | null> {
  const value = cookies.get(COOKIE_NAME)?.value;
  if (!value) return null;
  const [payload, signature] = value.split('.');
  if (!payload || !signature || value.split('.').length !== 2) return null;
  const key = await signingKey();
  const signatureBytes = base64UrlDecode(signature);
  const verifiedSignature = signatureBytes ? new Uint8Array(signatureBytes) : null;
  if (!key || !verifiedSignature || !(await crypto.subtle.verify('HMAC', key, verifiedSignature, encoder.encode(payload)))) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload) ?? new Uint8Array())) as CartAccess;
    if (!Array.isArray(parsed.ids) || !parsed.ids.every((id) => typeof id === 'string') || !Number.isFinite(parsed.exp) || parsed.exp <= Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function canAccessCart(cookies: CookieStore, cartId: string): Promise<boolean> {
  return (await read(cookies))?.ids.includes(cartId) ?? false;
}

export async function grantCartAccess(cookies: CookieStore, cartId: string): Promise<boolean> {
  const current = await read(cookies);
  const ids = [...new Set([...(current?.ids ?? []), cartId])].slice(-MAX_CARTS);
  const payload = base64UrlEncode(encoder.encode(JSON.stringify({ ids, exp: Date.now() + MAX_AGE_SECONDS * 1000 })));
  const signature = await sign(payload);
  if (!signature) return false;
  cookies.set(COOKIE_NAME, `${payload}.${signature}`, {
    httpOnly: true,
    sameSite: 'strict',
    secure: import.meta.env.PROD,
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
  return true;
}
