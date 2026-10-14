// ¿Funerario se puede COTIZAR (SA + primas/cuotas) aunque no emita?
// Compara los 4 productos en los 2 endpoints del paso Cotiza:
//  - products/plans/client/{clientId}  (cliente existente)
//  - products/plans/tentative-client   (con countryId, como manda CotizaStep)
// Y además revisa las cuotas dentro del carrito tras agregar el producto Funerario.
const PROXY = 'http://localhost:4321/api/mercantil';
const CHANNEL = 'cms6dz7170n84pc43oeg44aym';
const CLIENT = 'cmn9jvysl00jknt42y9z0ci2l'; // V-12345679 / 1990-01-01
const PRODUCTS = {
  'AUTO RCV': 'cm6gt3msg09onnv3na8shfuk2',
  Vida: 'cm23o270j0920ujopmmicjn2c',
  Accidentes: 'cm23o270j0922ujop2ik7ryq1',
  Funerario: 'cm23o270j0924ujopcki7bxdo',
};
const PLAN = { i: 'cm23o28er0cmjujopinj1qg47', I: 'cm23o28er0cm8ujopdlgqxb20', F: 'cm23o28er0cmbujopzlwht1w7' };

async function api(method, path, { query, body, origin = 'http://localhost:4321' } = {}) {
  const url = new URL(PROXY + '/' + path.replace(/^\//, ''));
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  const headers = { Origin: origin };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(url.toString(), {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60000),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

function fmtPlans(plans) {
  if (!plans) return '(sin plans)';
  return plans.map((p) => {
    const q = p.quotas ?? (p.cuotas ?? []);
    const prima = p.totalPrime ?? p.prime ?? p.totalPrima ?? p.premium ?? p.premiumAmount;
    return `plan=${p.id} sa=${p.assuredSum ?? p.insuredSum ?? p.sumas??p.sumAssured??'-'} prima=${prima ?? '-'} cuotas=${Array.isArray(q) ? q.length : (q ?? '-')}${q?.[0] ? ` (1ª=${q[0].amount ?? q[0].value ?? q[0].prime ?? '-'})` : ''}`;
  });
}

(async () => {
  // 1) Planes por cliente (cliente existente)
  const pc = await api('GET', `products/plans/client/${CLIENT}`);
  console.log('=== products/plans/client (cliente existente) ===');
  for (const cat of pc.data ?? []) {
    for (const prod of cat.products ?? []) {
      console.log(`[${cat.categoryTitle ?? cat.category}] ${prod.title} (${prod.id})`);
      for (const line of fmtPlans(prod.plans)) console.log('   ' + line);
    }
  }

  // 2) Planes tentativos con countryId (como CotizaStep)
  const tc = await api('GET', 'products/plans/tentative-client', { query: {
    dniType: 'VEN',
    dniNumber: '12345679',
    dniVenNationality: 'V',
    birthDate: '1990-01-01',
    genderId: 'M',
    phoneCountryId: '29',
    addressCountryId: '29',
    countryId: '29',
  } });
  console.log('\n=== products/plans/tentative-client (con countryId) ===');
  if (tc.status !== 200) { console.log('HTTP', tc.status, JSON.stringify(tc.data).slice(0, 300)); return; }
  for (const cat of tc.data ?? []) {
    for (const prod of cat.products ?? []) {
      console.log(`[${cat.categoryTitle ?? cat.category}] ${prod.title} (${prod.id})`);
      for (const line of fmtPlans(prod.plans)) console.log('   ' + line);
    }
  }

  // 3) Carrito con Funerario: cuotas dentro del carrito
  const cart = await api('POST', 'shopcarts', { body: { clientId: CLIENT, salesChannelId: CHANNEL } });
  const cid = cart.data?.id;
  console.log('\n=== carrito Funerario ===');
  if (!cid) { console.log('sin cart', cart.status, JSON.stringify(cart.data).slice(0,200)); return; }
  const add = await api('POST', `shopcarts/${cid}/products`, { body: { productId: PRODUCTS.Funerario, planId: PLAN.F, isPreferentialBeneficiaryEnabled: false } });
  console.log('addProduct ->', add.status, JSON.stringify(add.data).slice(0, 200));
  const prods = await api('GET', `shopcarts/${cid}/products`);
  for (const pr of prods.data ?? []) {
    console.log('precio/cuotas:', JSON.stringify({
      productId: pr.productId, planId: pr.planId,
      totalPrime: pr.totalPrime, assuredSum: pr.assuredSum, paymentFrequency: pr.paymentFrequency,
      priKeys: Object.keys(pr).filter((k) => /prima|prime|sum|cuota|quota|pay/i.test(k)),
      cuotas: pr.quotas ?? pr.cuotas ?? pr.paymentQuotes,
    }).slice(0, 500));
  }
  console.log('\nDONE');
})();