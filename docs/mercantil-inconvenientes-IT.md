# Estado de la integración con Mercantil Seguros — para IT (aliado JLC)

> **Revisión posterior del 25/09/2026:** consultar [informe actualizado](INFORME-REVISION-2026-09-25.md) y [borrador de correo](email-IT-Mercantil-2026-09-25.md). Las pruebas de emisión/notify descritas abajo son evidencia histórica. La revisión posterior fue de código, UI y lecturas de API; detectó pendientes propios de la app, por lo que la afirmación de que toda la app está corregida queda sustituida por el informe actualizado.


> **Actualizado: 25/09/2026**
> Ambiente: staging de Aliados (`https://imajev78v9.execute-api.us-east-2.amazonaws.com/ally-api`)
> Canal: `cms6dz7170n84pc43oeg44aym` · Ally ID: `cms6dx8it0n7cpc43zsnt76sr`

## Resumen para IT

Se probó el funnel **Cotiza → Emite → Paga** y se corrigieron los fallos del lado de la aplicación.
Quedan tres incidencias del lado de Mercantil:

| # | Endpoint / flujo | Error | Impacto |
|---|---|---|---|
| 1 | `POST payments/notify-external-payment` | `404 allyMerchantId` / `Merchant Id not found` | No se puede registrar el pago, ni para una póliza ni para un carrito de dos |
| 2 | `POST shopcarts/{id}/emit` con Funerario | `500-msQuoteError` → `ORA-01422` en `CALCULA_TASA_MUERTE_FUNERARIO` | El plan Funerario no se puede emitir |
| 3 | `GET shopcarts/{id}/products` | `403 Request not authorized (Forbidden)` | No se puede listar los productos del carrito; el POST equivalente sí funciona |

El #1 y el #2 bloquean el cierre. El #3 es de menor impacto: la app puede construir el carrito
con `POST shopcarts/{id}/products` y leer los totales por `GET shopcarts/{id}/emit`.

Estado de los flujos:

| Flujo | Cotiza | Emite | PDF | Montos/UI de Paga | Notify |
|---|---|---|---|---|---|
| Auto RCV | ✅ | ✅ | ✅ | ✅ total 46,35 | ❌ fallo 1 |
| Vida | ✅ | ✅ | ✅ | ✅ total 9,02 | ❌ fallo 1 |
| Accidentes Personales | ✅ | ✅ | ✅ | ✅ total 31,90 | ❌ fallo 1 |
| Carrito doble Vida + Accidentes | — | ✅ | — | ✅ UI: 40,92 | ❌ fallo 1, una sola llamada |
| Servicio Funerario | ✅ | ❌ fallo 2 | — | — | — |

### Incidencia transitoria de staging — recuperada

Entre ~05:48 y 06:07 Vzla del 25/09, toda la API de Aliados devolvió `500 {"message":null}`,
incluido `GET /health`, por proxy y acceso directo. A las 07:21 Vzla ambas rutas devolvieron
`200`; la re-verificación emitió correctamente un carrito doble. La caída ya no está activa.

---

## Fallo 1 — `notify-external-payment` devuelve `404 allyMerchantId`

### Respuesta vigente

Con payload real y referencias de póliza/cuota válidas:

```http
HTTP 404
```

```json
{
  "status": 404,
  "type": "allyMerchantId",
  "title": "Id de aliado mercantil no encontrado",
  "cause": "Merchant Id not found"
}
```

La validación de política, certificado, recibo, cuota y monto es superada. El error aparece cuando
el backend intenta resolver el comercio del aliado.

### Qué se descartó en la app

El endpoint inicialmente recibía el número compuesto (`1-50-230270`) y devolvía:

```text
400 policy, 0, number: Solo se permiten números
```

La app fue corregida para enviar solo `policyNumber` (`230270`). Con ese cambio se llega al
`404 allyMerchantId`, lo que confirma que el siguiente bloqueo es la configuración comercial del
aliado y no el payload de la póliza.

### Prueba simple

- Carrito: `cmug189z300z3o242mv5v0ri1`
- Vida: `1-50-230270`, `policyNumber=230270`, `certificate=1`, `entity=1`, `area=50`
- `quote=1`, `receipt=6376287`, `agreement=1`
- Monto: **9,02 USD**
- Resultado: `404 allyMerchantId`

### Prueba doble, una sola notificación

- Carrito: `cmugvxe1i006pnu427zipcd20`
- Estado: `emitted`, progreso `100`
- Accidentes: `policyNumber=177311`, recibo `6376294`, prima `30,97`, total `31,90`
- Vida: `policyNumber=230273`, recibo `6376293`, prima `8,76`, total `9,02`
- Total conjunto: **40,92 USD**
- `isPaid=false` en ambas después del intento.

Request:

```http
POST /payments/notify-external-payment?shopcartId=cmugvxe1i006pnu427zipcd20
Content-Type: application/json
```

```json
{
  "policy": [
    {
      "entity": "1",
      "area": "1",
      "number": "177311",
      "certificate": "1",
      "receipt": "6376294",
      "agreement": "1",
      "quote": "1"
    },
    {
      "entity": "1",
      "area": "50",
      "number": "230273",
      "certificate": "1",
      "receipt": "6376293",
      "agreement": "1",
      "quote": "1"
    }
  ],
  "payment": {
    "type": "TDC",
    "currency": "USD",
    "amount": 40.92,
    "approvalNumber": "123456",
    "payeeFirstName": "Jose",
    "payeeLastName": "Camejo"
  },
  "receipt": {
    "amount": 40.92,
    "currency": "USD"
  },
  "exchangeRate": null
}
```

Respuesta: el mismo `404 allyMerchantId`.

Esto cubre el caso de múltiples pólizas: **una sola llamada**, con las dos pólizas y el total
pagado una vez. La prueba visual posterior rehidrató este carrito, verificó `40,92` precargado y
no ejecutó nuevamente notify.

### Pedido a IT

Verificar y crear/configurar el `merchantId` del aliado JLC
(`allyId cms6dx8it0n7cpc43zsnt76sr`) en el módulo de pagos de staging. Cuando esté listo, se deben
reintentar:

1. notify de la póliza simple por 9,02;
2. notify del carrito doble por 40,92;
3. confirmar que el pago de ambas pólizas cambia a pagado y que no se duplica el monto.

### Contrato de monto confirmado contra el core y los PDF

La afirmación previa de que `summary.paymentQuotes[].amount` incluía IGTF era incorrecta. Los tres
productos muestran:

| Producto | Prima sin IGTF | Total a pagar | Campo autoritativo |
|---|---:|---:|---|
| Vida | 8,76 | **9,02** | `emit.policies[].policyPaymentData.cuota.mt_pendiente` |
| Accidentes | 30,97 | **31,90** | `emit.policies[].policyPaymentData.cuota.mt_pendiente` |
| Auto RCV | 45,00 | **46,35** | `emit.policies[].policyPaymentData.cuota.mt_pendiente` |

En las tres pólizas:

- `summary.policies[].paymentQuotes[0].amount` = prima sin IGTF;
- `emit.policies[].policyPaymentData.cuota.mt_pendiente_sin_igtf` = misma prima;
- `emit.policies[].policyPaymentData.cuota.mt_pendiente` = total con IGTF;
- el PDF muestra el mismo total.

La app no calcula IGTF: suma `mt_pendiente` de las pólizas pendientes. Para el carrito doble,
`31,90 + 9,02 = 40,92`.

La única pregunta funcional restante para IT es confirmar que el endpoint de notify espera el
**total con IGTF** (`mt_pendiente`) en `payment.amount` y `receipt.amount`. El funnel ya lo hace y
la petición llega hasta la resolución del `merchantId`.

---

## Fallo 2 — Funerario: `500-msQuoteError` / `ORA-01422`

### Síntoma

`POST shopcarts/{id}/emit` responde `200 { asyncEmissionId }`, pero el poll de
`GET shopcarts/{id}/emit` termina en `emission_error`. `GET shopcarts/errors?shopcartId=...`
registra:

```json
{
  "errorId": "500-msQuoteError",
  "extraData": "{\n  \"cause\": \"A quote error ocurred on the shopcart\",\n  \"data\": [\n    \"A quote error ocurred on the Vital Funerary Policy\",\n    \"Error generando la cotizacion.CALCULA_TASA_MUERTE_FUNERARIO: , EN  9 ** ORA-01422: exact fetch returns more than requested number of rows ~ proc CALCULA_TASA_MUERTE_FUNERARIO cot 6444683\"\n  ]\n}"
}
```

### Diagnóstico

Es un error PL/SQL del core de Mercantil en `CALCULA_TASA_MUERTE_FUNERARIO`:

```text
ORA-01422: exact fetch returns more than requested number of rows
```

La función espera una sola fila y el `SELECT` de tasas funerarias devuelve más de una. Esto apunta
a datos maestros duplicados para el producto/perfil o a una instalación incorrecta del paquete
PL/SQL de cotización.

### Reproducción

**6/6 intentos** con:

- producto `cm23o270j0924ujopcki7bxdo` (Servicio Funerario);
- plan `cm23o28er0cmbujopzlwht1w7`;
- cliente `V-12345679`, `clientId cmn9jvysl00jknt42y9z0ci2l`;
- nacimiento `1990-01-01`, género M.

Carritos con error:

- `cmug196g600zzo242u1ny8g1y` — intento 1;
- `cmug1c6c2011qo242vqhpv2qg` — intento 3, proc `cot 6444674`;
- `cmugvg6xo004pnu423amkr8rd` — reintento del 25/09 07:22 Vzla, proc `cot 6444680`;
- `cmugvymx7007pnu422jwg5jb3` — reintento del 25/09 07:35 Vzla, proc `cot 6444683`.

La emisión más reciente quedó persistida como:

- `status=emission_error`;
- `emissionProgress=0`;
- `errorId=500-msQuoteError`;
- `createdAt=2026-09-25T11:37:12.096Z`.

### Cotización sí funciona

Los tres planes de Funerario devuelven SA y prima sin error, tanto por cliente tentativo como por
el cliente existente:

| Plan | SA (USD) | Prima anual (USD) |
|---|---:|---:|
| `cm23o28er0cmbujopzlwht1w7` | 500 | 18,99 |
| `cm23o28er0cmcujop4pdw4u9v` | 1.000 | 34,02 |
| `cm23o28er0cmdujopncyjmdre` | 1.500 | 49,05 |

La API no tiene un paso de cuota independiente: `paymentQuotes` se genera al emitir. Como la
emisión Funerario falla, no se pueden obtener cuota/recibo ni alcanzar Paga para ese producto.

### Pedido a IT

Revisar en staging:

1. filas duplicadas en la tabla de tasas que alimenta `CALCULA_TASA_MUERTE_FUNERARIO` para el
   producto Funerario y el perfil de prueba;
2. filtros y versión instalada del paquete PL/SQL que ejecuta esa función;
3. reinstalación/actualización del paquete si procede.

Después de corregir, reintentar **solo Funerario**; no es necesario volver a emitir Auto, Vida o
Accidentes para validar este arreglo.

---

## Fallo 3 — `GET shopcarts/{id}/products` responde `403 Request not authorized`

### Síntoma

El listado de productos del carrito está bloqueado por el WAF de la API de Aliados:

```http
GET /shopcarts/cmugvxe1i006pnu427zipcd20/products
```

```json
{ "message": "Request not authorized (Forbidden)" }
```

### Alcance de la verificación

El `403` viene del upstream, no del proxy de la app:

- llamada directa a `https://imajev78v9.execute-api.us-east-2.amazonaws.com/ally-api` con la
  misma API key → `403` en 0,6 s;
- por el proxy local → `403` con `Cache-Control: no-store` (la petición sí sale de la
  allowlist y llega al upstream);
- en la misma sesión y con el mismo carrito, `GET shopcarts/{id}/summary`,
  `GET shopcarts/{id}/emit`, `GET payments/exchange-rate` y `GET health` responden `200`.

El equivalente `POST shopcarts/{id}/products` (agregar un producto) sí responde `200`, por lo que
el flujo de cotización y emisión no se ve afectado; solo la lectura del contenido del carrito
queda inutilizable.

### Pedido a IT

Revisar por qué el WAF bloquea el método `GET` sobre `shopcarts/{id}/products` para esta API key
(agregar la ruta a la lista de permitidos del WAF o del API Gateway). No es necesario para el
funnel del cliente, pero `scripts/verificacion/cotiza-funerario.mjs` usa esa ruta para confirmar los
productos agregados y hoy falla en ese paso.

---

## Lo que sí se corrigió del lado de la app

1. **Cotiza**
   - `countryId` enviado a planes tentativos.
   - Validación de email y fallback válido.
2. **Emite — dirección**
   - `postalCode` obligatorio y presente en `PUT clients/{id}/complete`.
3. **Emite — email**
   - El fallback `@jlcamejo.client` era rechazado con `ORA-20501`; ahora usa un dominio válido.
4. **Emite — Auto**
   - Nuevo upload obligatorio de título de propiedad (PNG/JPG/PDF, máximo 9 MB).
   - Validación de series de chasis y motor.
5. **Emite — async**
   - Polling extendido a 90 × 5 s porque el job multi-póliza tardó más de un minuto.
6. **Paga — monto**
   - `paymentQuotes[].amount` se trata como prima sin IGTF.
   - `mt_pendiente` se consume como total autoritativo y se precarga en el input.
   - Si falta un total, se bloquea la notificación.
7. **Paga — múltiples pólizas**
   - Una sola llamada con todas las pendientes y el total conjunto.
   - Las pólizas `isPaid` se excluyen.
   - Todas las referencias del POST se toman de `emit`; no se aceptan fallbacks del summary.
   - La UI bloquea Bs sin tasa, evita doble clic y conserva el pago aceptado hasta que el
     core refleje el pago.
8. **PDF**
   - La respuesta JSON base64 se decodifica y se sirve como PDF.
9. **Proxy**
   - Allowlist reducida a los endpoints usados por la app y los scripts, multipart crudo, PDF,
     origin-check para mutaciones y `Cache-Control: no-store` en JSON/PDF.
   - Las mutaciones ya no se reintentan solas ante error de red. Antes, un notify aceptado por el
     core pero con la respuesta perdida se reenviaba hasta tres veces y podía cobrar dos veces.
     Un `4xx` sigue siendo reintentable: el core rechazó y no aplicó el pago.
10. **Paga — no duplicar el cobro**
   - Los bloqueos locales son por `póliza#cuota`, no por póliza: en una póliza mensual, pagar la
     cuota 1 ya no oculta la cuota 2.
   - El `isPaid` explícito de `GET shopcarts/{id}/emit` manda sobre el `status` del summary, y
     `status: 'paid'` sólo se escribe cuando todas las cuotas de todas las pólizas quedaron
     pagadas.
   - Si la notificación falla por red o `5xx` (resultado desconocido), la cuota queda bloqueada
     como "Notificación en curso" y se reconcilia contra `emit`; no se reintenta a ciegas. El
     bloqueo se persiste en `sessionStorage`, así que sobrevive a un refresco.

---

## Verificación visual de Paga

El 25/09 se verificó la UI real con Microsoft Edge headless y el carrito doble
`cmugvxe1i006pnu427zipcd20`:

- número de pólizas: `2`;
- prima visible Accidentes: `30,97`;
- total visible Accidentes: `31,90`;
- prima visible Vida: `8,76`;
- total visible Vida: `9,02`;
- input de monto: `40,92`;
- POST de notify detectados: `0`.

Reproducir sin efectos secundarios:

```powershell
node scripts\verificacion\verificar-paga-ui.mjs `
  --cart cmugvxe1i006pnu427zipcd20 `
  --expected 40.92 `
  --policies 2 `
  --screenshot C:\ruta\evidencia\paga-doble.png
```

El script inyecta el estado antes de montar React, consulta el mismo endpoint que la UI y falla si
detecta cualquier POST a notify. No se requiere licencia ni paquete de navegador externo; usa Edge
o Chrome local.

---

## Seguridad del proxy `/api/mercantil`

### Riesgo

El proxy es público y suplica la API key del aliado desde el servidor. Antes de este cambio, las
mutaciones JSON no pasaban el origin-check de Astro 7, por lo que una URL desplegada podía permitir
crear clientes/carritos, emitir pólizas y notificar pagos.

### Mitigación aplicada

`POST`, `PUT` y `DELETE` ahora requieren `Sec-Fetch-Site: same-origin` o un `Origin` cuyo host
coincida con el del request. Los navegadores same-origin cumplen automáticamente; los scripts
deben enviar `Origin: http://localhost:4321`. La allowlist se redujo a los endpoints que usan el
funnel y los scripts de verificación; las respuestas JSON/PDF se envían con `Cache-Control: no-store`.

Esto es defensa en profundidad, no autenticación: un script puede falsificar el origen. Para
cerrarlo por completo se recomienda:

1. rate limiting en WAF/Vercel sobre `/api/mercantil/*`, con alertas por ráfagas de POST;
2. sesión/OTP y validación de sesión en el proxy;
3. rotación de la API key y restricción por ambiente;
4. auditoría de IPs y de llamadas fuera de la aplicación.

---

## Estado de las pruebas y pendientes

### Verificado

- Cotiza de los cuatro productos.
- Emisión y PDF de Auto, Vida y Accidentes.
- Montos sin/con IGTF para los tres productos.
- Emisión doble y una sola notificación con total conjunto.
- UI real de Paga en navegador: 2 pólizas, totales por póliza y monto `40,92` precargado.
- Diagnóstico persistente de Funerario.
- `npx tsc --noEmit` sin errores.
- `npm test`: 14/14 pruebas de reglas de pago.

### Bloqueado por Mercantil

- Confirmación del pago, simple y doble, hasta configurar `merchantId`.
- Emisión Funerario, hasta corregir `ORA-01422`.

### Pendiente del recorrido manual

- Ejecutar Cotiza → Emite con clics desde el inicio, especialmente el input/subida del título de
  propiedad de Auto. La parte Paga ya fue probada en la UI real usando un carrito emitido.

### Build local en Windows

`npm run build` genera `dist/` correctamente, pero `@astrojs/vercel` falla al final al crear un
symlink con `EPERM`. `.vercel/output` queda incompleto y no debe desplegarse con `--prebuilt`.
Desplegar desde código o ejecutar el build en un ambiente con soporte de symlinks. El adapter
también indica que Vercel usa Node 24, mientras el build local se ejecutó con Node 26.

---

## Scripts guardados

Desde la raíz:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\verificacion\reanudar.ps1
```

- `scripts/verificacion/reverificar.mjs`: salud, montos, carrito doble + notify y Funerario.
- `scripts/verificacion/verificar-paga-ui.mjs`: prueba visual sin notify.
- `scripts/verificacion/payment.test.mjs`: reglas de pago; ejecutar con `npm test`.
- `scripts/verificacion/todos-los-productos.mjs`: emite los cuatro productos.
- `scripts/verificacion/cotiza-funerario.mjs`: cotización Funerario.
- `scripts/verificacion/extraer-texto-pdf.mjs`: texto de los PDF de muestra.

`reanudar.ps1` crea datos de prueba cuando staging está disponible; usarlo repetidamente genera
pólizas adicionales.
