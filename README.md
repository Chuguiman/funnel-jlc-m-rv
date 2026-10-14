# JLCamejo · Funnel de Seguros (Cotiza → Emite → Paga)

Funnel transaccional de seguros construido con **Astro + React + Tailwind CSS v4**,
desplegado en **Vercel**, que consume la **Plataforma de Aliados de Mercantil Seguros**.

Marca propia **JLCamejo** (sin branding de Mercantil en el UI). La API key vive solo
en el servidor: el navegador nunca la ve.

## Flujo

1. **Cotiza** — Datos del asegurado → verificación/creación de cliente → catálogo de
   planes Vitales (Vida, Accidentes, Funerario, Hospitalización y Cáncer) u Auto
   (cascada año→marca→modelo→versión → RCV Básica o RCV Plus).
2. **Emite** — Completa datos del titular y dirección → crea carrito → agrega productos
   → (si aplica, completa info del vehículo) → **emisión asíncrona** con polling de
   estado (`emitted` / `emission_error`) y recuperación del detalle de error.
3. **Paga** — Resumen de pólizas emitidas → checkout hospedado de Mercantil mediante
   `paymentUrl` → descarga del PDF de la póliza. JLCamejo no captura datos de pago ni
   llama `notify-external-payment`.

## Stack

- **Astro 7** (`output: 'server'`) + adaptador **@astrojs/vercel**
- **React 19** islands (`client:load`) para el funnel
- **Tailwind CSS v4** vía `@tailwindcss/vite` (tema de marca en `src/styles/global.css`)
- Rutas API serverless `src/pages/api/mercantil/[...path].ts` como proxy con **allowlist**

## Configuración local

```bash
npm install
cp .env.example .env   # y completa la API key
npm run dev            # http://localhost:4321
```

Variables (`src/env.d.ts`):

| Variable              | Descripción                                        |
| --------------------- | -------------------------------------------------- |
| `MERCANTIL_API_URL`   | URL base de la API de Aliados (`.../ally-api`)     |
| `MERCANTIL_API_KEY`   | ApiKey de la Plataforma de Aliados (solo servidor) |
| `PUBLIC_APP_URL`      | URL pública del sitio (uso futuro)                 |

## Despliegue en Vercel

1. Crea el proyecto en Vercel apuntando a este directorio (framework: **Astro**, se
   detecta automáticamente).
2. Configura las environment variables `MERCANTIL_API_URL` y `MERCANTIL_API_KEY`
   (Settings → Environment Variables). La key queda solo en el servidor.
3. Build (`npm run build`) y funciones serverless con `maxDuration: 60` ya
   configurados en `astro.config.mjs`.
4. Deploy. El sitio y las rutas `/api/mercantil/*` quedan en la misma función
   serverless.

## Seguridad

- **API key nunca llega al cliente**: el proxy serverless la inyecta; el bundle JS
  público no la contiene (verificado en build).
- **Allowlist de endpoints**: la ruta catch-all solo reenvía paths/métodos listados en
  `src/pages/api/mercantil/[...path].ts`; bloquea traversal (`..`).
- **Rate-limit (WAF)**: el cliente de servidor (`src/lib/mercantil.ts`) reintenta con
  backoff ante 403 `"Request not authorized (Forbidden)"`.

## Notas sobre el ambiente de pruebas (staging)

La emisión es **asíncrona**: responde `asyncEmissionId` y el estado final llega por
polling. En staging, Mercantil puede devolver `emission_error` por problemas internos
del Core/SIRWEB (ej: convenio no configurado, `ORA-01422 VALIDA_EDAD_PROTECCION_VITAL`,
o `400-policyNotReadyToQuote` cuando el formulario de vehículo no queda registrado —
el endpoint `auto-products/vehicles/complete-vehicle-info` responde 400 en staging con
cualquier payload, incluso el ejemplo del propio OpenAPI del proveedor).
El funnel muestra el error con detalle amigable y permite reintentar.

## Estructura

```
src/
  components/funnel/        Isla React del funnel (3 pasos + UI atoms)
  layouts/Layout.astro      Layout con branding JLCamejo
  lib/
    api.ts                  Cliente del navegador → proxy local
    mercantil.ts            Cliente server-side (API key + retry WAF)
    types.ts                Tipos del API de Mercantil
    config.ts               Constantes de negocio (canal, frecuencias…)
  pages/
    index.astro             Página principal
    api/mercantil/[...path].ts  Proxy serverless con allowlist
```
## Validación de staging

El flujo activo es Cotiza → Emite → Paga. La emisión se valida en staging y el último
paso abre el checkout hospedado devuelto por Mercantil; no es necesario completar un
pago efectivo para la validación de integración.

- [Informe actualizado](docs/INFORME-REVISION-2026-09-25.md)
- [Correo para IT](docs/email-IT-Mercantil-2026-09-25.md)
- [Validación de aceptación de staging](docs/VALIDACION-STAGING-2026-10-01.md)
- [Recuperación de solicitudes](docs/RECUPERACION-DE-SOLICITUDES.md)

Estos documentos actualizan las notas históricas de staging anteriores de este README.
