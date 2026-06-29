# eBay Listing Image Quality & Conversion Strategy V1

## 1. Propósito

Esta estrategia define cómo deben planearse, revisar y seleccionar imágenes para propuestas internas de listings eBay, con enfoque en conversión, confianza y seguridad.

El objetivo es que cada propuesta de listing tenga una secuencia visual que ayude al comprador a entender el producto rápido, reduzca dudas y mantenga compliance antes de cualquier paso real.

Este documento es:

- advisory-only
- local-first
- human-review-required
- sin eBay API real
- sin drafts reales
- sin publicación
- sin cambios reales de listings

No sube imágenes, no descarga imágenes, no conecta eBay y no autoriza publicación.

## 2. Principio principal

Una imagen debe ayudar al comprador a entender rápido:

- qué es el producto
- cómo se ve
- para qué sirve
- tamaño/dimensiones aproximadas
- qué incluye
- por qué confiar

Pero debe hacerlo sin engañar, exagerar, usar imágenes no autorizadas o violar compliance. Una imagen que mejora conversión pero aumenta riesgo no debe avanzar sin revisión humana.

## 3. Imagen principal

La imagen principal debe ser la más clara, atractiva y representativa del producto.

Reglas:

- producto centrado
- fondo blanco o neutro cuando aplique
- buena iluminación
- alta resolución
- sin texto excesivo
- sin marcas no autorizadas
- sin logos ajenos
- sin screenshots con datos sensibles
- sin claims visuales exagerados

La primera imagen influye fuertemente en clics y confianza. Si el comprador no entiende el producto en pocos segundos, la propuesta visual debe revisarse antes de avanzar.

La imagen principal no debe intentar compensar un producto débil con diseño engañoso. Debe mostrar el producto de forma limpia, honesta y fácil de comparar.

## 4. Calidad técnica

Revisar que cada imagen sea:

- nítida
- bien enfocada
- con iluminación uniforme
- sin pixelación
- sin bordes raros
- sin compresión fuerte
- con suficiente resolución para zoom
- en formato compatible con marketplace

El tamaño mínimo o recomendado debe verificarse antes de producción porque los requisitos de eBay pueden cambiar. Esta estrategia no valida requisitos oficiales en tiempo real.

Referencia operativa:

- evitar imágenes pequeñas
- preferir imágenes grandes y cuadradas cuando sea posible
- revisar legibilidad en móvil
- confirmar que detalles importantes se entienden sin zoom excesivo

Si una imagen es autorizada pero técnicamente débil, debe marcarse para revisión visual antes de considerarla final-ready.

## 5. Secuencia recomendada de imágenes

Orden recomendado:

1. Main image clara.
2. Segundo ángulo.
3. Imagen de uso/lifestyle.
4. Dimensiones o escala.
5. Detalles/cierre.
6. Qué incluye/package contents.
7. Comparación o beneficio visual si aplica.
8. Infografía simple, si es autorizada y no engañosa.

La secuencia debe contar una historia visual simple: primero identificar el producto, luego explicar uso, tamaño, detalles y contenido. No debe saturar al comprador ni esconder información relevante.

## 6. Imágenes secundarias

Las imágenes secundarias deben complementar la imagen principal.

Incluir cuando aplique:

- varios ángulos
- detalles importantes
- close-up de material/textura
- uso realista
- dimensiones
- contenido del paquete
- comparación de tamaño
- variantes si aplica

Las imágenes secundarias deben resolver dudas reales del comprador. No deben duplicar la misma imagen sin aportar información.

## 7. Infografías, mockups y comparaciones

Las infografías, mockups y comparaciones pueden mejorar comprensión y conversión, pero requieren control.

Reglas:

- pueden mejorar comprensión y conversión
- deben ser simples y legibles
- no saturar con texto
- no prometer beneficios no comprobados
- no usar claims médicos
- no inventar certificaciones
- no mostrar logos/marcas ajenas sin autorización
- deben estar autorizadas

Una infografía buena aclara tamaño, contenido, uso o beneficio práctico. Una infografía riesgosa exagera resultados, usa claims no verificables o introduce elementos de marca/compliance no autorizados.

## 8. Imágenes de lifestyle/use case

Las imágenes de lifestyle o uso deben mostrar el producto en un contexto práctico y realista.

Reglas:

- mostrar uso práctico
- contexto realista
- no sugerir usos no permitidos
- no mostrar resultados exagerados
- no incluir personas/datos sensibles si no hay autorización
- no crear confusión sobre tamaño o contenido

El lifestyle debe ayudar al comprador a imaginar el uso del producto sin alterar la expectativa real. Si la escena hace que el producto parezca más grande, más completo o más potente de lo que es, requiere revisión.

## 9. Dimensiones y escala

Las imágenes deben ayudar a entender tamaño y escala cuando esto afecte la decisión de compra.

Reglas:

- incluir imagen con medidas si son verificadas
- usar comparación de escala solo si no engaña
- no inventar dimensiones
- no usar objetos de referencia que creen percepción falsa
- si faltan dimensiones, marcar listing como `DATA_INCOMPLETE` o review

Dimensiones incorrectas o ausentes pueden causar devoluciones, quejas y mala experiencia. Si peso o dimensiones no están confirmados, el listing no debe tratarse como final-ready.

## 10. Confianza visual

Las imágenes deben reducir dudas sobre:

- cómo se ve realmente
- material
- tamaño
- contenido del paquete
- detalles
- uso
- limitaciones visibles

La confianza visual aumenta cuando el comprador ve claramente qué recibe. Ocultar defectos, limitaciones, escala o contenido real aumenta riesgo de devolución y mala experiencia.

## 11. Conversión

Una buena secuencia visual puede:

- aumentar confianza
- reducir dudas
- mejorar clics
- reducir devoluciones
- mejorar comprensión del producto

Pero la conversión no debe sacrificar compliance. No se deben usar imágenes engañosas, claims visuales exagerados o contenido no autorizado para aumentar clics.

La regla de V1 es:

```text
conversion helpful = claridad + confianza + cumplimiento
```

Si una imagen vende más pero confunde o engaña, no debe avanzar.

## 12. Riesgos visuales

Bloqueadores o señales de revisión:

- imagen no autorizada
- marca/logo no autorizado
- claims médicos visuales
- certificaciones no verificadas
- before/after engañoso
- imágenes de proveedor sin permiso
- screenshots con datos sensibles
- imágenes que ocultan defectos o tamaño real
- imágenes con texto falso o exagerado

Interpretación:

- riesgo crítico de autorización o compliance -> bloquear
- calidad visual débil -> revisión
- datos visuales faltantes -> incompleto
- claims no verificables -> revisión o bloqueo según severidad

## 13. imageAuthorizationStatus

Estados recomendados:

- `authorized`: puede avanzar a revisión.
- `unknown`: `DATA_INCOMPLETE` / no final-ready.
- `unauthorized`: blocked / no avanzar.

`authorized` no significa que la imagen sea perfecta para conversión. Solo significa que puede considerarse en la revisión visual. La imagen todavía debe pasar calidad técnica, claridad, compliance y utilidad para comprador.

## 14. Checklist visual antes de avanzar

Antes de avanzar, responder:

- ¿La imagen principal es clara?
- ¿La imagen está autorizada?
- ¿Hay buena resolución?
- ¿Se entiende el producto en 3 segundos?
- ¿Hay varios ángulos?
- ¿Se muestran dimensiones o escala?
- ¿Se muestran detalles importantes?
- ¿Hay claims riesgosos?
- ¿Hay marcas no autorizadas?
- ¿Se ve bien en móvil?
- ¿La secuencia ayuda a comprar sin engañar?

Si alguna respuesta es negativa o incierta, marcar `REQUEST_IMAGE_REVIEW`, `DATA_INCOMPLETE` o bloqueo según severidad.

## 15. Relación con documentos existentes

Este documento complementa:

- `EBAY_LISTING_CREATION_STRATEGY_V1.md`
- `EBAY_LISTING_DRAFT_SCHEMA_V1.md`
- `EBAY_LISTING_COPYWRITING_RULES_V1.md`
- `EBAY_LISTING_QA_CHECKLIST_V1.md`
- `EBAY_LISTING_MANUAL_REVIEW_WORKFLOW_V1.md`

La estrategia visual debe alimentar futuros checklists, schemas y vistas Admin. No reemplaza revisión humana ni autoriza publicación.

## 16. Próximos loops recomendados

- `LOOP 069 — eBay Listing Image QA Checklist V1`
- `LOOP 070 — eBay Listing Image Plan Schema V1`
- `LOOP 071 — eBay Listing Admin Image Review Placeholder V1`
