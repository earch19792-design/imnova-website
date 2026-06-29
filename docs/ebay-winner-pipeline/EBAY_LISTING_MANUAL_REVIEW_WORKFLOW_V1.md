# eBay Listing Manual Review Workflow V1

## 1. Propósito

Este workflow define cómo revisar manualmente una propuesta interna de listing antes de cualquier preparación futura. Su objetivo es convertir el dry run, el QA result y el review report en una decisión humana clara, segura y accionable.

Este workflow es:

* local-only
* advisory-only
* human-review-required
* sin eBay API real
* sin OAuth/tokens
* sin drafts reales
* sin publicación
* sin cambios reales de listings
* sin Supabase

El workflow no crea drafts reales, no publica, no modifica listings y no conecta con eBay. Solo guía la revisión humana previa a cualquier paso futuro.

## 2. Principio principal

Ningún resultado automático autoriza publicación.

Reglas:

* `PROCEED_TO_HUMAN_REVIEW` no publica.
* `QA_PASSED_FOR_HUMAN_REVIEW` no crea draft real.
* `LISTING_DRAFT_READY` no significa listo para eBay real.
* Toda acción futura requiere revisión humana explícita.

El sistema puede sugerir un siguiente paso, pero la decisión humana debe revisar datos, riesgos, economics, compliance, copy, imágenes, shipping, returns y safety flags antes de avanzar.

## 3. Inputs del reviewer

El reviewer debe leer:

* dry-run summary
* review report
* listing state
* QA state
* recommended decision
* missing data
* risk flags
* blocked reasons
* economics review
* compliance review
* copywriting review
* image review
* shipping/returns review
* safety flags

Si falta cualquiera de estos inputs críticos, la revisión debe quedar pendiente o incompleta.

## 4. Decisiones humanas permitidas

Decisiones permitidas:

* `APPROVE_FOR_INTERNAL_REVIEW`: el caso puede pasar a revisión interna detallada.
* `REQUEST_MISSING_DATA`: faltan datos antes de seguir evaluando.
* `REQUEST_ECONOMICS_REVIEW`: precio, margen, ROI, fees o sold comps requieren revisión.
* `REQUEST_COMPLIANCE_REVIEW`: marca, VeRO, claims, restricciones o imágenes requieren revisión.
* `REQUEST_COPY_REVIEW`: título, descripción, bullets o item specifics requieren ajuste humano.
* `REQUEST_IMAGE_REVIEW`: derechos, cobertura visual o contenido de imagen requieren revisión.
* `BLOCK_PRODUCT`: existe un bloqueador operativo, compliance o safety V1.
* `DISCARD_PRODUCT`: el candidato no debe seguir en el flujo.

Ninguna decisión crea draft real, publica ni modifica eBay. Todas son decisiones internas para guiar trabajo humano.

## 5. Mapeo desde recommendedDecision

Mapeo recomendado:

* `PROCEED_TO_HUMAN_REVIEW` -> puede pasar a revisión humana detallada.
* `COMPLETE_MISSING_DATA` -> pedir datos faltantes.
* `REVIEW_ECONOMICS` -> revisar precio, margen, ROI, fees y sold comps.
* `REVIEW_COMPLIANCE` -> revisar VeRO, marca, claims, imágenes y restricciones.
* `BLOCK_DO_NOT_ADVANCE` -> no avanzar salvo revisión auditada.
* `DISCARD_CANDIDATE` -> descartar candidato.

El mapeo no reemplaza criterio humano. Si el reviewer detecta un riesgo adicional, puede elevar el estado a revisión o bloqueo aunque el reporte sugiera avanzar.

## 6. Revisión económica

Checklist:

* profit mínimo: `$5`
* profit ideal: `$7+`
* ROI mínimo: `30%`
* margen neto recomendado: `20%`
* precio vs sold comps
* shipping cost
* fees estimados
* buyer shipping charge
* cambios que obligan a volver a Product Selection

Reglas:

* Si el profit queda bajo el mínimo recomendado, solicitar `REQUEST_ECONOMICS_REVIEW`.
* Si el ROI queda bajo el mínimo recomendado, solicitar `REQUEST_ECONOMICS_REVIEW`.
* Si el margen neto queda bajo el recomendado, solicitar `REQUEST_ECONOMICS_REVIEW`.
* Si el precio supera sold comps median +10% sin justificación, solicitar revisión.
* Si cambia precio, costo, shipping o fees, volver a Product Selection antes de avanzar.

## 7. Revisión de compliance

Checklist:

* `brandRisk`
* `veroRisk`
* `medicalClaimsRisk`
* `restrictedProductRisk`
* `imageAuthorizationStatus`
* `complianceStatus`
* `blockedReasons`

Bloqueadores:

* `brandRisk` high
* `veroRisk` high
* `medicalClaimsRisk` high
* imágenes no autorizadas
* producto restringido crítico
* safety flags inválidos

Si existe un bloqueador, usar `BLOCK_PRODUCT` o `REQUEST_COMPLIANCE_REVIEW` según la severidad y la evidencia disponible. No avanzar a preparación manual sin revisión auditada.

## 8. Revisión de copywriting

Checklist:

* título claro
* keyword principal natural
* sin keyword stuffing
* sin marcas no autorizadas
* sin claims médicos
* sin promesas absolutas
* sin certificaciones inventadas
* descripción consistente con item specifics

El copy debe vender con claridad, pero sin exagerar, engañar, usar marcas no autorizadas o hacer claims riesgosos. Si el copy no es verificable, solicitar `REQUEST_COPY_REVIEW`.

## 9. Revisión de imágenes

Checklist:

* autorización confirmada
* main image definida
* imágenes de dimensiones, uso o detalles si aplica
* sin logos o marcas no autorizadas
* sin screenshots con datos sensibles
* `imageAuthorizationStatus unknown` no puede avanzar a final-ready

Reglas:

* Imágenes con autorización unknown dejan el caso incompleto.
* Imágenes no autorizadas bloquean el avance.
* No usar imágenes de terceros como propias sin autorización.
* No incluir datos sensibles en capturas o notas visuales.

## 10. Revisión de shipping/returns

Checklist:

* `weight`
* `dimensions`
* shipping method
* handling time
* estimated shipping cost
* return policy
* return risk
* productos frágiles, pesados o lentos requieren revisión adicional

Shipping y returns deben ser realistas, neutrales y consistentes con el producto. Si faltan peso o dimensiones, pedir datos antes de avanzar. Si return risk es medio o alto, solicitar revisión humana.

## 11. Safety gate obligatorio

Antes de avanzar, confirmar:

* `advisoryOnly: true`
* `localOnly: true`
* `externalCallsMade: false`
* `ebayApiUsed: false`
* `realDraftCreated: false`
* `publishedToEbay: false`
* `listingMutated: false`
* `requiresHumanReview: true`

Si un flag contradice V1, bloquear. Un safety gate inválido tiene prioridad sobre cualquier recommended decision positiva.

## 12. Estados manuales recomendados

Estados recomendados:

* `MANUAL_REVIEW_NOT_STARTED`: todavía no se inició revisión humana.
* `MANUAL_REVIEW_IN_PROGRESS`: el reviewer está evaluando el caso.
* `MANUAL_REVIEW_NEEDS_DATA`: faltan datos críticos.
* `MANUAL_REVIEW_NEEDS_ECONOMICS`: economía requiere revisión.
* `MANUAL_REVIEW_NEEDS_COMPLIANCE`: compliance requiere revisión.
* `MANUAL_REVIEW_BLOCKED`: existe bloqueador crítico.
* `MANUAL_REVIEW_READY_FOR_INTERNAL_APPROVAL`: el caso puede avanzar a aprobación interna.

`MANUAL_REVIEW_READY_FOR_INTERNAL_APPROVAL` no crea draft real ni publica. Solo indica que el caso puede avanzar dentro del proceso interno.

## 13. Flujo recomendado

1. Ejecutar dry run.
2. Leer recommended decision.
3. Revisar missing data.
4. Revisar economics.
5. Revisar compliance.
6. Revisar copy.
7. Revisar imágenes.
8. Revisar shipping/returns.
9. Confirmar safety gate.
10. Registrar decisión humana.
11. No publicar desde este flujo.

Si en cualquier paso aparece un riesgo crítico, detener el avance y registrar la razón.

## 14. Ejemplos simulados

### LISTING-GEN-001

* recommended decision: `PROCEED_TO_HUMAN_REVIEW`
* acción humana sugerida: revisar manualmente contenido, imágenes y economics antes de cualquier preparación futura.

Interpretación: puede pasar a revisión humana detallada, pero no autoriza publicación ni crea draft real.

### LISTING-GEN-004

* recommended decision: `BLOCK_DO_NOT_ADVANCE`
* acción humana sugerida: no avanzar por riesgo VeRO/marca.

Interpretación: bloquear salvo revisión auditada con evidencia suficiente.

### LISTING-GEN-006

* recommended decision: `REVIEW_ECONOMICS`
* acción humana sugerida: revisar precio, margen, ROI y sold comps.

Interpretación: el caso puede ser operativo solo si la economía se valida o se ajusta antes de avanzar.

## 15. Qué NO hacer

No hacer:

* no conectar eBay desde este flujo
* no crear draft real
* no publicar
* no modificar listings activos
* no copiar payload completo a sistemas externos
* no pegar tokens
* no pegar credenciales
* no pegar URLs privadas
* no usar datos sensibles reales

El workflow es una guía operativa interna. No debe convertirse en integración real ni en autorización automática.

## 16. Relación con archivos existentes

Este workflow se apoya en:

* `EBAY_LISTING_PROPOSAL_REVIEW_REPORT_V1.md`
* `EBAY_LISTING_PROPOSAL_DRY_RUN_RUNBOOK_V1.md`
* `EBAY_LISTING_QA_CHECKLIST_V1.md`
* `EBAY_LISTING_COPYWRITING_RULES_V1.md`
* `tools/ebay-listing-proposal-dry-run.mjs`

## 17. Próximos loops recomendados

* `LOOP 062 — eBay Listing Admin Read-Only Visibility Design V1`
* `LOOP 063 — eBay Listing Review Report Export Design V1`
* `LOOP 064 — eBay Listing Preproduction Dry Run Plan V1`
