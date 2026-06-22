# PHASE_2_5_QA_REPORT â€” QA controlado del eBay Winner Pipeline Core

## Resumen ejecutivo

La Fase 2.5 se ejecutÃ³ en modo local, seguro y sin llamadas externas. No se conectÃ³ eBay real, no se enviÃ³ WhatsApp real y no se desplegÃ³ producciÃ³n.

Resultado: **NO recomiendo pasar a Fase 3 todavÃ­a** hasta completar una corrida contra Supabase local/staging con datos reales del Radar IMNOVA. El motor core sÃ­ pasÃ³ QA dryRun con 5 candidatos en formato Radar, persistencia simulada en todas las tablas nuevas, decisiones idempotentes y confirmaciÃ³n de que `PUBLISHED` no es alcanzable por la Fase 2.

## Alcance y limitaciones del entorno

| Control | Resultado |
|---|---|
| ProducciÃ³n | No tocada. |
| Deploy | No ejecutado. |
| eBay real | No conectado. |
| WhatsApp real | No enviado. |
| Supabase local/staging | **No aplicado**: el entorno no expuso `supabase` CLI, `psql` ni variables `SUPABASE_*`. |
| Datos reales del Radar | **No disponibles desde DB** en este entorno. Se usaron 5 candidatos no sensibles con el formato real normalizado del Radar para validar el motor. |
| Screenshots/logs | Se generaron logs JSON no sensibles desde `tools/ebay-winner-pipeline-qa.mjs`. |

## Comandos ejecutados

```bash
node tools/ebay-winner-pipeline-qa.mjs
node --test tools/ebay-winner-pipeline-tests.mjs
npx tsc --noEmit
npm run build
npm run lint
```

## MigraciÃ³n Supabase

Archivo revisado:

```text
supabase/migrations/202606210001_create_ebay_winner_pipeline_core.sql
```

La migraciÃ³n es aditiva y define las tablas nuevas:

- `ebay_product_candidates`
- `ebay_candidate_validations`
- `ebay_profit_scenarios`
- `ebay_compliance_checks`
- `ebay_candidate_scores`
- `ebay_candidate_decisions`
- `ebay_listing_drafts`
- `ebay_pipeline_audit_log`

Estado QA:

- AplicaciÃ³n real en Supabase: **bloqueada por falta de Supabase CLI/psql/variables seguras**.
- ValidaciÃ³n lÃ³gica de persistencia: **pasÃ³ con Supabase in-memory harness**.
- RecomendaciÃ³n: aplicar la migraciÃ³n en Supabase local/staging antes de Fase 3 y repetir este reporte con capturas del SQL editor/logs anonimizados.

## Productos probados

> Estos productos son candidatos QA no sensibles con la misma forma de datos que consume el normalizador del Radar. No contienen secretos ni datos personales.

| # | SKU | Caso | Estado generado | Profit neto | Margen | ROI | Winner Score | Riesgos/datos faltantes |
|---:|---|---|---|---:|---:|---:|---:|---|
| 1 | `LP-QA-VALID-001` | Producto vÃ¡lido | `VALIDATED` | `$9.81` | `28.03%` | `98.10%` | `86` | Ninguno |
| 2 | `LP-QA-NOSTOCK-002` | Sin stock | `BLOCKED` | `$7.09` | `24.45%` | `88.63%` | `69` | `stock_zero` |
| 3 | `LP-QA-MISSING-SHIPPING-003` | Sin peso/dimensiones | `NEEDS_DATA` | `$10.03` | `29.50%` | `111.44%` | `82` | `weight_or_dimensions` |
| 4 | `LP-QA-LOW-MARGIN-004` | Margen bajo | `BLOCKED` | `-$6.85` | `-28.54%` | `-38.06%` | `58` | `margin_below_minimum` |
| 5 | `LP-QA-RISKY-BRAND-005` | Marca riesgosa | `BLOCKED` | `$11.96` | `30.67%` | `108.73%` | `85` | `risky_brand_or_vero` |

## Persistencia validada

El harness in-memory ejecutÃ³ `processRadarCandidateWithPersistence` y confirmÃ³ upserts sobre las tablas nuevas esperadas:

| Tabla | Registros esperados | Registros observados |
|---|---:|---:|
| `ebay_product_candidates` | 5 | 5 |
| `ebay_candidate_validations` | 5 | 5 |
| `ebay_profit_scenarios` | 5 | 5 |
| `ebay_compliance_checks` | 5 | 5 |
| `ebay_candidate_scores` | 5 | 5 |
| `ebay_candidate_decisions` | 4 | 4 |
| `ebay_listing_drafts` | 1 | 1 |
| `ebay_pipeline_audit_log` | 9 | 9 |

## Profit, compliance, Winner Score y explicaciÃ³n humana

Validaciones confirmadas:

- El producto vÃ¡lido quedÃ³ `VALIDATED` con profit positivo, margen mayor al mÃ­nimo, ROI mayor al mÃ­nimo y score alto.
- El producto sin stock quedÃ³ `BLOCKED` aunque el profit era positivo.
- El producto sin peso/dimensiones quedÃ³ `NEEDS_DATA` y no avanzÃ³ automÃ¡ticamente.
- El producto con margen bajo quedÃ³ `BLOCKED` por `margin_below_minimum`.
- El producto con marca riesgosa quedÃ³ `BLOCKED` por `risky_brand_or_vero`.
- Todos los candidatos generaron explicaciÃ³n humana y payload WhatsApp dryRun.

## WhatsApp dryRun

Confirmado para los 5 candidatos:

```json
{
  "dryRun": true,
  "enableRealSend": false
}
```

No se llamÃ³ Graph API, no se usÃ³ `WHATSAPP_ACCESS_TOKEN` y no se enviÃ³ ningÃºn mensaje real.

## Decisiones idempotentes probadas

Las cuatro decisiones se ejecutaron dos veces con el mismo `candidateKey`, `messageId` y acciÃ³n. El resultado fue idempotente: el ID de decisiÃ³n se mantuvo igual en la repeticiÃ³n.

| AcciÃ³n | Estado resultante | Idempotente | Draft local | `ebay_draft_id` |
|---|---|---|---|---|
| `create_draft` | `DRAFT_CREATED` | SÃ­ | SÃ­ | `null` |
| `reject` | `REJECTED` | SÃ­ | No | `null` |
| `review_data` | `NEEDS_DATA` | SÃ­ | No | `null` |
| `postpone` | `PAUSED` | SÃ­ | No | `null` |

## ConfirmaciÃ³n de draft local dryRun

`create_draft` generÃ³ Ãºnicamente un registro local en `ebay_listing_drafts` con:

- `dry_run_only = true`
- `ebay_draft_id = null`
- Sin llamada a API de eBay
- Sin publicaciÃ³n real

## ConfirmaciÃ³n de que `PUBLISHED` no puede alcanzarse

Confirmaciones realizadas:

1. El arreglo de estados del core no incluye `PUBLISHED`.
2. La migraciÃ³n no incluye `PUBLISHED` en constraints de `ebay_product_candidates.state` ni `ebay_pipeline_audit_log.to_state`.
3. El QA harness confirmÃ³ `publishedReachable: false`.

## Logs no sensibles

Resumen del log JSON generado por `node tools/ebay-winner-pipeline-qa.mjs`:

```json
{
  "processedCount": 5,
  "states": ["VALIDATED", "BLOCKED", "NEEDS_DATA", "BLOCKED", "BLOCKED"],
  "whatsappDryRunAll": true,
  "enableRealSendAll": false,
  "decisionActions": ["create_draft", "reject", "review_data", "postpone"],
  "decisionsIdempotent": true,
  "localDraftsCreated": 1,
  "publishedReachable": false
}
```

## Errores encontrados

| Ãrea | Resultado | AcciÃ³n recomendada |
|---|---|---|
| Supabase staging/local | No disponible en el entorno actual. | Provisionar `supabase` CLI/psql o variables seguras y repetir QA. |
| Datos reales del Radar | No consultables desde DB en este entorno. | Ejecutar el mismo harness contra `market_radar_latest_products` en staging. |
| `npm run build` | FallÃ³ por descarga de Google Font `Orbitron` desde `next/font`. | Resolver fuente local o permitir fetch en CI. |
| `npm run lint` | FallÃ³ porque ESLint 10 requiere `eslint.config.*`. | Agregar/migrar configuraciÃ³n ESLint. |

## RecomendaciÃ³n

**No pasar a Fase 3 todavÃ­a.**

Condiciones mÃ­nimas para aprobar Fase 3:

1. Aplicar la migraciÃ³n en Supabase local/staging, no producciÃ³n.
2. Procesar 5 candidatos realmente leÃ­dos desde `market_radar_latest_products`.
3. Verificar registros reales en las 8 tablas nuevas.
4. Repetir decisiones idempotentes contra Supabase real.
5. Adjuntar logs anonimizados o screenshots de staging.
6. Mantener eBay y WhatsApp en dryRun hasta completar sandbox eBay y revisiÃ³n humana.
