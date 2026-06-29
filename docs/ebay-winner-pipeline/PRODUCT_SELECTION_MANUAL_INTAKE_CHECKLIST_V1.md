# Product Selection Manual Intake Checklist V1

## 1. Propósito

Este checklist define cómo recolectar datos mínimos antes de evaluar un candidato con el Product Selection Manual Runner.

El objetivo es reducir candidatos incompletos, margen mal estimado, riesgos de marca, riesgos operativos y uso accidental de información sensible en archivos locales.

Reglas de seguridad:

- local-only
- advisory-only
- no eBay real
- no Supabase
- no drafts
- no publicación
- no cambios reales de listings

Este checklist no autoriza publicar, crear drafts reales, llamar APIs, escribir en bases de datos ni cambiar listings existentes.

## 2. Regla Principal

No evaluar un producto solo porque parece atractivo. Primero debe tener datos suficientes para revisar:

- margen
- ROI
- stock
- peso/dimensiones
- precio de mercado
- riesgo de marca/VeRO
- claims o restricciones
- derechos de imagen

Si faltan datos importantes, el resultado esperado debe ser `review / DATA_INCOMPLETE`, no aprobación.

## 3. Datos Mínimos Del Producto

| Campo | Qué significa | Cómo recolectarlo manualmente | Ejemplo simulado | Qué pasa si falta |
|---|---|---|---|---|
| `title` | Nombre humano del candidato. | Usar una descripción genérica y limpia del producto. | `Simulated Compact Desk Organizer` | La revisión humana pierde contexto. |
| `category guess` | Categoría probable del producto. | Inferir de productos comparables y tipo de uso. | `Home Office` | Puede faltar contexto de riesgo, fees o competencia. |
| `supplierCost` | Costo base del producto. | Tomar el costo visible o estimado, sin pegar datos confidenciales. | `12` | La economía no es confiable. |
| `supplierShippingCost` | Costo de envío del proveedor o costo operativo asumido. | Estimar con tarifa pública o dato manual seguro. | `2` | El profit puede quedar inflado. |
| `estimatedEbayPrice` | Precio estimado de venta en eBay. | Usar sold comps y rango competitivo. | `32` | No se puede estimar margen ni ROI. |
| `buyerShippingCharge` | Shipping cobrado al comprador, si aplica. | Usar `0` si el precio asume free shipping. | `0` | El revenue total puede quedar incompleto. |
| `stockAvailable` | Unidades disponibles o estimadas. | Confirmar manualmente sin copiar datos privados. | `10` | Si es desconocido, debe ir a `DATA_INCOMPLETE`. |
| `stockStatus` | Estado de stock. | Usar `available`, `unknown` o equivalente seguro. | `available` | Si es `unknown`, requiere revisión. |
| `weight` | Peso usado para estimar envío. | Confirmar con dato público, ficha segura o medición propia. | `1.2` | Resultado esperado: `DATA_INCOMPLETE`. |
| `dimensions` | Largo, ancho, alto y unidad. | Confirmar con ficha pública, medición o estimación conservadora. | `10 x 6 x 4 in` | Resultado esperado: `DATA_INCOMPLETE`. |
| `brandRisk` | Riesgo de marca restringida o sensible. | Revisar si la marca es conocida, protegida o problemática. | `low` | Si no se sabe, usar revisión conservadora. |
| `veroRisk` | Riesgo VeRO/IP. | Revisar señales de IP, trademark, diseños protegidos o claims del dueño de marca. | `low` | Si es alto, debe bloquearse. |
| `medicalClaimsRisk` | Riesgo por claims médicos, salud o tratamiento. | Revisar título, empaque y descripciones. | `low` | Si es alto, debe bloquearse. |
| `returnRisk` | Riesgo de devolución. | Evaluar talla, compatibilidad, expectativas y daño probable. | `low` | Puede requerir `RISK_REVIEW`. |
| `fragilityRisk` | Riesgo de rotura o empaque especial. | Revisar material, tamaño y envío. | `low` | Puede requerir revisión operativa. |
| `shippingSpeedRisk` | Riesgo de envío lento o incierto. | Revisar tiempos estimados de fulfillment. | `low` | Puede requerir revisión operativa. |
| `imageAuthorizationStatus` | Estado de derechos de imagen. | Usar solo imágenes propias, autorizadas o confirmables. | `authorized` | Si es `unknown`, resultado esperado: `DATA_INCOMPLETE`. |
| `soldCompsMedianPrice` | Mediana de vendidos comparables. | Revisar sold comps manualmente y usar un valor conservador. | `31` | Se pierde referencia de mercado. |

## 4. Checklist De Margen

Antes del runner, revisar:

- costo del proveedor
- costo de envío proveedor -> comprador o almacén
- precio estimado eBay
- fees aproximados
- margen neto mínimo recomendado: `20%`
- ROI mínimo: `30%`
- profit mínimo: `$5`
- profit ideal: `$7+`

Si el margen no es claro, el resultado esperado debe ser `review / MARGIN_REVIEW`.

Señales de alerta:

- el profit depende de un precio muy optimista
- el costo de envío es desconocido
- el ROI cae por debajo de `30%`
- el margen neto cae por debajo de `20%`
- el profit queda por debajo de `$5`

## 5. Checklist De Mercado eBay

Antes de confiar en el precio estimado:

- revisar sold comps
- comparar precio estimado contra la mediana de vendidos
- evitar precio > sold comps median +10% sin razón clara
- revisar demanda aparente
- revisar competencia
- revisar calidad de listings competidores
- no usar datos privados ni scraping automático en este loop

Si el precio rentable queda más de 10% por encima de sold comps median, el resultado esperado debe ser `review / MARGIN_REVIEW`.

## 6. Checklist De Stock Y Operación

Revisar:

- confirmar stock real
- si stock es `0`: `blocked / BLOCKED`
- si stock es `unknown`: `review / DATA_INCOMPLETE`
- confirmar peso
- confirmar dimensiones
- revisar fragilidad
- revisar velocidad de envío
- revisar posibilidad de devoluciones

No avanzar con un candidato si el stock real, peso o dimensiones son supuestos débiles.

## 7. Checklist De Riesgo eBay

Revisar señales de:

- marcas conocidas
- VeRO/IP
- productos con claims médicos
- productos regulados
- imágenes sin autorización
- productos peligrosos o restringidos

Reglas V1:

- si `brandRisk` o `veroRisk` es `high`: `blocked / BLOCKED`
- si `medicalClaimsRisk` es `high`: `blocked / BLOCKED`
- si `imageAuthorizationStatus` es `unknown`: `review / DATA_INCOMPLETE`
- si un riesgo no bloqueante sigue siendo importante: `review / RISK_REVIEW`

Cuando exista duda real sobre marca, IP o permisos de imagen, tratar el candidato como revisión o bloqueo, no como aprobación.

## 8. Qué NO Pegar En Archivos Locales

No pegar:

- tokens
- credenciales
- emails privados
- direcciones privadas
- URLs privadas de proveedor
- contratos
- documentos confidenciales
- datos de clientes
- claves API
- capturas con información sensible

Usar datos aproximados, públicos o simulados siempre que sea posible.

## 9. Flujo Recomendado Antes Del Runner

1. Encontrar candidato.
2. Recolectar datos públicos o simulados.
3. Revisar checklist de margen.
4. Revisar checklist de mercado.
5. Revisar checklist de stock/operación.
6. Revisar checklist de riesgo.
7. Copiar datos limpios a plantilla JSON.
8. Ejecutar runner.
9. Interpretar decisión.
10. No publicar desde este flujo.

## 10. Decisiones Esperadas

| Decisión / Estado | Significado |
|---|---|
| `approve / APPROVED_FOR_DRAFT` | Candidato prometedor para revisión humana. No autoriza publicación. |
| `review / DATA_INCOMPLETE` | Faltan datos mínimos antes de avanzar. |
| `review / MARGIN_REVIEW` | La economía o el precio necesitan revisión. |
| `review / RISK_REVIEW` | Hay riesgo no bloqueante que requiere criterio humano. |
| `blocked / BLOCKED` | No avanzar salvo revisión auditada. |
| `reject / REJECTED` | Economía inviable o candidato no apto para la estrategia. |

`approve` solo significa "candidato prometedor para revisión humana". No crea draft real, no publica y no cambia listings.

## 11. Relación Con Archivos Existentes

Referencias relacionadas:

- `docs/ebay-winner-pipeline/PRODUCT_SELECTION_STRATEGY_V1.md`
- `docs/ebay-winner-pipeline/PRODUCT_SELECTION_QA_PACK_V1.md`
- `docs/ebay-winner-pipeline/PRODUCT_SELECTION_MANUAL_RUNNER_RUNBOOK_V1.md`
- `tools/product-selection-evaluate-candidate.mjs`
- `tools/fixtures/product-selection-manual-candidate.example.json`
