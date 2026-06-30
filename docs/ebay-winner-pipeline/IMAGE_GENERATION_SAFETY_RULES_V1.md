# Image Generation Safety Rules V1

## 1. Proposito

Este documento define las reglas de seguridad para futuras generaciones o ediciones de imagenes con OpenAI dentro de IMNOVA.

Este loop es:

- documentation-only
- sin implementacion
- sin conexion OpenAI
- sin OpenAI API call
- sin API keys
- sin generacion de imagenes
- sin eBay API real
- sin drafts reales
- sin publicacion
- sin cambios reales de listings
- human-review-required

## 2. Principio principal

IMNOVA debe bloquear cualquier generacion visual que no este basada en datos reales, que pueda enganar al comprador o que pueda crear riesgo de compliance.

Regla central:

`No verified facts -> no final image generation`

## 3. Relacion con arquitectura

Estas reglas pertenecen a la arquitectura futura:

`ImagePlan -> PromptPlan -> OpenAI Image Generation -> Image QA Result -> Human Review -> Listing Pipeline`

Aplican especialmente a:

- ImagePlan
- PromptPlan
- OpenAI Image Generation
- Image QA Result
- Human Review

## 4. Estados de seguridad

Tipo conceptual:

```ts
type ImnovaImageGenerationSafetyStatus =
  | "SAFETY_READY_FOR_HUMAN_REVIEW"
  | "SAFETY_NEEDS_DATA"
  | "SAFETY_BLOCKED"
  | "SAFETY_REJECTED_AFTER_QA"
  | "SAFETY_APPROVED_FOR_INTERNAL_REVIEW_ONLY";
```

`SAFETY_APPROVED_FOR_INTERNAL_REVIEW_ONLY` no publica, no crea draft real y no modifica listings.

## 5. Safety gate antes del PromptPlan

Antes de crear un PromptPlan, IMNOVA debe confirmar:

- producto identificado
- categoria identificada
- imagen requerida identificada
- facts reales disponibles
- claims permitidos claros
- claims prohibidos claros
- trust signals verificados o desactivados
- restricciones de marca/logos claras
- uso permitido claro
- si hay persona/modelo, autorizacion requerida
- si hay imagen base, autorizacion requerida

Si falta algo critico, el estado debe ser `SAFETY_NEEDS_DATA`.

## 6. Safety gate del PromptPlan

El PromptPlan debe bloquearse si contiene:

- dimensiones inventadas
- materiales inventados
- colores inventados
- certificaciones inventadas
- logos o marcas no autorizadas
- claims medicos o exagerados
- stock USA no verificado
- Free Shipping no verificado
- Ships from USA no verificado
- In Stock in USA no verificado
- shipping speed no verificado
- persona real sin autorizacion
- imagen sexualizada o distractora
- promesa de resultados garantizados
- antes/despues enganoso
- contradiccion con datos reales del producto

## 7. Safety gate de trust signals

Reglas para senales de confianza:

- `Free Shipping` solo si esta verificado.
- `Ships from USA` solo si esta verificado.
- `In Stock in USA` solo si esta verificado.
- `Fast US Shipping` solo si esta verificado.
- USA flag solo si su uso es verdadero, permitido y no enganoso.

Si una senal no esta verificada:

- no incluir en prompt final
- marcar `SAFETY_NEEDS_DATA`
- enviar a revision humana

## 8. Safety gate de lifestyle images

Reglas para imagenes lifestyle:

- producto debe ser protagonista
- uso debe ser realista
- persona/modelo no debe distraer del producto
- no sexualizacion innecesaria
- no sugerir endoso real
- no mostrar marcas/logos ajenos
- no mostrar datos personales
- no crear escenario que contradiga el uso real del producto
- autorizacion/model release requerida si aplica
- revision humana obligatoria

## 9. Safety gate de imagen principal

Reglas:

- producto claro
- fondo blanco/neutro cuando aplique
- no saturar con texto
- no usar badges enganosos
- no usar flags o trust signals no verificadas
- no mostrar accesorios no incluidos
- no alterar tamano relativo de forma enganosa
- no representar un producto distinto
- revisar politicas actuales de eBay antes de usar textos, badges o banderas

Este documento no afirma detalles actuales de politicas de eBay. Solo registra que deben revisarse antes de uso real.

## 10. Safety gate de claims

### Permitidos si son verdaderos y moderados

- easy to use
- designed for daily use
- compact design
- durable material, solo si material esta verificado
- ideal for, solo si el uso es realista

### Prohibidos sin respaldo

- medical claims
- guaranteed results
- certified, si no hay certificacion real
- official brand compatible, si no hay autorizacion
- best on eBay
- cures, heals, treats
- before/after enganoso

## 11. Safety gate de datos reales

No inventar:

- dimensiones
- peso
- material
- color
- contenido del paquete
- certificaciones
- compatibilidad
- pais de envio
- ubicacion de stock
- costo de envio
- tiempo de entrega
- garantia
- beneficios
- accesorios incluidos

Si falta dato, el estado debe ser `SAFETY_NEEDS_DATA`.

## 12. Safety gate de marcas, logos y terceros

Bloquear generacion si pide:

- logo de marca no autorizada
- empaque de marca no autorizado
- producto de marca ajena
- comparacion con marca ajena sin control legal
- imagen de tercero sin permiso
- estilo visual que imite marca protegida
- endorsement falso

## 13. Safety gate de personas

Bloquear o mandar a revision si:

- se usa persona real sin permiso
- se sugiere identidad real
- se sugiere endorsement real
- la persona distrae del producto
- la imagen es sexualizada
- hay menores de edad sin necesidad clara y autorizacion
- hay datos personales visibles
- hay contexto sensible

## 14. Safety gate de imagen generada

Despues de generar una imagen futura, QA debe rechazar si:

- producto parece diferente
- medidas visuales parecen falsas
- materiales parecen diferentes
- texto aparece mal escrito
- trust signal no coincide con facts
- badge parece falso
- logo no autorizado aparece
- persona/contexto genera riesgo
- accesorios no incluidos aparecen como incluidos
- imagen contradice PromptPlan
- imagen contradice product facts

## 15. Safety flags

Tipo conceptual:

```ts
type ImnovaImageGenerationSafetyRulesFlags = {
  advisoryOnly: true;
  documentationOnly: true;
  humanReviewRequired: true;
  openAiApiUsed: false;
  imageGenerated: false;
  externalCallsMade: false;
  ebayApiUsed: false;
  realDraftCreated: false;
  publishedToEbay: false;
  listingMutated: false;
  requiresPolicyReviewBeforeRealUse: true;
};
```

## 16. Decisiones permitidas

Tipo conceptual:

```ts
type ImnovaImageGenerationSafetyDecision =
  | "ALLOW_PROMPT_PLAN_FOR_HUMAN_REVIEW"
  | "NEEDS_MORE_PRODUCT_DATA"
  | "BLOCK_PROMPT_PLAN"
  | "REJECT_GENERATED_IMAGE"
  | "APPROVE_FOR_INTERNAL_REVIEW_ONLY";
```

Ninguna decision publica en eBay ni crea draft real.

## 17. Matriz de decision

| Situacion                                           | Decision                                    |
| --------------------------------------------------- | ------------------------------------------- |
| Faltan dimensiones para dimensions_visual           | NEEDS_MORE_PRODUCT_DATA                     |
| Free Shipping no verificado                         | BLOCK_PROMPT_PLAN o NEEDS_MORE_PRODUCT_DATA |
| Lifestyle sin autorizacion de modelo                | BLOCK_PROMPT_PLAN                           |
| Producto con facts completos y sin claims riesgosos | ALLOW_PROMPT_PLAN_FOR_HUMAN_REVIEW          |
| Imagen generada contradice producto                 | REJECT_GENERATED_IMAGE                      |
| Imagen pasa QA pero no fue revisada por humano      | APPROVE_FOR_INTERNAL_REVIEW_ONLY            |

## 18. Ejemplo seguro

Ejemplo textual:

- imageRole: `white_background_product_image`
- facts verificados
- sin trust signals
- sin claims riesgosos
- decision: `ALLOW_PROMPT_PLAN_FOR_HUMAN_REVIEW`

Interpretacion: el PromptPlan puede avanzar a revision humana antes de cualquier futura generacion. Esto no genera imagenes, no llama OpenAI y no publica en eBay.

## 19. Ejemplo bloqueado

Ejemplo textual:

- imageRole: `us_buyer_trust_visual`
- pide `Free Shipping` y `Ships from USA`
- facts no verificados
- decision: `BLOCK_PROMPT_PLAN`
- razon: trust signals no verificadas

Interpretacion: IMNOVA debe bloquear el prompt o pedir datos verificables antes de permitir cualquier generacion futura.

## 20. Relacion con documentos existentes

Este documento se relaciona con:

- `IMNOVA_OPENAI_IMAGE_GENERATION_ARCHITECTURE_V1.md`
- `IMAGE_GENERATION_PROMPT_PLAN_SCHEMA_V1.md`
- `EBAY_LISTING_US_BUYER_TRUST_LIFESTYLE_VISUAL_STRATEGY_V1.md`
- `EBAY_LISTING_IMAGE_QA_RESULT_SCHEMA_V1.md`
- `EBAY_LISTING_IMAGE_QA_SERVICE_DESIGN_V1.md`
- `EBAY_LISTING_IMAGE_QA_CHECKLIST_V1.md`

## 21. Que NO hacer

- no implementar generacion en este loop
- no llamar OpenAI API
- no usar API keys
- no generar imagenes reales
- no usar eBay API
- no crear draft real
- no publicar
- no modificar listings
- no inventar facts
- no inventar trust signals
- no usar personas sin autorizacion
- no usar logos no autorizados
- no afirmar politicas actuales de eBay sin revision vigente

## 22. Proximos loops recomendados

- `LOOP 079 - Image Generation Prompt Plan Fixture V1`
- `LOOP 080 - Image Generator Admin Placeholder V1`
- `LOOP 081 - Image Generation Dry Run Result Schema V1`
