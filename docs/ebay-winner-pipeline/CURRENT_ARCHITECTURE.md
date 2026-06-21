# CURRENT_ARCHITECTURE — IMNOVA OS

## Resumen ejecutivo

La aplicación actual es una web Next.js con App Router que combina frontend público, panel admin, API routes server-side y acceso a Supabase. El Radar de Mercado ya existe como módulo aislado para Luna Portex y no debe reconstruirse: expone una ruta admin, una UI admin, tipos TypeScript, sincronización contra endpoints Shopify de Luna Portex, persistencia en tablas `market_radar_*`, scoring interno y alerta WhatsApp para oportunidades eBay.

## Stack frontend

- Next.js `16.2.6` con React `19` y TypeScript.
- App Router bajo `app/`.
- Componentes React bajo `components/`, incluyendo `components/admin/market-radar-panel.tsx` para el Radar.
- UI basada en Radix UI, Tailwind CSS v4, `lucide-react`, `framer-motion`, `sonner` y componentes locales `components/ui/*`.
- Analytics de Vercel mediante `@vercel/analytics`.

## Stack backend

- API routes de Next.js bajo `app/api/*/route.ts` ejecutadas en runtime Node.js cuando se requiere integración server-side.
- Supabase JS v2 como cliente de base de datos y Auth.
- Supabase service role key solo en server-side para rutas admin/API.
- WhatsApp Cloud API vía Graph API en `lib/whatsapp.ts`.
- Dependencia `twilio` instalada, pero el flujo WhatsApp revisado usa Graph API.

## Estructura de carpetas relevante

```text
app/
  api/
    admin/market-radar/route.ts      # API admin del Radar
    community/*/route.ts             # Comunidad y registro
    innova-lab/route.ts              # Labs, WhatsApp y comunidad
    store/featured/route.ts          # Store público
  admin/page.tsx                     # Admin shell
  admin/*                            # Admin pages
components/
  admin/market-radar-panel.tsx       # UI Radar
  ui/*                               # Sistema de componentes
lib/
  market-radar-lunaportex.ts         # Sync Luna Portex -> Radar
  market-radar-types.ts              # Tipos Radar
  supabase.ts                        # Cliente público/anon
  supabase-admin.ts                  # Cliente service-role y auth admin
  whatsapp.ts                        # WhatsApp Cloud API
supabase/
  migrations/202606200001_create_market_radar.sql
scripts/
  audit_remote_schema_before_fase1_deploy.sql
  verify_prod_after_fase1_005.sql
docs/
  ebay-winner-pipeline/              # Este entregable
```

## Servicios y módulos principales

| Área | Archivos | Responsabilidad |
|---|---|---|
| Store | `lib/products-service.ts`, `app/api/store/featured/route.ts` | Productos públicos y store. |
| Comunidad | `app/api/community/*` | Registro, member, ideas, votos y preferencias. |
| WhatsApp | `lib/whatsapp.ts` | Envío de templates, normalización de teléfonos, fallbacks y logging seguro parcial. |
| Radar | `lib/market-radar-lunaportex.ts`, `app/api/admin/market-radar/route.ts`, `components/admin/market-radar-panel.tsx` | Sync Luna Portex, dashboard, score y notificación de oportunidades. |
| Supabase | `lib/supabase.ts`, `lib/supabase-admin.ts`, `supabase/migrations/*` | Clientes, RLS, schema y vistas. |
| Admin auth | `lib/admin-auth.ts`, `lib/supabase-admin.ts` | Validación por Bearer token/service role/Auth + RPC `is_admin`. |

## Jobs, cron jobs, workers o queues

No se encontró definición de cron, worker dedicado o queue en el repositorio. El Radar se ejecuta actualmente como acción bajo demanda desde la ruta admin `POST /api/admin/market-radar` con `action: "sync_lunaportex"`. La tabla `market_radar_sources` tiene `poll_interval_minutes`, `last_run_at`, `last_success_at` y `last_error`, lo que sugiere preparación para programación futura, pero el repo no contiene scheduler.

## Integración Supabase

- Cliente público: `lib/supabase.ts` usa `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`, con placeholders para build.
- Cliente admin: `lib/supabase-admin.ts` usa `SUPABASE_SERVICE_ROLE_KEY` solo server-side y desactiva persistencia/refresh de sesión.
- Validación admin: Bearer token puede ser service role o usuario Supabase autenticado con RPC `is_admin`.
- Radar: usa service-role desde API admin para upsert/insert en `market_radar_*`.
- RLS: migración del Radar habilita RLS y políticas para usuarios autenticados admin.

## Integración WhatsApp

- `lib/whatsapp.ts` usa WhatsApp Cloud API `https://graph.facebook.com/v25.0/{phoneId}/messages`.
- Variables esperadas: `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, templates y recipientes.
- El Radar no envía productos a eBay; solo construye una alerta con top oportunidades y llama `sendWhatsAppUpdate`.
- Hay masking de teléfonos en algunas respuestas/logs, pero existe un fallback de teléfono hardcodeado que conviene mover a variable obligatoria antes de producción crítica.

## Módulo Radar y Luna Portex

- Fuente fija `lunaportex` con base `https://lunaportex.com`.
- Colecciones consultadas: `products`, `flash-sale`, `weekly-deals`, `out-of-stock`.
- Endpoints Shopify usados: `/collections/{collection}/products.json?limit=250&page=N` y, si existe cookie, `/products/{handle}.js` para hidratar inventario.
- Cookie opcional: `LUNAPORTEX_AUTH_COOKIE`.
- Persistencia: productos, snapshots, eventos y scores.

## Manejo de secretos

Secretos se leen desde `process.env`. No se observaron valores reales de Supabase/Meta/eBay en los archivos revisados. Variables sensibles identificadas:

- `SUPABASE_SERVICE_ROLE_KEY`
- `LUNAPORTEX_AUTH_COOKIE`
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_BUSINESS_ACCOUNT_ID`
- Templates WhatsApp y teléfonos destino

## Logs y errores

- API Radar devuelve códigos de error genéricos al cliente (`market_radar_dashboard_failed`, `market_radar_action_failed`) y registra errores en `console.error`.
- Sync Luna Portex escribe `last_error` en `market_radar_sources`.
- Eventos Radar tienen `idempotency_key` único.
- WhatsApp registra respuestas Meta, errores y estados; algunas funciones sanitizan teléfonos, pero debe revisarse que no se logueen payloads con PII completa.

## Método de despliegue

No hay configuración explícita de despliegue en el repo salvo dependencia `@vercel/analytics` y URLs `vercel.app` usadas como fallback de imagen. La inferencia más probable es Vercel para Next.js, con Supabase remoto y migraciones SQL bajo `supabase/migrations`. No se ejecutó ni se recomienda deploy en esta auditoría.

## Auditoría 2026-06-21 — límites confirmados

- No se modificó producción ni se ejecutó deploy durante esta auditoría.
- No se invocó ningún endpoint externo de Luna Portex, WhatsApp, Supabase remoto ni eBay; la revisión fue estática sobre código, migraciones y documentación del repo.
- El repositorio no contiene conector eBay ni variables eBay existentes; cualquier OAuth, sandbox, scopes o publicación queda fuera de esta fase.
- La rama de trabajo para este entregable es `feature/ebay-winner-pipeline`.

## Inventario de rutas API relevantes

| Ruta | Método esperado | Uso observado | Riesgo para pipeline |
|---|---:|---|---|
| `app/api/admin/market-radar/route.ts` | `GET`/`POST` | Dashboard Radar, sync Luna Portex y notificación WhatsApp. | No debe mezclarse con publicación eBay; crear ruta nueva para pipeline. |
| `app/api/innova-lab/route.ts` | `POST` | Captura comunidad/Labs y flujos WhatsApp. | Puede compartir patrones de logging, pero no tablas de candidatos. |
| `app/api/community/*/route.ts` | varios | Comunidad, miembros, votos e ideas. | Reutilizable solo para identidad/telefonía si se decide aprobador humano. |
| `app/api/store/featured/route.ts` | `GET` | Store público con Supabase service-role. | No escribir candidatos eBay en catálogo público. |

## Recomendación de aislamiento

El eBay Winner Pipeline debe ser un consumidor aguas abajo del Radar: leer vistas `market_radar_latest_products`/`market_radar_events`, escribir únicamente tablas nuevas con prefijo `ebay_` o `ebay_winner_`, y exponer una ruta admin nueva. Esto mantiene reversible la extensión y evita que un fallo en cálculo de profit, compliance o aprobaciones afecte el Radar actual.
