# eBay Listing Creation Strategy V1

## 1. Propósito

Esta estrategia define cómo construir propuestas de listings para productos aprobados o priorizados, antes de cualquier draft real en eBay.

El objetivo es transformar un candidato prometedor en una propuesta segura, competitiva y revisable por humano.

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

Un producto aprobado no significa publicar. Significa que puede pasar a preparación de listing bajo revisión humana.

Regla:

```text
APPROVED_FOR_DRAFT = candidato listo para propuesta interna, no autorización de publicación.
```

Ningún output de Product Selection o Listing Creation debe interpretarse como permiso automático para crear drafts reales, publicar o modificar listings.

## 3. Inputs Mínimos Para Crear Una Propuesta De Listing

Antes de crear una propuesta, reunir:

- título del producto
- categoría estimada
- precio estimado
- sold comps
- costo del proveedor
- shipping cost
- peso
- dimensiones
- stock
- riesgos
- autorización de imágenes
- beneficios principales
- keywords relevantes
- item specifics requeridos
- condición
- política de envío
- política de devolución

Si faltan stock, peso, dimensiones, autorización de imágenes o datos de cumplimiento, la propuesta debe quedar incompleta y requerir revisión humana.

## 4. Estructura Del Listing Ganador

Una propuesta de listing debe incluir:

- `title`: título optimizado, claro y sin abuso de keywords.
- `subtitle`: opcional, solo si aporta valor real.
- `category`: categoría estimada o recomendada.
- `condition`: condición verificable.
- `item specifics`: atributos relevantes y requeridos.
- `price`: precio basado en sold comps y economía.
- `quantity`: cantidad conservadora basada en stock confirmado.
- `shipping`: plan de envío realista.
- `returns`: política de devolución compatible con el riesgo del producto.
- `description`: copy claro, verificable y orientado al comprador.
- `images`: plan de imágenes autorizadas.
- `compliance notes`: riesgos, restricciones y pendientes.
- `human review notes`: decisiones que requieren criterio humano.

## 5. Estrategia De Título

Reglas:

- usar keywords relevantes al inicio
- incluir tipo de producto
- incluir atributo principal
- incluir uso o beneficio práctico
- evitar keyword stuffing
- no usar marcas protegidas si no aplica
- no hacer claims exagerados
- no usar símbolos innecesarios

Ejemplo simulado:

```text
Compact Desk Organizer with Drawer, Space Saving Office Storage, Black
```

Un buen título debe ser legible para humanos y útil para búsqueda. No debe depender de marcas ajenas ni promesas no verificables.

## 6. Estrategia De Precio

Antes de avanzar:

- comparar contra sold comps
- evitar precio > sold comps median +10% sin justificación
- respetar profit mínimo `$5`
- buscar profit ideal `$7+`
- respetar ROI mínimo `30%`
- respetar margen neto recomendado `20%`
- revisar shipping y fees antes de avanzar
- si la economía cambia, volver a Product Selection

Si el precio necesario para cumplir margen queda fuera del mercado, la propuesta debe volver a `MARGIN_REVIEW`.

## 7. Estrategia De Descripción

Estructura recomendada:

- línea inicial clara
- bullets de beneficios
- detalles técnicos
- qué incluye
- uso recomendado
- notas de seguridad/compliance si aplica
- shipping/returns resumidos
- cierre profesional

Reglas:

- no claims médicos fuertes
- no promesas absolutas
- no copiar texto de proveedor sin revisión
- no usar marcas ajenas
- no inventar certificaciones
- no ocultar limitaciones relevantes

La descripción debe ayudar al comprador a entender el producto sin aumentar riesgo de política, devolución o expectativa falsa.

## 8. Estrategia De Item Specifics

Reglas:

- completar la mayor cantidad posible
- priorizar campos requeridos por categoría
- usar valores verificables
- no inventar atributos
- dejar como pendiente si falta información

Ejemplos de campos:

- `Brand`
- `Type`
- `Color`
- `Material`
- `Size`
- `Model`
- `MPN`
- `Country/Region of Manufacture`
- `Features`

Si un item specific es desconocido, marcarlo como pendiente en la propuesta, no inventarlo.

## 9. Estrategia De Imágenes

Reglas:

- usar solo imágenes autorizadas
- no usar imágenes con marcas no autorizadas
- no usar screenshots con datos sensibles
- primera imagen clara sobre fondo limpio
- imágenes secundarias para uso, dimensiones, contenido y detalles
- si `imageAuthorizationStatus` es `unknown`, no avanzar a listing final

La propuesta puede incluir un `imagePlan`, pero no debe adjuntar ni subir imágenes a eBay en V1.

## 10. Estrategia De Shipping Y Returns

Antes de avanzar:

- confirmar peso/dimensiones
- estimar costo realista
- evitar promesas de entrega no verificadas
- política de devolución alineada al riesgo del producto
- productos frágiles o lentos requieren revisión adicional

Si shipping o returns dependen de supuestos débiles, la propuesta debe quedar en revisión.

## 11. Compliance Y Riesgos eBay

Revisar:

- VeRO/IP
- marcas protegidas
- claims médicos
- productos restringidos
- imágenes no autorizadas
- categorías sensibles
- palabras peligrosas o engañosas

Reglas:

- `brandRisk high` o `veroRisk high` -> no crear propuesta final
- `medicalClaimsRisk high` -> no crear propuesta final
- `imageAuthorizationStatus unknown` -> propuesta incompleta o `DATA_INCOMPLETE`
- `compliance unresolved` -> `human review required`

Si el riesgo no se puede resolver con evidencia clara, el candidato no debe avanzar hacia listing final.

## 12. Estados Recomendados De Propuesta De Listing

Estados internos futuros:

- `LISTING_NOT_STARTED`
- `LISTING_DATA_INCOMPLETE`
- `LISTING_DRAFT_READY`
- `LISTING_REVIEW_REQUIRED`
- `LISTING_BLOCKED`
- `LISTING_APPROVED_FOR_MANUAL_DRAFT`

`LISTING_APPROVED_FOR_MANUAL_DRAFT` no publica ni crea draft real automáticamente. Solo indica que un humano puede considerar crear un draft manual en un flujo futuro controlado.

## 13. Output Esperado De Una Propuesta De Listing

Formato conceptual:

```json
{
  "listingProposal": {
    "title": "",
    "category": "",
    "condition": "New",
    "price": 0,
    "quantity": 0,
    "itemSpecifics": {},
    "description": "",
    "shippingPlan": {},
    "returnPlan": {},
    "imagePlan": [],
    "complianceNotes": [],
    "humanReviewRequired": true,
    "advisoryOnly": true
  }
}
```

Este output es conceptual. No crea draft, no publica y no llama eBay real.

## 14. Qué Queda Fuera De Alcance V1

Fuera de alcance:

- no eBay API real
- no OAuth
- no drafts reales
- no publicación
- no actualización de listings activos
- no sincronización automática
- no scraping automático
- no decisiones sin humano

## 15. Relación Con Product Selection

Referencias relacionadas:

- `docs/ebay-winner-pipeline/PRODUCT_SELECTION_STRATEGY_V1.md`
- `docs/ebay-winner-pipeline/PRODUCT_SELECTION_MANUAL_INTAKE_CHECKLIST_V1.md`
- `docs/ebay-winner-pipeline/PRODUCT_SELECTION_MANUAL_SHORTLIST_TEMPLATE_V1.md`
- `tools/product-selection-evaluate-candidate.mjs`

Product Selection decide si vale la pena trabajar el producto. Listing Creation Strategy decide cómo preparar la propuesta de listing.

## 16. Próximos Loops Recomendados

- `LOOP 049 — eBay Listing Draft Schema V1`
- `LOOP 050 — eBay Listing Copywriting Rules V1`
- `LOOP 051 — eBay Listing QA Checklist V1`
- `LOOP 052 — eBay Listing Proposal Generator Dry Run V1`
