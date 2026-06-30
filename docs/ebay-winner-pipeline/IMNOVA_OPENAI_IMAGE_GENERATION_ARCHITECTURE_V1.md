# IMNOVA OpenAI Image Generation Architecture V1

## 1. Propósito

Este documento define la arquitectura futura para usar OpenAI como motor generativo de imágenes dentro de IMNOVA.

El objetivo es dejar claro cómo IMNOVA controlará el flujo comercial, visual y de compliance antes de permitir que una imagen generada o editada avance hacia revisión interna de listings eBay.

Este documento es:

- documentation-only
- sin implementación
- sin conexión OpenAI en este loop
- sin API keys
- sin generación de imágenes
- sin eBay API real
- sin drafts reales
- sin publicación
- sin cambios reales de listings
- human-review-required

No implementa generación, no llama OpenAI, no conecta eBay, no crea drafts reales y no autoriza publicación.

## 2. Principio principal

OpenAI puede generar o editar imágenes, pero IMNOVA controla el flujo.

Reglas:

- OpenAI no decide qué se publica.
- OpenAI no aprueba imágenes.
- OpenAI no valida compliance comercial.
- IMNOVA decide qué se puede pedir.
- IMNOVA bloquea prompts inseguros.
- IMNOVA valida calidad/compliance.
- Un humano aprueba antes de usar imágenes en eBay.

La generación de imágenes debe ser tratada como una capacidad subordinada al pipeline de revisión, no como una aprobación automática.

## 3. Arquitectura general

Arquitectura futura:

```text
ImagePlan -> PromptPlan -> OpenAI Image Generation -> Image QA Result -> Human Review -> Listing Pipeline
```

### ImagePlan

Define qué imágenes necesita el listing:

- main
- angle
- detail
- dimensions
- lifestyle
- package contents
- comparison
- infographic
- trust image

El ImagePlan indica roles, datos faltantes, riesgos visuales, autorización y acciones humanas necesarias antes de pedir o aceptar una imagen.

### PromptPlan

Convierte el ImagePlan en instrucciones seguras para generación.

El PromptPlan debe incluir facts verificables, claims permitidos, claims prohibidos, restricciones visuales y reglas de seguridad antes de cualquier llamada futura a OpenAI.

### OpenAI Image Generation

Genera o edita imágenes según prompts aprobados.

OpenAI debe recibir instrucciones limitadas, seguras y basadas en datos reales. No debe recibir secretos, credenciales, URLs privadas, datos sensibles ni claims no verificados.

### Image QA Result

Evalúa imagen generada:

- calidad
- autorización
- realismo
- compliance
- conversión
- consistencia con producto

El resultado debe resumir qué pasó, qué falta, qué riesgo existe y qué acción humana se requiere.

### Human Review

Una persona revisa y aprueba o rechaza.

La revisión humana confirma si la imagen representa el producto real, respeta claims permitidos, evita engaño y puede avanzar dentro del pipeline interno.

### Listing Pipeline

Solo después de aprobación humana puede avanzar internamente. No publicar automáticamente.

Un avance interno no significa crear draft real, llamar eBay, publicar ni modificar listings.

## 4. Rol de OpenAI

OpenAI debe tratarse como motor generativo.

Puede ayudar a:

- crear imagen de producto limpia
- crear lifestyle image
- crear infografía visual
- crear imagen de dimensiones si los datos son reales
- crear imagen de package contents si el contenido es real
- crear imagen de comparación si no es engañosa
- crear visuales de trust signals si son verdaderos

No debe:

- inventar dimensiones
- inventar materiales
- inventar certificaciones
- inventar stock en USA
- inventar `Free Shipping`
- inventar beneficios
- inventar logos/marcas
- representar un producto distinto
- crear claims médicos o exagerados

OpenAI no debe ser usado como fuente de verdad del producto. Solo puede generar imágenes a partir de datos controlados por IMNOVA.

## 5. Rol de IMNOVA

IMNOVA debe controlar:

- datos reales del producto
- prompt seguro
- reglas de marca/compliance
- reglas de eBay
- autorización visual
- idioma del copy
- claims permitidos
- señales de confianza verificables
- QA visual
- decisión humana
- logging/auditoría futura

IMNOVA debe actuar como capa de gobierno sobre la generación. Si falta un dato o existe riesgo, IMNOVA debe bloquear, pedir datos o mandar a revisión humana.

## 6. Datos requeridos antes de generar

Antes de pedir una imagen a OpenAI, IMNOVA debe tener:

- product name
- product category
- product color
- material real
- dimensiones reales si aplica
- contenido real del paquete
- uso permitido
- estilo visual permitido
- shipping real
- stock location real
- `Free Shipping` real o no
- autorización de imagen/referencia
- restricciones de claims
- restricciones de marca/logos

Si faltan datos críticos, no generar imagen final.

Ejemplos de datos críticos:

- dimensiones para una imagen de escala
- contenido del paquete para una imagen de package contents
- ubicación real del stock para `Ships from USA` o `In Stock in USA`
- autorización de referencia si se edita o imita una imagen existente

## 7. Tipos de imágenes futuras

Tipos de imágenes futuras:

- `main_product_image`
- `white_background_product_image`
- `lifestyle_product_in_use`
- `detail_closeup`
- `dimensions_visual`
- `package_contents_visual`
- `comparison_visual`
- `infographic_visual`
- `us_buyer_trust_visual`
- `variant_visual`

Cada tipo debe mapearse a un rol del ImagePlan y a un objetivo de revisión. No debe generarse una imagen si su propósito, datos o restricciones no están claros.

## 8. PromptPlan futuro

El PromptPlan debe definir conceptualmente:

- `promptVersion`
- `caseId`
- `imageRole`
- `targetBuyer`
- `language`
- `productFacts`
- `allowedClaims`
- `prohibitedClaims`
- `visualStyle`
- `requiredElements`
- `forbiddenElements`
- `trustSignals`
- `safetyRules`
- `outputRequirements`
- `requiresHumanReview`

El PromptPlan no debe contener secretos, URLs privadas, datos reales sensibles ni claims no verificados.

Un PromptPlan seguro debe ser:

- específico
- verificable
- limitado a facts reales
- claro sobre elementos prohibidos
- compatible con revisión humana

## 9. Trust signals y comprador americano

Señales como:

- `Free Shipping`
- `Ships from USA`
- `In Stock in USA`
- `Fast US Shipping`
- USA flag

solo pueden usarse si son verdaderas y verificables.

Si no son verificables:

- no generar
- marcar como needs data
- mandar a revisión humana

OpenAI no debe inventar señales de confianza. IMNOVA debe pasarlas explícitamente solo cuando estén verificadas.

## 10. Lifestyle images

Reglas:

- uso realista
- producto protagonista
- persona/modelo no distractora
- sin sexualización innecesaria
- sin marcas/logos ajenos
- sin claims falsos
- sin sugerir endoso real
- sin datos personales
- revisión humana obligatoria

Una lifestyle image debe ayudar al comprador a imaginar el uso real sin alterar expectativas sobre tamaño, material, cantidad, resultado o rendimiento.

## 11. Imagen principal

Reglas:

- producto claro
- fondo blanco/neutro cuando aplique
- sin saturación de texto
- sin badges engañosos
- revisar políticas actuales de eBay antes de usar textos/banderas/badges
- producto debe ser consistente con el real

La imagen principal debe priorizar claridad del producto. Si una señal de confianza puede comprometer policy, legibilidad o honestidad, debe moverse a imagen secundaria o bloquearse hasta revisión.

## 12. Seguridad de prompts

Bloquear prompts que pidan:

- inventar dimensiones
- inventar materiales
- inventar certificaciones
- usar marcas no autorizadas
- usar logos no autorizados
- crear claims médicos
- crear antes/después engañoso
- crear stock USA falso
- crear `Free Shipping` falso
- mostrar personas reales sin autorización
- crear imágenes que contradigan el producto real

El prompt debe proteger al comprador de expectativas falsas y proteger a IMNOVA de claims, marcas o visuales no autorizados.

## 13. Seguridad del resultado generado

Toda imagen generada debe pasar por:

- Image QA Result
- visual compliance review
- human review

No puede avanzar si:

- parece otro producto
- inventa detalles
- distorsiona tamaño
- usa logos/marcas
- incluye claims riesgosos
- muestra texto incorrecto
- genera persona o contexto problemático
- contradice datos reales

Una imagen generada no se considera usable por estar bien renderizada. Debe ser verdadera, consistente, útil y revisada.

## 14. Estados futuros de generación

Estados futuros:

- `IMAGE_GENERATION_NOT_REQUESTED`
- `IMAGE_GENERATION_PROMPT_READY`
- `IMAGE_GENERATION_BLOCKED`
- `IMAGE_GENERATION_GENERATED_FOR_REVIEW`
- `IMAGE_GENERATION_NEEDS_QA`
- `IMAGE_GENERATION_REJECTED`
- `IMAGE_GENERATION_APPROVED_FOR_INTERNAL_USE`

`IMAGE_GENERATION_APPROVED_FOR_INTERNAL_USE` no publica ni crea draft real.

Ese estado solo significa que la imagen puede avanzar dentro de un flujo interno controlado, sujeto a otras revisiones del listing.

## 15. Safety flags futuros

Tipo conceptual:

```ts
type ImnovaImageGenerationSafetyFlags = {
  advisoryOnly: true;
  humanReviewRequired: true;
  openAiApiUsed: boolean;
  imageGenerated: boolean;
  externalCallsMade: boolean;
  ebayApiUsed: false;
  realDraftCreated: false;
  publishedToEbay: false;
  listingMutated: false;
};
```

En este loop no se usa OpenAI. Esto solo define flags futuros.

Los flags deben dejar claro si hubo llamada externa, si se generó imagen y si todavía requiere revisión humana.

## 16. Flujo de aprobación humana

Una persona debe confirmar:

- imagen representa producto real
- no inventa medidas
- no inventa materiales
- no usa claims falsos
- no usa logos/marcas no autorizadas
- trust signals son verdaderos
- imagen cumple propósito
- imagen ayuda a conversión
- imagen es aceptable para eBay

Si una persona no puede confirmar un punto crítico, la imagen debe quedar en needs data, revisión o bloqueada.

## 17. Relación con eBay

Reglas:

- ninguna imagen generada se sube automáticamente a eBay
- ninguna imagen generada crea draft real
- ninguna imagen generada publica
- las políticas actuales de eBay deben revisarse antes de usar imágenes generadas
- el uso de textos, badges o banderas debe validarse antes de imagen principal

IMNOVA debe tratar eBay como destino futuro controlado, no como una integración automática de este flujo.

## 18. Relación con documentos existentes

Este documento complementa:

- `EBAY_LISTING_US_BUYER_TRUST_LIFESTYLE_VISUAL_STRATEGY_V1.md`
- `EBAY_LISTING_IMAGE_PLAN_SCHEMA_V1.md`
- `EBAY_LISTING_IMAGE_QA_RESULT_SCHEMA_V1.md`
- `EBAY_LISTING_IMAGE_QA_SERVICE_DESIGN_V1.md`
- `EBAY_LISTING_IMAGE_QA_CHECKLIST_V1.md`
- `EBAY_LISTING_IMAGE_QUALITY_CONVERSION_STRATEGY_V1.md`

Debe servir como capa de arquitectura entre la estrategia visual y futuros schemas, fixtures, servicios o vistas Admin de generación de imágenes.

## 19. Qué NO hacer

No hacer:

- no implementar generación en este loop
- no llamar OpenAI API
- no guardar API keys
- no generar imágenes reales
- no usar eBay API
- no crear draft real
- no publicar
- no modificar listings
- no usar datos reales sensibles
- no usar imágenes de terceros sin permiso
- no inventar datos del producto
- no inventar señales de confianza

Este documento no autoriza acciones reales. Solo define arquitectura futura para una implementación segura.

## 20. Próximos loops recomendados

- `LOOP 077 — Image Generation Prompt Plan Schema V1`
- `LOOP 078 — Image Generation Safety Rules V1`
- `LOOP 079 — Image Generator Admin Placeholder V1`
