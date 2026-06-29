# eBay Listing QA Checklist V1

## 1. Propósito

Este checklist define cómo revisar una propuesta interna de listing antes de considerarla lista para revisión humana o preparación manual.

Reglas de seguridad:

- advisory-only
- local-first
- human-review-required
- no eBay API real
- no OAuth/tokens
- no drafts reales
- no publicación
- no cambios reales de listings

## 2. Principio Principal

Una propuesta de listing no debe avanzar solo porque el producto fue aprobado.

Reglas:

```text
APPROVED_FOR_DRAFT no significa publicar.
LISTING_APPROVED_FOR_MANUAL_DRAFT no crea draft real automáticamente.
```

Product Selection decide si vale la pena trabajar un producto. Listing QA decide si una propuesta interna está suficientemente completa, segura y clara para revisión humana.

## 3. Estados QA Recomendados

- `QA_NOT_STARTED`: la propuesta todavía no fue revisada.
- `QA_INCOMPLETE`: faltan datos requeridos para evaluar o preparar la propuesta.
- `QA_REVIEW_REQUIRED`: la propuesta puede ser viable, pero requiere criterio humano.
- `QA_BLOCKED`: existe un bloqueador crítico de riesgo, compliance o seguridad V1.
- `QA_PASSED_FOR_HUMAN_REVIEW`: la propuesta está completa para revisión humana.
- `QA_APPROVED_FOR_MANUAL_DRAFT`: un humano puede considerar preparación manual futura.

`QA_APPROVED_FOR_MANUAL_DRAFT` sigue requiriendo acción humana y no publica, no crea draft real y no modifica listings.

## 4. Checklist De Origen Del Candidato

Verificar:

- `selectionDecision`
- `selectionState`
- `sourceType`
- `sourceCaseId` o `productCandidateId`
- `notes`
- que el candidato no esté `blocked` o `rejected`
- que no existan riesgos críticos sin resolver

Reglas:

- `blocked / BLOCKED` no debe pasar a listing final.
- `reject / REJECTED` no debe pasar a listing final.
- `review / DATA_INCOMPLETE` requiere completar datos antes de avanzar.
- `approve / APPROVED_FOR_DRAFT` solo permite propuesta interna.

Si el origen no explica por qué el candidato avanzó, la propuesta debe quedar en `QA_REVIEW_REQUIRED` o `QA_INCOMPLETE`.

## 5. Checklist Económico

Verificar:

- `listingPrice`
- `supplierCost`
- `supplierShippingCost`
- `buyerShippingCharge`
- `estimatedFees`
- `estimatedProfit`
- `estimatedRoiPercent`
- `estimatedNetMarginPercent`
- `soldCompsMedianPrice`

Reglas:

- profit mínimo recomendado: `$5`
- profit ideal: `$7+`
- ROI mínimo recomendado: `30%`
- margen neto recomendado: `20%`
- precio no debe superar sold comps median +10% sin justificación
- si cambia precio, shipping o fees, volver a Product Selection

Si la economía depende de supuestos débiles o datos desactualizados, marcar `QA_REVIEW_REQUIRED`.

## 6. Checklist De Título

Verificar:

- contiene tipo de producto
- contiene keyword principal
- contiene atributo útil
- es legible
- no tiene keyword stuffing
- no usa marcas no autorizadas
- no usa claims médicos
- no usa claims absolutos
- no inventa certificaciones
- no usa símbolos decorativos innecesarios

Un título seguro debe ser útil para búsqueda y legible para humanos, sin atraer tráfico irrelevante.

## 7. Checklist De Descripción Y Bullets

Verificar:

- headline claro
- bullets con beneficios concretos
- detalles técnicos verificables
- `packageIncludes` claro
- `recommendedUse` razonable
- shipping/returns summary neutral
- no copia texto de proveedor sin revisión
- no promesas absolutas
- no claims médicos fuertes
- no certificaciones inventadas
- no contradice item specifics

La descripción debe ayudar al comprador a entender el producto sin crear expectativas falsas ni riesgos de compliance.

## 8. Checklist De Item Specifics

Verificar:

- required item specifics completos o marcados como `missing`
- recommended item specifics incluidos cuando existan
- `Brand` correcto o `Unbranded` solo si corresponde
- `MPN`, `Model`, `Material`, `Color`, `Size` y `Features` no inventados
- description no contradice item specifics
- valores pendientes agregados a `itemSpecifics.missing`

Regla: no inventar item specifics. Si falta información, marcar pendiente y requerir revisión humana.

## 9. Checklist De Imágenes

Verificar:

- `imagePlan` existe
- primera imagen definida como `main`
- `imageAuthorizationStatus` confirmado
- no imágenes no autorizadas
- no screenshots con datos sensibles
- no logos/marcas no autorizadas
- imágenes cubren uso, dimensiones, detalles o contenido si aplica

Reglas:

- `imageAuthorizationStatus: unknown` deja la propuesta incompleta.
- imágenes no autorizadas bloquean avance a listing final.

En V1 este checklist no sube imágenes, no descarga imágenes y no llama eBay real.

## 10. Checklist De Shipping

Verificar:

- `weight`
- `dimensions`
- `shippingMethod`
- `estimatedShippingCost`
- `handlingTime`
- `shippingRiskFlags`
- `shippingNotes`

Reglas:

- sin peso o dimensiones: `LISTING_DATA_INCOMPLETE`
- no prometer fechas no verificadas
- productos frágiles, pesados o lentos requieren revisión

Si shipping depende de estimados sin soporte, marcar `QA_REVIEW_REQUIRED`.

## 11. Checklist De Returns

Verificar:

- `returnsAccepted`
- `returnWindowDays`
- `buyerPaysReturnShipping`
- `returnRiskLevel`
- `returnNotes`

Reglas:

- política debe alinearse al riesgo del producto
- `returnRisk high` requiere revisión humana
- no ocultar condiciones relevantes

Returns debe ser claro, neutral y compatible con el riesgo operacional del producto.

## 12. Checklist De Compliance eBay

Verificar:

- `brandRisk`
- `veroRisk`
- `medicalClaimsRisk`
- `restrictedProductRisk`
- `imageAuthorizationStatus`
- `complianceStatus`
- `complianceNotes`
- `blockedReasons`

Bloqueadores:

- `brandRisk: high`
- `veroRisk: high`
- `medicalClaimsRisk: high`
- producto restringido sin revisión
- imágenes no autorizadas
- `complianceStatus unresolved` con riesgo crítico

Si hay un bloqueador, el resultado QA debe ser `QA_BLOCKED`.

## 13. Checklist De Palabras/Frases De Riesgo

Revisar y marcar:

- `cure`
- `treats`
- `prevents disease`
- `FDA approved`
- `official`
- `guaranteed`
- `100% safe`
- `best in the world`
- marcas protegidas no relacionadas
- compatibilidad no verificada

Esta no es una lista legal completa. Es una guía operativa V1 para reducir riesgo antes de revisión humana.

## 14. Checklist De Safety Flags

Verificar que en V1:

- `advisoryOnly: true`
- `localOnly: true`
- `externalCallsMade: false`
- `ebayApiUsed: false`
- `realDraftCreated: false`
- `publishedToEbay: false`
- `listingMutated: false`
- `requiresHumanReview: true`

Si cualquiera de estos flags contradice la seguridad V1, bloquear con `QA_BLOCKED`.

## 15. Matriz De Decisión QA

### `QA_PASSED_FOR_HUMAN_REVIEW`

Usar cuando:

- economía aceptable
- copy claro
- datos suficientes
- sin bloqueadores de compliance
- imágenes autorizadas
- safety flags correctos

### `QA_INCOMPLETE`

Usar cuando:

- faltan peso/dimensiones
- falta stock
- falta autorización de imágenes
- faltan item specifics críticos

### `QA_REVIEW_REQUIRED`

Usar cuando:

- margen dudoso
- precio sobre mercado
- return risk medio/alto
- shipping risk medio/alto
- copy necesita revisión humana
- compliance no crítico pero pendiente

### `QA_BLOCKED`

Usar cuando:

- VeRO/IP high
- `brandRisk high`
- `medicalClaimsRisk high`
- producto restringido crítico
- imágenes no autorizadas
- seguridad V1 violada

`QA_APPROVED_FOR_MANUAL_DRAFT` solo puede llegar después de revisión humana. No publica ni crea draft real automáticamente.

## 16. Checklist Rápido Antes De Avanzar

Antes de avanzar, responder:

- ¿El producto sigue siendo económicamente viable?
- ¿El título es claro y seguro?
- ¿La descripción no exagera?
- ¿Los item specifics son verificables?
- ¿Las imágenes están autorizadas?
- ¿Shipping y returns son realistas?
- ¿No hay VeRO/IP high?
- ¿No hay claims médicos fuertes?
- ¿Los safety flags están correctos?
- ¿Un humano debe revisar antes de cualquier acción?

Si alguna respuesta es negativa o incierta, no avanzar sin revisión humana.

## 17. Ejemplo QA Simulado

Propuesta simulada: compact desk organizer.

Resultado económico:

- `estimatedProfit`: `$13.46`
- `estimatedRoiPercent`: `112.17`
- `estimatedNetMarginPercent`: `42.06`
- sold comps median cercano al precio propuesto

Resultado de copy:

- título claro y sin keyword stuffing
- bullets concretos
- sin claims médicos
- sin marcas protegidas
- sin certificaciones inventadas

Resultado de imágenes:

- `imagePlan` existe
- imagen principal definida
- derechos de imagen requieren confirmación humana antes de cualquier paso real

Resultado de compliance:

- sin VeRO/IP high
- sin brandRisk high
- sin medicalClaimsRisk high
- sin blocked reasons

Estado QA final simulado:

```text
QA_PASSED_FOR_HUMAN_REVIEW
```

Acciones humanas requeridas:

- confirmar categoría
- confirmar item specifics pendientes
- confirmar derechos de imagen
- revisar shipping/returns antes de cualquier preparación manual

Este ejemplo no representa producto real, proveedor real, URL ni dato sensible.

## 18. Relación Con Documentos Existentes

Referencias relacionadas:

- `docs/ebay-winner-pipeline/EBAY_LISTING_CREATION_STRATEGY_V1.md`
- `docs/ebay-winner-pipeline/EBAY_LISTING_DRAFT_SCHEMA_V1.md`
- `docs/ebay-winner-pipeline/EBAY_LISTING_COPYWRITING_RULES_V1.md`
- `docs/ebay-winner-pipeline/PRODUCT_SELECTION_STRATEGY_V1.md`

## 19. Próximos Loops Recomendados

- `LOOP 052 — eBay Listing Proposal Generator Dry Run V1`
- `LOOP 053 — eBay Listing Proposal Fixture Tests V1`
- `LOOP 054 — eBay Listing QA Runner V1`
