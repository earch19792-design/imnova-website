# eBay Listing Copywriting Rules V1

## 1. Propósito

Estas reglas definen cómo escribir propuestas internas de listing para eBay antes de cualquier draft real.

Reglas de seguridad:

- advisory-only
- local-first
- human-review-required
- no eBay API real
- no drafts reales
- no publicación
- no cambios reales de listings

## 2. Principio Principal

El copy debe vender con claridad, pero sin exagerar, engañar, usar marcas no autorizadas o hacer claims riesgosos.

Principios:

- claridad antes que hype
- datos verificables antes que promesas
- keywords relevantes antes que keyword stuffing
- revisión humana antes de avanzar

## 3. Reglas Para Títulos

Reglas:

- iniciar con el tipo de producto o keyword principal
- incluir atributo diferenciador relevante
- incluir uso práctico o beneficio claro
- mantenerlo legible para humanos
- evitar repetir palabras innecesariamente
- evitar símbolos decorativos
- no usar marcas protegidas si no corresponde
- no usar "compatible con" salvo que esté verificado y sea seguro
- no hacer claims médicos, absolutos o imposibles de probar
- no inventar certificaciones

Ejemplo bueno simulado:

```text
Compact Desk Organizer with Drawer, Space Saving Office Storage, Black
```

Ejemplos malos simulados:

- `BEST AMAZING ORGANIZER!!!`
- `Apple Style Desk Organizer`
- `Cures Back Pain Office Storage`
- `FDA Certified Organizer`

## 4. Fórmula Recomendada De Título

Fórmula conceptual:

```text
Product Type + Key Attribute + Use Case/Benefit + Size/Color/Material
```

Ejemplos simulados:

- `Foldable Kitchen Storage Rack, Space Saving Counter Organizer, White`
- `Portable Car Trash Bin with Lid, Leak Resistant Interior, Black`
- `Adjustable Drawer Divider Set, Bamboo Storage Organizer for Kitchen`

La longitud y límites oficiales de eBay deben verificarse manualmente en una fase futura. Este loop no valida contra eBay API.

## 5. Reglas Para Subtítulo

Reglas:

- usar solo si aporta valor real
- no repetir el título
- reforzar beneficio, material, compatibilidad verificada o uso
- evitar claims agresivos
- tratarlo como opcional en V1

Un subtítulo no debe corregir un título débil. Si el título no es claro, corregir el título primero.

## 6. Reglas Para Descripción

Estructura recomendada:

1. Línea inicial clara.
2. Beneficios principales.
3. Detalles técnicos.
4. Qué incluye.
5. Uso recomendado.
6. Notas de seguridad/compliance si aplica.
7. Shipping/returns resumidos.
8. Cierre profesional.

Reglas:

- no copiar texto del proveedor sin revisión
- no inventar datos
- no inventar certificaciones
- no usar claims médicos fuertes
- no prometer resultados garantizados
- no usar lenguaje engañoso
- no usar marcas ajenas para atraer tráfico

## 7. Reglas Para Benefit Bullets

Reglas:

- máximo 4 a 6 bullets conceptuales
- cada bullet debe explicar un beneficio concreto
- preferir beneficio + razón
- evitar frases vacías como "alta calidad" sin soporte
- no prometer resultados absolutos

Ejemplos:

- `Space-saving design helps keep small desks, counters, or shelves organized.`
- `Drawer compartment stores small accessories like clips, notes, or cables.`
- `Compact footprint makes it suitable for home office, dorm, or study areas.`

## 8. Reglas Para Detalles Técnicos

Reglas:

- usar datos verificables
- incluir dimensiones si existen
- incluir peso si existe
- incluir material si está confirmado
- incluir color/size/model solo si está confirmado
- si falta información, marcar como pendiente en `itemSpecifics.missing`

Los detalles técnicos deben coincidir con el schema de propuesta y con item specifics. Si hay conflicto, requiere revisión humana.

## 9. Reglas Para Item Specifics

Reglas:

- alinear copy con item specifics
- no decir en descripción algo que contradiga item specifics
- no inventar `Brand`, `MPN`, `Model` o `Material`
- usar `Unbranded` solo si corresponde y fue revisado
- dejar pendiente si falta información

La descripción no debe compensar item specifics inventados. Los campos desconocidos deben permanecer pendientes.

## 10. Reglas Para Keywords

Reglas:

- usar keywords por intención de búsqueda
- priorizar keywords naturales
- evitar keyword stuffing
- no usar keywords de marcas protegidas para capturar tráfico
- no usar keywords no relacionadas
- distribuir keywords entre title, item specifics y descripción de forma natural

Las keywords deben ayudar al comprador correcto a encontrar el producto correcto. No deben atraer tráfico irrelevante.

## 11. Reglas Para Claims Y Compliance

No usar:

- claims médicos fuertes
- claims de cura, tratamiento o prevención
- claims de seguridad absoluta
- `guaranteed`, `100%`, `official`, `certified` si no está verificado
- referencias a marcas protegidas sin autorización
- afirmaciones regulatorias no verificadas

Productos con riesgo `high` deben quedar bloqueados o en revisión humana.

## 12. Palabras Y Frases De Riesgo

Ejemplos a evitar o revisar:

- `cure`
- `treats`
- `prevents disease`
- `FDA approved`
- `official`
- `authentic brand` sin prueba
- `guaranteed results`
- `100% safe`
- `best in the world`
- nombres de marcas protegidas no relacionadas
- claims de compatibilidad no verificados

Esta no es una lista legal completa. Es una guía operativa V1 para reducir riesgo antes de revisión humana.

## 13. Reglas Para Imágenes Y Texto Visual

Reglas:

- no describir imágenes no autorizadas como propias
- no usar copy que dependa de imágenes sin derechos
- no incluir capturas con datos sensibles
- si `imageAuthorizationStatus` es `unknown`, el copy debe quedar incompleto o en revisión

El texto visual y la descripción deben mantenerse consistentes con el `imagePlan` de la propuesta.

## 14. Reglas Para Shipping Y Returns Copy

Reglas:

- no prometer fechas no verificadas
- no prometer envío gratis si el margen no lo soporta
- no ocultar condiciones relevantes
- mantener lenguaje claro y neutral
- productos frágiles, pesados o lentos requieren revisión adicional

Shipping y returns deben explicar condiciones sin crear expectativas falsas.

## 15. Copy Según Estado Del Listing

- `LISTING_DATA_INCOMPLETE`: copy parcial, marcar pendientes.
- `LISTING_REVIEW_REQUIRED`: copy usable, pero requiere revisión.
- `LISTING_BLOCKED`: no generar copy final.
- `LISTING_DRAFT_READY`: copy interno completo, pendiente de humano.
- `LISTING_APPROVED_FOR_MANUAL_DRAFT`: aprobado para preparación manual, no publicación automática.

Ningún estado crea draft real ni publica automáticamente.

## 16. Ejemplo De Copy Completo Simulado

Producto simulado: compact desk organizer.

Title:

```text
Compact Desk Organizer with Drawer, Space Saving Office Storage, Black
```

Subtitle opcional:

```text
Small workspace storage for notes, clips, cables, and desk accessories
```

Headline:

```text
Keep everyday desk items organized with a compact drawer-style organizer.
```

Benefit bullets:

- `Space-saving design helps keep small desks, shelves, or study areas organized.`
- `Drawer compartment stores small accessories like clips, notes, or cables.`
- `Compact footprint makes it suitable for home office, dorm, or workspace setups.`

Technical details:

- `Simulated dimensions: 10 x 6 x 4 in`
- `Simulated weight: 1.2 lb`
- `Color: Black`

Package includes:

- `1 simulated desk organizer`

Recommended use:

```text
For home office, study desk, dorm room, or small workspace organization.
```

Shipping/returns summary:

```text
Shipping and returns must be confirmed by a human before any real listing step.
```

Compliance notes:

- No medical claims.
- No protected brand claims.
- Image authorization must be confirmed before any final listing step.

## 17. Anti-Ejemplos

Keyword stuffing:

```text
Organizer Desk Organizer Office Organizer Storage Organizer Drawer Organizer
```

Problema: repite keywords sin mejorar claridad.

Claim médico:

```text
Cures back pain while organizing your office.
```

Problema: claim médico fuerte no verificable.

Marca no autorizada:

```text
Apple Style Desk Organizer for Premium Workspaces
```

Problema: usa marca protegida para atraer tráfico sin autorización.

Promesa absoluta:

```text
Guaranteed to organize every desk perfectly.
```

Problema: promesa absoluta no verificable.

Certificación inventada:

```text
FDA Certified Office Organizer
```

Problema: certificación no aplicable ni verificada.

## 18. Checklist Rápido De Copy

Antes de marcar un copy como listo:

- ¿El título es claro?
- ¿Las keywords son relevantes?
- ¿Hay keyword stuffing?
- ¿Se usó marca no autorizada?
- ¿Hay claims médicos o absolutos?
- ¿Los datos técnicos están verificados?
- ¿La descripción contradice item specifics?
- ¿Faltan derechos de imagen?
- ¿Requiere revisión humana?

Si alguna respuesta indica riesgo, el listing debe quedar en revisión o incompleto.

## 19. Relación Con Documentos Existentes

Referencias relacionadas:

- `docs/ebay-winner-pipeline/EBAY_LISTING_CREATION_STRATEGY_V1.md`
- `docs/ebay-winner-pipeline/EBAY_LISTING_DRAFT_SCHEMA_V1.md`
- `docs/ebay-winner-pipeline/PRODUCT_SELECTION_STRATEGY_V1.md`
- `docs/ebay-winner-pipeline/PRODUCT_SELECTION_MANUAL_INTAKE_CHECKLIST_V1.md`

## 20. Próximos Loops Recomendados

- `LOOP 051 — eBay Listing QA Checklist V1`
- `LOOP 052 — eBay Listing Proposal Generator Dry Run V1`
- `LOOP 053 — eBay Listing Proposal Fixture Tests V1`
