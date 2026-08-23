# eBay Sales & Commercial Monitoring Loop V1

## Alcance

Este loop monitorea listings activos ya vinculados a la cuenta oficial. Todas
las llamadas eBay son lecturas: Fulfillment `getOrders`, Analytics
`getTrafficReport` y Trading `GetItem` con `IncludeWatchCount=true`. El módulo
no publica, no modifica precios o cantidades, no cancela órdenes y no compra en
Luna Portex.

El botón **Actualizar rendimiento** vive en Seller Command Center, pero no en
el componente de Radar. Radar conserva una sola responsabilidad: descubrir
oportunidades de Luna Portex.

## Flujo implementado

```text
Fulfillment getOrders + Traffic Report + GetItem WatchCount
                         │
                         ▼
        snapshots y líneas de orden sanitizadas
                         │
                         ▼
        comparación + reglas configurables versionadas
                         │
                         ▼
     eventos idempotentes + tareas de fulfillment únicas
                         │
                         ▼
        outbox neutral con lease/backoff/dead-letter
                         │
                         ▼
     dispatcher Meta aprobado, sólo en Vercel Preview
```

Las transacciones de Analytics se guardan como métrica de Traffic Report y no
se usan como venta confirmada. WatchCount se etiqueta siempre como señal de
interés. Una venta sólo nace de una orden `PAID` devuelta por Fulfillment.

## Persistencia y privacidad

La migración `20260715120000_create_marketplace_commercial_monitor_v1.sql`
crea:

- `marketplace_order_snapshots`
- `marketplace_order_line_items`
- `listing_commercial_snapshots`
- `commercial_alert_events`
- `commercial_threshold_configs`
- `fulfillment_tasks`
- `alert_delivery_outbox`
- `alert_delivery_attempts`
- `commercial_monitor_runs`
- `commercial_daily_summaries`

Todas las tablas tienen RLS habilitado, ACL de navegador revocada y acceso
operativo exclusivo de `service_role`. Las claves únicas aíslan
`marketplace_account_key`, marketplace, Order ID y Line Item ID. Los workers
usan advisory lock por cuenta, índice de un run activo, leases, `SKIP LOCKED`,
backoff exponencial y dead-letter.

No se persisten ni se devuelven `buyer`, username, nombre, dirección, teléfono,
email, notas de checkout ni el bloque de dirección de fulfillment.

## Venta y fulfillment

Antes de emitir `SALE_DETECTED`, el servicio exige coincidencia exacta del
Item ID y del SKU con un listing activo del account scope. Después consulta la
última variante Luna vinculada, calcula costo del pack, stock y economía
estimada. La tarea se crea una sola vez con historial:

1. `SALE_DETECTED`
2. `VALIDATING_ORDER`
3. `PENDING_MANUAL_PURCHASE`

El operador compra manualmente y un loop posterior podrá llevarla a
`PURCHASED_AWAITING_TRACKING`. `FIRST_SALE_CONFIRMED` usa una clave estable por
listing y se emite una sola vez.

## APIs

- `GET /api/admin/ebay/commercial-monitor`: dashboard sanitario sin PII.
- `POST /api/admin/ebay/commercial-monitor` con `action=run`: dry run o
  actualización manual explícita.
- `POST ... {"action":"oauth_preflight"}`: valida OAuth/identidad read-only y
  devuelve únicamente categorías sanitizadas; no llama `getOrders`/`GetItem`.
- `POST ... {"action":"update_thresholds", ...}`: nueva versión activa de
  umbrales.
- `GET /api/cron/ebay-commercial-monitor`: ejecuta sólo los readers vencidos.
- `GET /api/cron/commercial-alert-dispatcher`: reclama y entrega un WhatsApp.

Admin Auth protege el endpoint manual; `CRON_SECRET` protege los endpoints de
scheduler. Los tres endpoints devuelven bloqueo o estado desactivado si
`VERCEL_ENV` no es `preview` cuando hay riesgo de automatización o entrega.

## OAuth dedicado de Commercial Orders

El único callback canónico del consentimiento Fulfillment es:

```text
https://imnova-website-z1qh-git-featur-6c9e25-earch19792-6888s-projects.vercel.app/api/admin/ebay/monitor/seller-oauth-reauth
```

La ruta legacy `/api/admin/ebay/oauth/callback` permanece bloqueada y nunca
delega Commercial Orders. La ruta dedicada exige `code` y un `state` base64url
de 43 caracteres. El `state` se reclama atómicamente sólo si el handoff está
`pending` y no expiró; un state ausente, vencido o reutilizado termina en una
redirección sanitizada al Seller Command Center. El authorization code y los
tokens nunca se incluyen en esa redirección ni se almacenan en la tabla de
handoffs. El intercambio y la verificación de identidad ocurren server-side.

El Auth Accepted URL del RuName OAuth Enabled debe coincidir exactamente con
el callback canónico anterior. `EBAY_COMMERCIAL_ORDERS_RUNAME` es la fuente
canónica del RuName en Preview; los aliases legacy no cambian este contrato.

## Automatización de Preview

El workflow `ebay-commercial-preview-monitor.yml` llama ambos workers cada
cinco minutos. Está apagado por defecto y requiere:

- variable de GitHub `EBAY_COMMERCIAL_PREVIEW_MONITOR_ENABLED=true`;
- secreto `EBAY_COMMERCIAL_PREVIEW_URL`, que debe apuntar al deployment
  Preview autorizado;
- secreto `EBAY_COMMERCIAL_CRON_SECRET`, igual al `CRON_SECRET` de Preview;
- `EBAY_COMMERCIAL_MONITOR_ENABLED=true` sólo en Preview.

La frecuencia base es cinco minutos; el backend aplica los intervalos por
reader configurados en variables de entorno. Production no recibe cron nuevo
en `vercel.json` y todos los feature flags nuevos tienen default `false`.

## Activación controlada

Antes de GO se requiere aplicar la migración en staging, autorizar manualmente
`EBAY_COMMERCIAL_ORDERS_REFRESH_TOKEN` con `sell.fulfillment.readonly`,
desplegar Preview, ejecutar un dry run, pulsar **Actualizar rendimiento** una
vez para el listing piloto y revisar que WhatsApp apunte al único destinatario
autorizado. El token general validado no se sustituye. Sólo después se
habilitan el flag de Vercel Preview y la variable del workflow.

### Monitoreo continuo mientras existan listings activos

El monitor Preview requiere simultáneamente
`EBAY_COMMERCIAL_PREVIEW_MONITOR_ENABLED=true` y
`EBAY_COMMERCIAL_MONITOR_ENABLED=true`, ambos limitados a la rama Preview.
Las fechas históricas `EBAY_COMMERCIAL_PILOT_STARTED_AT` y
`EBAY_COMMERCIAL_PILOT_EXPIRES_AT` ya no detienen el servicio. Después de un
dry run satisfactorio y una activación explícita, el monitor continúa mientras
la configuración siga habilitada y exista al menos un listing activo con
identidad exacta. Sólo una revocación o desactivación explícita lo detiene.

Cuando el workflow todavía no existe en la rama por defecto, no se debe
desplegarlo en Production para habilitar un Preview. El piloto puede ser
invocado desde Supabase staging mediante `pg_cron` + `pg_net`, con un secreto
dedicado guardado en Vault y configurado como
`EBAY_COMMERCIAL_PILOT_CRON_SECRET` únicamente en el Preview de la rama. Los
jobs se mantienen durante toda la vida de los listings activos y deben
deshabilitarse explícitamente cuando ya no deban operar.

Frecuencias iniciales del piloto: invocación base y dispatcher cada 5 minutos,
Orders cada 5 minutos, Watchers cada 360 minutos, Analytics cada 1440 minutos y
un resumen por día. El backend decide qué lanes están vencidos; nunca se añade
un cron comercial a `vercel.json` porque los crons Vercel corresponden a
Production.
