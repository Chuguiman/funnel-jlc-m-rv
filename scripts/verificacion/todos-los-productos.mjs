// ¿Qué flujos emiten OK hoy? Prueba los 4 productos (Auto + 3 Vitales) con el cliente existente,
// carrito → producto → emitir → poll, vía proxy.
const PROXY = 'http://localhost:4321/api/mercantil';
const CHANNEL = 'cms6dz7170n84pc43oeg44aym';
const CLIENT = 'cmn9jvysl00jknt42y9z0ci2l'; // V-12345679 / 1990-01-01

const FLOWS = [
  { name: 'AUTO RCV', productId: 'cm6gt3msg09onnv3na8shfuk2', planId: 'cm6gt3ow10dcanv3n6rztthx3', vehicle: { year: '2021', brandCode: '001', modelCode: '028', versionCode: '05' } },
  { name: 'Vida', productId: 'cm23o270j0920ujopmmicjn2c', planId: 'cm23o28er0cmjujopinj1qg47' },
  { name: 'Accidentes', productId: 'cm23o270j0922ujop2ik7ryq1', planId: 'cm23o28er0cm8ujopdlgqxb20' },
  { name: 'Funerario', productId: 'cm23o270j0924ujopcki7bxdo', planId: 'cm23o28er0cmbujopzlwht1w7' },
];

async function api(method, path, { query, body, form, origin = 'http://localhost:4321' } = {}) {
  const url = new URL(PROXY + '/' + path.replace(/^\//, ''));
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  const headers = {};
  if (origin) headers['Origin'] = origin;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(url.toString(), {
    method,
    headers,
    body: form ? form : body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60000),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const bytes = Uint8Array.from(Buffer.from(b64, 'base64'));

const rows = [];
for (const f of FLOWS) {
  console.log(`\n===== ${f.name} =====`);
  const cart = await api('POST', 'shopcarts', { body: { clientId: CLIENT, salesChannelId: CHANNEL } });
  const cid = cart.data?.id;
  if (!cid) { rows.push({ name: f.name, ok: false, detail: `sin cart: ${cart.status}` }); continue; }
  await api('POST', `shopcarts/${cid}/products`, { body: {
    productId: f.productId, planId: f.planId, isPreferentialBeneficiaryEnabled: false,
    vehicleInformation: f.vehicle ? { year: f.vehicle.year, brandCode: f.vehicle.brandCode, modelCode: f.vehicle.modelCode, versionCode: f.vehicle.versionCode } : undefined,
  } });

  if (f.vehicle) {
    await api('POST', 'auto-products/vehicles/complete-vehicle-info', { query: { shopcartId: cid }, body: {
      vehicleInformation: { year: '2021', brand: '001', model: '028', version: '05', commonLocationId: '1', isArmored: false, plate: 'AZ87Z81', colorId: '2', chassisSerial: 'JHMFA16586S012345', engineSerial: '1NZ123456789123456' },
    } });
    const form = new FormData();
    form.append('vehiclePropertyFile', new Blob([bytes], { type: 'image/png' }), 'titulo.png');
    await api('POST', `shopcarts/${cid}/vehicle-property-title`, { form, origin: 'http://localhost:4321' });
  }

  await api('POST', `shopcarts/${cid}/emit`, { body: {
    paymentFrequency: 'yearly', sendEmailConfirmation: true, isHolderThePayee: true,
    holderAcceptedTermsAndConditions: true, isHolderNotPoliticallyExposed: true,
    holderEnjoysGoodHealth: f.name !== 'AUTO RCV',
  } });

  let outcome = 'timeout';
  const maxAttempts = 90;
  for (let i = 1; i <= maxAttempts; i++) {
    await sleep(5000);
    const st = await api('GET', `shopcarts/${cid}/emit`);
    const s = st.data?.status;
    if (i === 1 || i % 10 === 0) console.log(`  poll ${i}/${maxAttempts}: ${s} prog=${st.data?.emissionProgress}`);
    if (s === 'emitted') { outcome = 'emitted'; break; }
    if (s === 'emission_error') {
      const errs = await api('GET', 'shopcarts/errors', { query: { shopcartId: cid } });
      const raw = errs.data?.[0];
      let d = raw?.errorId ?? '';
      if (raw?.extraData) { try { const x = JSON.parse(raw.extraData); d += ' | ' + (x.cause ?? '') + ' | ' + JSON.stringify(x.data ?? []).slice(0, 120); } catch { d += ' | ' + raw.extraData; } }
      outcome = d || 'emission_error';
      break;
    }
  }
  rows.push({ name: f.name, ok: outcome === 'emitted', detail: outcome, cart: cid });
  console.log(`  => ${f.name}: ${outcome === 'emitted' ? '✓ EMITIDO' : '✗ ' + outcome}`);
}

console.log('\n===== RESUMEN =====');
for (const r of rows) console.log(`${r.ok ? '✓' : '✗'} ${r.name}: ${r.ok ? 'emitido' : r.detail} (cart=${r.cart})`);