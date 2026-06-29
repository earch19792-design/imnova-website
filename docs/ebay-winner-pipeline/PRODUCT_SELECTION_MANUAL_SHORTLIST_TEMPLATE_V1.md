# Product Selection Manual Shortlist Template V1

## 1. Propósito

Esta plantilla sirve para comparar varios candidatos de producto antes de avanzar con investigación profunda o preparación interna.

La shortlist ayuda a ordenar oportunidades por economía, stock, riesgo, decisión del runner y siguiente acción humana. El objetivo no es aprobar automáticamente productos, sino seleccionar con más claridad qué candidatos merecen más revisión.

Reglas de seguridad:

- local-only
- advisory-only
- no eBay API real
- no Supabase
- no drafts reales
- no publicación
- no cambios reales de listings

## 2. Cuándo Usarla

Usar esta plantilla cuando se necesite:

- comparar 3 a 10 productos candidatos
- priorizar productos con mejor margen/riesgo
- separar productos aprobables de productos con datos incompletos
- documentar siguiente acción humana
- decidir qué producto investigar primero sin tocar eBay real

## 3. Campos De Shortlist

| Campo | Uso |
|---|---|
| `shortlistId` | Identificador local del candidato dentro de la shortlist. |
| `title` | Nombre descriptivo y seguro del producto. |
| `categoryGuess` | Categoría estimada para contexto de mercado y riesgo. |
| `supplierCost` | Costo base estimado. |
| `supplierShippingCost` | Costo estimado de envío o logística. |
| `estimatedEbayPrice` | Precio estimado para evaluar economía. |
| `soldCompsMedianPrice` | Mediana de vendidos comparables. |
| `stockStatus` | Estado de stock: `available`, `unknown` u otro valor seguro. |
| `stockAvailable` | Unidades disponibles o `null` si se desconoce. |
| `weightStatus` | `known`, `unknown` o `estimated`. |
| `dimensionsStatus` | `known`, `unknown` o `estimated`. |
| `imageAuthorizationStatus` | `authorized`, `unknown` o estado conservador. |
| `brandRisk` | Riesgo de marca: `low`, `medium` o `high`. |
| `veroRisk` | Riesgo VeRO/IP: `low`, `medium` o `high`. |
| `medicalClaimsRisk` | Riesgo de claims médicos: `low`, `medium` o `high`. |
| `runnerDecision` | Decisión copiada desde el runner: `approve`, `review`, `reject` o `blocked`. |
| `runnerState` | Estado copiado desde el runner. |
| `mainRiskFlags` | Riesgos principales devueltos por el runner. |
| `nextHumanAction` | Siguiente acción humana recomendada. |
| `priority` | `P1`, `P2`, `P3` o `Blocked`. |
| `notes` | Notas manuales sin datos sensibles. |

## 4. Prioridades Recomendadas

- `P1`: candidato prometedor, margen sólido, bajo riesgo, datos completos.
- `P2`: interesante pero requiere revisar margen, stock o datos.
- `P3`: incompleto o débil; no avanzar hasta corregir.
- `Blocked`: riesgo alto, sin stock o no viable.

La prioridad debe reflejar el riesgo total, no solo el profit. Un producto con buen margen pero riesgo VeRO alto debe ser `Blocked`.

## 5. Cómo Llenar La Shortlist

1. Recolectar datos usando Intake Checklist.
2. Copiar candidatos limpios a JSON local.
3. Ejecutar runner con `--all`.
4. Copiar decisión/estado/riesgos principales al documento de shortlist.
5. Priorizar P1/P2/P3/Blocked.
6. Seleccionar máximo 1 a 3 productos para investigación profunda.
7. No publicar desde este flujo.

Comando de referencia:

```bash
node tools/product-selection-evaluate-candidate.mjs \
  --file tools/fixtures/product-selection-manual-shortlist.example.json \
  --all
```

## 6. Ejemplo De Interpretación

- `approve / APPROVED_FOR_DRAFT` + bajo riesgo -> `P1`.
- `review / DATA_INCOMPLETE` por stock unknown -> `P2` o `P3` según facilidad de completar.
- `review / MARGIN_REVIEW` -> `P2` si el precio puede ajustarse; `P3` si el margen sigue débil.
- `blocked / BLOCKED` -> `Blocked`.
- `reject / REJECTED` -> `Blocked` o descartado.

`approve` no publica, no crea draft real y no cambia listings. Solo significa que el candidato es prometedor para revisión humana.

## 7. Qué NO Incluir

No incluir:

- tokens
- claves API
- credenciales
- emails privados
- direcciones privadas
- URLs privadas de proveedor
- contratos
- datos de clientes
- capturas con información sensible
- información confidencial de proveedores

La shortlist debe usar datos simulados, públicos o aproximados. No debe contener información sensible.

## 8. Relación Con Archivos Existentes

Referencias relacionadas:

- `docs/ebay-winner-pipeline/PRODUCT_SELECTION_MANUAL_INTAKE_CHECKLIST_V1.md`
- `docs/ebay-winner-pipeline/PRODUCT_SELECTION_MANUAL_RUNNER_RUNBOOK_V1.md`
- `docs/ebay-winner-pipeline/PRODUCT_SELECTION_QA_PACK_V1.md`
- `tools/product-selection-evaluate-candidate.mjs`
- `tools/fixtures/product-selection-manual-candidate.example.json`
