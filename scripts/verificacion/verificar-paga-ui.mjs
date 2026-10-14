#!/usr/bin/env node
/**
 * Verificación visual y sin efectos de pago del paso Paga.
 *
 * Rehidrata un carrito emitido en la UI, comprueba que Paga consulte
 * policyPaymentData.cuota.mt_pendiente desde GET shopcarts/{id}/emit, que
 * precargue la suma de los totales y que muestre cada total por póliza.
 * NO pulsa «Notificar pago realizado» y falla si aparece cualquier POST al
 * endpoint de notify.
 *
 * Uso:
 *   node scripts/verificacion/verificar-paga-ui.mjs --cart <shopcartId> \
 *     [--expected 40.92] [--policies 2] [--screenshot <ruta.png>]
 *
 * Requiere el dev server en http://localhost:4321 y Microsoft Edge (o define
 * EDGE_PATH / BROWSER_PATH con la ruta al ejecutable).
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  displayPaymentQuote,
  findEmittedPolicy,
  selectPendingPolicies,
} from '../../src/lib/payment.ts';

const STORAGE_KEY = 'jlcamejo.funnel.v1';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const args = { appUrl: 'http://localhost:4321' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--cart') args.cartId = argv[++i];
    else if (arg === '--expected') args.expected = Number(argv[++i]);
    else if (arg === '--policies') args.policyCount = Number(argv[++i]);
    else if (arg === '--screenshot') args.screenshot = argv[++i];
    else if (arg === '--url') args.appUrl = argv[++i];
    else if (arg === '--edge') args.edgePath = argv[++i];
    else fail(`Argumento desconocido: ${arg}`);
  }
  if (!args.help && !args.cartId) {
    fail('Falta --cart <shopcartId>. Usa --help para ver la ayuda.');
  }
  if (args.expected !== undefined && (!Number.isFinite(args.expected) || args.expected <= 0)) {
    fail('--expected debe ser un número mayor que cero.');
  }
  if (args.policyCount !== undefined && (!Number.isInteger(args.policyCount) || args.policyCount <= 0)) {
    fail('--policies debe ser un entero mayor que cero.');
  }
  return args;
}

function printHelp() {
  console.log(`Uso:
  node scripts/verificacion/verificar-paga-ui.mjs --cart <shopcartId> [opciones]

Opciones:
  --expected <monto>    Total esperado; por defecto se toma de mt_pendiente.
  --policies <cantidad> Cantidad esperada de pólizas pendientes.
  --screenshot <archivo>
                        Captura PNG de página completa.
  --url <url>           Base local (por defecto http://localhost:4321).
  --edge <archivo>      Ruta alternativa a msedge.exe/chrome.exe.
  -h, --help            Mostrar esta ayuda.

La prueba nunca hace clic en Notificar ni envía pagos.`);
}

function findBrowser(explicitPath) {
  const localAppData = process.env.LOCALAPPDATA || '';
  const programFiles = process.env.ProgramFiles || '';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || '';
  const candidates = [
    explicitPath,
    process.env.EDGE_PATH,
    process.env.BROWSER_PATH,
    programFilesX86 && path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    programFiles && path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    localAppData && path.join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    programFiles && path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    programFilesX86 && path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    localAppData && path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean);

  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) fail('No se encontró Edge o Chrome. Define EDGE_PATH/BROWSER_PATH o usa --edge.');
  return found;
}

async function getJson(url) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) {
    fail(`GET ${url} -> ${response.status}: ${text.slice(0, 300)}`);
  }
  return data;
}

async function loadCart(appUrl, cartId) {
  const proxy = `${appUrl.replace(/\/$/, '')}/api/mercantil`;
  const [summary, emit] = await Promise.all([
    getJson(`${proxy}/shopcarts/${cartId}/summary`),
    getJson(`${proxy}/shopcarts/${cartId}/emit`),
  ]);
  if (emit?.status !== 'emitted') {
    fail(`El carrito ${cartId} no está emitido (status=${emit?.status ?? 'desconocido'}).`);
  }
  const policies = Array.isArray(summary?.policies) ? summary.policies : [];
  const emittedPolicies = Array.isArray(emit.policies) ? emit.policies : [];
  const pending = selectPendingPolicies(policies, emittedPolicies);
  if (pending.length === 0) fail(`El carrito ${cartId} no tiene pólizas pendientes.`);

  const policyData = pending.map((summaryPolicy) => {
    const authoritative = findEmittedPolicy(summaryPolicy, emittedPolicies);
    const number = String(authoritative?.policyPaymentData?.nu_poliza ?? '');
    /**
     * Oráculo independiente: se lee el `mt_pendiente` crudo del core, sin pasar
     * por `policyTotal`/`sumPolicyTotals`. Si la UI y el oráculo compartieran el
     * mismo helper, una regresión en la lectura del total would "aprobar" los dos.
     */
    const total = Number(authoritative?.policyPaymentData?.cuota?.mt_pendiente);
    if (!Number.isFinite(total) || total <= 0) {
      fail(`El core no devolvió mt_pendiente válido para la póliza ${number || '(sin número)'} (${authoritative?.policyPaymentData?.cuota?.mt_pendiente}).`);
    }
    return {
      number,
      title: summaryPolicy.title ?? '',
      premium: Number(displayPaymentQuote(summaryPolicy)?.amount),
      total,
    };
  });
  const expected = Math.round(
    policyData.reduce((sum, policy) => sum + policy.total, 0) * 100,
  ) / 100;
  if (!Number.isFinite(expected) || expected <= 0) {
    fail(`El total de mt_pendiente no sirve como oráculo para ${cartId}.`);
  }
  return { summary, emit, policyData, expected };
}

async function waitForDevToolsPort(profileDir, browser, diagnostics) {
  const portFile = path.join(profileDir, 'DevToolsActivePort');
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (existsSync(portFile)) {
      const [portLine] = (await readFile(portFile, 'utf8')).split(/\r?\n/);
      const port = Number(portLine);
      if (Number.isInteger(port) && port > 0) return port;
    }
    if (browser.exitCode !== null) {
      fail(`El navegador terminó antes de abrir DevTools (exit=${browser.exitCode}). ${diagnostics()}`);
    }
    await sleep(100);
  }
  fail(`Timeout esperando DevTools de ${browser}. ${diagnostics()}`);
}

async function findPageTarget(port) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
        signal: AbortSignal.timeout(1_000),
      });
      const targets = await response.json();
      const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      /* DevTools aún está arrancando. */
    }
    await sleep(100);
  }
  fail('No se encontró una pestaña de página en DevTools.');
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      const onOpen = () => {
        this.ws.removeEventListener('error', onError);
        resolve();
      };
      const onError = () => {
        this.ws.removeEventListener('open', onOpen);
        reject(new Error('No se pudo abrir la conexión WebSocket de DevTools.'));
      };
      this.ws.addEventListener('open', onOpen, { once: true });
      this.ws.addEventListener('error', onError, { once: true });
    });
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
        else pending.resolve(message.result);
        return;
      }
      for (const listener of this.listeners.get(message.method) || []) listener(message.params);
    });
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) || [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  send(method, params = {}, timeoutMs = 30_000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timeout de CDP: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (response.exceptionDetails) {
      const detail = response.exceptionDetails.exception?.description
        || response.exceptionDetails.text
        || 'error de evaluación';
      fail(`Error al evaluar en el navegador: ${detail}`);
    }
    return response.result?.value;
  }

  close() {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.close();
  }
}

async function waitForPaga(cdp, expected, expectedPolicies, timeoutMs = 60_000) {
  const startedAt = Date.now();
  let lastState = null;
  while (Date.now() - startedAt < timeoutMs) {
    lastState = await cdp.evaluate(`(() => {
      const labelValues = (label) => [...document.querySelectorAll('#paga p')]
        .filter((node) => node.textContent?.trim().toLowerCase() === label.toLowerCase())
        .map((node) => node.nextElementSibling?.textContent?.trim() ?? '');
      return {
        readyState: document.readyState,
        hasPaga: Boolean(document.querySelector('#paga')),
        totals: labelValues('Total pendiente'),
        premiums: labelValues('Prima'),
        checkoutEnabled: (() => {
          const button = [...document.querySelectorAll('#paga button')]
            .find((node) => node.textContent?.includes('Continuar al pago seguro'));
          return button instanceof HTMLButtonElement && !button.disabled;
        })(),
        body: document.body?.innerText ?? ''
      };
    })()`);
    // Se espera a que estén TODAS las pólizas pintadas: si no, la aserción
    // correría contra una vista a medio renderizar.
    if (
      lastState.hasPaga
      && lastState.totals.length === expectedPolicies
      && lastState.premiums.length === expectedPolicies
      && lastState.totals.every((value) => value.length > 0)
      && lastState.premiums.every((value) => value.length > 0)
      && lastState.checkoutEnabled
    ) {
      return lastState;
    }
    await sleep(250);
  }
  fail(`Paga no quedó lista con el total ${expected} en ${expectedPolicies} póliza(s). Último estado: ${JSON.stringify(lastState)}`);
}

function moneyValues(rawValues) {
  return rawValues.map((value) => {
    const cleaned = value.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
    return Number(cleaned);
  });
}

function assertUi(cart, ui, state) {
  const expectedTotals = cart.policyData.map((policy) => policy.total);
  const expectedPremiums = cart.policyData.map((policy) => policy.premium);
  const displayedTotals = moneyValues(ui.totals);
  const displayedPremiums = moneyValues(ui.premiums);
  const differences = (left, right) => left.map((value, index) => Math.abs(value - (right[index] ?? NaN)));
  const policiesVisible = cart.policyData.every((policy) => ui.body.includes(policy.number));

  /**
   * Los conteos y la finitud se exigen siempre: si la UI no muestra una póliza,
   * `differences` no produce ninguna discrepancia y la prueba pasaba en verde.
   */
  if (displayedTotals.length !== expectedTotals.length) {
    fail(`La UI mostró ${displayedTotals.length} totales; se esperaban ${expectedTotals.length}.`);
  }
  if (state.requiresExactPolicyCount && displayedTotals.length !== state.expectedPolicyCount) {
    fail(`La UI mostró ${displayedTotals.length} totales; se esperaban ${state.expectedPolicyCount}.`);
  }
  if (displayedPremiums.length !== expectedPremiums.length) {
    fail(`La UI mostró ${displayedPremiums.length} primas; se esperaban ${expectedPremiums.length}.`);
  }
  if (!displayedTotals.every(Number.isFinite) || !displayedPremiums.every(Number.isFinite)) {
    fail(`Montos no numéricos en pantalla: totales=${JSON.stringify(ui.totals)} primas=${JSON.stringify(ui.premiums)}.`);
  }
  const totalsMatch = differences(displayedTotals, expectedTotals).every((delta) => delta <= 0.01);
  const premiumsMatch = differences(displayedPremiums, expectedPremiums)
    .every((delta) => delta <= 0.01);
  if (!totalsMatch) {
    fail(`Totales visibles ${JSON.stringify(displayedTotals)}; esperados ${JSON.stringify(expectedTotals)}.`);
  }
  if (!premiumsMatch) {
    fail(`Primas visibles ${JSON.stringify(displayedPremiums)}; esperadas ${JSON.stringify(expectedPremiums)}.`);
  }
  if (!policiesVisible) fail('No se mostraron todos los números de póliza en pantalla.');
  if (!ui.checkoutEnabled) fail('El botón de checkout Mercantil no está habilitado.');
  if (ui.body.includes('Notificar pago realizado') || ui.body.includes('Código de aprobación')) {
    fail('La UI aún muestra el flujo de notificación manual de pago.');
  }
  if (state.notifyRequests.length !== 0) {
    fail(`Se detectaron ${state.notifyRequests.length} POST de notify; la prueba no debe notificarlos.`);
  }
  return {
    cartId: state.cartId,
    status: cart.emit.status,
    policies: cart.policyData,
    expectedTotal: cart.expected,
    displayedTotals,
    displayedPremiums,
    checkoutEnabled: ui.checkoutEnabled,
    notifyRequests: state.notifyRequests.length,
  };
}

async function stopBrowser(browser, profileDir) {
  if (browser.exitCode === null) {
    if (process.platform === 'win32' && browser.pid) {
      spawnSync('taskkill.exe', ['/PID', String(browser.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      browser.kill('SIGTERM');
    }
  }
  await rm(profileDir, { recursive: true, force: true }).catch(() => {});
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  const origin = new URL(args.appUrl).origin;
  const appUrl = `${origin}/`;
  const cart = await loadCart(appUrl, args.cartId);
  if (args.expected !== undefined && Math.abs(args.expected - cart.expected) > 0.01) {
    fail(`El total de mt_pendiente es ${cart.expected}, no ${args.expected}.`);
  }
  if (args.policyCount !== undefined && args.policyCount !== cart.policyData.length) {
    fail(`Hay ${cart.policyData.length} pólizas pendientes, no ${args.policyCount}.`);
  }

  const browserPath = findBrowser(args.edgePath);
  const profileDir = await mkdtemp(path.join(os.tmpdir(), 'jlcamejo-paga-'));
  let stderr = '';
  let browser = null;
  let cdp = null;
  try {
    browser = spawn(browserPath, [
      '--headless=new',
      '--disable-gpu',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-extensions',
      '--no-default-browser-check',
      '--no-first-run',
      '--remote-debugging-port=0',
      `--user-data-dir=${profileDir}`,
      '--window-size=1440,1200',
      'about:blank',
    ], {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });
    browser.stderr.on('data', (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-8_000);
    });
    const diagnostics = () => (stderr ? `stderr: ${stderr.slice(-1_000)}` : 'sin stderr');
    const port = await waitForDevToolsPort(profileDir, browser, diagnostics);
    const target = await findPageTarget(port);
    cdp = new CdpClient(target.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');

    const notifyRequests = [];
    cdp.on('Network.requestWillBeSent', (params) => {
      const url = String(params?.request?.url || '');
      if (params?.request?.method === 'POST' && url.includes('/payments/notify-external-payment')) {
        notifyRequests.push({ url, postData: params.request.postData });
      }
    });

    const persisted = {
      step: 3,
      identity: {
        dniType: 'VEN',
        dniNumber: '',
        dniVenNationality: 'V',
        birthDate: '',
        genderId: 'M',
        countryId: '29',
        email: '',
        phoneCountryId: '29',
        areaCode: '',
        phoneNumber: '',
      },
      client: {},
      plans: null,
      autoPlans: null,
      selections: [],
      vehicleFlow: null,
      cartId: args.cartId,
      summary: cart.summary,
      emissionDone: true,
      paymentLocks: { paid: [], submitted: [] },
    };
    const persistedLiteral = JSON.stringify(JSON.stringify(persisted));
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `try {
        sessionStorage.setItem(${JSON.stringify(STORAGE_KEY)}, ${persistedLiteral});
      } catch (error) {
        globalThis.__jlcamejoStorageError = String(error);
      }`,
    });
    await cdp.send('Page.navigate', { url: appUrl });

    const ui = await waitForPaga(cdp, cart.expected, cart.policyData.length);
    const storageState = await cdp.evaluate(`({
      present: sessionStorage.getItem(${JSON.stringify(STORAGE_KEY)}) !== null,
      error: globalThis.__jlcamejoStorageError ?? null
    })`);
    if (!storageState.present || storageState.error) {
      fail(`No se pudo inyectar el estado de Paga: ${storageState.error || 'sessionStorage vacío'}.`);
    }
    const report = assertUi(cart, ui, {
      cartId: args.cartId,
      requiresExactPolicyCount: args.policyCount !== undefined,
      expectedPolicyCount: args.policyCount,
      notifyRequests,
    });

    if (args.screenshot) {
      const screenshotPath = path.resolve(args.screenshot);
      await mkdir(path.dirname(screenshotPath), { recursive: true });
      const capture = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: true,
      });
      await writeFile(screenshotPath, Buffer.from(capture.data, 'base64'));
      report.screenshot = screenshotPath;
    }

    console.log(`OK Paga UI: carrito ${report.cartId}, ${report.policies.length} póliza(s).`);
    console.log(`   Primas sin IGTF: ${report.displayedPremiums.join(' + ')}`);
    console.log(`   Totales pendientes: ${report.displayedTotals.join(' + ')}`);
    console.log(`   Checkout Mercantil habilitado: ${report.checkoutEnabled}.`);
    console.log(`   POST notify detectados: ${report.notifyRequests} (correcto: 0).`);
    if (report.screenshot) console.log(`   Captura: ${report.screenshot}`);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    cdp?.close();
    if (browser) await stopBrowser(browser, profileDir);
    else await rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((error) => {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
