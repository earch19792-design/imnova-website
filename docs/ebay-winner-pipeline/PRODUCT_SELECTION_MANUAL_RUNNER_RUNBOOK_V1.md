# Product Selection Manual Runner Runbook V1

## 1. Propósito

El Product Selection Manual Runner permite evaluar candidatos de producto localmente antes de cualquier integración real con eBay. Sirve para revisar si un producto simulado o preparado manualmente califica como oportunidad, requiere revisión, debe rechazarse o debe bloquearse.

Reglas de seguridad:

- advisory-only
- local-only
- sin Supabase
- sin eBay API real
- sin OAuth/tokens
- sin drafts reales
- sin publicación
- sin cambios reales de listings

El runner no crea drafts, no publica, no cambia listings y no escribe en bases de datos.

## 2. Cuándo Usarlo

Usar este runner cuando se necesite:

- evaluar un producto encontrado manualmente
- comparar varios candidatos simulados
- revisar margen, ROI, stock, riesgo y datos faltantes
- probar casos antes de llevarlos a Admin o al pipeline
- confirmar rápidamente si un candidato necesita más datos antes de cualquier revisión humana

## 3. Comandos Principales

Evaluar un caso del QA Pack:

```bash
node tools/product-selection-evaluate-candidate.mjs \
  --file tools/fixtures/product-selection-candidates-v1.json \
  --case QA-001
```

Evaluar todos los casos del QA Pack:

```bash
node tools/product-selection-evaluate-candidate.mjs \
  --file tools/fixtures/product-selection-candidates-v1.json \
  --all
```

Evaluar la plantilla manual segura:

```bash
node tools/product-selection-evaluate-candidate.mjs \
  --file tools/fixtures/product-selection-manual-candidate.example.json \
  --case manual
```

## 4. Cómo Interpretar El Resultado

- `approve / APPROVED_FOR_DRAFT`: candidato prometedor, pero todavía requiere revisión humana.
- `review / DATA_INCOMPLETE`: faltan datos antes de avanzar.
- `review / MARGIN_REVIEW`: la economía es débil o el precio necesita revisión.
- `review / RISK_REVIEW`: existe riesgo no bloqueante que requiere revisión.
- `blocked / BLOCKED`: no avanzar salvo revisión auditada.
- `reject / REJECTED`: economía inviable.

`approve` no crea draft real, no publica y no autoriza acciones automáticas. Solo significa que el candidato puede considerarse para un flujo interno futuro de preparación, con revisión humana.

## 5. Campos Mínimos Recomendados Del Candidato

Campos recomendados para una evaluación útil:

- `title`
- `supplierCost`
- `supplierShippingCost`
- `estimatedEbayPrice`
- `buyerShippingCharge`
- `stockAvailable`
- `stockStatus`
- `weight`
- `dimensions`
- `brandRisk`
- `veroRisk`
- `medicalClaimsRisk`
- `returnRisk`
- `imageAuthorizationStatus`
- `soldCompsMedianPrice`

Mientras más incompletos estén estos campos, más probable es que el resultado sea `review / DATA_INCOMPLETE`.

## 6. Checklist Antes De Evaluar Un Producto Real

Antes de copiar datos en un JSON local:

- no pegar credenciales
- no pegar tokens
- no pegar OAuth secrets
- no pegar URLs privadas
- no pegar información confidencial del proveedor
- usar datos aproximados o públicos cuando sea posible
- revisar derechos de imagen
- confirmar stock
- confirmar peso/dimensiones
- revisar riesgos de marca/VeRO
- tratar el resultado como recomendación, no como aprobación automática

## 7. Flujo Recomendado

1. Copiar `tools/fixtures/product-selection-manual-candidate.example.json`.
2. Reemplazar los datos simulados por datos seguros.
3. Ejecutar el runner.
4. Leer decisión, estado, riesgos y números clave.
5. Si es `approve`, hacer revisión humana antes de cualquier preparación interna.
6. Si es `review`, completar datos o ajustar economía.
7. Si es `blocked`, no avanzar salvo revisión auditada.
8. No publicar desde este flujo.

## 8. Relación Con QA Pack

Referencias relacionadas:

- `docs/ebay-winner-pipeline/PRODUCT_SELECTION_QA_PACK_V1.md`
- `tools/fixtures/product-selection-candidates-v1.json`
- `tools/product-selection-evaluate-candidate.mjs`

El QA Pack define casos esperados. El runner permite ejecutar esos casos o candidatos manuales locales con la misma lógica de Product Selection Advisor.
