# eBay Listing US Buyer Trust & Lifestyle Visual Strategy V1

## 1. Propósito

Esta estrategia define cómo usar señales visuales de confianza e imágenes lifestyle para mejorar conversión en listings eBay orientados a compradores de Estados Unidos.

El objetivo es que las imágenes generadas, seleccionadas o editadas en futuros loops ayuden al comprador americano a confiar más rápido, entender el producto y visualizar su uso real, sin engañar ni aumentar riesgo de compliance.

Este documento es:

- documentation-only
- advisory-only
- human-review-required
- sin generación de imágenes
- sin OpenAI API en este loop
- sin eBay API real
- sin drafts reales
- sin publicación
- sin cambios reales de listings

No genera imágenes, no conecta OpenAI, no conecta eBay, no crea drafts reales y no autoriza publicación.

## 2. Principio principal

Las imágenes deben aumentar confianza y deseo de compra sin engañar.

Deben ayudar al comprador a entender:

- qué es el producto
- cómo se usa
- dónde se puede usar
- si parece confiable
- si el envío será conveniente
- si el producto está disponible localmente, solo cuando sea verdadero

La regla de V1 es:

```text
US buyer trust = claridad del producto + señales verdaderas + uso realista + revisión humana
```

Una imagen que se ve atractiva pero comunica envío, stock, origen, beneficio o uso falso no debe avanzar.

## 3. Comprador objetivo

El comprador principal es americano.

Reglas de enfoque:

- el copy visual debe estar en inglés
- las señales visuales deben hablar el lenguaje del comprador de EE. UU.
- la imagen debe reducir dudas sobre disponibilidad, shipping y uso real
- el listing debe evitar parecer un producto genérico de dropshipping internacional
- el producto debe verse confiable, cercano y listo para comprar

La estrategia visual debe crear confianza local solo cuando la operación real pueda sostener esa confianza.

## 4. Producto limpio como protagonista

La imagen debe presentar el producto de forma clara y profesional.

Reglas:

- imagen limpia
- fondo blanco o neutro cuando aplique
- producto centrado
- buena iluminación
- el producto debe sobresalir
- no saturar la imagen con textos, badges o gráficos
- no tapar partes importantes del producto

La imagen principal debe seguir siendo entendible incluso si no se usan badges, banderas o textos. El producto debe ser la razón principal para hacer clic.

## 5. Señales visuales de confianza para comprador de EE. UU.

Señales visuales permitidas si son verdaderas, verificables y compatibles con las reglas aplicables:

- `Free Shipping`
- `Ships from USA`
- `In Stock in USA`
- `Fast US Shipping`
- `US Warehouse`
- `Ready to Ship`
- USA flag como señal visual, si no se usa de forma engañosa

Estas señales pueden ayudar a reducir dudas sobre:

- tiempos de envío
- ubicación del stock
- costos adicionales
- confianza de compra
- percepción de disponibilidad local

Una señal de confianza solo debe usarse si una persona puede verificar que es cierta para ese listing específico.

## 6. Regla de honestidad

Reglas estrictas:

- no afirmar `Ships from USA` si el producto no se envía desde EE. UU.
- no afirmar `In Stock in USA` si el stock no está físicamente en EE. UU.
- no afirmar `Free Shipping` si el listing no tiene envío gratis real
- no usar bandera de EE. UU. para sugerir origen, stock o envío local si no es cierto
- no usar frases que oculten que el producto viene de otro país
- no usar señales visuales si la operación no puede cumplirlas

Si una señal no es verificable, el plan visual debe marcarse como incompleto, revisión requerida o bloqueado según severidad.

## 7. Política de eBay y uso en imagen principal

Antes de usar texto, banderas, badges o claims visuales en la imagen principal, se deben revisar las políticas actuales de eBay.

Reglas:

- no asumir que todo badge está permitido en la imagen principal
- si eBay limita texto, badges o gráficos en la imagen principal, usar estas señales en imágenes secundarias o infografías permitidas
- la imagen principal debe seguir siendo limpia y centrada en el producto
- las políticas actuales deben verificarse antes de producción porque pueden cambiar
- cualquier duda de policy debe generar revisión humana antes de avanzar

Esta estrategia no reemplaza la revisión de políticas de eBay. Solo define el enfoque visual interno.

## 8. Lifestyle image con persona/modelo usando el producto

Una estrategia fuerte es mostrar el producto siendo usado por una persona o modelo en un contexto realista, limpio y profesional.

Objetivo:

- ayudar al comprador a imaginar el uso real
- mostrar escala
- mostrar utilidad
- crear deseo de compra
- hacer la imagen más aspiracional

Reglas:

- el producto debe seguir siendo protagonista
- la persona/modelo no debe distraer del producto
- el uso mostrado debe ser realista
- no sexualizar innecesariamente
- no usar personas reales sin permiso/model release
- no usar imágenes de terceros sin autorización
- no sugerir resultados falsos
- no mostrar usos no permitidos
- no usar claims médicos o exagerados
- no mostrar marcas/logos no autorizados
- no usar datos personales ni screenshots sensibles

Si la imagen lifestyle altera la expectativa real del comprador, requiere revisión o reemplazo.

## 9. Imágenes generadas por IA en el futuro

Si en el futuro IMNOVA usa OpenAI como motor generativo de imágenes:

- IMNOVA debe controlar el prompt, reglas, compliance y aprobación
- OpenAI solo genera o edita imágenes
- IMNOVA debe revisar realismo, calidad, derechos, claims, marcas y consistencia del producto
- no se deben inventar medidas, materiales, certificaciones, stock en USA, `Free Shipping` o beneficios
- no se debe sugerir que una persona real endorsa el producto
- no se debe crear engaño sobre tamaño, materiales o resultados
- toda imagen generada debe pasar QA visual y revisión humana antes de usarse

Arquitectura futura:

```text
ImagePlan -> PromptPlan -> OpenAI Image Generation -> Image QA Result -> Human Review -> Listing Pipeline
```

La generación de imágenes no debe saltarse safety gates. Un resultado visual atractivo todavía puede ser bloqueado si no es verdadero, verificable o autorizado.

## 10. Estructura recomendada de galería visual

Orden recomendado:

1. Main image: producto limpio, fondo blanco/neutro.
2. Lifestyle image: persona/modelo usando el producto en contexto realista.
3. Detail image: textura, material, función o close-up.
4. Dimensions image: tamaño/escala.
5. Trust image: `Free Shipping`, `Ships from USA`, `In Stock in USA` si es verdadero y permitido.
6. Package contents image: qué incluye.
7. Comparison/benefit image: comparación simple o beneficio visual, sin engañar.

La galería debe contar una historia visual simple: primero confianza en el producto, luego uso, tamaño, detalles, envío/stock si aplica y contenido del paquete.

## 11. Copy visual en inglés

Todo texto visual orientado a compradores americanos debe estar en inglés.

Ejemplos permitidos si son verdaderos:

- `Free Shipping`
- `Ships from USA`
- `In Stock in USA`
- `Fast US Shipping`
- `US Warehouse`
- `Ready to Ship`
- `Product in Use`
- `Everyday Use`
- `Easy to Use`
- `Designed for Daily Use`
- `Compact Design`
- `Great for Home, Office, or Travel`

El copy visual debe ser corto, legible y verificable. Una frase clara vale más que una imagen saturada con claims.

## 12. Estrategia problema -> solución

Una imagen secundaria puede mostrar o sugerir problema y solución.

Ejemplos:

- `Keep Your Space Clean`
- `Easy Everyday Use`
- `Compact Design for Small Spaces`
- `Organized and Ready to Use`

Reglas:

- no exagerar
- no mostrar antes/después engañoso
- no inventar beneficios
- no sugerir un resultado garantizado
- no convertir un beneficio menor en un claim absoluto

La imagen problema -> solución debe ayudar a entender utilidad, no manipular expectativa.

## 13. Mobile-first

La revisión visual debe asumir que muchos compradores verán el listing desde celular.

Reglas:

- la imagen debe entenderse rápido en celular
- texto grande y legible
- no saturar con demasiadas frases
- producto debe verse claro en miniatura
- si no se entiende en pocos segundos, la imagen no está optimizada

La versión móvil debe revisarse antes de tratar una galería como lista para revisión humana.

## 14. Riesgos visuales

Mandar a revisión o bloquear si aparece:

- señal `Ships from USA` no verificable
- señal `Free Shipping` no coincide con shipping real
- bandera de EE. UU. usada de forma engañosa
- lifestyle image no autorizada
- modelo/persona sin permiso
- imagen sexualizada o distractora
- producto deja de ser protagonista
- claim visual exagerado
- marcas o logos no autorizados
- imagen sugiere beneficios falsos
- imagen contradice descripción real del listing

Riesgos de confianza local son especialmente sensibles porque pueden afectar expectativas de envío, disponibilidad y experiencia del comprador.

## 15. Checklist de confianza para comprador americano

Responder:

- ¿El producto se ve limpio y profesional?
- ¿El producto sigue siendo protagonista?
- ¿El copy visual está en inglés?
- ¿La imagen comunica confianza sin engañar?
- ¿`Free Shipping` es real?
- ¿`Ships from USA` es real?
- ¿`In Stock in USA` es real?
- ¿La persona/modelo tiene autorización o es imagen segura?
- ¿El uso mostrado es realista?
- ¿La imagen se entiende en móvil?
- ¿No hay marcas/logos no autorizados?
- ¿No hay claims falsos?
- ¿Cumple políticas actuales de eBay?

Si una respuesta es incierta, la imagen no debe marcarse como final-ready.

## 16. Relación con QA visual

Esta estrategia debe alimentar:

- Image QA Checklist
- Image Plan Schema
- Image QA Result Schema
- Image QA Service Design

Si una señal de confianza no es verificable, debe generar:

- `IMAGE_QA_NEEDS_DATA`
- `IMAGE_QA_COMPLIANCE_REVIEW_REQUIRED`
- `IMAGE_QA_BLOCKED` si es engañosa o crítica

Mapeo recomendado:

- claim de shipping no verificado -> `IMAGE_QA_NEEDS_DATA`
- uso de bandera de EE. UU. ambiguo -> `IMAGE_QA_COMPLIANCE_REVIEW_REQUIRED`
- señal falsa de stock local -> `IMAGE_QA_BLOCKED`
- persona/modelo sin permiso -> `IMAGE_QA_COMPLIANCE_REVIEW_REQUIRED` o `IMAGE_QA_BLOCKED`

El QA visual debe priorizar verdad, autorización y compliance por encima de conversión.

## 17. Qué NO hacer

No hacer:

- no generar imágenes en este loop
- no usar OpenAI API en este loop
- no usar eBay API
- no crear draft real
- no publicar
- no modificar listings
- no afirmar envío desde USA si no es verdad
- no afirmar stock en USA si no es verdad
- no afirmar `Free Shipping` si no es verdad
- no usar personas reales sin permiso
- no usar imágenes de terceros sin autorización
- no usar marcas ajenas sin permiso
- no usar claims médicos o exagerados
- no usar datos reales sensibles
- no engañar al comprador

Esta estrategia no autoriza acciones reales. Solo define criterios visuales para revisión humana segura.

## 18. Relación con documentos existentes

Este documento complementa:

- `EBAY_LISTING_IMAGE_QUALITY_CONVERSION_STRATEGY_V1.md`
- `EBAY_LISTING_IMAGE_QA_CHECKLIST_V1.md`
- `EBAY_LISTING_IMAGE_PLAN_SCHEMA_V1.md`
- `EBAY_LISTING_IMAGE_QA_RESULT_SCHEMA_V1.md`
- `EBAY_LISTING_IMAGE_QA_SERVICE_DESIGN_V1.md`
- `EBAY_LISTING_DRAFT_SCHEMA_V1.md`

Debe usarse como capa de estrategia visual orientada al comprador americano, encima de los schemas y checklists de QA visual existentes.

## 19. Próximos loops recomendados

- `LOOP 076 — IMNOVA OpenAI Image Generation Architecture V1`
- `LOOP 077 — eBay Listing Conversion Listing Strategy V1`
- `LOOP 078 — eBay Listing US Trust Visual QA Checklist V1`
