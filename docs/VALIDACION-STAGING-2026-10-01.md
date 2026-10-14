# Validación de aceptación de staging — 1 de octubre de 2026

## Alcance

El funnel de pruebas de JLCamejo sigue tres pasos: **Cotiza → Emite → Paga**.
Cotiza obtiene las opciones disponibles para el perfil; Emite crea la póliza de
forma asíncrona; Paga muestra el resumen y abre el checkout hospedado que Mercantil
devuelve en `paymentUrl`. La prueba no ejecuta cobros ni usa
`payments/notify-external-payment`.

## Productos emitidos en staging

| Producto | Resultado | Carrito de referencia |
| --- | --- | --- |
| RCV Básica | Emitido | `cmug17qsc00yeo242kt24dnla` |
| RCV Plus | Emitido | `cmuod4qy700jmpc43dhnyjf5m` |
| Vida | Emitido | `cmug189z300z3o242mv5v0ri1` |
| Accidentes Personales | Emitido | `cmug18qby00zjo242jh6h3qyw` |
| Renta por Hospitalización | Emitido | `cmuocys4r00ifpc43ykmtvy36` |
| Pago Único por Cáncer | Emitido | `cmuocwh9600hfpc43iyqgykqa` |
| Servicio Funerario | Emitido con perfil alternativo | `cmuoe0sb400m9pc439ikyc6mt` |

El perfil histórico de Funerario `V-12345679`, masculino, nacido el 1990-01-01,
continúa devolviendo `ORA-01422` en `CALCULA_TASA_MUERTE_FUNERARIO`. El perfil
alternativo `V-12345681`, femenino, nacido el 1985-06-15, emitió correctamente.
La aplicación conserva el carrito fallido y muestra su error sin reemitirlo de
forma automática.

## Comportamiento de pago

- El total pendiente se lee del estado de emisión (`mt_pendiente`); se muestra como
  referencia, incluyendo IGTF cuando el core lo informa.
- El cliente selecciona método y moneda dentro de la plataforma Mercantil.
- El botón **Ir a pagar en Mercantil** redirige únicamente al `paymentUrl` HTTPS
  entregado por el summary del carrito.
- No se solicitan tarjeta, aprobación, nombre de pagador, moneda ni monto en la
  aplicación JLCamejo.
- Si el enlace no aparece, la pantalla permite actualizar el summary; si persiste,
  se debe compartir el identificador del carrito con Mercantil.

## Guion para JAR

1. Seleccionar Auto o Protección Vital y completar los datos de cotización.
2. Elegir un plan disponible; en Auto comprobar que aparecen RCV Básica y RCV Plus.
   La frecuencia de prueba habilitada es anual.
3. En Emite completar identidad, dirección, declaraciones y, para Auto, vehículo y
   título de propiedad.
4. Esperar `emitted`; verificar las pólizas y los importes mostrados.
5. En Paga verificar que no se piden datos bancarios y que el botón dirige a
   `paymentUrl` de Mercantil. No completar el cobro para esta validación.
6. Regresar o recargar y comprobar que el carrito emitido se recupera sin crear
   otra póliza.

## Verificaciones locales

- `node node_modules/typescript/bin/tsc --noEmit`
- `npm test` — 23 pruebas aprobadas.
- `npm run build` — la compilación Astro completa; en Windows el empaquetado final
  del adaptador Vercel puede requerir un entorno con soporte de symlinks. Vercel debe
  desplegar desde el repositorio con Node 24, no desde un output local incompleto.

## Nota de disponibilidad de staging

Durante la comprobación visual final del checkout, `GET /health` y la lectura del
carrito de evidencia devolvieron HTTP 500 con cuerpo nulo desde Mercantil. Por ello
no se generó una captura final contra staging en ese momento. Cuando health vuelva a
HTTP 200, repetir el paso 5 del guion con un carrito emitido; no es necesario crear
ni pagar otra póliza.

## Pendientes antes de producción

- Confirmación de Mercantil sobre vigencia del `paymentUrl`, callback/retorno y
  política de carritos emitidos sin pago.
- Matriz definitiva de elegibilidad y frecuencias por producto/plan.
- Resolución del perfil histórico de Funerario si ese perfil debe ser elegible.
- Revisión comercial, legal y de seguridad propia antes de procesar clientes reales.
