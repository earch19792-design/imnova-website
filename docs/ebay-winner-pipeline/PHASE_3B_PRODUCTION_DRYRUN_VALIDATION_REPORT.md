# PHASE 3B Production DryRun Validation Report

## Fecha

2026-06-22

## Estado post-merge

El PR #1, `Feat: recover eBay Winner Pipeline core`, fue mergeado correctamente a
`main`.

Produccion Vercel quedo en estado `Ready` para `main`.

La web publica, Store y Admin cargan correctamente despues del merge.

## Alcance de esta validacion

Esta validacion confirmo el comportamiento production dry run del eBay Winner
Pipeline ya mergeado a `main`.

No se modifico logica del pipeline. No se conecto eBay real. No se envio
WhatsApp real. No se tocaron variables Vercel. No se hicieron cambios en
Supabase desde este reporte. No se documentan tokens, cookies, service role
keys, bypass secrets ni headers de autorizacion.

## Migracion aplicada en produccion

Archivo aplicado en Supabase produccion:

```text
supabase/migrations/202606210001_create_ebay_winner_pipeline_core.sql
```

Resultado confirmado:

- Migracion aplicada correctamente en Supabase produccion.
- RLS confirmado en tablas `ebay_*`.
- Policies confirmadas en tablas `ebay_*`.
- Constraints confirmadas.
- `PUBLISHED` no esta permitido para el flujo validado.
- `ebay_listing_drafts_no_real_ebay_id_check` mantiene `ebay_draft_id` en `null`.
- `dry_run_only` permanece activo para drafts locales.

## Tablas confirmadas

Se confirmaron 8 tablas `ebay_*` en produccion:

```text
ebay_candidate_decisions
ebay_candidate_scores
ebay_candidate_validations
ebay_compliance_checks
ebay_listing_drafts
ebay_pipeline_audit_log
ebay_product_candidates
ebay_profit_scenarios
```

## Endpoint protegido

Endpoint validado:

```text
POST /api/admin/ebay-winner-pipeline
```

Prueba sin token:

```text
HTTP 401 admin_token_required
```

Resultado: el endpoint esta protegido correctamente.

No se documentan headers, tokens, cookies ni secretos.

## Production dryRun: process_radar_candidate

Accion validada en produccion:

```text
process_radar_candidate
```

Resultado autenticado: OK.

Datos confirmados:

```text
supplier_sku: LP-PROD-DRYRUN-001
candidate_id: 7a0d9f66-157e-4c16-b767-9f72bc2a906f
candidate_key: lunaportex:lp-prod-dryrun-001:lp-prod-dryrun-001-v1
state inicial: VALIDATED
```

Profit:

```text
net_profit: 9.81
net_margin_percent: 28.03
roi_percent: 98.1
```

Score:

```text
winner_score: 86
```

Safety:

```text
whatsappDryRunPayload.dryRun: true
enableRealSend: false
```

Resultado: `process_radar_candidate` funciona en production dry run.

## Production dryRun: record_decision

Accion validada en produccion:

```text
record_decision
decision: create_draft
```

Resultado autenticado: OK.

Datos confirmados:

```text
decision_id: 2cd7a6e8-4ea7-41c6-9c57-162a9c9ef5c4
listingDraft_id: d6a815fc-3aa5-458f-9c36-7f8096e15dbd
candidate.state: DRAFT_CREATED
ebay_draft_id: null
dry_run_only: true
```

Resultado: `record_decision` crea decision y draft local en production dry run.

## Idempotencia

Se repitio el mismo `record_decision` con el mismo `messageId`.

Confirmado:

- No duplico decision.
- No duplico draft.
- `decisions = 1`.
- `drafts = 1`.

Resultado: idempotencia OK.

## Confirmacion SQL final

Resultado final confirmado en produccion:

```text
state = DRAFT_CREATED
ebay_draft_id = null
dry_run_only = true
published_rows = 0
real_ebay_drafts = 0
```

## Confirmacion de seguridad operacional

Confirmado:

- No hay estado `PUBLISHED`.
- No hay drafts reales de eBay.
- No se conecto eBay real.
- No se creo draft externo real.
- No se envio WhatsApp real.
- No se modificaron variables Vercel.
- No se hizo deploy manual.
- No se guardaron ni imprimieron secretos.

## Resultado

La validacion production dry run del eBay Winner Pipeline queda aprobada para el
alcance de esta fase:

- Produccion Vercel esta `Ready` en `main`.
- Migracion core aplicada en Supabase produccion.
- 8 tablas `ebay_*` confirmadas.
- Endpoint admin protegido con `401 admin_token_required` sin token.
- `process_radar_candidate` OK en production dry run.
- `record_decision` OK en production dry run.
- Idempotencia OK.
- Sin `PUBLISHED`.
- Sin drafts reales.
- Sin eBay real.
- Sin WhatsApp real.

## Siguiente fase recomendada

Construir Admin UI para revisar candidatos y drafts locales antes de conectar
eBay real.

La siguiente fase debe mantener el modo dry run hasta que exista revision
operativa clara de candidatos, decisions y drafts locales desde Admin.
