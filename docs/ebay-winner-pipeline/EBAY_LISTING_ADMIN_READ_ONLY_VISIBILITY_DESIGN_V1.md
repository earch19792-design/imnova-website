# eBay Listing Admin Read-Only Visibility Design V1

## 1. Propósito

Este diseño define cómo mostrar en Admin las propuestas internas de listing eBay y sus reportes de revisión, sin permitir acciones reales. El objetivo es que un Admin, reviewer u operador pueda entender el estado del flujo local sin conectar eBay ni modificar información real.

Este diseño es:

* read-only
* advisory-only
* human-review-required
* sin eBay API real
* sin OAuth/tokens
* sin drafts reales
* sin publicación
* sin cambios reales de listings
* sin Supabase changes en este loop

Este loop solo documenta visibilidad. No implementa UI, API, servicios, migraciones ni persistencia.

## 2. Principio principal

Admin puede ver y revisar información, pero no ejecutar acciones reales.

Reglas:

* No botón de publicar.
* No botón de crear draft real.
* No botón de sincronizar eBay.
* No botón de modificar listing activo.
* No acción automática basada en recommendedDecision.
* Toda decisión requiere humano.

La pantalla debe reforzar que el resultado es una lectura operativa interna, no una autorización para operar en eBay.

## 3. Usuarios y objetivo de pantalla

Usuarios:

* Admin interno
* reviewer humano
* operador de producto/listing

Objetivo:

* entender rápidamente si una propuesta puede avanzar
* identificar si necesita datos
* detectar si requiere revisión económica, compliance, copy, imágenes o shipping/returns
* ver si está bloqueada
* leer acciones humanas recomendadas sin ejecutar acciones reales

## 4. Ubicación sugerida en Admin

Ubicación sugerida dentro del panel eBay Winner Pipeline:

* bloque dentro de detalle de candidato
* pestaña futura `Listing Proposal`
* sección `Listing Dry Run`
* sección `Review Report`
* sección `Manual Review`

Esto es diseño. No implementar UI en este loop.

## 5. Vista de lista

La vista de lista puede usar columnas o cards compactas para comparar propuestas.

Campos recomendados:

* candidate title/name
* caseId o candidate id
* listingState
* qaState
* recommendedDecision
* risk level
* missingData count
* blockedReasons count
* updatedAt/generatedAt
* badge `Read-only`
* badge `No eBay action`

La lista debe permitir identificar rápidamente qué casos están listos para revisión humana, incompletos, en revisión o bloqueados.

## 6. Vista de detalle

Secciones recomendadas:

1. Header
2. Candidate Source
3. Listing Proposal Summary
4. QA Result Summary
5. Review Report
6. Economics
7. Missing Data
8. Risk Flags
9. Blocked Reasons
10. Compliance
11. Copywriting
12. Images
13. Shipping/Returns
14. Safety Flags
15. Required Human Actions
16. Manual Review Notes

La vista de detalle debe priorizar lectura rápida, trazabilidad y seguridad. No debe mostrar payload completo por defecto.

## 7. Header del detalle

Campos:

* candidate name
* listingState
* qaState
* recommendedDecision
* advisoryOnly
* humanReviewRequired
* generatedAt
* read-only badge

El header debe dejar claro si el caso puede pasar a revisión humana, necesita datos, requiere revisión o está bloqueado.

## 8. Badges recomendados

Badges:

* `Read-only`
* `Dry-run`
* `No eBay API`
* `No real draft`
* `Not published`
* `Human review required`
* `Blocked`
* `Needs data`
* `Review economics`
* `Proceed to human review`

Los badges deben reforzar el estado y la seguridad sin sugerir acciones reales.

## 9. Colores/semántica visual

Semántica sugerida:

* verde: passed/proceed to human review
* amarillo: review required
* naranja: incomplete/missing data
* rojo: blocked
* gris: read-only/safety

La UI final debe mantener consistencia con diseño IMNOVA. Esta sección solo define intención visual, no implementación.

## 10. Acciones permitidas en V1

Solo read-only o acciones no peligrosas futuras:

* copiar resumen
* descargar reporte local futuro
* marcar como revisado internamente futuro, solo después de diseñar backend
* agregar nota manual futura, solo si existe modelo seguro

En este loop no implementar ninguna acción.

## 11. Acciones prohibidas

Acciones prohibidas:

* publicar en eBay
* crear draft real
* conectar OAuth
* sincronizar con eBay
* actualizar listing activo
* cambiar precio real
* cambiar stock real
* enviar datos a eBay
* ejecutar acciones masivas
* ocultar bloqueadores

Estas acciones no deben existir como botones, links, comandos rápidos ni automatizaciones derivadas de recommendedDecision.

## 12. Estados mostrados

Listing states:

* `LISTING_DRAFT_READY`
* `LISTING_DATA_INCOMPLETE`
* `LISTING_REVIEW_REQUIRED`
* `LISTING_BLOCKED`

QA states:

* `QA_PASSED_FOR_HUMAN_REVIEW`
* `QA_INCOMPLETE`
* `QA_REVIEW_REQUIRED`
* `QA_BLOCKED`

Recommended decisions:

* `PROCEED_TO_HUMAN_REVIEW`
* `COMPLETE_MISSING_DATA`
* `REVIEW_ECONOMICS`
* `REVIEW_COMPLIANCE`
* `BLOCK_DO_NOT_ADVANCE`
* `DISCARD_CANDIDATE`

Manual review states:

* `MANUAL_REVIEW_NOT_STARTED`
* `MANUAL_REVIEW_IN_PROGRESS`
* `MANUAL_REVIEW_NEEDS_DATA`
* `MANUAL_REVIEW_NEEDS_ECONOMICS`
* `MANUAL_REVIEW_NEEDS_COMPLIANCE`
* `MANUAL_REVIEW_BLOCKED`
* `MANUAL_REVIEW_READY_FOR_INTERNAL_APPROVAL`

Ningún estado publica ni crea draft real.

## 13. Safety flags visibles

Mostrar siempre:

* advisoryOnly
* localOnly
* externalCallsMade
* ebayApiUsed
* realDraftCreated
* publishedToEbay
* listingMutated
* requiresHumanReview

Si cualquier safety flag contradice V1, mostrar alerta roja y bloquear cualquier avance operativo futuro.

## 14. Empty/loading/error states

Empty:

* `No listing proposal generated yet.`
* `Run local dry-run before review.`

Loading:

* `Loading listing proposal review...`

Error:

* `Unable to load listing proposal review.`
* No mostrar tokens, payload completo ni datos sensibles.

Los estados vacíos y de error deben evitar sugerir que el sistema puede recuperar datos desde eBay real.

## 15. Datos sensibles y privacidad

Reglas:

* no mostrar tokens
* no mostrar credenciales
* no mostrar URLs privadas
* no mostrar datos confidenciales de proveedor
* no mostrar payload completo por defecto
* no mostrar datos de clientes
* no exponer OAuth
* no exponer headers

La vista debe estar diseñada para revisión operativa interna sin filtrar información sensible o innecesaria.

## 16. Ejemplos simulados de cómo se vería

### LISTING-GEN-001

* listingState: `LISTING_DRAFT_READY`
* qaState: `QA_PASSED_FOR_HUMAN_REVIEW`
* recommendedDecision: `PROCEED_TO_HUMAN_REVIEW`
* badge: `Human review required`

Lectura: puede pasar a revisión humana, sin publicar ni crear draft real.

### LISTING-GEN-004

* listingState: `LISTING_BLOCKED`
* qaState: `QA_BLOCKED`
* recommendedDecision: `BLOCK_DO_NOT_ADVANCE`
* badge: `Blocked`

Lectura: no avanzar por riesgo VeRO/IP o marca.

### LISTING-GEN-006

* listingState: `LISTING_REVIEW_REQUIRED`
* qaState: `QA_REVIEW_REQUIRED`
* recommendedDecision: `REVIEW_ECONOMICS`
* badge: `Review economics`

Lectura: revisar precio, margen, ROI, fees y sold comps antes de cualquier paso futuro.

## 17. Relación con archivos existentes

Este diseño se relaciona con:

* `EBAY_LISTING_MANUAL_REVIEW_WORKFLOW_V1.md`
* `EBAY_LISTING_PROPOSAL_REVIEW_REPORT_V1.md`
* `EBAY_LISTING_PROPOSAL_DRY_RUN_RUNBOOK_V1.md`
* `tools/ebay-listing-proposal-dry-run.mjs`
* `tools/fixtures/ebay-listing-generator-candidates-v1.json`

## 18. Próximos loops recomendados

* `LOOP 063 — eBay Listing Review Report Export Design V1`
* `LOOP 064 — eBay Listing Admin Read-Only Data Contract V1`
* `LOOP 065 — eBay Listing Preproduction Dry Run Plan V1`
