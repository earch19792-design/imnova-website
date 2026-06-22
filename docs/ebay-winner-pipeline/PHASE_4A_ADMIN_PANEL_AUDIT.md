# PHASE 4A Admin Panel Audit

## Fecha

2026-06-22

## Objetivo

Auditar como integrar un panel Admin read-only para el eBay Winner Pipeline
dentro de IMNOVA OS, sin implementar cambios grandes y sin modificar la logica
del pipeline.

Esta fase es solo documentacion y propuesta de estructura. No conecta eBay real,
no envia WhatsApp real, no publica productos, no crea estados `PUBLISHED`, no
toca Store/Home, no toca variables Vercel y no agrega migraciones Supabase.

## Archivos revisados

Admin actual:

```text
app/admin/page.tsx
app/admin/products/[slug]/page.tsx
app/admin/sidebar.tsx
app/admin/metrics.tsx
components/admin/market-radar-panel.tsx
```

Servicios y auth:

```text
lib/products-service.ts
lib/supabase.ts
lib/supabase-admin.ts
lib/admin-auth.ts
```

Pipeline eBay Winner:

```text
app/api/admin/ebay-winner-pipeline/route.ts
lib/ebay-winner-pipeline/core.mjs
lib/ebay-winner-pipeline/service.mjs
lib/ebay-winner-pipeline/core.d.mts
lib/ebay-winner-pipeline/service.d.mts
```

Schema/documentacion:

```text
supabase/migrations/202606210001_create_ebay_winner_pipeline_core.sql
docs/ebay-winner-pipeline/PHASE_3B_PRODUCTION_DRYRUN_VALIDATION_REPORT.md
docs/ebay-winner-pipeline/CURRENT_ARCHITECTURE.md
docs/ebay-winner-pipeline/SUPABASE_SCHEMA_REVIEW.md
```

## Estado actual observado

El Admin principal vive en `app/admin/page.tsx` como un dashboard client-side
grande con menu lateral local. Las secciones se renderizan por `selectedMenu`.

`app/admin/sidebar.tsx` define las secciones actuales:

```text
Comunidad
Oportunidades
Productos
Comunicacion
Analytics
Market Radar
```

`components/admin/market-radar-panel.tsx` es el patron mas cercano para una
nueva seccion eBay:

- Es un componente cliente dedicado.
- Obtiene el access token desde `supabase.auth.getSession()`.
- Llama una ruta protegida `/api/admin/market-radar`.
- Renderiza metricas, tabla y eventos recientes.
- Incluye acciones de sync/notificacion, pero esas acciones no deben copiarse
  para la primera version eBay.

`app/api/admin/ebay-winner-pipeline/route.ts` existe y esta protegida mediante
`validateAdminApiRequest`. Actualmente acepta `POST` para:

- `process_radar_candidate`
- `record_decision`

Para el panel read-only no se recomienda reutilizar esos `POST` como fuente de
lectura. Conviene agregar en Fase 4B un `GET` read-only o una ruta separada
read-only que no ejecute transiciones ni escritura.

`lib/supabase-admin.ts` ya centraliza el cliente service role server-side y la
validacion de admin API. Este es el lugar correcto para proteger cualquier ruta
server-side nueva. No se deben exponer service role keys al cliente.

## Tablas eBay existentes

La migracion core ya define las 8 tablas `ebay_*`:

```text
ebay_product_candidates
ebay_candidate_validations
ebay_profit_scenarios
ebay_compliance_checks
ebay_candidate_scores
ebay_candidate_decisions
ebay_listing_drafts
ebay_pipeline_audit_log
```

Campos principales utiles para el listado:

```text
ebay_product_candidates:
  id
  candidate_key
  supplier_sku
  title
  product_url
  brand
  product_type
  state
  last_evaluated_at
  blocked_reason
  needs_data
  created_at
  updated_at

ebay_candidate_scores:
  winner_score
  demand_score
  profitability_score
  competition_score
  stock_stability_score
  data_quality_score
  inverse_operational_risk_score
  explanation
  calculated_at

ebay_profit_scenarios:
  estimated_sale_price
  luna_cost
  total_estimated_cost
  net_profit
  net_margin_percent
  roi_percent
  passes_minimums
  calculated_at

ebay_compliance_checks:
  overall_status
  blocker_count
  findings
  checked_at

ebay_listing_drafts:
  draft_status
  dry_run_only
  ebay_draft_id
  created_at
  updated_at
```

Campos principales utiles para el detalle:

```text
ebay_candidate_validations:
  validation_status
  required_fields
  missing_fields
  critical_reasons
  validated_at

ebay_candidate_decisions:
  decision
  decision_channel
  message_id
  decided_by
  decision_payload
  decided_at

ebay_listing_drafts:
  title
  description_html
  category_id
  condition_id
  price
  quantity
  supplier_sku
  brand
  image_urls
  aspects
  shipping_policy
  return_policy
  payment_policy
  dry_run_only
  ebay_draft_id

ebay_pipeline_audit_log:
  event_type
  from_state
  to_state
  actor
  payload
  created_at
```

## Propuesta de primera version read-only

Agregar una seccion nueva en Admin llamada `eBay Pipeline` o `eBay Winners`,
preferiblemente despues de `Market Radar`, porque el pipeline consume candidatos
desde Radar.

La primera version debe ser solo lectura:

- Sin botones de crear draft.
- Sin botones de aprobar.
- Sin botones de rechazar.
- Sin botones de publicar.
- Sin botones de conectar eBay.
- Sin botones de enviar WhatsApp.
- Sin formularios que escriban en tablas `ebay_*`.

### Listado de candidatos

Vista recomendada:

- Header con estado operativo `Dry run only`.
- Metric cards: candidatos totales, validated, draft_created, blocked/needs_data,
  drafts locales, drafts reales detectados.
- Filtros read-only por state, compliance status, draft status y busqueda por
  `supplier_sku`/`title`.
- Tabla paginada con columnas:

```text
state
supplier_sku
title
winner_score
net_profit
net_margin_percent
roi_percent
compliance overall_status
draft_status
dry_run_only
ebay_draft_id
last_evaluated_at
detalle
```

Reglas de visualizacion:

- `ebay_draft_id` debe mostrarse como `null` o `Sin draft real`.
- Si aparece un valor no null, mostrar alerta critica porque violaria el modo
  dry run esperado.
- `dry_run_only` debe mostrarse explicitamente.
- `PUBLISHED` no debe existir como estado ni como filtro.
- `state` debe limitarse a los estados del check actual:
  `DETECTED`, `ENRICHING`, `NEEDS_DATA`, `BLOCKED`, `VALIDATED`,
  `APPROVAL_PENDING`, `APPROVED`, `DRAFT_CREATED`, `PAUSED`, `REJECTED`.

### Detalle de candidato

Ruta sugerida:

```text
/admin/ebay-winner-pipeline/[candidateId]
```

Alternativa de menor cambio:

```text
panel lateral/modal dentro de app/admin/page.tsx
```

La ruta dedicada es mas limpia a mediano plazo, pero el panel lateral reduce
el cambio inicial en el routing del Admin. Para Fase 4B se recomienda empezar
con panel lateral si se quiere mantener bajo el alcance.

Secciones del detalle:

1. Informacion base
   - `candidate_key`
   - `supplier_sku`
   - `title`
   - `product_url`
   - `brand`
   - `product_type`
   - `state`
   - `blocked_reason`
   - `needs_data`
   - `last_evaluated_at`

2. Profit scenario
   - `estimated_sale_price`
   - `luna_cost`
   - `fulfillment_cost`
   - `packaging_cost`
   - `estimated_shipping_cost`
   - `estimated_ebay_fee`
   - `estimated_payment_fee`
   - `estimated_advertising_cost`
   - `return_reserve`
   - `total_estimated_cost`
   - `net_profit`
   - `net_margin_percent`
   - `roi_percent`
   - `passes_minimums`
   - `assumptions`

3. Compliance findings
   - `overall_status`
   - `blocker_count`
   - `findings`
   - `checked_at`

4. Score breakdown
   - `winner_score`
   - `demand_score`
   - `profitability_score`
   - `competition_score`
   - `stock_stability_score`
   - `data_quality_score`
   - `inverse_operational_risk_score`
   - `explanation`
   - `score_payload`

5. Validacion
   - `validation_status`
   - `required_fields`
   - `missing_fields`
   - `critical_reasons`
   - `validated_at`

6. Decisiones registradas
   - `decision`
   - `decision_channel`
   - `message_id`
   - `decided_by`
   - `decision_payload`
   - `decided_at`

7. Draft local
   - `draft_status`
   - `title`
   - `description_html` como texto/preview seguro, no HTML ejecutado
   - `category_id`
   - `condition_id`
   - `price`
   - `quantity`
   - `supplier_sku`
   - `brand`
   - `image_urls`
   - `aspects`
   - `shipping_policy`
   - `return_policy`
   - `payment_policy`
   - `dry_run_only`
   - `ebay_draft_id`

8. Audit log
   - timeline ordenado por `created_at desc`
   - `event_type`
   - `from_state`
   - `to_state`
   - `actor`
   - `payload`

## Arquitectura propuesta

### Opcion recomendada para Fase 4B

Crear una ruta API admin read-only:

```text
app/api/admin/ebay-winner-pipeline/dashboard/route.ts
```

o agregar `GET` read-only a:

```text
app/api/admin/ebay-winner-pipeline/route.ts
```

La ruta debe:

- Usar `validateAdminApiRequest(req)`.
- Usar `getSupabaseAdminClient()` solo en server-side.
- Aceptar filtros read-only por query string.
- Aplicar paginacion obligatoria.
- Devolver un payload normalizado para listado y detalle.
- No llamar `processRadarCandidateWithPersistence`.
- No llamar `recordCandidateDecision`.
- No hacer `insert`, `update`, `upsert` ni `delete`.

Separar queries en un servicio server-side nuevo:

```text
lib/ebay-winner-pipeline/admin-read-service.mjs
```

Funciones sugeridas:

```text
getEbayWinnerAdminDashboard({ supabase, filters, page, limit })
getEbayWinnerCandidateDetail({ supabase, candidateId })
getEbayWinnerAdminSummary({ supabase })
```

Tipos sugeridos:

```text
lib/ebay-winner-pipeline/admin-read-types.ts
```

o mantener `.d.mts` si se sigue el patron actual del pipeline.

Componente UI sugerido:

```text
components/admin/ebay-winner-pipeline-panel.tsx
```

Integracion minima en Admin:

```text
app/admin/sidebar.tsx
app/admin/page.tsx
```

Cambios esperados para Fase 4B:

- Agregar item de sidebar.
- Renderizar `<EbayWinnerPipelinePanel />` cuando `selectedMenu` sea
  `ebay-winner-pipeline`.
- El panel cliente solo debe hacer `GET`.
- El panel cliente debe mostrar estados vacios, loading, error y refresh.

## Consultas recomendadas

Para listado, evitar traer JSON grandes por defecto. Primera consulta sugerida:

```text
ebay_product_candidates:
  id,
  candidate_key,
  supplier_sku,
  title,
  product_url,
  brand,
  product_type,
  state,
  last_evaluated_at,
  blocked_reason,
  needs_data,
  created_at,
  updated_at
```

Luego traer tablas relacionadas por `candidate_id` para la pagina actual:

```text
ebay_candidate_scores
ebay_profit_scenarios
ebay_compliance_checks
ebay_listing_drafts
```

Para detalle, traer todas las relaciones del candidato seleccionado:

```text
ebay_candidate_validations
ebay_profit_scenarios
ebay_compliance_checks
ebay_candidate_scores
ebay_candidate_decisions
ebay_listing_drafts
ebay_pipeline_audit_log
```

Orden recomendado:

- Listado: `last_evaluated_at desc nulls last`, fallback `updated_at desc`.
- Scores: `calculated_at desc`.
- Profit: `calculated_at desc`.
- Compliance: `checked_at desc`.
- Decisions: `decided_at desc`.
- Audit log: `created_at desc`.

Limites recomendados:

- Listado inicial: 25 o 50 filas.
- Audit log por detalle: 100 eventos maximo.
- Decisions por detalle: 50 eventos maximo.
- JSON payloads colapsados por defecto.

## Componentes necesarios

Componentes de Fase 4B:

```text
EbayWinnerPipelinePanel
EbayWinnerSummaryCards
EbayWinnerCandidateFilters
EbayWinnerCandidateTable
EbayWinnerStateBadge
EbayWinnerComplianceBadge
EbayWinnerDryRunBadge
EbayWinnerCandidateDetailDrawer
EbayWinnerJsonPreview
EbayWinnerAuditTimeline
```

El diseno debe seguir el Admin actual:

- Fondo oscuro.
- Bordes sutiles `border-white/10`.
- Cards de radio bajo o moderado.
- Badges para estados.
- Tablas densas para escaneo operativo.
- Sin copy de marketing.

## Riesgos antes de implementar

### Consultas pesadas

Riesgo: `source_payload`, `normalized_payload`, `findings`, `score_payload`,
`decision_payload` y `payload` pueden crecer y hacer lenta la tabla.

Mitigacion:

- No cargar JSON grandes en el listado.
- Cargar payloads completos solo en detalle.
- Paginacion obligatoria.
- Limites en audit log y decisions.

### Exposicion de datos sensibles

Riesgo: `source_payload`, `normalized_payload`, `decision_payload` o audit
payloads podrian contener URLs privadas, datos de proveedor, mensajes o
identificadores internos.

Mitigacion:

- Ruta API protegida por admin.
- No exponer service role en cliente.
- Redactar o colapsar payloads JSON.
- No imprimir tokens ni headers en consola.
- Evitar mostrar secretos si aparecen por accidente en payloads.

### Errores por RLS

Riesgo: consultas directas desde cliente con `supabase` anon/auth pueden fallar
por RLS o variar segun sesion.

Mitigacion:

- Usar ruta API server-side protegida.
- Usar service role solo en server.
- Mantener `validateAdminApiRequest` antes de cualquier query.

### Acciones peligrosas

Riesgo: copiar el patron de `MarketRadarPanel` podria introducir botones de
sync/notificacion o `POST` que ejecuten transiciones.

Mitigacion:

- Primera version solo `GET`.
- No incluir botones de accion.
- No llamar endpoints `POST`.
- No agregar handlers para `process_radar_candidate` ni `record_decision`.

### Estados y publicaciones

Riesgo: introducir `PUBLISHED` en UI, filtros o copy podria normalizar un estado
que el schema actual no permite.

Mitigacion:

- No mostrar `PUBLISHED`.
- No agregar estado nuevo.
- Mantener alerta si se detecta `ebay_draft_id` no null.
- Mostrar siempre `dry_run_only`.

### Render de HTML

Riesgo: `description_html` podria renderizar HTML no confiable.

Mitigacion:

- Mostrar como texto o preview sanitizado.
- No usar `dangerouslySetInnerHTML` en Fase 4B.

## Botones que no deben existir todavia

No implementar en Fase 4B:

```text
Crear draft
Aprobar candidato
Rechazar candidato
Pausar candidato
Publicar en eBay
Enviar a eBay
Conectar eBay
Enviar WhatsApp
Reprocesar candidato
Sincronizar Radar
Convertir a producto Store
```

La primera version debe limitarse a:

```text
Refresh
Filtros
Ver detalle
Abrir product_url externo, si existe
Copiar candidate_id o candidate_key, si se considera necesario
```

## Plan seguro para Fase 4B

1. Crear servicio read-only server-side para queries Admin eBay.
2. Crear `GET` protegido para dashboard/listado.
3. Crear `GET` protegido para detalle o soportar `candidateId` en query string.
4. Crear tipos de respuesta normalizados.
5. Crear componente `EbayWinnerPipelinePanel` sin acciones de escritura.
6. Agregar item de sidebar.
7. Renderizar panel desde `app/admin/page.tsx`.
8. Validar sin token: `401 admin_token_required`.
9. Validar con admin: listado carga sin ejecutar escrituras.
10. Confirmar que no existen botones peligrosos.
11. Confirmar que no se toca Store/Home.
12. Confirmar que no se toca Supabase con nuevas migraciones.
13. Confirmar que no se conecta eBay ni WhatsApp real.

## Criterios de aceptacion para Fase 4B

- Panel visible solo dentro de Admin.
- Endpoint read-only protegido.
- Sin `POST` desde el panel.
- Sin escrituras a tablas `ebay_*`.
- Listado paginado de candidatos.
- Detalle de candidato con profit, compliance, score, decisions, draft local y
  audit log.
- `dry_run_only` visible.
- `ebay_draft_id` visible y esperado como `null`.
- Sin estado `PUBLISHED`.
- Sin botones de publicacion, aprobacion, rechazo, draft o WhatsApp.
- Sin cambios en Store/Home.
- Sin migraciones nuevas.

## Confirmacion de alcance

Esta auditoria no modifica logica del pipeline, eBay, WhatsApp, Store, Home,
Supabase ni Vercel. El unico cambio propuesto en esta fase es este documento.
