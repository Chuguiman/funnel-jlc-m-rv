// Re-verificación programada: espera a las 12:00 London / 07:00 Vzla y re-prueba staging.
// 1) ¿La API de Aliados se recuperó del 500?  2) Confirmar montos emitidos (Total a Pagar)
// 3) Carrito con 2 pólizas (reproduce el caso del bug de Paga)  4) Notify con payload real
// 5) Reintento Funerario (para tener un 3er ID de carrito en el doc)
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  buildNotifyPolicies,
  displayPaymentQuote,
  findEmittedPolicy,
  isPolicyPaid,
  policyTotal,
  selectPendingPolicies,
  sumPolicyTotals,
} from '../../src/lib/payment.ts';

const PROXY = 'http://localhost:4321/api/mercantil';
const CHANNEL = 'cms6dz7170n84pc43oeg44aym';
const CLIENT = 'cmn9jvysl00jknt42y9z0ci2l'; // V-12345679 / 1990-01-01 / M
const ORIGIN = 'http://localhost:4321';
const PROJECT = 'C:\\Herd\\jlcamejo-funnel';

const env = Object.fromEntries(
  readFileSync(PROJECT + '\\.env', 'utf8')
    .split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Lo que quedó sin verificar se acumula acá y termina en `process.exitCode`.
 * Antes el script sólo escribía en la consola y salía con 0 aunque las
 * verificaciones fallaran, así que una corrida "verde" no probaba nada.
 */
const failures = [];
function record(ok, message) {
  if (!ok) failures.push(message);
  return ok;
}

function log(...a) { console.log(`[${new Intl.DateTimeFormat('es-VE', { timeZone: 'America/Caracas', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date())} Vzla]`, ...a); }

async function api(method, path, { query, body, origin = true, timeoutMs = 60000 } = {}) {
  const url = new URL(PROXY + '/' + path.replace(/^\//, ''));
  if (query) for (const [k, v] of Object.entries(query)) if (v != null && v !== '') url.searchParams.set(k, String(v));
  const headers = {};
  if (origin) headers['Origin'] = ORIGIN;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url.toString(), { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal: ac.signal });
    const text = await res.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data };
  } catch (e) { return { status: 0, data: { error: String(e).slice(0, 120) } }; }
  finally { clearTimeout(t); }
}

/**
 * Asegura que el dev server esté arriba (lo inicia si hace falta).
 * OJO: no se puede usar /health para esto, porque el proxy lo reenvía al upstream
 * y devuelve 500 cuando la API de staging está caída (falso "servidor caído").
 * Se usa una ruta fuera de la allowlist: el proxy responde 403 sin tocar el upstream,
 * lo que prueba que el servidor y el handler están vivos.
 */
async function proxyAlive() {
  const r = await api('GET', '__ping__', { timeoutMs: 15000 });
  return r.status === 403; // "Recurso no permitido" emitido por nuestro propio proxy
}

async function ensureServer() {
  if (await proxyAlive()) { log('dev server ya estaba arriba (proxy vivo)'); return true; }
  log('dev server no responde -> iniciando npm run dev');
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const p = spawn(npmCommand, ['run', 'dev'], {
    cwd: PROJECT,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  p.unref();
  for (let i = 0; i < 24; i++) {
    await sleep(5000);
    if (await proxyAlive()) { log('dev server arriba'); return true; }
  }
  log('no se pudo levantar el dev server');
  return false;
}

/** 1) Estado de la API de staging (vía proxy y directo). */
async function checkApi() {
  const viaProxy = await api('GET', 'health');
  let direct = 'n/d';
  try {
    const t0 = Date.now();
    const r = await fetch((env.MERCANTIL_API_URL || '').replace(/\/$/, '') + '/health', { headers: { 'x-api-key': env.MERCANTIL_API_KEY, Accept: 'application/json' }, signal: AbortSignal.timeout(60000) });
    direct = `${r.status} (${Date.now() - t0}ms)`;
  } catch (e) { direct = 'ERROR ' + String(e).slice(0, 60); }
  log(`1) API staging -> proxy:${viaProxy.status} directo:${direct}`);
  return viaProxy.status === 200;
}

/** 2) Montos de las 3 pólizas del 24/09: summary.amount es prima; emitStatus.mt_pendiente es el total. */
async function checkAmounts() {
  const carts = [
    { n: 'Vida', c: 'cmug189z300z3o242mv5v0ri1', premium: 8.76, total: 9.02 },
    { n: 'Accidentes', c: 'cmug18qby00zjo242jh6h3qyw', premium: 30.97, total: 31.90 },
    { n: 'Auto RCV', c: 'cmug17qsc00yeo242kt24dnla', premium: 45.00, total: 46.35 },
  ];
  for (const x of carts) {
    const [s, e] = await Promise.all([
      api('GET', `shopcarts/${x.c}/summary`),
      api('GET', `shopcarts/${x.c}/emit`),
    ]);
    const p = s.data?.policies?.[0];
    const q = displayPaymentQuote(p ?? {});
    const emittedPolicies = Array.isArray(e.data?.policies) ? e.data.policies : [];
    const emitted = findEmittedPolicy(p ?? {}, emittedPolicies);
    const total = policyTotal(p ?? {}, emittedPolicies);
    const premium = emitted?.policyPaymentData?.cuota?.mt_pendiente_sin_igtf;
    const okPremium = Number(q.amount) === x.premium && Number(premium) === x.premium;
    const okTotal = Number(total) === x.total;
    log(`2) ${x.n}: prima summary=${q.amount} core=${premium} (esperada ${x.premium.toFixed(2)}) ${okPremium ? 'COINCIDE' : 'REVISAR'}; total=${total} (PDF ${x.total.toFixed(2)}) ${okTotal ? 'COINCIDE' : 'REVISAR'}; quote=${q.quote} receipt=${q.receipt} paid=${q.isPaid}`);
    record(okPremium, `prima de ${x.n} (${x.c}): summary=${q.amount} core=${premium}, se esperaba ${x.premium}`);
    record(okTotal, `total de ${x.n} (${x.c}): ${total}, se esperaba ${x.total}`);
  }
  return failures.length === 0;
}

/** 3) Carrito con 2 pólizas: reproduce el escenario del bug corregido en Paga. */
async function checkTwoPolicies() {
  const cart = await api('POST', 'shopcarts', { body: { clientId: CLIENT, salesChannelId: CHANNEL } });
  const cid = cart.data?.id;
  if (!cid) { log('3) no se pudo crear el carrito: ' + JSON.stringify(cart.data).slice(0, 120)); record(false, 'no se pudo crear el carrito de 2 polizas'); return false; }

  for (const [name, pid, plid] of [
    ['Vida', 'cm23o270j0920ujopmmicjn2c', 'cm23o28er0cmjujopinj1qg47'],
    ['Accidentes', 'cm23o270j0922ujop2ik7ryq1', 'cm23o28er0cm8ujopdlgqxb20'],
  ]) {
    const r = await api('POST', `shopcarts/${cid}/products`, { body: { productId: pid, planId: plid, isPreferentialBeneficiaryEnabled: false } });
    if (r.status !== 200) { log(`3) add ${name} -> ${r.status} ${JSON.stringify(r.data).slice(0, 140)}`); record(false, `add  respondio ${r.status}`); return false; }
    log(`3) add ${name} -> ${r.status}`);
  }

  const em = await api('POST', `shopcarts/${cid}/emit`, { body: { paymentFrequency: 'yearly', sendEmailConfirmation: true, isHolderThePayee: true, holderAcceptedTermsAndConditions: true, isHolderNotPoliticallyExposed: true, holderEnjoysGoodHealth: true } });
  log(`3) emit -> ${em.status} ${JSON.stringify(em.data).slice(0, 80)}`);
  if (em.status !== 200) { record(false, `emit respondio ${em.status}: ${JSON.stringify(em.data).slice(0, 120)}`); return false; }

  const maxAttempts = 90;
  for (let i = 1; i <= maxAttempts; i++) {
    await sleep(5000);
    const st = await api('GET', `shopcarts/${cid}/emit`);
    if (i === 1 || i % 10 === 0) log(`3) poll ${i}/${maxAttempts}: status=${st.data?.status} progress=${st.data?.emissionProgress}`);

    if (st.data?.status === 'emitted') {
      const s = await api('GET', `shopcarts/${cid}/summary`);
      const policies = Array.isArray(s.data?.policies) ? s.data.policies : [];
      const emittedPolicies = Array.isArray(st.data?.policies) ? st.data.policies : [];
      const pending = selectPendingPolicies(policies, emittedPolicies);
      const total = sumPolicyTotals(pending, emittedPolicies);
      if (policies.length !== 2 || pending.length !== 2 || total === null) {
        log(`3) EMITIDO cart=${cid}, pero no se pudieron obtener los dos totales con IGTF; no se notificará`);
        record(false, `emisión de ${cid}: se esperaban 2 pólizas pendientes con total, hubo ${pending.length} (total=${total})`);
        return;
      }

      let notifyPolicies;
      try {
        notifyPolicies = buildNotifyPolicies(pending, emittedPolicies);
      } catch (error) {
        log(`3) EMITIDO cart=${cid}, pero emit no tiene todas las referencias de notify; no se notificará: ${error instanceof Error ? error.message : String(error)}`);
        record(false, `referencias de notify incompletas en ${cid}`);
        return;
      }
      log(`3) EMITIDO cart=${cid} con ${pending.length} póliza(s) pendiente(s); total a pagar = ${total}`);
      pending.forEach((p) => {
        const quote = displayPaymentQuote(p);
        log(`     - ${p.title} ${p.number} prima=${quote?.amount} total=${policyTotal(p, emittedPolicies)} quote=${quote?.quote} paid=${quote?.isPaid}`);
      });

      // 4) Notify con datos de emisión, una sola llamada y el monto total.
      const notif = await api('POST', 'payments/notify-external-payment', { query: { shopcartId: cid }, body: {
        policy: notifyPolicies,
        payment: { type: 'TDC', currency: 'USD', amount: total, approvalNumber: '123456', payeeFirstName: 'Jose', payeeLastName: 'Camejo' },
        receipt: { amount: total, currency: 'USD' }, exchangeRate: null,
      } });
      log(`4) notify (1 llamada, ${pending.length} pólizas, amount=${total}) -> ${notif.status} ${JSON.stringify(notif.data).slice(0, 160)}`);
      if (notif.status < 200 || notif.status >= 300) {
        record(false, `notify de ${cid} respondio ${notif.status}: ${JSON.stringify(notif.data).slice(0, 160)}`);
        return false;
      }
      await checkAcknowledgement(cid, pending.length);
      return true;
    }
    if (st.data?.status === 'emission_error') {
      const er = await api('GET', 'shopcarts/errors', { query: { shopcartId: cid } });
      log(`3) EMISSION_ERROR cart=${cid} ${er.data?.[0]?.errorId} ${String(er.data?.[0]?.extraData).slice(0, 150)}`);
      return record(false, `emision de 2 polizas fallo en ${cid}: ${er.data?.[0]?.errorId}`);
    }
  }
  log(`3) timeout esperando emision del cart ${cid}`);
  return record(false, `la emision de ${cid} no llego a emitted en 90 intentos`);
}
/**
 * 4b) Confirma contra la fuente autoritativa (GET emit) que TODAS las pólizas
 * quedaron pagadas. Un 2xx en notify no garantiza que el core haya aplicado el
 * cobro: si el core no acusa, la notificación se reintentaría y duplicaría.
 */
async function checkAcknowledgement(cid, expectedPolicies) {
  const attempts = 12; // 12 x 5 s = 1 min
  for (let i = 1; i <= attempts; i += 1) {
    await sleep(5000);
    const [st, s] = await Promise.all([
      api('GET', `shopcarts/${cid}/emit`),
      api('GET', `shopcarts/${cid}/summary`),
    ]);
    const policies = Array.isArray(s.data?.policies) ? s.data.policies : [];
    const paid = policies.filter((policy) => isPolicyPaid(policy, undefined, new Set())).length;
    if (i === 1 || i % 4 === 0) log(`4b) acuse ${i}/${attempts}: ${paid}/${expectedPolicies} póliza(s) pagadas en el summary`);
    if (paid >= expectedPolicies) {
      log(`4b) OK: las ${paid} póliza(s) de ${cid} figuran pagadas en el resumen.`);
      return true;
    }
    if (st.data?.status === 'emission_error') break;
  }
  log(`4b) el core no confirmo el pago de ${cid} dentro del tiempo esperado.`);
  return record(false, `el core no reflejo el pago de ${cid}: emit/summary siguen sin marcarlo pagado`);
}

/** 5) Funerario: un intento más para tener un 3er ID de carrito registrado. */
async function checkFunerario() {
  const cart = await api('POST', 'shopcarts', { body: { clientId: CLIENT, salesChannelId: CHANNEL } });
  const cid = cart.data?.id;
  if (!cid) { log(`5) no cart: ${cart.status} ${JSON.stringify(cart.data).slice(0, 140)}`); record(false, 'no se pudo crear el carrito Funerario'); return false; }
  log(`5) cart=${cid}`);

  const add = await api('POST', `shopcarts/${cid}/products`, { body: { productId: 'cm23o270j0924ujopcki7bxdo', planId: 'cm23o28er0cmbujopzlwht1w7', isPreferentialBeneficiaryEnabled: false } });
  if (add.status !== 200) { log(`5) add Funerario -> ${add.status} ${JSON.stringify(add.data).slice(0, 140)}`); record(false, `add Funerario respondio ${add.status}`); return false; }

  const em = await api('POST', `shopcarts/${cid}/emit`, { body: { paymentFrequency: 'yearly', sendEmailConfirmation: true, isHolderThePayee: true, holderAcceptedTermsAndConditions: true, isHolderNotPoliticallyExposed: true, holderEnjoysGoodHealth: true } });
  log(`5) emit -> ${em.status} ${JSON.stringify(em.data).slice(0, 80)}`);
  if (em.status !== 200) { record(false, `emit respondio ${em.status}: ${JSON.stringify(em.data).slice(0, 120)}`); return false; }

  const maxAttempts = 90;
  for (let i = 1; i <= maxAttempts; i++) {
    await sleep(5000);
    const st = await api('GET', `shopcarts/${cid}/emit`);
    if (i === 1 || i % 10 === 0) log(`5) poll ${i}/${maxAttempts}: status=${st.data?.status} progress=${st.data?.emissionProgress}`);
    if (st.data?.status === 'emitted') {
      log(`5) Funerario EMITIDO cart=${cid} (el paquete quedo reparado en Mercantil)`);
      return true;
    }
    if (st.data?.status === 'emission_error') {
      const er = await api('GET', 'shopcarts/errors', { query: { shopcartId: cid } });
      log(`5) Funerario sigue fallando cart=${cid} ${er.data?.[0]?.errorId} ${String(er.data?.[0]?.extraData).replace(/\s+/g, ' ').slice(0, 260)}`);
      return record(false, `Funerario: emission_error en ${cid} (${er.data?.[0]?.errorId})`);
    }
  }
  log(`5) Funerario timeout cart=${cid}`);
  return record(false, `Funerario: la emision de ${cid} no termino dentro de ${maxAttempts} intentos`);
}

(async () => {
  log('=== INICIO re-verificación programada ===');
  const up = await ensureServer();
  if (!up) {
    log('No se pudo levantar el dev server; fin de la re-verificación.');
    process.exitCode = 1;
    return;
  }
  const ok = await checkApi();
  if (!ok) {
    log('La API de Aliados sigue caída (500). No hay nada que re-probar todavía.');
    log('=== FIN (API caída) ===');
    process.exitCode = 1;
    return;
  }
  log('La API de Aliados responde OK -> re-verificando todo.');
  await checkAmounts();
  await checkTwoPolicies();
  await checkFunerario();
  if (failures.length > 0) {
    log(`=== FIN con ${failures.length} verificacion(es) fallida(s) ===`);
    failures.forEach((f) => log(`   - ${f}`));
    process.exitCode = 1;
    return;
  }
  log('=== FIN: todas las verificaciones pasaron ===');
})();