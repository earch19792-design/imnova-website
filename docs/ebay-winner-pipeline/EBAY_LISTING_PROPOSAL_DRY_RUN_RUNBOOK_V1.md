# eBay Listing Proposal Dry Run Runbook V1

## 1. Propósito

Este runbook explica cómo usar el runner local end-to-end para evaluar candidatos simulados o locales y producir una propuesta interna de listing junto con un resultado QA final.

Este flujo es:

* local-only
* advisory-only
* human-review-required
* sin eBay API real
* sin OAuth/tokens
* sin drafts reales
* sin publicación
* sin cambios reales de listings
* sin Supabase

El runner no crea listings reales, no prepara drafts reales en eBay y no autoriza publicación. Solo resume el resultado interno para revisión humana.

## 2. Qué hace el runner

El runner ejecuta el flujo completo:

```text
candidate -> listing proposal generator -> listing QA runner -> safe summary
```

Archivos relacionados:

* `tools/ebay-listing-proposal-dry-run.mjs`
* `lib/ebay-winner-pipeline/listing-proposal-generator.mjs`
* `lib/ebay-winner-pipeline/listing-proposal-qa-runner.mjs`
* `tools/fixtures/ebay-listing-generator-candidates-v1.json`

El resultado impreso es un resumen seguro. No imprime el payload completo del candidato ni de la propuesta.

## 3. Cuándo usarlo

Usar este runner para:

* probar candidatos simulados antes de cualquier flujo real
* validar si un producto puede convertirse en propuesta interna de listing
* revisar riesgos de listing antes de preparar contenido manual
* comparar estados entre candidatos
* entrenar el proceso de revisión humana

## 4. Comandos principales

Ejecutar un candidato ideal simulado:

```bash
node tools/ebay-listing-proposal-dry-run.mjs \
  --file tools/fixtures/ebay-listing-generator-candidates-v1.json \
  --case LISTING-GEN-001
```

Ejecutar un candidato bloqueado simulado:

```bash
node tools/ebay-listing-proposal-dry-run.mjs \
  --file tools/fixtures/ebay-listing-generator-candidates-v1.json \
  --case LISTING-GEN-004
```

Ejecutar todos los casos simulados:

```bash
node tools/ebay-listing-proposal-dry-run.mjs \
  --file tools/fixtures/ebay-listing-generator-candidates-v1.json \
  --all
```

## 5. Cómo interpretar Listing State

* `LISTING_DRAFT_READY`: propuesta interna completa para revisión humana.
* `LISTING_DATA_INCOMPLETE`: faltan datos antes de avanzar.
* `LISTING_REVIEW_REQUIRED`: requiere revisión por margen, precio, copy, shipping, returns o riesgo no crítico.
* `LISTING_BLOCKED`: no avanzar salvo revisión auditada.

`LISTING_DRAFT_READY` no crea draft real y no autoriza publicación. Solo indica que la propuesta interna está suficientemente completa para revisión humana.

## 6. Cómo interpretar QA State

* `QA_PASSED_FOR_HUMAN_REVIEW`: puede pasar a revisión humana.
* `QA_INCOMPLETE`: faltan datos.
* `QA_REVIEW_REQUIRED`: requiere revisión adicional.
* `QA_BLOCKED`: bloqueado por riesgo o safety flags.

Ningún QA state publica ni crea drafts reales automáticamente.

## 7. Casos fixture actuales

* `LISTING-GEN-001`: candidato ideal -> `LISTING_DRAFT_READY` + `QA_PASSED_FOR_HUMAN_REVIEW`.
* `LISTING-GEN-002`: datos incompletos -> incomplete/missing.
* `LISTING-GEN-003`: imagen unknown -> no final-ready.
* `LISTING-GEN-004`: VeRO/IP/marca high -> blocked.
* `LISTING-GEN-005`: medical claims high -> blocked.
* `LISTING-GEN-006`: margen débil/precio riesgoso -> review required.

Todos los casos son simulados y no contienen proveedores reales, URLs privadas, secretos ni datos sensibles reales.

## 8. Qué revisar en la salida

Revisar:

* listing schema
* listing state
* title
* advisory only
* human review required
* QA schema
* QA state
* missing data
* risk flags
* blocked reasons
* required human actions

Safety flags:

* eBay API used
* real draft created
* published to eBay
* listing mutated

Los safety flags deben confirmar que no hubo API real, draft real, publicación ni mutación de listings.

## 9. Qué NO hacer con este runner

No usar este runner para:

* copiar la salida a eBay como listing final sin revisión
* tratar `QA_PASSED_FOR_HUMAN_REVIEW` como autorización de publicación
* pegar tokens
* pegar credenciales
* pegar URLs privadas
* pegar datos reales sensibles
* usarlo como integración real de eBay
* modificar listings activos desde este flujo

## 10. Flujo recomendado de trabajo

1. Seleccionar candidato desde shortlist.
2. Confirmar datos mínimos con intake checklist.
3. Ejecutar dry run con `--case`.
4. Leer Listing State.
5. Leer QA State.
6. Revisar missing data, risk flags y blocked reasons.
7. Si pasa, preparar revisión humana.
8. Si está incomplete, completar datos.
9. Si está review required, revisar economía, copy o riesgo.
10. Si está blocked, no avanzar.
11. No publicar desde este flujo.

## 11. Ejemplo de lectura humana

### Ejemplo A — Candidato ideal

* Listing state: `LISTING_DRAFT_READY`
* QA state: `QA_PASSED_FOR_HUMAN_REVIEW`
* Interpretación: puede revisarse manualmente, pero no publicarse automáticamente.

### Ejemplo B — Candidato bloqueado

* Listing state: `LISTING_BLOCKED`
* QA state: `QA_BLOCKED`
* Interpretación: no avanzar por riesgo.

## 12. Relación con documentos existentes

Este runbook se apoya en:

* `EBAY_LISTING_CREATION_STRATEGY_V1.md`
* `EBAY_LISTING_DRAFT_SCHEMA_V1.md`
* `EBAY_LISTING_COPYWRITING_RULES_V1.md`
* `EBAY_LISTING_QA_CHECKLIST_V1.md`
* `PRODUCT_SELECTION_MANUAL_SHORTLIST_TEMPLATE_V1.md`

## 13. Próximos loops recomendados

* `LOOP 057 — eBay Listing End-to-End Dry Run Manual QA V1`
* `LOOP 058 — eBay Listing Proposal Review Report V1`
* `LOOP 059 — eBay Listing Admin Read-Only Visibility Design V1`
