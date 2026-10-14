# Estado y plan — Funnel Cotiza → Emite → Paga (JLCamejo × Mercantil)

> **Revisión posterior del 25/09/2026:** consultar [informe actualizado](INFORME-REVISION-2026-09-25.md) y [borrador de correo](email-IT-Mercantil-2026-09-25.md). Las pruebas de emisión/notify descritas abajo son evidencia histórica. La revisión posterior fue de código, UI y lecturas de API; detectó pendientes propios de la app, por lo que la afirmación de que toda la app está corregida queda sustituida por el informe actualizado.


> **Última actualización: 25/09/2026**
> Objetivo: probar y dejar funcional el funnel completo contra el staging de Aliados de
> Mercantil Seguros, corrigiendo todo lo que esté del lado de la app.
> **Este directorio no es un repositorio Git: los cambios quedan sin commit.**

---

## 1. Cómo retomar en 30 segundos

Desde la raíz del proyecto:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\verificacion\reanudar.ps1
```

El script:

1. comprueba/levanta el dev server en `http://localhost:4321`;
2. consulta `/health` por el proxy y directo contra staging;
3. si staging responde, contrasta los tres montos conocidos;
4. crea y emite un carrito nuevo con Vida + Accidentes, espera hasta 90 × 5 s y hace **una**
   notificación por el total conjunto;
5. crea un carrito Funerario y confirma si IT ya corrigió el error de tasas.

> Importante: cuando staging está disponible, `reanudar.ps1` **crea dos pólizas de prueba y un
> intento Funerario**. No lo ejecutes repetidamente si no quieres emitir otra prueba.
>
> `reanudar.ps1` tarda hasta ~20 min: cada carrito se espera con 90 intentos ÷ 5 s y el notify
> dispara 12 intentos mús de acuse. Si hay que verificar algo sin tocar staging, usar
> `npm test` y `verificar-paga-ui.mjs`, que son de solo lectura.
>
> Si el proxy responde `403` a `GET /api/mercantil/__ping__` pero las rutas reales se quedan
> colgadas sin registrar nada en la consola de Astro, el pool de sockets del dev server se
> quedóo bloqueado tras una ráfaga de llamadas: reiniciar `npm run dev`.

Documento para IT: **`docs/mercantil-inconvenientes-IT.md`**.
PDFs de referencia: **`docs/ejemplos-pdf/`**.

---

## 2. Estado actual

| Flujo | Cotiza | Emite | PDF | Total/payload de Paga | Notify real |
|---|---|---|---|---|---|
| Auto RCV | ✅ | ✅ | ✅ | ✅ 46,35 | ❌ bloqueado por fallo 1 |
| Vida | ✅ | ✅ | ✅ | ✅ 9,02; doble UI ✅ 40,92 | ❌ bloqueado por fallo 1 |
| Accidentes Personales | ✅ | ✅ | ✅ | ✅ 31,90; doble UI ✅ 40,92 | ❌ bloqueado por fallo 1 |
| Servicio Funerario | ✅ | ❌ **fallo 2** | — | — | — |

La parte de la app que depende de staging está corregida y verificada. Permanecen dos
incidencias externas:

1. **`POST payments/notify-external-payment` → `404 allyMerchantId`**
   - Respuesta: `Merchant Id not found`.
   - El payload de una póliza y de un carrito de dos pólizas supera la validación del endpoint y
     llega hasta la búsqueda del comercio.
   - Ninguna póliza de la prueba quedó pagada.
   - IT debe configurar el `merchantId` del aliado JLC en el módulo de pagos de staging.

2. **Funerario: `500-msQuoteError` → `ORA-01422` en `CALCULA_TASA_MUERTE_FUNERARIO`**
   - El `SELECT` de tasas funerarias devuelve más de una fila.
   - Reproducido 6/6, incluido el reintento del 25/09 a las 07:35 Vzla.

### Incidencia transitoria de staging: recuperada

Entre aproximadamente 05:48 y 06:07 Vzla del 25/09, toda la API de Aliados respondió
`500 {"message":null}`, incluso `/health`. A las **07:21 Vzla** se recuperó: proxy y upstream
devolvieron `200` y la re-verificación completa volvió a emitir Vida y Accidentes.

Un health check correcto no garantiza que un job asíncrono ya haya terminado; por eso el polling
espera hasta 90 intentos de 5 s.

---

## 3. Contrato de montos descubierto en staging

La afirmación anterior de que `paymentQuotes[].amount` incluía IGTF era incorrecta. La evidencia
de las tres pólizas, el estado de emisión y los PDF da este contrato:

| Producto | Prima sin IGTF | Total con IGTF | Fuente del total |
|---|---:|---:|---|
| Vida | 8,76 | **9,02** | `policyPaymentData.cuota.mt_pendiente` |
| Accidentes | 30,97 | **31,90** | `policyPaymentData.cuota.mt_pendiente` |
| Auto RCV | 45,00 | **46,35** | `policyPaymentData.cuota.mt_pendiente` |

- `GET shopcarts/{id}/summary` → `policies[].paymentQuotes[0].amount` = **prima sin IGTF**.
- `GET shopcarts/{id}/emit` → `policies[].policyPaymentData.cuota.mt_pendiente` = **total a pagar**.
- `mt_pendiente_sin_igtf` confirma la prima en la misma respuesta del core.
- No se calcula IGTF localmente ni se redondea un porcentaje: la app consume el total autoritativo.

Para el carrito doble, `31,90 + 9,02 = 40,92`; ese monto se envía una sola vez para las dos pólizas.

---

## 4. Arreglos aplicados en la app

### `src/components/funnel/steps/CotizaStep.tsx`

- `countryId` en la consulta de planes tentativos (Venezuela).
- Validación de formato de email.

### `src/components/funnel/steps/EmiteStep.tsx`

- `postalCode` obligatorio en UI y en `PUT clients/{id}/complete`.
- Fallback de email válido: `fallbackClientEmail(dni)` → `V12345678@jlcamejo.com`.
- Validación de chasis `^[A-Z0-9]{17}$` y motor `^[A-Z0-9]{18}$`.
- Nuevo paso de título de propiedad para Auto:
  - fase `uploading-title`;
  - input de archivo PNG/JPG/PDF, máximo 9 MB;
  - `POST shopcarts/{id}/vehicle-property-title` antes de emitir.
- Polling de emisión extensible a **90 intentos × 5 s (7,5 min)**.

### `src/components/funnel/steps/PagaStep.tsx`

- Consulta `GET shopcarts/{id}/emit` al montar el paso y usa
  `policyPaymentData.cuota.mt_pendiente` como total autoritativo.
- Relaciona cada póliza por número normalizado y bloquea el pago si falta algún total o algúna
  referencia obligatoria de `emit`.
- Muestra por separado **prima sin IGTF** y **total a pagar**.
- Precarga `40,92` en el carrito doble sin necesidad de hacer clic en notify.
- Conserva una sola llamada de notificación con:
  - arreglo `policy` de todas las pólizas pendientes;
  - identificadores, recibo, convenio y cuota tomados **solo de `emit`**;
  - `payment.amount` y `receipt.amount` iguales a la suma de `mt_pendiente`.
- Selecciona la cuota pendiente real (`isNextDuePayment`) aunque no sea el primer elemento.
- Excluye pólizas pagadas según el core, el resumen o la aceptación local ya registrada.
  Un `isPaid: false` explícito de `emit` **manda sobre el resumen**: si no, en una póliza
  mensual con la cuota anterior pagada la vigente quedaba oculta para siempre.
- Bloquea Bs si no existe una tasa positiva y válida, y si el monto redondeado a centavos
  queda en `0` o en `Infinity` (`Infinity` se serializaría como `null` en el notify).
- Evita doble notificación con un guard sincrónico y, tras una aceptación, marca el resumen
  local como pagado para impedir reintentos mientras el core actualiza `isPaid`.
- Bloqueos por clave **`póliza#cuota`** (`PaymentLocks`), persistidos en `sessionStorage` por
  `Funnel.tsx` para que sobrevivan a un refresco:
  - `paid`: notificación aceptada.
  - `submitted`: notificación con resultado desconocido (red o 5xx). El core pudo aplicarla,
    así que **no se reintenta**; se reconcilia contra `GET shopcarts/{id}/emit` y la póliza
    queda con la insignia «Notificación en curso». Un 4xx sí es reintentable: el core rechazó.

### `src/lib/payment.ts`

- Funciones puras y compartidas por la UI y los scripts para seleccionar cuotas, asociar pólizas,
  calcular la suma de `mt_pendiente`, convertir a Bs y construir el payload de notify.
- `paymentQuoteKey()` + `pendingBalance()`: clave de bloqueo por póliza **y** cuota, y lectura
  explícita del saldo del core.
- `isPolicyPaid()` da prioridad al core (`isPaid`), luego al bloqueo local de ESA cuota, luego al
  resumen. Un `mt_pendiente <= 0` explícito significa «no hay nada pendiente», aunque el resumen
  todavía liste una cuota.
- `markSummaryPaid()` sólo escribe `status: 'paid'` cuando **todas** las cuotas de **todas** las
  pólizas quedaron pagadas; antes lo declaraba global y escondía las cuotas siguientes.
- `calculatePaymentAmount()` devuelve `null` si el total redondeado no es finito y positivo.
- Valida longitudes y presencia de `entity`, `area`, `number`, `certificate`, `receipt`, `agreement`
  y `quote` antes de enviar el POST.
- No usa campos del summary como fallback para referencias de notify.

### `src/lib/types.ts`

- Tipos para `EmitPaymentStatus`, `EmitPolicyPaymentData`, `EmitPolicyStatus` y `EmitStatus`.
- `mt_pendiente` y `mt_pendiente_sin_igtf` están tipados explícitamente.
- Los campos que OpenAPI no declara obligatorios se modelan como optional/nullable y se validan antes
  de construir notify.

### `src/lib/mercantil.ts`, `src/lib/api.ts`, `src/lib/config.ts`

- `mercantilFetch` acepta `rawBody` + `contentType` y `call()` soporta `FormData`.
- **Las mutaciones ya no se reintentan ante error de red.** `mercantilFetch` sólo reintenta
  métodos idempotentes (`GET`/`HEAD`); un POST/PUT devuelve `502` en el primer fallo. El 403 del
  WAF sigue siendo reintentable en cualquier método porque bloquea antes de llegar a la
  aplicación. Sin esto, un notifyaccepted por el core pero con respuesta perdida se reenviaba
  y podía cobrar dos veces.
- `api.uploadVehicleTitle()`.
- `countryId` en `tentativePlans`.
- `EMAIL_REGEX` y `fallbackClientEmail`.
- `postalCode` requerido y `VehicleTitleUploadResponse`.

### `src/pages/api/mercantil/[...path].ts`

- Allowlist reducida a los endpoints que usan el funnel y los scripts de verificación, incluido el
  upload multipart de título de propiedad; las rutas GET públicas no usadas responden `403`.
- Multipart reenviado crudo con `request.arrayBuffer()`.
- Todas las respuestas JSON y el PDF incluyen `Cache-Control: no-store` para no persistir datos
  monetarios o identificadores de póliza en caches intermedias.
- PDF JSON `{ pdfName, pdfBase64 }` decodificado y servido como `application/pdf`.
- Origen obligatorio en POST/PUT/DELETE (mutaciones).
- `GET shopcarts/{id}/products` esta en la allowlist y llega al upstream, pero **el WAF de
  Mercantil responde `403 {"message":"Request not authorized (Forbidden)"}`** mientras
  `summary`, `emit`, `exchange-rate` y `health` responden `200`. No es un problema del proxy:
  se verifico tambien con llamada directa a la API. `cotiza-funerario.mjs` usa esa ruta, asi que
  ese paso falla hoy; pendiente de IT.

---

## 5. Evidencia más reciente

### Carrito doble emitido y probado en la UI

- Carrito: `cmugvxe1i006pnu427zipcd20`
- Estado: `emitted`, progreso `100`
- Accidentes: `1-1-177311`, prima `30,97`, total `31,90`, recibo `6376294`
- Vida: `1-50-230273`, prima `8,76`, total `9,02`, recibo `6376293`
- Total conjunto: **40,92**
- Ambas siguen `isPaid=false` porque notify devuelve `404 allyMerchantId`.

Prueba visual headless sobre la UI real:

```powershell
node scripts\verificacion\verificar-paga-ui.mjs `
  --cart cmugvxe1i006pnu427zipcd20 `
  --expected 40.92 `
  --policies 2 `
  --screenshot C:\ruta\evidencia\paga-doble.png
```

Resultado: OK

- `Prima sin IGTF`: `30,97 + 8,76`.
- `Total a pagar`: `31,90 + 9,02`.
- Input `Monto pagado`: `40,92`.
- Número de pólizas: `2`.
- POST a `notify-external-payment`: **0**.

El script inyecta el estado antes de que React monte, no pulsa el botón y falla si detecta un POST
de notify. La captura usada en esta sesión quedó fuera del repositorio, en
`C:\Users\granj\AppData\Local\Temp\opencode\paga-doble-refactor-cmuGvxe1i006pnu427zipcd20.png`.

### Notify simple y doble

- Simple Vida: `9,02` → `404 allyMerchantId`.
- Doble Vida + Accidentes: reiterado el 25/09 con el carrito `cmugvxe1i006pnu427zipcd20`;
  una llamada, dos objetos `policy`, `40,92` → mismo `404`.
- Ninguna de las dos pólizas quedó pagada.
- No se volvió a llamar notify durante la prueba visual.

### Funerario

- Carrito del reintento más reciente: `cmugvymx7007pnu422jwg5jb3`
- `GET emit`: `emission_error`, progreso `0`
- Error persistido: `500-msQuoteError`
- Detalle: `ORA-01422 ... CALCULA_TASA_MUERTE_FUNERARIO ... cot 6444683`
- Creado: `2026-09-25T11:37:12.096Z`

---

## 6. Datos de prueba

- **API**: `https://imajev78v9.execute-api.us-east-2.amazonaws.com/ally-api` (key en `.env`).
- **Canal**: `cms6dz7170n84pc43oeg44aym`.
- **allyId**: `cms6dx8it0n7cpc43zsnt76sr`.
- **Cliente**: `V-12345679`, nacimiento `1990-01-01`, género M.
- **clientId**: `cmn9jvysl00jknt42y9z0ci2l`.
- **Email**: `V12345679@jlcamejo.com`.
- **Dirección**:
  - estado `cly4l6gsa005xlfmv2fwdv4w9`;
  - municipio `cmltprr7704minz43acgq5yp8`;
  - localidad `cly4l6i0o0719lfmvjwf4o70g`;
  - código postal `1020`.
- **Planes**:
  - Vida `cm23o28er0cmjujopinj1qg47` — prima 8,76;
  - Accidentes `cm23o28er0cm8ujopdlgqxb20` — prima 30,97;
  - Funerario `cm23o28er0cmbujopzlwht1w7` — prima 18,99;
  - Auto RCV `cm6gt3ow10dcanv3n6rztthx3`.
- **Auto de prueba**:
  - 2021, ACURA `001`, ILX `028`, versión `05`;
  - `typeId/tariffId 1`, color `2`, `commonLocationId "1"`;
  - chasis `JHMFA16586S012345`;
  - motor `1NZ123456789123456`;
  - placa `AZ87Z81`.
- **Tasa BCV observada**: 801,18 Bs/USD.

Carritos con PDF en `docs/ejemplos-pdf/`:

- Auto `cmug17qsc00yeo242kt24dnla` → `1-32-74388`.
- Vida `cmug189z300z3o242mv5v0ri1` → `1-50-230270`.
- Accidentes `cmug18qby00zjo242jh6h3qyw` → `1-1-177308`.

Carritos adicionales de la re-verificación:

- Doble `cmugv2sb6000mnu42utmv0stu` → Vida `230271`, Accidentes `177309`.
- Doble `cmugvxe1i006pnu427zipcd20` → Vida `230273`, Accidentes `177311`.
- Funerario fallido `cmugvymx7007pnu422jwg5jb3`.

---

## 7. Scripts reproducibles

Todos están bajo `scripts/verificacion/`:

- `reanudar.ps1` — wrapper de reanudación y re-verificación integral.
- `reverificar.mjs` — salud, montos, carrito doble + notify y Funerario.
- `verificar-paga-ui.mjs` — prueba visual de Paga con Edge/Chrome, sin efectos de pago.
- `payment.test.mjs` — pruebas unitarias de cuotas, pagado, payload, total, Bs y estado local.
- `todos-los-productos.mjs` — emite los cuatro productos y registra sus errores.
- `cotiza-funerario.mjs` — cotización Funerario para cliente tentativo/existente.
- `extraer-texto-pdf.mjs` — extracción de texto de los PDF de muestra.

Los POST/PUT de prueba deben enviar `Origin: http://localhost:4321`. Los GET no lo requieren.
El proxy rechaza rutas fuera de la allowlist, lo que permite comprobar que el dev server está vivo
sin confundir una caída del upstream con una caída local. Los scripts que importan las reglas
TypeScript de `src/lib/payment.ts` requieren Node 24 o superior.

---

## 8. Validación local

| Comprobación | Resultado |
|---|---|
| `npx tsc --noEmit` | ✅ exit 0 |
| `npm test` | ✅ 14/14 pruebas de reglas de pago |
| `node --check` de scripts | ✅ `payment.test.mjs`, `reverificar.mjs`, `verificar-paga-ui.mjs` |
| `verificar-paga-ui.mjs` con carrito doble | ✅ 2 pólizas, 31,90 + 9,02 = 40,92, 0 notify |
| Rutas GET por el proxy | ✅ `summary`/`emit`/`exchange-rate`/`health` 200 + `no-store`; `GET shopcarts/{id}/products` 403 del WAF |
| `npm run build` | ⚠️ app compilada; hook Vercel falla al final |

> `reverificar.mjs` **no se volvió a ejecutar** después de estos cambios: vuelve a emitir carritos y
> a llamar `notify`, y ambos están en pausa hasta que IT confirme los arreglos. La validación de
> esta sección es local y de solo lectura. Cuando IT responda, ejecutarlo una vez y revisar el
> código de salida: ahora `reverificar.mjs` acumula los fallos y termina con `process.exitCode = 1`
> si algún monto, emisión, notify o acuse no cuadra. Antes salía con 0 aunque todo estuviera mal.

El build de Astro genera `dist/` correctamente, pero `@astrojs/vercel` falla en Windows al crear
un symlink dentro de `.vercel/output`:

```text
EPERM: operation not permitted, symlink ... node_modules/react
```

`.vercel/output/functions/_render.func/node_modules` queda vacío. **No desplegar con
`--prebuilt` desde ese output.** Opciones:

- habilitar Windows Developer Mode o ejecutar el build con permisos suficientes;
- compilar en WSL/Linux/CI;
- desplegar desde el código y dejar que Vercel construya en sus servidores.

Astro también advierte que Node local 26 no es el runtime soportado por Vercel; el adapter usará
Node 24. Para builds locales es preferible Node 24.

---

## 9. Seguridad del proxy

El proxy es público y suplica la API key del aliado desde el servidor. Astro 7 no aplicaba su
origin-check a JSON, por lo que se añadió una comprobación explícita:

| Petición | Resultado |
|---|---|
| POST sin `Origin` | `403 Origen no permitido` |
| POST con `Origin` ajeno | `403 Origen no permitido` |
| POST same-origin | pasa al upstream |
| GET monetario | `Cache-Control: no-store` |
| GET fuera de allowlist | `403 Recurso no permitido` |

Esto es defensa en profundidad, no autenticación: un script puede falsificar `Origin`. Para cerrar
el riesgo se recomienda rate limiting en WAF/Vercel, sesión/OTP, rotación/restricción de la API key
y auditoría de IPs. Detalle en `docs/mercantil-inconvenientes-IT.md`.

---

## 10. Pendientes, en orden

1. **IT:** configurar el `merchantId` de `cms6dx8it0n7cpc43zsnt76sr` y reintentar notify simple y doble.
2. **IT:** corregir datos/paquete de `CALCULA_TASA_MUERTE_FUNERARIO`; reintentar solo Funerario.
3. **IT:** habilitar `GET shopcarts/{id}/products`, que hoy responde `403 Request not authorized`
   desde el WAF. `cotiza-funerario.mjs` depende de esa ruta.
4. Recorrer con clics la UI completa desde Cotiza hasta Emite, en especial el upload de título de Auto.
5. Definir mitigaciones de seguridad del proxy.
6. Resolver el build de symlinks en Windows o desplegar desde código; nunca usar el output Vercel incompleto.
7. Cuando IT cierre ambos fallos, repetir únicamente los flujos afectados, evitando crear más pólizas sin necesidad.
