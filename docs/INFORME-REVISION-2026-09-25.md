# Revisión del funnel JLCamejo y propuesta de compra guiada

Fecha: 25 de septiembre de 2026. Revisión del código disponible en `C:/Herd/jlcamejo-funnel`.

## Conclusión

La experiencia debe empezar por lo que el cliente quiere proteger y pedir los datos por etapas. Se implementó una entrada tipo quiz: RCV o Vital; en RCV, año → marca → modelo → versión; en Vital, Vida / Accidentes / Funerario → frecuencia preferida → datos para cotizar. El objetivo es elegir un seguro principal con pocas decisiones, conservando el motor de emisión y los cálculos existentes.

La aplicación todavía no está lista para una compra autónoma en producción. El formulario actual de pago notifica una operación externa: no cobra una tarjeta ni inicia una transferencia. Además de las incidencias de Mercantil, quedan trabajo de autenticación, confirmación de pagos y recuperación durable de operaciones. No debe interpretarse el anterior “todo lo de la app está corregido” como una certificación de producción.

## Qué se verificó en esta revisión

Se revisaron `docs/ESTADO-Y-PLAN.md`, `docs/mercantil-inconvenientes-IT.md`, el cliente de API, el proxy, los tres pasos y las pruebas de pagos. Los documentos previos se trataron como evidencia histórica, no como instrucciones para emitir o pagar. No hay repositorio Git: no es posible atribuir cambios a un agente mediante commits ni producir una comparación histórica fiable.

| Comprobación actual | Resultado |
| --- | --- |
| TypeScript: `node node_modules/typescript/bin/tsc --noEmit` | Sin errores |
| `node --test scripts/verificacion/payment.test.mjs` | 14/14 pasan |
| GET health | HTTP 200 |
| GET payments/exchange-rate | HTTP 200; no se afirma vigencia comercial de la tasa sin validar su fecha |
| GET emit del carrito doble documentado | HTTP 200, `emitted`; totales 31,90 + 9,02 = 40,92 |
| GET summary del mismo carrito | HTTP 200, frecuencia `yearly`; incluye `paymentUrl` HTTPS hacia `www2.pagamercantil.com/bdp_front/` (token omitido) |
| GET emit del carrito Funerario documentado | HTTP 200, `emission_error` |
| GET products del carrito doble | HTTP 403, `Request not authorized (Forbidden)` |
| Navegador | Entrada quiz, selección Vida, cuatro frecuencias, selección trimestral conservada, error de datos vacíos y RCV año → carga de marcas |
| Diseño | Inspección visual en escritorio y 390 px; corregido desbordamiento del indicador de pasos |
| Build Astro/Vercel | Compila la aplicación; falla empaquetado Vercel con EPERM al crear symlink de React |

No se crearon clientes, carritos, pólizas ni pagos en esta revisión. No se volvió a ejecutar notify. El `404 allyMerchantId` procede de la evidencia anterior, no de una nueva prueba. El estado Funerario consultado pertenece a un carrito ya fallido: por sí solo no demuestra que un intento nuevo fallaría hoy. No se hizo un recorrido completo de emisión ni una carga real de título de propiedad.

El comando `npx` de esta máquina falla por una instalación global de npm incompleta; por eso se invocaron directamente los ejecutables locales. Node local 26 produce aviso porque Vercel selecciona Node 24. El output `.vercel/output` no es un artefacto de despliegue válido tras EPERM.

## Cambios aplicados

- Quiz con dos rutas. RCV descubre progresivamente los selectores; Vital filtra el catálogo por el producto solicitado y pregunta la frecuencia antes de la identidad. No se recomienda automáticamente una cobertura a partir de datos sensibles.
- Frecuencia elegida compartida con Emite y persistida en la sesión. Los consentimientos no se guardan como aceptados.
- Logo original incorporado; marino `#103550`, turquesa `#16a7ad` y verde `#47ad43`, con tonos más oscuros para botones/texto legible. Favicon alineado.
- Corrección de columnas Tailwind con sintaxis inválida; resumen contrastado, etiquetas asociadas a controles, foco visible, tamaños de campos para móvil, movimiento reducido y pasos legibles en pantallas pequeñas.
- Se quitaron “sin papeleo / en minutos” y referencias técnicas del formulario de pago. El cliente sabe que registra un pago ya realizado.
- Eliminado el generador de correo ficticio y el teléfono `0000000` en el flujo de clientes. Se piden correo y teléfono reales cuando hay que crear/completar el perfil.
- Los cambios de identidad invalidan la cotización Vital; los cambios de vehículo invalidan su plan. Se bloquean cambios durante consultas para evitar resultados fuera de orden. Se recuperan catálogos de vehículo al recargar.
- Fecha futura rechazada; errores de validación visibles antes de emitir. Cambio de estado de residencia limpia municipio/localidad.
- Declaración de salud sin aceptación predeterminada. Las reglas de elegibilidad definitivas corresponden al proveedor.
- Emisión protegida ante doble clic. Con carrito conocido, el botón consulta el estado en vez de crear otro; si está emitido/pagado recupera el resumen. Un carrito fallido o incompleto se deriva a revisión asistida, sin reemitir a ciegas.
- Retorno desde Paga a una emisión ya completada conserva una salida para continuar.
- PDF ausente en una respuesta upstream 2xx se convierte en error 502; validación de Origin compara origen completo en su rama de comprobación.

## Lo que hizo bien la implementación anterior

Las pruebas de pagos sostienen reglas útiles: referencias desde `emit`, exclusión de cuotas pagadas, suma de `mt_pendiente`, bloqueo si falta un total, tratamiento de tasa inválida y claves por póliza/cuota. También están presentes la subida multipart del título, decodificación del PDF y ausencia de reintentos de mutaciones ante errores de red.

Estas pruebas son de reglas locales. No certifican conciliación bancaria, idempotencia del servidor, control de acceso ni aceptación comercial de todos los payloads.

## Datos del quiz y correspondencia con API

| Etapa | Qué pregunta el cliente | Qué usa la integración |
| --- | --- | --- |
| Intención | RCV o Vital; qué protección Vital desea | Filtra producto; todavía no crea cliente |
| Vehículo | Año, marca, modelo, versión | GET vehicle-information en cascada; códigos de catálogo, typeId/tariffId; GET auto-products/plans/client |
| Frecuencia Vital | Mensual / cada 3 meses / cada 6 meses / anual | `paymentFrequency`: `monthly`, `quarterly`, `biannual`, `yearly` en POST emit |
| Cotización | Documento/nacionalidad, nacimiento, género | GET clients/exists; planes de cliente o tentative-client; país configurado como Venezuela (29) |
| Perfil, si hace falta | Nombre, apellido, correo, teléfono, nacimiento, estado civil y dirección | POST clients y PUT clients/{id}/complete; dirección con estado, municipio, localidad, código postal y address1 |
| Auto antes de emitir | Placa, color, circulación, blindaje, chasis, motor, título | complete-vehicle-info; vehicle-property-title multipart |
| Revisión | Plan, prima, frecuencia, declaraciones y consentimiento | POST shopcarts, products y emit; consulta asíncrona del mismo carrito |
| Pago | Importe confirmado, canal autorizado y confirmación | summary/emit; hoy el formulario usa notify-external-payment |
| Entrega | Estado confirmado y descarga | Estado del core y PDF por póliza |

Las cuatro frecuencias están en los tipos y constantes del proyecto; no se encontró una especificación OpenAPI versionada en `docs`. La búsqueda pública no permitió certificar una matriz oficial de frecuencias para estos productos/canal. Se presentan como preferencias sujetas a confirmación, no como cuatro modalidades garantizadas para todo producto. Las pruebas históricas revisadas y el carrito leído corresponden a pago anual. IT debe validar mensual, trimestral y semestral y aportar un endpoint de cotización por frecuencia si existe.

No se divide la prima anual entre 12, 4 o 2 para mostrar cuotas: fraccionamiento, impuestos, redondeos y condiciones deben venir del proveedor. El contrato de vehículo actual exige chasis de 17 y motor de 18 caracteres, PNG/JPG/PDF hasta 9 MB; debe contrastarse con OpenAPI vigente y las limitaciones efectivas del hosting antes del lanzamiento.

## Experiencia propuesta para cerrar la compra

1. Entrada por campaña: permitir entrar directamente a RCV o Vital en una siguiente iteración, conservando la opción de cambiar.
2. Quiz corto según intención. Ya implementado el inicio; las pantallas de identidad y emisión aún agrupan varios campos.
3. Planes con cobertura, exclusiones y límites legibles; prima claramente distinguida de la cuota final. La descripción de catálogo no sustituye las condiciones contractuales.
4. Revisión previa a emitir: identidad, plan, frecuencia, monto y documentos contractuales accesibles. Si el importe definitivo solo existe después de emitir, Mercantil debe confirmar cómo se comunica y cancela una operación no aceptada.
5. Pago por enlace/pasarela del proveedor si `paymentUrl` es el canal soportado; evitar pedir al comprador códigos de aprobación como sustituto de un checkout. La URL existe en el summary revisado y apunta a `www2.pagamercantil.com`, pero su contrato, vigencia y estados deben verificarse con IT antes de integrarla como CTA.
6. Retorno de pasarela y confirmación servidor a servidor. Mostrar “pendiente de confirmación” hasta reconciliar; después, póliza, recibo y siguiente cuota.

## Pendientes prioritarios y responsables

| Prioridad | Responsable | Pendiente |
| --- | --- | --- |
| Alta | Mercantil | Merchant ID: diagnosticar el 404 histórico; no asumir que un 404 demuestra validación financiera completa |
| Alta | Mercantil | Funerario: revisar ORA-01422 reportado; una duplicidad de tasas es hipótesis, no causa probada sin acceso al core |
| Alta | Mercantil + JLC | Contrato de paymentUrl/pasarela, callback/webhook, firma, conciliación e idempotencia de notify |
| Alta | JLC | Sesión/OTP y autorización de recursos por propietario; el proxy actual es público y el Origin es falsificable fuera del navegador |
| Alta | JLC + Mercantil | Estado durable de operaciones y recuperación entre dispositivos; sessionStorage no sustituye idempotencia del backend |
| Alta | JLC | Términos/privacidad reales, documentos contractuales y ruta asistida de excepciones. El checkbox actual carece de enlace a términos |
| Media | Mercantil | Frecuencias por producto, montos/cuotas/IGTF por moneda, momento de activación de cobertura y cancelación de no pagadas |
| Media | Mercantil | Investigar GET products 403; atribución exacta a WAF/Gateway/permisos pendiente de logs del proveedor |
| Media | JLC | Recuperar carritos incompletos/fallidos con una política explícita; actualmente quedan en consulta/asistencia para evitar duplicados |
| Media | JLC | Prueba completa de Auto/título y revisión del límite de upload del hosting frente a los 9 MB del frontend |
| Media | JLC | Construcción en Node 24 / entorno con symlinks; inicializar Git y una base de cambios revisable |

Otros límites observados: años de vehículo 1990–año actual codificados localmente; país por defecto fijo; borradores con datos personales en sessionStorage; bloqueos de notificación locales que no cubren todos los escenarios de cierre de pestaña, múltiples sesiones o dispositivos; reintentos 403 del proxy basados en mensaje sin garantía formal de idempotencia. Deben resolverse antes de llamar a este flujo “compra simple en producción”.

## Próxima validación de aceptación

Con IT confirmando la solución: probar una operación controlada por producto/frecuencia habilitada, total e impuestos, enlace de pago, retorno y webhook, error/rechazo, refresco mientras se procesa y reconciliación de la misma operación. Para Funerario repetir únicamente el producto afectado. Registrar evidencia sin claves ni datos personales innecesarios.

Correo listo para adaptar: `docs/email-IT-Mercantil-2026-09-25.md`.

## Recuperación de solicitudes — añadido posterior

La aplicación ahora ofrece guardar el avance de forma optativa durante siete días en el mismo navegador. La recuperación de carrito evita crear una emisión nueva: primero consulta el estado de la referencia existente. Se añadió además una integración preparada, pero desactivada, para que JLC reciba un aviso interno después de 30 minutos de inactividad y consentimiento expreso del cliente. No hay proveedor de correo ni almacenamiento configurados y no se envían avisos. La guía de activación y límites está en `docs/RECUPERACION-DE-SOLICITUDES.md`.

Validación posterior: `tsc --noEmit` sin errores y `npm test` con 23 pruebas aprobadas, incluidas las de recuperación, cancelación, no duplicación de aviso y bloqueo previo a notificación de pago. El build vuelve a compilar la aplicación y falla solamente al empaquetar la función Vercel por el enlace simbólico de React en Windows (`EPERM`); no se debe desplegar su output local incompleto.
