# Recuperación de solicitudes abandonadas

## Estado actual

La funcionalidad está implementada pero completamente desactivada. No se han configurado proveedores, no existe una tarea programada y no se envía ningún correo.

El cliente puede elegir guardar el avance localmente durante siete días. Al volver con el mismo navegador se restaura el borrador; si existe un carrito, la aplicación consulta su estado en lugar de crear otra emisión. Esta opción guarda datos del formulario en `localStorage`, por lo que el texto advierte usar un dispositivo personal.

El seguimiento por correo aparece únicamente cuando `RECOVERY_ENABLED=true` y Redis está configurado. Requiere autorización explícita del cliente y solo guarda en servidor: correo, etapa, IDs de producto, frecuencia preferida y referencia del carrito. Si el cliente marca por separado la autorización de WhatsApp, también guarda su número venezolano normalizado para un enlace de contacto manual. No guarda documento, fecha de nacimiento, dirección, números de serie ni declaraciones de salud.

Tras 30 minutos sin actividad, el procesador puede avisar a un correo interno de JLC. No envía correos directamente al cliente. Si existe autorización de WhatsApp, el aviso incluye un enlace `wa.me` que el asesor abre manualmente después de revisar el caso; no hay integración ni envío automático por WhatsApp. Antes de avisar, consulta Mercantil: un carrito `paid`, `cancelled` o `emission_error` no genera aviso; una respuesta desconocida de Mercantil aplaza el caso. Un aviso no confirma que el cliente no haya pagado.

## Activación posterior

1. Crear una base Redis persistente con HTTPS y colocar `UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN` en Vercel.
2. Generar una clave aleatoria de 32 bytes codificada en hexadecimal y colocarla como `RECOVERY_ENCRYPTION_KEY`.
3. Configurar un dominio remitente y las variables de Resend: `RESEND_API_KEY`, `RECOVERY_EMAIL_FROM` y `RECOVERY_NOTIFY_TO`.
4. Generar `CRON_SECRET` de al menos 16 caracteres y activar `RECOVERY_ENABLED=true` y `RECOVERY_EMAIL_ENABLED=true`.
5. Crear una tarea programada autenticada que invoque `GET /api/recovery/process` con `Authorization: Bearer <CRON_SECRET>` cada 15 minutos. El endpoint procesa un registro por ejecución.
6. Antes de activarlo en producción, revisar el texto de autorización y privacidad con el responsable legal/comercial, probar un buzón interno y verificar entrega, cancelación de seguimiento y vencimiento a los siete días.

No incluir `CRON_SECRET`, claves de Redis ni clave de Resend en código, correo, navegador o documentación pública.

## Protección ante duplicados

El trabajo usa almacenamiento persistente cifrado, bloqueo distribuido y una bandeja de salida. Reutiliza la misma clave de idempotencia durante 23 horas para un posible reintento del proveedor de correo. Si esa ventana expira sin confirmación, el registro queda para revisión manual en vez de arriesgar un segundo aviso.

También se escribe el bloqueo local de una notificación de pago antes de llamar a Mercantil. Si se pierde la respuesta o se cierra la pestaña, el usuario no puede reenviar el pago a ciegas al volver.
