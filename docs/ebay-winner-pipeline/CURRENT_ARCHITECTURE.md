# CURRENT_ARCHITECTURE â€” IMNOVA OS

## Resumen ejecutivo

La aplicaciÃ³n actual es una web Next.js con App Router que combina frontend pÃºblico, panel admin, API routes server-side y acceso a Supabase. El Radar de Mercado ya existe como mÃ³dulo aislado para Luna Portex y no debe reconstruirse: expone una ruta admin, una UI admin, tipos TypeScript, sincronizaciÃ³n contra endpoints Shopify de Luna Portex, persistencia en tablas `market_radar_*`, scoring interno y alerta WhatsApp para oportunidades eBay.

## Stack frontend

- Next.js `16.2.6` con React `19` y TypeScript.
- App Router bajo `app/`.
- Componentes React bajo `components/`, incluyendo `components/admin/market-radar-panel.tsx` para el Radar.
- UI basada en Radix UI, Tailwind CSS v4, `lucide-react`, `framer-motion`, `sonner` y componentes locales `components/ui/*`.
- Analytics de Vercel mediante `@vercel/analytics`.

## Stack backend

- API routes de Next.js bajo `app/api/*/route.ts` ejecutadas en runtime Node.js cuando se requiere integraciÃ³n server-side.
- Supabase JS v2 como cliente de base de datos y Auth.
- Supabase service role key solo en server-side para rutas admin/API.
- WhatsApp Cloud API vÃ­a Graph API en `lib/whatsapp.ts`.
- Dependencia `twilio` instalada, pero el flujo WhatsApp revisado usa Graph API.

## Estructura de carpetas relevante

```text
app/
  api/
    admin/market-radar/route.ts      # API admin del Radar
    community/*/route.ts             # Comunidad y registro
    innova-lab/route.ts              # Labs, WhatsApp y comunidad
    store/featured/route.ts          # Store pÃºblico
  admin/page.tsx                     # Admin shell
  admin/*                            # Admin pages
components/
  admin/market-radar-panel.tsx       # UI Radar
  ui/*                               # Sistema de componentes
lib/
  market-radar-lunaportex.ts         # Sync Luna Portex -> Radar
  market-radar-types.ts              # Tipos Radar
  supabase.ts                        # Cliente pÃºblico/anon
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

## Servicios y mÃ³dulos principales

| Ãrea | Archivos | Responsabilidad |
|---|---|---|
| Store | `lib/products-service.ts`, `app/api/store/featured/route.ts` | Productos pÃºblicos y store. |
| Comunidad | `app/api/community/*` | Registro, member, ideas, votos y preferencias. |
| WhatsApp | `lib/whatsapp.ts` | EnvÃ­o de templates, normalizaciÃ³n de telÃ©fonos, fallbacks y logging seguro parcial. |
| Radar | `lib/market-radar-lunaportex.ts`, `app/api/admin/market-radar/route.ts`, `components/admin/market-radar-panel.tsx` | Sync Luna Portex, dashboard, score y notificaciÃ³n de oportunidades. |
| Supabase | `lib/supabase.ts`, `lib/supabase-admin.ts`, `supabase/migrations/*` | Clientes, RLS, schema y vistas. |
| Admin auth | `lib/admin-auth.ts`, `lib/supabase-admin.ts` | ValidaciÃ³n por Bearer token/service role/Auth + RPC `is_admin`. |

## Jobs, cron jobs, workers o queues

No se encontrÃ³ definiciÃ³n de cron, worker dedicado o queue en el repositorio. El Radar se ejecuta actualmente como acciÃ³n bajo demanda desde la ruta admin `POST /api/admin/market-radar` con `action: "sync_lunaportex"`. La tabla `market_radar_sources` tiene `poll_interval_minutes`, `last_run_at`, `last_success_at` y `last_error`, lo que sugiere preparaciÃ³n para programaciÃ³n futura, pero el repo no contiene scheduler.

## IntegraciÃ³n Supabase

- Cliente pÃºblico: `lib/supabase.ts` usa `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`, con placeholders para build.
- Cliente admin: `lib/supabase-admin.ts` usa `SUPABASE_SERVICE_ROLE_KEY` solo server-side y desactiva persistencia/refresh de sesiÃ³n.
- ValidaciÃ³n admin: Bearer token puede ser service role o usuario Supabase autenticado con RPC `is_admin`.
- Radar: usa service-role desde API admin para upsert/insert en `market_radar_*`.
- RLS: migraciÃ³n del Radar habilita RLS y polÃ­ticas para usuarios autenticados admin.

## IntegraciÃ³n WhatsApp

- `lib/whatsapp.ts` usa WhatsApp Cloud API `https://graph.facebook.com/v25.0/{phoneId}/messages`.
- Variables esperadas: `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, templates y recipientes.
- El Radar no envÃ­a productos a eBay; solo construye una alerta con top oportunidades y llama `sendWhatsAppUpdate`.
- Hay masking de telÃ©fonos en algunas respuestas/logs, pero existe un fallback de telÃ©fono hardcodeado que conviene mover a variable obligatoria antes de producciÃ³n crÃ­tica.

## MÃ³dulo Radar y Luna Portex

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
- Templates WhatsApp y telÃ©fonos destino

## Logs y errores

- API Radar devuelve cÃ³digos de error genÃ©ricos al cliente (`market_radar_dashboard_failed`, `market_radar_action_failed`) y registra errores en `console.error`.
- Sync Luna Portex escribe `last_error` en `market_radar_sources`.
- Eventos Radar tienen `idempotency_key` Ãºnico.
- WhatsApp registra respuestas Meta, errores y estados; algunas funciones sanitizan telÃ©fonos, pero debe revisarse que no se logueen payloads con PII completa.

## MÃ©todo de despliegue

No hay configuraciÃ³n explÃ­cita de despliegue en el repo salvo dependencia `@vercel/analytics` y URLs `vercel.app` usadas como fallback de imagen. La inferencia mÃ¡s probable es Vercel para Next.js, con Supabase remoto y migraciones SQL bajo `supabase/migrations`. No se ejecutÃ³ ni se recomienda deploy en esta auditorÃ­a.

## AuditorÃ­a 2026-06-21 â€” lÃ­mites confirmados

- No se modificÃ³ producciÃ³n ni se ejecutÃ³ deploy durante esta auditorÃ­a.
- No se invocÃ³ ningÃºn endpoint externo de Luna Portex, WhatsApp, Supabase remoto ni eBay; la revisiÃ³n fue estÃ¡tica sobre cÃ³digo, migraciones y documentaciÃ³n del repo.
- El repositorio no contiene conector eBay ni variables eBay existentes; cualquier OAuth, sandbox, scopes o publicaciÃ³n queda fuera de esta fase.
- La rama de trabajo para este entregable es `feature/ebay-winner-pipeline`.

## Inventario de rutas API relevantes

| Ruta | MÃ©todo esperado | Uso observado | Riesgo para pipeline |
|---|---:|---|---|
| `app/api/admin/market-radar/route.ts` | `GET`/`POST` | Dashboard Radar, sync Luna Portex y notificaciÃ³n WhatsApp. | No debe mezclarse con publicaciÃ³n eBay; crear ruta nueva para pipeline. |
| `app/api/innova-lab/route.ts` | `POST` | Captura comunidad/Labs y flujos WhatsApp. | Puede compartir patrones de logging, pero no tablas de candidatos. |
| `app/api/community/*/route.ts` | varios | Comunidad, miembros, votos e ideas. | Reutilizable solo para identidad/telefonÃ­a si se decide aprobador humano. |
| `app/api/store/featured/route.ts` | `GET` | Store pÃºblico con Supabase service-role. | No escribir candidatos eBay en catÃ¡logo pÃºblico. |

## RecomendaciÃ³n de aislamiento

El eBay Winner Pipeline debe ser un consumidor aguas abajo del Radar: leer vistas `market_radar_latest_products`/`market_radar_events`, escribir Ãºnicamente tablas nuevas con prefijo `ebay_` o `ebay_winner_`, y exponer una ruta admin nueva. Esto mantiene reversible la extensiÃ³n y evita que un fallo en cÃ¡lculo de profit, compliance o aprobaciones afecte el Radar actual.
