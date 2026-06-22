# PHASE 2.9 Staging Validation Report

## Fecha

2026-06-22

## Rama y commit

```text
branch: feature/ebay-winner-pipeline-core
commit: 5a3e75f feat: recover ebay winner pipeline core
PR: #1 Feat: recover eBay Winner Pipeline core
```

## Entorno validado

Produccion oficial:

```text
project: imnova-website-z1qh
branch: main
commit: 311725b
status: limpia; /api/admin/ebay-winner-pipeline responde 404 en produccion
```

Preview validado:

```text
branch: feature/ebay-winner-pipeline-core
commit: 5a3e75f
status: Ready
```

Supabase staging:

```text
project: imnova-staging
ref: vsfthqydfrdzulldbfbe
```

No se hizo merge, deploy production, conexion eBay real, envio WhatsApp real ni migracion en produccion.

## Migracion aplicada en staging

Archivo:

```text
supabase/migrations/202606210001_create_ebay_winner_pipeline_core.sql
```

Resultado:

- Migracion aplicada correctamente en `imnova-staging`.
- Migracion aditiva.
- No elimina ni renombra tablas existentes.
- No contiene `DROP TABLE`.
- No contiene `DROP COLUMN`.
- No contiene `TRUNCATE`.
- No contiene `DELETE FROM`.
- No contiene `RENAME`.
- `PUBLISHED` no esta permitido en los checks de estado.
- `ebay_listing_drafts_no_real_ebay_id_check` fuerza `ebay_draft_id is null`.
- `dry_run_only` queda con default `true`.

## Resultado SQL: tablas

Se confirmaron las 8 tablas nuevas:

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

## Resultado SQL: constraints

Confirmado:

- `ebay_product_candidates_state_check` no permite `PUBLISHED`.
- `ebay_pipeline_audit_log_to_state_check` no permite `PUBLISHED`.
- `ebay_listing_drafts_no_real_ebay_id_check` exige `ebay_draft_id is null`.
- `ebay_listing_drafts_candidate_unique` evita mas de un draft por candidato.
- Las tablas de validacion, profit, compliance, score, decision y audit log tienen constraints unicos por `idempotency_key`.

## Resultado SQL: RLS y policies

Confirmado:

- RLS activo en tablas `ebay_*`.
- Policies admin creadas para tablas `ebay_*`.
- Acceso operativo queda detras de auth/admin y service role backend.

## Endpoint Preview autenticado

Endpoint probado en Preview branch del commit `5a3e75f`:

```text
POST /api/admin/ebay-winner-pipeline
```

Prueba sin token:

```text
401 admin_token_required
```

Prueba autenticada:

```text
OK
```

No se documentan headers, tokens, cookies, bypass secrets ni llaves.

## Resultado process_radar_candidate

Accion:

```text
process_radar_candidate
persist: true
```

Candidato creado:

```text
supplier_sku: LP-STAGING-FKFIX-001
candidate_key: lunaportex:lp-staging-fkfix-001:lp-staging-fkfix-001-v1
candidate_id: d3d003f1-896f-4490-ad03-14b635b5b9a9
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
ebayRealApiConnected: false
```

Resultado: OK.

## Resultado record_decision

Accion:

```text
record_decision
decision: create_draft
```

Resultado:

```text
candidate.state: DRAFT_CREATED
decision.id: df7fe111-ff4c-4853-a664-d40c145d748f
listingDraft.id: 1dc52f81-88be-444c-bace-fb134045894b
ebay_draft_id: null
dry_run_only: true
```

Resultado: OK.

## Confirmacion de idempotencia

Se repitio exactamente el mismo request `record_decision`.

Confirmado:

- No duplico decision.
- No duplico draft.
- SQL de duplicados por `idempotency_key` devolvio 0 filas.

## Confirmacion DB final

Confirmado en Supabase staging:

```text
candidate.state = DRAFT_CREATED
ebay_draft_id = null
dry_run_only = true
state PUBLISHED = 0 filas
duplicados por idempotency_key = 0 filas
audit log existente
```

Audit log:

- Evento de candidato validado.
- Evento de decision con transicion a `DRAFT_CREATED`.

## Confirmacion no eBay real

Confirmado:

- No se conecto eBay real.
- No se publico listing real.
- No se creo draft externo real.
- `ebay_draft_id` permanece `null`.
- La DB fuerza `ebay_draft_id is null`.
- El pipeline no tiene llamada real a API eBay en esta fase.

## Confirmacion no WhatsApp real

Confirmado:

- No se envio WhatsApp real.
- Approval card se genero como dry-run.
- `whatsappDryRunPayload.dryRun = true`.
- `enableRealSend = false`.
- No se documentaron destinatarios reales ni tokens.

## Validaciones locales

Ejecutadas antes de cierre:

```bash
git diff --check
node --test tools/ebay-winner-pipeline-tests.mjs
node tools/ebay-winner-pipeline-qa.mjs
npx tsc --noEmit
```

Resultado esperado para cierre:

- `git diff --check`: OK.
- Tests unitarios dry-run: OK.
- QA dry-run: OK.
- TypeScript: OK.
- Si `tsconfig.tsbuildinfo` cambia, restaurarlo y no commitearlo.

## Datos sensibles

Este reporte no incluye:

- `Authorization` headers.
- `SUPABASE_SERVICE_ROLE_KEY`.
- Vercel bypass token.
- `_vercel_jwt` cookies.
- WhatsApp tokens.
- Luna Portex auth cookie.
- Llaves anon/service role.
- Secretos de proyecto.

## Riesgos pendientes

- La migracion solo esta aplicada en staging; produccion sigue pendiente de aprobacion humana.
- El merge a `main` no debe hacerse hasta aprobacion final.
- La publicacion real en eBay sigue fuera de alcance.
- WhatsApp real sigue fuera de alcance.
- Antes de produccion, repetir checklist de variables para confirmar que Preview/staging y Production no esten cruzados.

## Recomendacion final

Mergear: si, despues de aprobacion humana del PR #1.

Justificacion:

- Core dryRun validado localmente y en Supabase staging.
- Migracion aditiva validada en staging.
- Endpoint Preview autenticado validado contra staging.
- `process_radar_candidate` OK.
- `record_decision` OK.
- Idempotencia OK.
- `PUBLISHED` bloqueado.
- `ebay_draft_id` forzado a `null`.
- `dry_run_only` confirmado.
- Sin eBay real.
- Sin WhatsApp real.
- Produccion sigue limpia en `main`.

No hacer merge automatico desde esta fase. Esperar aprobacion humana.
