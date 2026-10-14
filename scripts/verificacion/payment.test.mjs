import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildNotifyPolicies,
  calculatePaymentAmount,
  displayPaymentQuote,
  duePaymentQuote,
  findEmittedPolicy,
  isPaymentPending,
  isPolicyPaid,
  markSummaryPaid,
  paymentQuoteKey,
  pendingBalance,
  policyKey,
  policyTotal,
  roundPaymentAmount,
  selectPendingPolicies,
  sumPolicyTotals,
} from '../../src/lib/payment.ts';

function policy(overrides = {}) {
  return {
    id: 'summary-230273',
    title: 'Vida Mercantil',
    policyNumber: '230273',
    certificateNumber: '1',
    entity: '1',
    area: '50',
    number: '1-50-230273',
    paymentQuotes: [
      { quote: '1', agreement: '1', receipt: '999999', amount: 8.76, isPaid: false },
    ],
    ...overrides,
  };
}

function emitted(overrides = {}) {
  return {
    id: 'emit-230273',
    isQuoted: true,
    isEmitted: true,
    isPaid: false,
    product: 'Vida Mercantil',
    category: 'vital',
    policyPaymentData: {
      certificateNumber: 7,
      nu_poliza: 230273,
      cd_area: 50,
      cd_entidad: 1,
      recibo: {
        cd_recibo: '7000001',
        nu_convenio_pago: 9,
      },
      cuota: {
        nu_cuota: 2,
        mt_pendiente: 9.02,
        mt_pendiente_sin_igtf: 8.76,
      },
    },
    ...overrides,
  };
}

/** Emisión de una póliza mensual: la cuota vigente es la que informa el core. */
function emittedCuota(cuota) {
  const base = emitted();
  return emitted({
    policyPaymentData: {
      ...base.policyPaymentData,
      cuota: { nu_cuota: cuota, mt_pendiente: 3, mt_pendiente_sin_igtf: 2.88 },
    },
  });
}

test('selecciona la cuota siguiente pendiente aunque no sea la primera', () => {
  const target = policy({
    paymentQuotes: [
      { quote: '1', amount: 8.76, isPaid: true, receiptStatus: 'paid' },
      { quote: '3', amount: 2.5, isPaid: false, isNextDuePayment: true },
    ],
  });

  assert.equal(duePaymentQuote(target)?.quote, '3');
  assert.equal(displayPaymentQuote(target)?.quote, '3');
});

test('isPolicyPaid reconoce el core, el resumen y el bloqueo local', () => {
  const target = policy();
  const corePaid = emitted({ isPaid: true });

  assert.equal(isPolicyPaid(target, corePaid, new Set()), true);
  assert.equal(isPolicyPaid(policy({
    paymentQuotes: [{ quote: '1', isPaid: true, receiptStatus: 'paid' }],
  }), undefined, new Set()), true);
  assert.equal(isPolicyPaid(target, undefined, new Set([policyKey(target)])), true);
  assert.equal(isPolicyPaid(target, undefined, new Set()), false);
});

test('el isPaid explícito del core manda sobre un resumen stale', () => {
  // El resumen quedó con la cuota anterior pagada, pero el core dice que la
  // cuota emitida sigue sin pagar: debe seguir apareciendo como pendiente.
  const stale = policy({
    paymentQuotes: [{ quote: '2', isPaid: true, receiptStatus: 'paid', quoteStatus: 'paid' }],
  });
  const unpaid = emitted({ isPaid: false });

  assert.equal(isPolicyPaid(stale, unpaid, new Set()), false);
  assert.equal(isPaymentPending(stale, [unpaid], new Set(), new Set()), true);
});

test('los bloqueos locales son por póliza Y cuota', () => {
  // Póliza mensual: cuota 1 pagada, cuota 3 vigente. El lock de la cuota 1 no
  // puede tapar la 3, ni al revés.
  const monthly = policy({
    paymentQuotes: [
      { quote: '1', amount: 3, isPaid: true, receiptStatus: 'paid', quoteStatus: 'paid' },
      { quote: '2', amount: 3, isPaid: true, receiptStatus: 'paid', quoteStatus: 'paid' },
      { quote: '3', amount: 3, isPaid: false, isNextDuePayment: true },
    ],
  });
  const emittedPolicies = [emittedCuota(3)];
  const cuota1 = '230273#1';
  const cuota3 = paymentQuoteKey(monthly, undefined);

  assert.equal(cuota3, '230273#3');
  assert.equal(paymentQuoteKey(monthly, emittedPolicies[0]), '230273#3');
  assert.equal(isPolicyPaid(monthly, emittedPolicies[0], new Set([cuota1])), false);
  assert.equal(isPaymentPending(monthly, emittedPolicies, new Set([cuota1])), true);

  // Al bloquear la cuota 3, la política queda pagada y sale de las pendientes.
  assert.equal(isPolicyPaid(monthly, emittedPolicies[0], new Set([cuota3])), true);
  assert.deepEqual(selectPendingPolicies([monthly], emittedPolicies, new Set([cuota3])), []);
});

test('un saldo explícito en cero no es una cuota pendiente', () => {
  const target = policy();
  const zeroed = emitted({
    policyPaymentData: {
      ...emitted().policyPaymentData,
      cuota: { nu_cuota: 1, mt_pendiente: 0, mt_pendiente_sin_igtf: 0 },
    },
  });

  assert.equal(pendingBalance(zeroed), 0);
  assert.equal(policyTotal(target, [zeroed]), null);
  assert.equal(isPaymentPending(target, [zeroed], new Set(), new Set()), false);
  assert.deepEqual(selectPendingPolicies([target], [zeroed]), []);
  // Sin `mt_pendiente` (respuesta vieja) se sigue lo que informa el resumen.
  assert.equal(pendingBalance(emitted({
    policyPaymentData: { ...emitted().policyPaymentData, cuota: { nu_cuota: 1 } },
  })), null);
});

test('una notificación con resultado desconocido bloquea el reintento', () => {
  const target = policy();
  const key = paymentQuoteKey(target, emitted());

  assert.equal(isPaymentPending(target, [emitted()], new Set(), new Set([key])), false);
  assert.deepEqual(selectPendingPolicies([target], [emitted()], new Set(), new Set([key])), []);
  // Un 4xx no se bloquea: el core rechazó y no aplicó el pago.
  assert.equal(isPaymentPending(target, [emitted()], new Set(), new Set(['otra#9'])), true);
});

test('excluye pólizas pagadas y conserva las pendientes', () => {
  const paid = policy({
    id: 'summary-177311',
    policyNumber: '177311',
    number: '1-1-177311',
    paymentQuotes: [{ quote: '1', isPaid: true }],
  });
  const pending = policy();
  const emittedPolicies = [
    emitted(),
    emitted({
      id: 'emit-177311',
      isPaid: true,
      policyPaymentData: {
        ...emitted().policyPaymentData,
        nu_poliza: 177311,
        cd_area: 1,
      },
    }),
  ];

  assert.equal(findEmittedPolicy(pending, emittedPolicies)?.id, 'emit-230273');
  assert.deepEqual(
    selectPendingPolicies([paid, pending], emittedPolicies).map(policyKey),
    ['230273'],
  );
});

test('construye todas las referencias de notify desde emit', () => {
  const summary = policy({
    certificateNumber: 'stale',
    entity: '2',
    area: '99',
    paymentQuotes: [{
      quote: 'stale',
      agreement: 'stale',
      receipt: 'stale',
      amount: 8.76,
      isPaid: false,
    }],
  });

  assert.deepEqual(buildNotifyPolicies([summary], [emitted()]), [{
    entity: '1',
    area: '50',
    number: '230273',
    certificate: '7',
    receipt: '7000001',
    agreement: '9',
    quote: '2',
  }]);
});

test('rechaza identificadores ausentes o inválidos antes de notificar', () => {
  const target = policy();
  assert.throws(
    () => buildNotifyPolicies([target], [emitted({
      policyPaymentData: {
        ...emitted().policyPaymentData,
        recibo: { cd_recibo: '', nu_convenio_pago: 1 },
      },
    })]),
    /no tiene recibo/,
  );
  assert.throws(
    () => buildNotifyPolicies([target], [emitted({
      policyPaymentData: {
        ...emitted().policyPaymentData,
        cd_entidad: 3,
      },
    })]),
    /Entidad inválida/,
  );
  assert.throws(
    () => buildNotifyPolicies([policy({ policyNumber: '', number: '' })], [emitted()]),
    /No se encontró la emisión/,
  );
});

test('suma únicamente mt_pendiente y bloquea totales incompletos', () => {
  const first = policy();
  const second = policy({
    id: 'summary-177311',
    policyNumber: '177311',
    number: '1-1-177311',
    paymentQuotes: [{ quote: '1', amount: 30.97, isPaid: false }],
  });
  const policies = [first, second];
  const emittedPolicies = [
    emitted(),
    emitted({
      id: 'emit-177311',
      policyPaymentData: {
        ...emitted().policyPaymentData,
        nu_poliza: 177311,
        cd_area: 1,
        cuota: {
          nu_cuota: 1,
          mt_pendiente: 31.9,
          mt_pendiente_sin_igtf: 30.97,
        },
      },
    }),
  ];

  assert.equal(policyTotal(first, emittedPolicies), 9.02);
  assert.equal(sumPolicyTotals(policies, emittedPolicies), 40.92);
  assert.equal(sumPolicyTotals(policies, [emitted()]), null);
  assert.equal(sumPolicyTotals([], emittedPolicies), null);
});

test('USD conserva el total y Bs exige una tasa válida', () => {
  assert.equal(calculatePaymentAmount(40.92, 'USD', null), 40.92);
  assert.equal(calculatePaymentAmount(40.92, 'BS', 801.18), 32784.29);
  assert.equal(calculatePaymentAmount(40.92, 'BS', null), null);
  assert.equal(calculatePaymentAmount(40.92, 'BS', 0), null);
  assert.equal(calculatePaymentAmount(40.92, 'BS', 'invalid'), null);
  assert.equal(calculatePaymentAmount(null, 'USD', 801.18), null);
  assert.equal(roundPaymentAmount(1.005), 1.01);
});

test('un total redondeado a 0 o a Infinity no se puede pagar', () => {
  // Infinity se serializaría como null en el JSON del notify.
  assert.equal(calculatePaymentAmount(40.92, 'BS', 1e308), null);
  assert.equal(calculatePaymentAmount(1e308, 'USD', null), null);
  // Tasa tan pequeña que el redondeo a centavos da 0.
  assert.equal(calculatePaymentAmount(40.92, 'BS', 1e-6), null);
  assert.equal(calculatePaymentAmount(0.001, 'USD', null), null);
  assert.equal(calculatePaymentAmount(0.01, 'USD', null), 0.01);
});

test('markSummaryPaid persiste la aceptación sin mutar el resumen recibido', () => {
  const original = policy();
  const snapshot = structuredClone(original);
  const marked = markSummaryPaid(
    { id: 'cart-1', status: 'emitted', policies: [original] },
    new Set([paymentQuoteKey(original, undefined)]),
  );
  const quote = marked.policies?.[0]?.paymentQuotes?.[0];

  assert.deepEqual(original, snapshot);
  assert.equal(marked.status, 'paid');
  assert.equal(quote?.isPaid, true);
  assert.equal(quote?.receiptStatus, 'paid');
  assert.equal(quote?.quoteStatus, 'paid');
  assert.equal(quote?.isNextDuePayment, false);
});

test('markSummaryPaid no declara pagado un carrito con cuotas por cobrar', () => {
  // Póliza mensual: sólo se notificó la cuota 2 de 4.
  const monthly = policy({
    paymentQuotes: [
      { quote: '1', amount: 3, isPaid: true, receiptStatus: 'paid', quoteStatus: 'paid' },
      { quote: '2', amount: 3, isPaid: false, isNextDuePayment: true },
      { quote: '3', amount: 3, isPaid: false },
      { quote: '4', amount: 3, isPaid: false },
    ],
  });
  const marked = markSummaryPaid(
    { id: 'cart-2', status: 'emitted', policies: [monthly] },
    new Set(['230273#2']),
  );
  const quotes = marked.policies?.[0]?.paymentQuotes ?? [];

  assert.equal(marked.status, 'emitted');
  assert.equal(quotes.filter((quote) => quote.isPaid).length, 2);
  assert.equal(duePaymentQuote(marked.policies?.[0] ?? {})?.quote, '3');
  assert.equal(isPaymentPending(marked.policies?.[0] ?? {}, [emittedCuota(3)], new Set(['230273#2'])), true);
});
