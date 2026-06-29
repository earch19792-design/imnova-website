# eBay Listing Image QA Checklist V1

## 1. Propósito

Este checklist define cómo revisar imágenes de propuestas internas de listings eBay antes de avanzar en el pipeline.

Su objetivo es convertir la estrategia visual en criterios claros para revisión humana, sin ejecutar acciones reales.

Este documento es:

- documentation-only
- advisory-only
- human-review-required
- sin eBay API real
- sin drafts reales
- sin publicación
- sin cambios reales de listings

No genera imágenes, no sube imágenes, no conecta eBay y no autoriza publicación.

## 2. Principio principal

Ningún listing debe avanzar visualmente si las imágenes no ayudan al comprador a entender el producto de forma clara, confiable y segura.

La revisión visual debe cubrir:

- claridad
- confianza
- conversión
- autorización
- compliance
- consistencia con el producto
- seguridad visual

Una imagen puede mejorar conversión solo si también mantiene autorización, claridad y cumplimiento. Si una imagen vende más pero confunde, exagera o introduce riesgo, no debe avanzar sin revisión humana.

## 3. Resultado del QA visual

Estados recomendados:

- `IMAGE_QA_PASSED_FOR_HUMAN_REVIEW`: la secuencia visual puede pasar a revisión humana.
- `IMAGE_QA_NEEDS_DATA`: faltan datos visuales o evidencia para evaluar.
- `IMAGE_QA_NEEDS_REPLACEMENT`: una o más imágenes deben reemplazarse por calidad, claridad o consistencia.
- `IMAGE_QA_COMPLIANCE_REVIEW_REQUIRED`: hay riesgo visual que requiere revisión de compliance.
- `IMAGE_QA_BLOCKED`: existe un bloqueador visual crítico.

Ningún estado crea draft real, publica, llama eBay ni modifica listings. Estos estados solo guían revisión interna.

## 4. Checklist de imagen principal

Responder:

- ¿La imagen principal muestra claramente el producto?
- ¿El producto está centrado?
- ¿El fondo es blanco o neutro cuando aplica?
- ¿La imagen se ve profesional?
- ¿La iluminación es buena?
- ¿No hay texto excesivo?
- ¿No hay logos/marcas ajenas no autorizadas?
- ¿No hay claims visuales exagerados?
- ¿Se entiende el producto en pocos segundos?
- ¿Se ve bien en móvil?
- ¿Está autorizada?

Si la imagen principal no permite entender el producto rápido, marcar `IMAGE_QA_NEEDS_REPLACEMENT` o `IMAGE_QA_NEEDS_DATA` según corresponda.

## 5. Checklist de calidad técnica

Revisar:

- nitidez
- enfoque
- resolución suficiente para zoom
- iluminación uniforme
- sin pixelación
- sin compresión fuerte
- sin bordes raros
- sin recortes incorrectos
- sin distorsión
- formato compatible
- tamaño/requisitos actuales deben verificarse antes de producción porque pueden cambiar

No afirmar tamaños exactos obligatorios de eBay como definitivos en este checklist. Los requisitos oficiales pueden cambiar y deben verificarse antes de producción.

## 6. Checklist de secuencia visual

Revisar si la galería cubre:

1. imagen principal
2. segundo ángulo
3. uso/lifestyle
4. dimensiones o escala
5. detalle/material/textura
6. contenido del paquete
7. comparación o beneficio visual si aplica
8. infografía simple si aplica

La secuencia debe explicar producto, uso, tamaño, detalles y contenido sin saturar ni esconder información relevante.

## 7. Checklist de imágenes secundarias

Responder:

- ¿Muestran ángulos útiles?
- ¿Aclaran detalles importantes?
- ¿Muestran materiales o textura?
- ¿Muestran escala realista?
- ¿Muestran contenido del paquete?
- ¿Evitan confundir al comprador?
- ¿No duplican imágenes sin aportar valor?

Las imágenes secundarias deben resolver dudas reales del comprador. Si repiten la misma información sin valor, pedir reemplazo o simplificación.

## 8. Checklist de infografías/mockups/comparaciones

Revisar:

- texto legible
- diseño simple
- no saturado
- sin promesas absolutas
- sin claims médicos
- sin certificaciones inventadas
- sin logos no autorizados
- sin comparaciones engañosas
- datos verificables

Una infografía aceptable aclara tamaño, uso, contenido o beneficio práctico. Una infografía riesgosa exagera resultados o introduce claims no verificables.

## 9. Checklist lifestyle/use case

Revisar:

- uso realista
- contexto claro
- no exagera resultados
- no sugiere usos no permitidos
- no usa personas/datos sensibles sin autorización
- no confunde tamaño, cantidad o contenido

El lifestyle debe ayudar al comprador a imaginar el uso real del producto. Si la escena altera la expectativa del comprador, marcar revisión.

## 10. Checklist dimensiones/escala

Revisar:

- dimensiones verificadas
- escala no engañosa
- comparación de tamaño clara
- no inventar medidas
- si faltan dimensiones, marcar como `IMAGE_QA_NEEDS_DATA`

Dimensiones o escala incorrectas pueden causar devoluciones. Si faltan medidas relevantes, la propuesta no debe tratarse como final-ready.

## 11. Checklist compliance visual

Bloquear o mandar a revisión si hay:

- imagen no autorizada
- marca/logo no autorizado
- posible VeRO/IP risk
- claims médicos visuales
- before/after engañoso
- certificaciones no verificadas
- screenshots con datos sensibles
- imágenes de proveedor sin permiso confirmado
- contenido restringido o sensible
- imagen que oculta defectos o tamaño real

Si el riesgo es crítico o no se puede resolver con evidencia, usar `IMAGE_QA_BLOCKED`.

## 12. imageAuthorizationStatus

Estados recomendados:

- `authorized` -> puede avanzar a revisión humana.
- `unknown` -> no puede ser final-ready; marcar `IMAGE_QA_NEEDS_DATA`.
- `unauthorized` -> bloquear; marcar `IMAGE_QA_BLOCKED`.

`authorized` no significa que la imagen ya sea óptima para conversión. Todavía debe pasar claridad, calidad técnica, compliance y utilidad para comprador.

## 13. Señales de conversión visual

Responder:

- ¿La primera imagen genera confianza?
- ¿La galería responde dudas básicas?
- ¿Se entiende qué incluye?
- ¿Se entiende tamaño/uso?
- ¿Hay suficientes detalles para reducir devoluciones?
- ¿La secuencia visual ayuda a decidir compra sin engañar?

Conversión visual aceptable significa claridad más confianza más cumplimiento. No usar imágenes engañosas para aumentar clics.

## 14. Reglas de bloqueo

Bloqueadores:

- imágenes no autorizadas
- claims visuales riesgosos
- uso de marcas no autorizadas
- producto visualmente distinto al descrito
- dimensiones inventadas
- imágenes engañosas
- falta total de imagen principal clara
- safety/compliance visual crítico

Si aparece un bloqueador, el listing no debe avanzar visualmente hasta revisión y resolución documentada.

## 15. Mapeo a listing pipeline

Mapeo recomendado:

- si pasa QA visual -> puede continuar a revisión humana
- si faltan datos visuales -> `LISTING_DATA_INCOMPLETE`
- si hay riesgo económico/retorno por imágenes confusas -> `LISTING_REVIEW_REQUIRED`
- si hay riesgo compliance visual alto -> `LISTING_BLOCKED`
- si `imageAuthorizationStatus` es `unknown` -> no final-ready
- si `imageAuthorizationStatus` es `unauthorized` -> blocked

Este mapeo no reemplaza criterio humano. Solo traduce hallazgos visuales a estados internos del pipeline.

## 16. Checklist final antes de avanzar

Confirmar:

- main image clara
- galería completa
- autorización confirmada
- calidad técnica aceptable
- móvil legible
- sin claims peligrosos
- sin logos no autorizados
- dimensiones verificadas o marcadas como faltantes
- contenido del paquete claro
- riesgos visuales revisados
- decisión humana requerida

Si alguna condición es incierta, no avanzar como final-ready.

## 17. Ejemplos simulados

### Imagen clara y autorizada

Resultado:

```text
IMAGE_QA_PASSED_FOR_HUMAN_REVIEW
```

Interpretación: puede pasar a revisión humana, pero no crea draft real ni publica.

### Faltan dimensiones

Resultado:

```text
IMAGE_QA_NEEDS_DATA
```

Interpretación: pedir medidas verificadas o marcar dimensiones como faltantes.

### Imagen de proveedor sin permiso

Resultado:

```text
IMAGE_QA_BLOCKED
```

Interpretación: no usar imagen hasta confirmar autorización o reemplazarla.

### Claims visuales médicos

Resultado:

```text
IMAGE_QA_COMPLIANCE_REVIEW_REQUIRED
```

Interpretación: revisar compliance antes de cualquier avance.

### Imagen pixelada

Resultado:

```text
IMAGE_QA_NEEDS_REPLACEMENT
```

Interpretación: reemplazar por imagen más clara antes de considerar la secuencia visual lista.

## 18. Qué NO hacer

No hacer:

- no generar imágenes en este loop
- no subir imágenes a eBay
- no usar eBay API
- no crear drafts
- no publicar
- no usar imágenes no autorizadas
- no inventar medidas
- no inventar certificaciones
- no usar claims médicos
- no usar marcas ajenas sin permiso
- no usar datos reales sensibles

Este checklist no autoriza acciones reales. Solo estructura revisión humana segura.

## 19. Relación con documentos existentes

Este checklist complementa:

- `EBAY_LISTING_IMAGE_QUALITY_CONVERSION_STRATEGY_V1.md`
- `EBAY_LISTING_QA_CHECKLIST_V1.md`
- `EBAY_LISTING_DRAFT_SCHEMA_V1.md`
- `EBAY_LISTING_MANUAL_REVIEW_WORKFLOW_V1.md`
- `EBAY_LISTING_ADMIN_READ_ONLY_DATA_CONTRACT_V1.md`

Debe usarse como capa visual específica dentro de la revisión general de listing.

## 20. Próximos loops recomendados

- `LOOP 070 — eBay Listing Image Plan Schema V1`
- `LOOP 071 — eBay Listing Image QA Fixture V1`
- `LOOP 072 — eBay Listing Admin Image Review Placeholder V1`
