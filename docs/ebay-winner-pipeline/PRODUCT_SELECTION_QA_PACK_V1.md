# Product Selection QA Pack V1

## 1. Propósito

Este QA Pack define casos simulados para validar que Product Selection Advisor toma decisiones correctas antes de usar productos reales, eBay API real, drafts o publicación.

El objetivo es confirmar que IMNOVA distingue productos aptos, productos que requieren revisión, productos rechazables y productos bloqueados sin ejecutar acciones reales.

Reglas de seguridad para este pack:

- advisory-only.
- sin eBay real.
- sin drafts reales.
- sin publicación.
- sin cambios reales de listings.
- sin decisiones automáticas sin revisión humana.

## 2. Referencias

- `docs/ebay-winner-pipeline/PRODUCT_SELECTION_STRATEGY_V1.md`
- `lib/ebay-winner-pipeline/product-selection-decision-service.mjs`
- `lib/ebay-winner-pipeline/service.mjs`
- `tools/ebay-winner-pipeline-tests.mjs`

## 3. Reglas Confirmadas

- Sin stock -> `blocked / BLOCKED`
- Stock desconocido -> `review / DATA_INCOMPLETE`
- Falta peso/dimensiones -> `review / DATA_INCOMPLETE`
- Riesgo VeRO/IP/marca alto -> `blocked / BLOCKED`
- Claims médicos high -> `blocked / BLOCKED`
- Precio > sold comps median +10% -> `review / MARGIN_REVIEW`
- Imagen no autorizada/unknown -> `review / DATA_INCOMPLETE`
- Profit <= 0 -> `reject / REJECTED`
- Profit bajo, ROI bajo o net margin bajo -> `review / MARGIN_REVIEW`
- Riesgos review no-data -> `review / RISK_REVIEW`

## 4. Casos QA V1

### QA-001 — Producto ideal

Input simulado resumido:

- `supplierCost`: `12`
- `supplierShippingCost`: `2`
- `estimatedEbayPrice`: `32`
- `stockAvailable`: `10`
- `stockStatus`: `available`
- `weight`: presente
- `dimensions`: completas
- `brandRisk`: `low`
- `veroRisk`: `low`
- `medicalClaimsRisk`: `low`
- `imageAuthorizationStatus`: `authorized`
- `soldCompsMedianPrice`: `31`

Resultado esperado:

- Decisión: `approve`
- Estado: `APPROVED_FOR_DRAFT`
- Riesgos esperados: ninguno crítico
- Razón esperada: pasa economía, stock, datos y riesgo
- Siguiente acción humana esperada: revisión humana para preparación interna futura

### QA-002 — Producto sin stock

Input simulado resumido:

- Igual al caso ideal
- `stockAvailable`: `0`

Resultado esperado:

- Decisión: `blocked`
- Estado: `BLOCKED`
- Riesgo esperado: `stock_zero`
- Razón esperada: no hay stock disponible
- Siguiente acción humana esperada: no avanzar hasta confirmar stock

### QA-003 — Stock desconocido

Input simulado resumido:

- `stockAvailable`: `null`
- `stockStatus`: `unknown`

Resultado esperado:

- Decisión: `review`
- Estado: `DATA_INCOMPLETE`
- Riesgo esperado: `stock_unknown`
- Razón esperada: falta confirmar stock antes de cualquier siguiente paso
- Siguiente acción humana esperada: confirmar stock real del proveedor

### QA-004 — Sin peso/dimensiones

Input simulado resumido:

- `weight`: `null`
- `dimensions`: `null`

Resultado esperado:

- Decisión: `review`
- Estado: `DATA_INCOMPLETE`
- Riesgos esperados:
  - `missing_weight`
  - `missing_dimensions`
- Razón esperada: faltan datos operativos requeridos
- Siguiente acción humana esperada: confirmar peso y dimensiones

### QA-005 — Margen bajo

Input simulado resumido:

- `supplierCost`: `20`
- `supplierShippingCost`: `4`
- `estimatedEbayPrice`: `29`

Resultado esperado:

- Decisión: `review` o `reject`
- Estado: `MARGIN_REVIEW` o `REJECTED`
- Riesgo esperado: economía insuficiente
- Razón esperada: profit, ROI o net margin no cumplen umbrales V1
- Siguiente acción humana esperada: revisar precio, costo, shipping y fees

### QA-006 — ROI bajo

Input simulado resumido:

- Costo alto
- Precio apenas rentable
- ROI menor a `30%`

Resultado esperado:

- Decisión: `review` o `reject`
- Estado: `MARGIN_REVIEW` o `REJECTED`
- Riesgo esperado: economía débil
- Razón esperada: ROI menor al umbral mínimo V1
- Siguiente acción humana esperada: revisar economía antes de avanzar

### QA-007 — VeRO/IP alto

Input simulado resumido:

- `veroRisk`: `high`
- o `brandRisk`: `high`

Resultado esperado:

- Decisión: `blocked`
- Estado: `BLOCKED`
- Riesgo esperado: `brand_or_vero_high`
- Razón esperada: riesgo alto de marca, IP o VeRO
- Siguiente acción humana esperada: no avanzar salvo revisión auditada

### QA-008 — Claims médicos fuertes

Input simulado resumido:

- `medicalClaimsRisk`: `high`

Resultado esperado:

- Decisión: `blocked`
- Estado: `BLOCKED`
- Riesgo esperado: `medical_claims_high`
- Razón esperada: claims médicos o de salud fuertes
- Siguiente acción humana esperada: no avanzar

### QA-009 — Precio sobre mercado

Input simulado resumido:

- `estimatedEbayPrice` mayor que `soldCompsMedianPrice * 1.10`

Resultado esperado:

- Decisión: `review`
- Estado: `MARGIN_REVIEW`
- Riesgo esperado: `price_above_market`
- Razón esperada: el precio estimado supera el rango competitivo de sold comps
- Siguiente acción humana esperada: revisar precio contra sold comps

### QA-010 — Imágenes no autorizadas

Input simulado resumido:

- `imageAuthorizationStatus`: `unknown`
- o `imageAuthorizationStatus`: `unauthorized`

Resultado esperado:

- Decisión: `review`
- Estado: `DATA_INCOMPLETE`
- Riesgo esperado: `image_authorization_missing`
- Razón esperada: autorización de imágenes no confirmada
- Siguiente acción humana esperada: confirmar derechos de imagen antes de preparar listing

## 5. Gaps Para Próximos Tests

Gaps detectados para convertir este pack en fixtures/tests parametrizados:

- Imagen no autorizada/unknown como caso explícito.
- Profit <= 0 para verificar `reject / REJECTED`.
- Riesgo review no bloqueante, por ejemplo `returnRisk: high` o `medicalClaimsRisk: medium`.
- Shipping lento/fragilidad para riesgo operacional review.
- Buyer shipping charge para validar economía con revenue total.

## 6. Próximo Loop Recomendado

`LOOP 042-IMPLEMENT — Product Selection QA Fixtures and Parametrized Tests V1`

Objetivo futuro:

- Crear `tools/fixtures/product-selection-candidates-v1.json`.
- Agregar tests parametrizados.
- Mantener todo sin eBay API real, sin Supabase, sin drafts y sin publicación.
