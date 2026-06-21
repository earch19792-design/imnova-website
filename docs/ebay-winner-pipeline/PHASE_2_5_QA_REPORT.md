# PHASE_2_5_QA_REPORT — QA controlado del eBay Winner Pipeline Core

## Resumen ejecutivo

La Fase 2.5 se ejecutó en modo local, seguro y sin llamadas externas. No se conectó eBay real, no se envió WhatsApp real y no se desplegó producción.

Resultado: **NO recomiendo pasar a Fase 3 todavía** hasta completar una corrida contra Supabase local/staging con datos reales del Radar IMNOVA. El motor core sí pasó QA dryRun con 5 candidatos en formato Radar, persistencia simulada en todas las tablas nuevas, decisiones idempotentes y confirmación de que `PUBLISHED` no es alcanzable por la Fase 2.

## Alcance y limitaciones del entorno

| Control | Resultado |
|---|---|
| Producción | No tocada. |
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

## Migración Supabase

Archivo revisado:

```text
supabase/migrations/202606210001_create_ebay_winner_pipeline_core.sql
```

La migración es aditiva y define las tablas nuevas:

- `ebay_product_candidates`
- `ebay_candidate_validations`
- `ebay_profit_scenarios`
- `ebay_compliance_checks`
- `ebay_candidate_scores`
- `ebay_candidate_decisions`
- `ebay_listing_drafts`
- `ebay_pipeline_audit_log`

Estado QA:

- Aplicación real en Supabase: **bloqueada por falta de Supabase CLI/psql/variables seguras**.
- Validación lógica de persistencia: **pasó con Supabase in-memory harness**.
- Recomendación: aplicar la migración en Supabase local/staging antes de Fase 3 y repetir este reporte con capturas del SQL editor/logs anonimizados.

## Productos probados

> Estos productos son candidatos QA no sensibles con la misma forma de datos que consume el normalizador del Radar. No contienen secretos ni datos personales.

| # | SKU | Caso | Estado generado | Profit neto | Margen | ROI | Winner Score | Riesgos/datos faltantes |
|---:|---|---|---|---:|---:|---:|---:|---|
| 1 | `LP-QA-VALID-001` | Producto válido | `VALIDATED` | `$9.81` | `28.03%` | `98.10%` | `86` | Ninguno |
| 2 | `LP-QA-NOSTOCK-002` | Sin stock | `BLOCKED` | `$7.09` | `24.45%` | `88.63%` | `69` | `stock_zero` |
| 3 | `LP-QA-MISSING-SHIPPING-003` | Sin peso/dimensiones | `NEEDS_DATA` | `$10.03` | `29.50%` | `111.44%` | `82` | `weight_or_dimensions` |
| 4 | `LP-QA-LOW-MARGIN-004` | Margen bajo | `BLOCKED` | `-$6.85` | `-28.54%` | `-38.06%` | `58` | `margin_below_minimum` |
| 5 | `LP-QA-RISKY-BRAND-005` | Marca riesgosa | `BLOCKED` | `$11.96` | `30.67%` | `108.73%` | `85` | `risky_brand_or_vero` |

## Persistencia validada

El harness in-memory ejecutó `processRadarCandidateWithPersistence` y confirmó upserts sobre las tablas nuevas esperadas:

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

## Profit, compliance, Winner Score y explicación humana

Validaciones confirmadas:

- El producto válido quedó `VALIDATED` con profit positivo, margen mayor al mínimo, ROI mayor al mínimo y score alto.
- El producto sin stock quedó `BLOCKED` aunque el profit era positivo.
- El producto sin peso/dimensiones quedó `NEEDS_DATA` y no avanzó automáticamente.
- El producto con margen bajo quedó `BLOCKED` por `margin_below_minimum`.
- El producto con marca riesgosa quedó `BLOCKED` por `risky_brand_or_vero`.
- Todos los candidatos generaron explicación humana y payload WhatsApp dryRun.

## WhatsApp dryRun

Confirmado para los 5 candidatos:

```json
{
  "dryRun": true,
  "enableRealSend": false
}
```

No se llamó Graph API, no se usó `WHATSAPP_ACCESS_TOKEN` y no se envió ningún mensaje real.

## Decisiones idempotentes probadas

Las cuatro decisiones se ejecutaron dos veces con el mismo `candidateKey`, `messageId` y acción. El resultado fue idempotente: el ID de decisión se mantuvo igual en la repetición.

| Acción | Estado resultante | Idempotente | Draft local | `ebay_draft_id` |
|---|---|---|---|---|
| `create_draft` | `DRAFT_CREATED` | Sí | Sí | `null` |
| `reject` | `REJECTED` | Sí | No | `null` |
| `review_data` | `NEEDS_DATA` | Sí | No | `null` |
| `postpone` | `PAUSED` | Sí | No | `null` |

## Confirmación de draft local dryRun

`create_draft` generó únicamente un registro local en `ebay_listing_drafts` con:

- `dry_run_only = true`
- `ebay_draft_id = null`
- Sin llamada a API de eBay
- Sin publicación real

## Confirmación de que `PUBLISHED` no puede alcanzarse

Confirmaciones realizadas:

1. El arreglo de estados del core no incluye `PUBLISHED`.
2. La migración no incluye `PUBLISHED` en constraints de `ebay_product_candidates.state` ni `ebay_pipeline_audit_log.to_state`.
3. El QA harness confirmó `publishedReachable: false`.

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

| Área | Resultado | Acción recomendada |
|---|---|---|
| Supabase staging/local | No disponible en el entorno actual. | Provisionar `supabase` CLI/psql o variables seguras y repetir QA. |
| Datos reales del Radar | No consultables desde DB en este entorno. | Ejecutar el mismo harness contra `market_radar_latest_products` en staging. |
| `npm run build` | Falló por descarga de Google Font `Orbitron` desde `next/font`. | Resolver fuente local o permitir fetch en CI. |
| `npm run lint` | Falló porque ESLint 10 requiere `eslint.config.*`. | Agregar/migrar configuración ESLint. |

## Recomendación

**No pasar a Fase 3 todavía.**

Condiciones mínimas para aprobar Fase 3:

1. Aplicar la migración en Supabase local/staging, no producción.
2. Procesar 5 candidatos realmente leídos desde `market_radar_latest_products`.
3. Verificar registros reales en las 8 tablas nuevas.
4. Repetir decisiones idempotentes contra Supabase real.
5. Adjuntar logs anonimizados o screenshots de staging.
6. Mantener eBay y WhatsApp en dryRun hasta completar sandbox eBay y revisión humana.
