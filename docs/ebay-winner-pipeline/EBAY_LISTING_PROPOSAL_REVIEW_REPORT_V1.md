# eBay Listing Proposal Review Report V1

## 1. Propósito

Este reporte estandariza cómo una persona debe leer y revisar los resultados del dry run end-to-end de propuestas internas de listing eBay. Su objetivo es convertir la salida del runner en una lectura profesional, accionable y segura.

Este reporte es:

* local-only
* advisory-only
* human-review-required
* sin eBay API real
* sin OAuth/tokens
* sin drafts reales
* sin publicación
* sin cambios reales de listings
* sin Supabase

El reporte no autoriza publicación, no crea drafts reales y no modifica listings. Solo ayuda a decidir el siguiente paso humano.

## 2. Cuándo usar este reporte

Usar este reporte:

* después de ejecutar `tools/ebay-listing-proposal-dry-run.mjs`
* cuando un candidato pasa de selección de producto a propuesta de listing
* antes de preparar contenido manual
* antes de considerar cualquier draft manual futuro
* para comparar varios candidatos evaluados

## 3. Estructura del reporte

Secciones estándar:

1. Header
2. Executive Summary
3. Candidate Source
4. Listing Proposal Summary
5. QA Result Summary
6. Economics Review
7. Missing Data
8. Risk Flags
9. Blocked Reasons
10. Compliance Review
11. Copywriting Review
12. Image Review
13. Shipping/Returns Review
14. Safety Flags
15. Required Human Actions
16. Recommended Decision
17. Reviewer Notes

## 4. Header

Campos:

* `reportVersion`
* `generatedAt`
* `caseId`
* `candidateName`
* `schemaVersion`
* `listingState`
* `qaState`
* `advisoryOnly`
* `humanReviewRequired`

El header debe permitir identificar rápidamente qué caso fue evaluado y si el reporte mantiene las reglas V1 de seguridad.

## 5. Executive Summary

Debe responder:

* ¿El candidato puede pasar a revisión humana?
* ¿Está incompleto?
* ¿Requiere revisión?
* ¿Está bloqueado?
* ¿Cuál es el principal motivo?

Ejemplos de resumen:

* `Ready for human review`
* `Incomplete: missing weight, dimensions, stock`
* `Blocked: high VeRO/IP risk`
* `Review required: weak margin or price above market`

El resumen ejecutivo debe ser breve y accionable.

## 6. Candidate Source

Incluir:

* `sourceType`
* `sourceCaseId`
* `selectionDecision`
* `selectionState`
* `productCandidateId` si existe
* notas relevantes

No incluir proveedores reales, URLs privadas, credenciales ni información sensible. Si el origen no explica por qué el candidato avanzó, marcarlo para revisión humana.

## 7. Listing Proposal Summary

Incluir:

* `title`
* `category`
* `condition`
* `listingPrice`
* `quantity`
* `listingState`
* `humanReviewRequired`
* `advisoryOnly`

Esta sección debe indicar si la propuesta está lista internamente, incompleta, en revisión o bloqueada.

## 8. QA Result Summary

Incluir:

* `qaState`
* `passedChecks`
* `failedChecks`
* `warnings`
* `missingData`
* `riskFlags`
* `blockedReasons`
* `requiredHumanActions`

El QA summary debe explicar por qué el resultado es `QA_PASSED_FOR_HUMAN_REVIEW`, `QA_INCOMPLETE`, `QA_REVIEW_REQUIRED` o `QA_BLOCKED`.

## 9. Economics Review

Incluir:

* `listingPrice`
* `supplierCost`
* `supplierShippingCost`
* `buyerShippingCharge`
* `estimatedFees`
* `estimatedProfit`
* `estimatedRoiPercent`
* `estimatedNetMarginPercent`
* `soldCompsMedianPrice`
* `economicsStatus`

Reglas:

* profit mínimo recomendado: `$5`
* profit ideal: `$7+`
* ROI mínimo recomendado: `30%`
* margen neto recomendado: `20%`
* precio mayor que sold comps median +10% requiere revisión

Si la economía cambia por costo, shipping, fees o precio, volver a Product Selection antes de avanzar.

## 10. Missing Data

Incluir:

* `weight`
* `dimensions`
* `stock`
* `imageAuthorizationStatus`
* category confirmation
* required item specifics
* cualquier otro dato crítico

Interpretación:

* missing data crítico -> `QA_INCOMPLETE`
* no avanzar hasta completar datos

El reporte debe separar datos faltantes críticos de datos recomendados para que el siguiente paso humano sea claro.

## 11. Risk Flags

Incluir:

* price risk
* margin risk
* ROI risk
* return risk
* shipping risk
* copy risk
* image authorization risk
* compliance risk

Los risk flags no siempre bloquean, pero deben explicar por qué una propuesta requiere revisión antes de cualquier preparación manual.

## 12. Blocked Reasons

Incluir:

* `brand_or_vero_high`
* `medical_claims_high`
* `compliance_blocked`
* `unauthorized_images`
* `safety_flags_invalid`
* `restricted_product_risk`

Interpretación:

* blocked reasons -> no avanzar salvo revisión auditada

Si existe cualquier blocked reason, la decisión recomendada normalmente debe ser `BLOCK_DO_NOT_ADVANCE`.

## 13. Compliance Review

Cubrir:

* `brandRisk`
* `veroRisk`
* `medicalClaimsRisk`
* `restrictedProductRisk`
* `imageAuthorizationStatus`
* `complianceStatus`

Reglas:

* VeRO/IP high bloquea
* brandRisk high bloquea
* medicalClaimsRisk high bloquea
* imageAuthorizationStatus unknown deja incompleto
* compliance unresolved requiere revisión

Compliance debe revisarse antes de cualquier acción manual futura.

## 14. Copywriting Review

Cubrir:

* título claro
* no keyword stuffing
* no claims médicos
* no marcas no autorizadas
* no certificaciones inventadas
* descripción consistente con item specifics
* bullets útiles y verificables

El copy debe ser claro, verificable y seguro. No debe prometer resultados absolutos ni usar marcas o certificaciones sin soporte.

## 15. Image Review

Cubrir:

* main image
* dimensions image
* usage image
* package contents image
* `authorizationStatus`
* notes

Reglas:

* imágenes unknown -> incompleto
* imágenes no autorizadas -> bloqueado

El reporte no debe incluir capturas con datos sensibles ni imágenes de proveedores reales sin autorización.

## 16. Shipping/Returns Review

Cubrir:

* weight
* dimensions
* shipping method
* handling time
* estimated shipping cost
* return policy
* return risk

Shipping y returns deben ser realistas. Productos pesados, frágiles, lentos o con return risk medio/alto requieren revisión adicional.

## 17. Safety Flags

Confirmar:

* `advisoryOnly: true`
* `localOnly: true`
* `externalCallsMade: false`
* `ebayApiUsed: false`
* `realDraftCreated: false`
* `publishedToEbay: false`
* `listingMutated: false`
* `requiresHumanReview: true`

Si cualquiera contradice V1, el reporte debe recomendar bloqueo.

## 18. Recommended Decision

Decisiones humanas recomendadas:

* `PROCEED_TO_HUMAN_REVIEW`
* `COMPLETE_MISSING_DATA`
* `REVIEW_ECONOMICS`
* `REVIEW_COMPLIANCE`
* `BLOCK_DO_NOT_ADVANCE`
* `DISCARD_CANDIDATE`

Mapeo sugerido:

* `LISTING_DRAFT_READY` + `QA_PASSED_FOR_HUMAN_REVIEW` -> `PROCEED_TO_HUMAN_REVIEW`
* `QA_INCOMPLETE` -> `COMPLETE_MISSING_DATA`
* `QA_REVIEW_REQUIRED` -> revisar según riesgos
* `QA_BLOCKED` -> `BLOCK_DO_NOT_ADVANCE`

Ninguna decisión publica ni crea draft real.

## 19. Ejemplo de reporte simulado

### Ejemplo A — `LISTING-GEN-001`

Header:

* `reportVersion`: `EBAY_LISTING_PROPOSAL_REVIEW_REPORT_V1`
* `caseId`: `LISTING-GEN-001`
* `candidateName`: `Candidato ideal`
* `listingState`: `LISTING_DRAFT_READY`
* `qaState`: `QA_PASSED_FOR_HUMAN_REVIEW`
* `advisoryOnly`: `true`
* `humanReviewRequired`: `true`

Executive Summary:

* `Ready for human review`

Review:

* Economía aceptable.
* Sin missing data crítico.
* Sin blocked reasons.
* Imágenes autorizadas.
* Safety flags correctos.

Recommended Decision:

* `PROCEED_TO_HUMAN_REVIEW`

Interpretación: puede pasar a revisión humana, pero no publica ni crea draft real automáticamente.

### Ejemplo B — `LISTING-GEN-004`

Header:

* `reportVersion`: `EBAY_LISTING_PROPOSAL_REVIEW_REPORT_V1`
* `caseId`: `LISTING-GEN-004`
* `candidateName`: `VeRO o marca alto`
* `listingState`: `LISTING_BLOCKED`
* `qaState`: `QA_BLOCKED`
* `advisoryOnly`: `true`
* `humanReviewRequired`: `true`

Executive Summary:

* `Blocked: high VeRO/IP risk`

Review:

* `brandRisk` high.
* `veroRisk` high.
* Blocked reasons incluyen `brand_or_vero_high`.
* Safety flags correctos.

Recommended Decision:

* `BLOCK_DO_NOT_ADVANCE`

Interpretación: no avanzar salvo revisión auditada.

## 20. Qué NO incluir en el reporte

No incluir:

* tokens
* credenciales
* claves API
* URLs privadas
* información confidencial de proveedor
* datos de clientes
* capturas con información sensible
* identificadores privados no necesarios

El reporte debe ser seguro para revisión operativa y no debe contener datos reales sensibles.

## 21. Relación con archivos existentes

Este formato se relaciona con:

* `EBAY_LISTING_PROPOSAL_DRY_RUN_RUNBOOK_V1.md`
* `EBAY_LISTING_QA_CHECKLIST_V1.md`
* `EBAY_LISTING_DRAFT_SCHEMA_V1.md`
* `tools/ebay-listing-proposal-dry-run.mjs`
* `tools/fixtures/ebay-listing-generator-candidates-v1.json`

## 22. Próximos loops recomendados

* `LOOP 059 — eBay Listing Proposal Review Report Formatter V1`
* `LOOP 060 — eBay Listing Admin Read-Only Visibility Design V1`
* `LOOP 061 — eBay Listing Manual Review Workflow V1`
