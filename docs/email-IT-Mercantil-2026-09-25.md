# Correo para IT de Mercantil

**Asunto:** JLCamejo — confirmación de checkout Mercantil, Funerario y datos Auto en staging

Estimado equipo de IT de Mercantil Seguros:

Gracias por la confirmación sobre el uso de la plataforma de pagos Mercantil. Ajustaremos el flujo de JLCamejo para usar exclusivamente el `paymentUrl` que devuelve el resumen del carrito; por tanto, no invocaremos `payments/notify-external-payment` ni requerimos configuración de `Merchant ID` para este flujo.

Validamos nuevamente en staging el carrito `cmugvxe1i006pnu427zipcd20`: permanece emitido, con dos cuotas pendientes de 31,90 y 9,02 USD, y su resumen incluye un `paymentUrl` HTTPS hacia la plataforma de pago Mercantil.

Para cerrar la integración, agradecemos confirmar los siguientes puntos:

**1. Checkout y confirmación del pago**

La validación funcional de JLCamejo se estructura en tres pasos: **Cotiza → Emite → Paga**. En Paga comprobaremos que el resumen entregue el `paymentUrl` y que el cliente pueda continuar a la plataforma Mercantil con las primas emitidas. Para esta validación no es necesario ejecutar ni confirmar un cobro efectivo; su aprobación o rechazo es gestionado por la plataforma de pago.

Nuestro flujo mostrará la moneda elegida por el cliente. Para USD se utilizará el total pendiente informado por la emisión; para bolívares se convertirá ese monto usando la tasa obtenida en `payments/exchange-rate` al momento de iniciar el pago.

Por favor confirmar:

- Vigencia del `paymentUrl` y si puede abrirse más de una vez sin crear cobros duplicados.
- Ruta de retorno del checkout, callback o webhook disponible, autenticación o firma de la notificación y mecanismo de consulta si el navegador se cierra o recarga.
- Estado o campo exacto que confirma el pago y la activación de cobertura, considerando que primero se emite la póliza y luego se realiza el cobro.
- Regla de tasa, redondeo e IGTF aplicable cuando el cliente selecciona bolívares, incluido cuándo debe refrescarse la tasa.
- Tratamiento de un carrito emitido que queda sin pago: vigencia, cancelación o recuperación y criterio para iniciar un nuevo intento sin duplicar pólizas.

**2. Servicio Funerario**

El carrito histórico `cmugvymx7007pnu422jwg5jb3` continúa en `emission_error`. Compartimos los datos exactos de reproducción solicitados:

- Asegurado de prueba: documento `V-12345679`; nacimiento `1990-01-01`; género `M`; `clientId` `cmn9jvysl00jknt42y9z0ci2l`.
- Canal: `cms6dz7170n84pc43oeg44aym`; aliado: `cms6dx8it0n7cpc43zsnt76sr`.
- Producto Servicio Funerario: `cm23o270j0924ujopcki7bxdo`; plan: `cm23o28er0cmbujopzlwht1w7`; suma asegurada 500 USD; prima anual 18,99 USD.
- Emisión: frecuencia `yearly`; `sendEmailConfirmation: true`; `isHolderThePayee: true`; `holderAcceptedTermsAndConditions: true`; `isHolderNotPoliticallyExposed: true`; `holderEnjoysGoodHealth: true`.
- Resultado: `status=emission_error`, `emissionProgress=0`, `errorId=500-msQuoteError`, creado el `2026-09-25T11:37:12.096Z`.
- Detalle del core: `ORA-01422: exact fetch returns more than requested number of rows`, en `CALCULA_TASA_MUERTE_FUNERARIO`, cotización `6444683`.

La secuencia fue crear el carrito, agregar ese producto/plan, ejecutar `POST shopcarts/{id}/emit` y consultar `GET shopcarts/{id}/emit` y `GET shopcarts/errors?shopcartId=...`. La cotización previa del producto sí devolvió prima; el fallo histórico ocurre durante la emisión, antes de generar cuotas o de llegar a Paga.

También repetimos hoy la emisión con un perfil distinto y el mismo producto/plan:

- Asegurado de prueba: documento `V-12345681`; nacimiento `1985-06-15`; género `F`; `clientId` `cmuodzr1l00lcpc43wovtz5rp`.
- Carrito: `cmuoe0sb400m9pc439ikyc6mt`; frecuencia `yearly`; términos, no PEP, buena salud y titular pagador en `true`; confirmación de correo en `false`.
- Resultado: `status=emitted`, `emissionProgress=100`; póliza `1-42-147168`; recibo `6376338`; suma asegurada 500 USD; prima 18,99 USD; total pendiente 19,56 USD.

Por tanto, Funerario sí emite para este segundo perfil. Agradecemos validar por qué el perfil histórico masculino, nacido el `1990-01-01`, reproduce `ORA-01422`, para confirmar si la causa depende de los datos de elegibilidad/tarifa y no de la disponibilidad general del producto.

**3. Datos de vehículo Auto verificados**

Revisamos la estructura compartida y ejecutamos una prueba controlada en staging, sin emitir póliza, cargar título de propiedad ni realizar pago. El carrito de prueba fue `cmuoc5rvm00c0pc43n19e58gy`; tanto la incorporación de Auto RCV como `complete-vehicle-info` respondieron HTTP 200.

El payload aceptado contiene:

- `year`, `brand`, `model` y `version`: datos/códigos de la selección previa del vehículo.
- `commonLocationId`: ID del estado donde circula.
- `isArmored`: booleano que indica si el vehículo está blindado.
- `plate`: placa.
- `colorId`: ID de color del catálogo.
- `chassisSerial`: serial del chasis.
- `engineSerial`: serial del motor.

En la prueba se usaron los valores de catálogo 2021 / marca `001` / modelo `028` / versión `05`, estado `1`, color `2`, placa `AZ87Z81`, chasis `JHMFA16586S012345` y motor `1NZ123456789123456`.

Por favor compartir el enlace o versión vigente del Swagger/OpenAPI aplicable a este aliado y ambiente, con las longitudes, formatos y demás campos obligatorios definitivos. También agradeceremos confirmar formatos y tamaño máximo del título de propiedad, además de los términos, condiciones y manejo de declaraciones de salud/PEP que requieren atención asistida.

**4. Productos adicionales verificados en staging**

Consultamos los catálogos del aliado y ejecutamos una emisión controlada anual por producto, sin abrir ni ejecutar pagos. Los tres productos están disponibles y las emisiones concluyeron en estado `emitted`:

| Producto | `productId` | Plan probado | Carrito emitido |
| --- | --- | --- | --- |
| Responsabilidad Civil Vehicular Plus | `cm6gt3msg09oonv3nf1mlb0bw` | `cm6gt3owc0dcgnv3nikytsgb7` — suma asegurada 5.000, prima 100 | `cmuod4qy700jmpc43dhnyjf5m` |
| Renta por Hospitalización | `cm23o270j0923ujop8tjgv0pl` | `cm23o28er0cmoujopm07ohxdo` — suma asegurada 100, prima 145,08 | `cmuocys4r00ifpc43ykmtvy36` |
| Pago Único por Cáncer | `cm23o270j0921ujophujfkgit` | `cm23o28er0cmfujop1g3fwpkm` — suma asegurada 2.000, prima 3,90 | `cmuocwh9600hfpc43iyqgykqa` |

El catálogo también devolvió estos planes:

- Renta por Hospitalización: `cm23o28er0cmoujopm07ohxdo` (100 / 145,08), `cm23o28er0cmpujop6ccc306k` (150 / 217,62) y `cm23o28es0cmqujopyonfoqk0` (250 / 362,71).
- Pago Único por Cáncer: `cm23o28er0cmfujop1g3fwpkm` (2.000 / 3,90), `cm23o28er0cmhujopojgjzblz` (5.000 / 9,75) y `cm23o28er0cmiujopb2dv0z6g` (10.000 / 19,50).

Para el perfil de prueba del catálogo, las reglas devueltas para Cáncer y Hospitalización indican Venezuela, género femenino y edad de 18 a 40 años. Por favor confirmar la matriz completa de elegibilidad, campos obligatorios y frecuencias de pago habilitadas por producto/plan antes de incorporarlos al funnel.

Quedamos atentos a la información para completar la validación del flujo Cotiza → Emite → Paga en staging.

Saludos cordiales,

José Luis Camejo Leal  
JLCamejo · Corredor de la Actividad Aseguradora  
CAA-002563 · RIF V-10387044-1

---

Nota interna: borrador no enviado. No incluir token de `paymentUrl`, API keys ni documentos/datos personales del asegurado en correos ordinarios.
