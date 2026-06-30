# Image Generation Prompt Plan Schema V1

## 1. Propósito

Este documento define el formato seguro del `PromptPlan` que IMNOVA usará en el futuro antes de solicitar generación o edición de imágenes con OpenAI.

El objetivo es estructurar qué puede pedirse, qué datos reales sustentan el pedido, qué claims están permitidos, qué elementos están prohibidos y qué revisión humana debe ocurrir antes de cualquier uso visual en listings eBay.

Este documento es:

- documentation-only
- sin implementación
- sin conexión OpenAI en este loop
- sin OpenAI API call
- sin API keys
- sin generación de imágenes
- sin eBay API real
- sin drafts reales
- sin publicación
- sin cambios reales de listings
- human-review-required

No genera imágenes, no llama OpenAI, no conecta eBay, no crea drafts reales y no autoriza publicación.

## 2. Principio principal

El `PromptPlan` no es una imagen y no genera nada por sí solo. Es una instrucción segura, revisable y controlada por IMNOVA.

Reglas:

- OpenAI genera o edita imágenes.
- IMNOVA decide qué prompt es permitido.
- El `PromptPlan` debe basarse en datos reales.
- Si faltan datos críticos, no se debe generar imagen final.
- Toda imagen futura requiere QA visual y revisión humana.

Un `PromptPlan` útil debe reducir ambigüedad. Si deja espacio para inventar medidas, materiales, disponibilidad, beneficios o señales de confianza, debe revisarse antes de cualquier generación futura.

## 3. Relación con arquitectura IMNOVA/OpenAI

Arquitectura futura:

```text
ImagePlan -> PromptPlan -> OpenAI Image Generation -> Image QA Result -> Human Review -> Listing Pipeline
```

Relación:

- `ImagePlan` define qué imagen hace falta.
- `PromptPlan` convierte esa necesidad en instrucciones seguras.
- OpenAI genera o edita.
- Image QA revisa resultado.
- Humano aprueba.
- Listing Pipeline solo avanza internamente.

El `PromptPlan` es la capa de control entre la necesidad visual y la generación. No debe saltarse el ImagePlan ni reemplazar revisión humana.

## 4. Tipo principal: ImnovaImageGenerationPromptPlan

Tipo conceptual TypeScript:

```ts
type ImnovaImageGenerationPromptPlan = {
  promptVersion: "IMAGE_GENERATION_PROMPT_PLAN_SCHEMA_V1";
  caseId: string;
  candidateName: string;
  generatedAt: string;
  imageRole:
    | "main_product_image"
    | "white_background_product_image"
    | "lifestyle_product_in_use"
    | "detail_closeup"
    | "dimensions_visual"
    | "package_contents_visual"
    | "comparison_visual"
    | "infographic_visual"
    | "us_buyer_trust_visual"
    | "variant_visual";
  targetBuyer: "us_ebay_buyer";
  language: "en";
  promptStatus:
    | "PROMPT_PLAN_READY_FOR_HUMAN_REVIEW"
    | "PROMPT_PLAN_NEEDS_DATA"
    | "PROMPT_PLAN_BLOCKED";
  productFacts: ImnovaPromptProductFacts;
  visualStrategy: ImnovaPromptVisualStrategy;
  trustSignals: ImnovaPromptTrustSignals;
  allowedClaims: string[];
  prohibitedClaims: string[];
  requiredElements: string[];
  forbiddenElements: string[];
  safetyRules: string[];
  outputRequirements: ImnovaPromptOutputRequirements;
  requiredHumanActions: string[];
  safetyFlags: ImnovaPromptPlanSafetyFlags;
};
```

Este tipo representa planificación interna. No representa una llamada real a OpenAI ni un payload de eBay.

## 5. Tipo: ImnovaPromptProductFacts

Tipo conceptual TypeScript:

```ts
type ImnovaPromptProductFacts = {
  productName: string;
  category: string;
  color?: string;
  material?: string;
  dimensions?: string;
  packageContents?: string[];
  allowedUseCases: string[];
  knownLimitations: string[];
  factsVerified: boolean;
};
```

`factsVerified` debe ser `true` para que el plan pueda considerarse listo para revisión humana. Si falta material, dimensiones, contenido del paquete o uso permitido para una imagen que depende de esos datos, el plan debe quedar en `PROMPT_PLAN_NEEDS_DATA`.

## 6. Tipo: ImnovaPromptVisualStrategy

Tipo conceptual TypeScript:

```ts
type ImnovaPromptVisualStrategy = {
  backgroundStyle: "white" | "neutral" | "lifestyle" | "transparent" | "other";
  composition: string;
  lighting: string;
  cameraAngle?: string;
  mobileFirst: boolean;
  productMustRemainHero: boolean;
  lifestyleContext?: string;
  avoidVisualClutter: boolean;
};
```

La estrategia visual debe ser específica. Debe indicar si el producto necesita fondo limpio, contexto lifestyle, close-up, escala o una composición mobile-first.

## 7. Tipo: ImnovaPromptTrustSignals

Tipo conceptual TypeScript:

```ts
type ImnovaPromptTrustSignals = {
  freeShipping: {
    allowed: boolean;
    verified: boolean;
    text?: "Free Shipping";
  };
  shipsFromUsa: {
    allowed: boolean;
    verified: boolean;
    text?: "Ships from USA";
  };
  inStockInUsa: {
    allowed: boolean;
    verified: boolean;
    text?: "In Stock in USA";
  };
  usaFlag: {
    allowed: boolean;
    verified: boolean;
    purpose?: string;
  };
};
```

Si `verified` es `false`, la señal no debe usarse en prompts finales.

Una señal puede ser visualmente atractiva y aun así estar bloqueada si no es verdadera para el listing.

## 8. Tipo: ImnovaPromptOutputRequirements

Tipo conceptual TypeScript:

```ts
type ImnovaPromptOutputRequirements = {
  intendedUse: "internal_review_only";
  imageGenerationAllowed: boolean;
  requiresImageQa: true;
  requiresHumanReview: true;
  doNotPublish: true;
  doNotCreateRealDraft: true;
};
```

`imageGenerationAllowed` solo puede ser `true` cuando los datos críticos están completos y no hay bloqueadores de prompt.

## 9. Tipo: ImnovaPromptPlanSafetyFlags

Tipo conceptual TypeScript:

```ts
type ImnovaPromptPlanSafetyFlags = {
  advisoryOnly: true;
  localOnly: true;
  openAiApiUsed: false;
  imageGenerated: false;
  externalCallsMade: false;
  ebayApiUsed: false;
  realDraftCreated: false;
  publishedToEbay: false;
  listingMutated: false;
  requiresHumanReview: true;
};
```

En este schema/documento no se llama OpenAI. Los flags reflejan que es solo planificación.

Si un `PromptPlan` futuro indica que ya se generó una imagen, ese objeto ya no representa este estado inicial de planificación y debe pasar a un flujo de generación/QA separado.

## 10. Roles de imagen y prompt

Comportamiento esperado por `imageRole`:

- `white_background_product_image`: producto limpio, fondo blanco/neutro, producto protagonista.
- `lifestyle_product_in_use`: producto usado en contexto realista.
- `detail_closeup`: mostrar material, textura o función.
- `dimensions_visual`: usar solo dimensiones reales verificadas.
- `package_contents_visual`: mostrar solo contenido real del paquete.
- `comparison_visual`: comparación simple no engañosa.
- `infographic_visual`: explicación clara, poco texto, sin claims falsos.
- `us_buyer_trust_visual`: señales como `Free Shipping` o `Ships from USA` solo si verificadas.

Cada rol debe tener propósito claro. No debe pedirse una imagen genérica si el producto necesita una función visual específica.

## 11. Reglas de idioma

Todo copy visual para compradores americanos debe estar en inglés.

Ejemplos:

- `Free Shipping`
- `Ships from USA`
- `In Stock in USA`
- `Fast US Shipping`
- `Ready to Ship`
- `Product in Use`
- `Easy to Use`
- `Designed for Daily Use`

El prompt debe evitar mezclar idiomas en texto visible para el comprador objetivo.

## 12. Reglas de datos reales

El `PromptPlan` no debe inventar:

- medidas
- materiales
- colores
- contenido del paquete
- certificaciones
- marcas
- stock en USA
- `Free Shipping`
- shipping speed
- beneficios
- usos no permitidos

Si falta información, `promptStatus` debe ser `PROMPT_PLAN_NEEDS_DATA`.

El plan debe preferir omitir un elemento visual antes que inventarlo.

## 13. Reglas de bloqueo

`PromptPlan` debe ser `PROMPT_PLAN_BLOCKED` si solicita:

- marca/logo no autorizado
- claims médicos
- antes/después engañoso
- certificaciones inventadas
- stock USA falso
- `Free Shipping` falso
- persona real sin permiso
- imagen sexualizada o distractora
- datos sensibles
- URLs privadas
- contradicción con datos reales del producto

Un prompt bloqueado no debe avanzar a generación ni a revisión humana como candidato de generación. Debe corregirse o descartarse.

## 14. Ejemplo JSON seguro: lifestyle_product_in_use

Ejemplo simulado para `LISTING-GEN-001`:

```json
{
  "promptVersion": "IMAGE_GENERATION_PROMPT_PLAN_SCHEMA_V1",
  "caseId": "LISTING-GEN-001",
  "candidateName": "Simulated listing image plan candidate",
  "generatedAt": "2026-01-01T00:00:00.000Z",
  "imageRole": "lifestyle_product_in_use",
  "targetBuyer": "us_ebay_buyer",
  "language": "en",
  "promptStatus": "PROMPT_PLAN_NEEDS_DATA",
  "productFacts": {
    "productName": "Simulated product",
    "category": "Simulated category",
    "color": "neutral",
    "material": "unknown",
    "allowedUseCases": [
      "Everyday use in a clean home or office setting"
    ],
    "knownLimitations": [
      "Verified dimensions are still missing"
    ],
    "factsVerified": false
  },
  "visualStrategy": {
    "backgroundStyle": "lifestyle",
    "composition": "Product remains the hero while shown in realistic everyday use.",
    "lighting": "Clean, bright, natural-looking light.",
    "cameraAngle": "Straight or slightly angled view that keeps product details visible.",
    "mobileFirst": true,
    "productMustRemainHero": true,
    "lifestyleContext": "Clean US buyer-friendly home or office environment.",
    "avoidVisualClutter": true
  },
  "trustSignals": {
    "freeShipping": {
      "allowed": false,
      "verified": false
    },
    "shipsFromUsa": {
      "allowed": false,
      "verified": false
    },
    "inStockInUsa": {
      "allowed": false,
      "verified": false
    },
    "usaFlag": {
      "allowed": false,
      "verified": false,
      "purpose": "Do not use until stock or shipping claim is verified."
    }
  },
  "allowedClaims": [
    "Product in Use",
    "Easy to Use"
  ],
  "prohibitedClaims": [
    "Ships from USA",
    "In Stock in USA",
    "Free Shipping",
    "Certified",
    "Medical benefit"
  ],
  "requiredElements": [
    "Product visible and dominant",
    "Realistic lifestyle context",
    "English-only buyer-facing text if text is used"
  ],
  "forbiddenElements": [
    "Unauthorized logos",
    "Medical claims",
    "Fake USA shipping or stock signals",
    "Private data",
    "Base64 image data"
  ],
  "safetyRules": [
    "Do not invent dimensions.",
    "Do not invent material.",
    "Do not imply verified USA stock or shipping.",
    "Require human review before any future image use."
  ],
  "outputRequirements": {
    "intendedUse": "internal_review_only",
    "imageGenerationAllowed": false,
    "requiresImageQa": true,
    "requiresHumanReview": true,
    "doNotPublish": true,
    "doNotCreateRealDraft": true
  },
  "requiredHumanActions": [
    "Verify dimensions before final image generation.",
    "Verify shipping and stock location before using trust signals."
  ],
  "safetyFlags": {
    "advisoryOnly": true,
    "localOnly": true,
    "openAiApiUsed": false,
    "imageGenerated": false,
    "externalCallsMade": false,
    "ebayApiUsed": false,
    "realDraftCreated": false,
    "publishedToEbay": false,
    "listingMutated": false,
    "requiresHumanReview": true
  }
}
```

Este ejemplo no incluye un prompt final de producción. Es solo un plan seguro para revisión.

## 15. Ejemplo de PromptPlan bloqueado

Ejemplo textual:

```text
Input request:
Create a lifestyle image with a USA flag and the text "Ships from USA" even though stock location has not been verified.

Result:
PROMPT_PLAN_BLOCKED or PROMPT_PLAN_NEEDS_DATA

Reason:
Trust signal is not verifiable. The prompt could mislead the buyer about shipping origin or stock availability.
```

Si la señal puede verificarse con datos reales, el plan puede volver a revisión. Si no puede verificarse, no debe generarse.

## 16. Campos prohibidos

No incluir:

- API keys
- Authorization headers
- tokens
- passwords
- secrets
- URLs privadas
- datos reales sensibles
- datos de proveedor
- datos de cliente
- imágenes base64
- rutas locales sensibles
- payload completo del candidato

Si aparece un campo prohibido, el `PromptPlan` debe rechazarse o redactarse antes de cualquier generación futura.

## 17. Relación con QA visual

El `PromptPlan` debe alimentar OpenAI Image Generation en el futuro.

Reglas:

- toda imagen generada debe alimentar Image QA Result
- si `PromptPlan` contiene datos no verificados, no debe llegar a generación final
- si una imagen generada contradice el `PromptPlan`, debe ser rechazada
- si QA detecta claims, logos, dimensiones o trust signals falsos, debe bloquear o pedir revisión

El QA visual debe comparar la imagen generada contra el plan, no solo contra su calidad estética.

## 18. Relación con eBay

Reglas:

- `PromptPlan` no crea listing
- `PromptPlan` no crea draft
- `PromptPlan` no publica
- `PromptPlan` no sube imágenes a eBay
- cualquier imagen futura debe pasar revisión de políticas actuales de eBay

Un plan listo para revisión humana no equivale a un asset listo para eBay.

## 19. Qué NO hacer

No hacer:

- no implementar generación en este loop
- no llamar OpenAI API
- no usar API keys
- no generar imágenes reales
- no usar eBay API
- no crear draft real
- no publicar
- no modificar listings
- no inventar datos del producto
- no inventar señales de confianza
- no usar datos reales sensibles

Este schema no autoriza acciones reales. Solo define cómo estructurar prompts seguros antes de una implementación futura.

## 20. Próximos loops recomendados

- `LOOP 078 — Image Generation Safety Rules V1`
- `LOOP 079 — Image Generation Prompt Plan Fixture V1`
- `LOOP 080 — Image Generator Admin Placeholder V1`
