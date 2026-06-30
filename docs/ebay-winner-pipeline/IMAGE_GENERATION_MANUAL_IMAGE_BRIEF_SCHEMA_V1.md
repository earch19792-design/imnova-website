# Image Generation Manual Image Brief Schema V1

## 1. Proposito

Este documento define el schema del Manual Image Brief que IMNOVA usara para preparar instrucciones seguras de creacion o edicion manual de imagenes de listing.

El Manual Image Brief convierte datos reales, PromptPlan, Dry Run Result, reglas de seguridad, claims permitidos/prohibidos y trust signals verificadas en una guia clara para una persona.

Este documento es:

- documentation-only
- sin implementacion
- sin generacion de imagenes
- sin conexion OpenAI
- sin OpenAI API call
- sin API keys
- sin eBay API real
- sin drafts reales
- sin publicacion
- sin cambios reales de listings
- human-review-required

No genera imagenes, no llama OpenAI, no conecta eBay, no crea drafts reales, no publica y no modifica listings.

## 2. Principio principal

El Manual Image Brief no genera imagenes por si solo.

Regla:

```text
Manual Image Brief guides a human. It does not execute generation, upload, draft, or publish.
```

El brief debe ser una guia segura para creacion manual, no un comando ejecutable ni un payload de generacion.

## 3. Relacion con el flujo manual

Flujo manual:

```text
Product Facts -> ImagePlan -> PromptPlan -> Dry Run Runner -> Manual Image Brief -> Human Manual Creation -> Image QA -> Human Approval -> Listing Asset Ready
```

Relacion:

- PromptPlan organiza instrucciones seguras.
- Dry Run Result indica si se puede avanzar.
- Manual Image Brief traduce eso en instrucciones claras para una persona.
- Imagen final requiere QA y aprobacion humana.

El brief no reemplaza el PromptPlan ni el Dry Run Result. Los resume en un formato accionable para una persona, manteniendo bloqueos, datos faltantes y reglas de seguridad.

## 4. Tipo principal: ImnovaManualImageBrief

Tipo conceptual TypeScript:

```ts
type ImnovaManualImageBrief = {
  briefVersion: "IMAGE_GENERATION_MANUAL_IMAGE_BRIEF_SCHEMA_V1";
  caseId: string;
  candidateName: string;
  createdAt: string;
  sourcePromptPlanVersion: "IMAGE_GENERATION_PROMPT_PLAN_SCHEMA_V1";
  sourceDryRunResultVersion: "IMAGE_GENERATION_DRY_RUN_RESULT_SCHEMA_V1";
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
  briefStatus:
    | "MANUAL_IMAGE_BRIEF_NEEDS_DATA"
    | "MANUAL_IMAGE_BRIEF_READY_FOR_HUMAN_CREATION"
    | "MANUAL_IMAGE_BRIEF_BLOCKED";
  creationMode: "manual_external_tool" | "manual_photo_editing" | "manual_design";
  productFacts: ImnovaManualImageBriefProductFacts;
  visualGoal: ImnovaManualImageBriefVisualGoal;
  allowedClaims: string[];
  prohibitedClaims: string[];
  requiredElements: string[];
  forbiddenElements: string[];
  trustSignals: ImnovaManualImageBriefTrustSignals;
  manualInstructions: string[];
  safetyNotes: string[];
  qaChecklist: string[];
  requiredHumanActions: string[];
  approvalRequirements: ImnovaManualImageBriefApprovalRequirements;
  safetyFlags: ImnovaManualImageBriefSafetyFlags;
};
```

Este tipo representa una guia interna. No representa una imagen, una llamada a OpenAI, una subida de asset, un draft eBay ni una publicacion.

## 5. Tipo: Product Facts

Tipo conceptual TypeScript:

```ts
type ImnovaManualImageBriefProductFacts = {
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

`factsVerified` debe ser `true` antes de considerar un brief listo para creacion humana final. Si faltan datos que afectan la imagen, el brief debe quedar en `MANUAL_IMAGE_BRIEF_NEEDS_DATA`.

## 6. Tipo: Visual Goal

Tipo conceptual TypeScript:

```ts
type ImnovaManualImageBriefVisualGoal = {
  primaryGoal: string;
  backgroundStyle: "white" | "neutral" | "lifestyle" | "transparent" | "other";
  composition: string;
  lighting: string;
  mobileFirst: boolean;
  productMustRemainHero: boolean;
  lifestyleContext?: string;
  avoidVisualClutter: boolean;
};
```

El visual goal debe explicar que debe lograr la imagen y que restricciones visuales debe respetar. No debe dejar espacio para inventar escala, materiales, accesorios, claims o trust signals.

## 7. Tipo: Trust Signals

Tipo conceptual TypeScript:

```ts
type ImnovaManualImageBriefTrustSignals = {
  freeShipping: {
    allowed: boolean;
    verified: boolean;
    text?: "Free Shipping";
    instruction: "use" | "do_not_use" | "needs_verification";
  };
  shipsFromUsa: {
    allowed: boolean;
    verified: boolean;
    text?: "Ships from USA";
    instruction: "use" | "do_not_use" | "needs_verification";
  };
  inStockInUsa: {
    allowed: boolean;
    verified: boolean;
    text?: "In Stock in USA";
    instruction: "use" | "do_not_use" | "needs_verification";
  };
  usaFlag: {
    allowed: boolean;
    verified: boolean;
    instruction: "use" | "do_not_use" | "needs_verification";
  };
};
```

Si `verified` es `false`, `instruction` no puede ser `use`.

Una senal no verificada debe quedar como `needs_verification` o `do_not_use`. El brief no debe convertir una senal atractiva en una instruccion usable.

## 8. Tipo: Approval Requirements

Tipo conceptual TypeScript:

```ts
type ImnovaManualImageBriefApprovalRequirements = {
  requiresImageQa: true;
  requiresHumanReview: true;
  requiresPolicyReviewBeforeEbayUse: true;
  approvedForInternalUseOnly: boolean;
  approvedForListingReview: boolean;
  doNotPublish: true;
  doNotCreateRealDraft: true;
};
```

Un brief listo para creacion humana todavia requiere QA, revision humana y revision de politicas antes de cualquier uso real en eBay.

## 9. Tipo: Safety Flags

Tipo conceptual TypeScript:

```ts
type ImnovaManualImageBriefSafetyFlags = {
  advisoryOnly: true;
  manualWorkflowOnly: true;
  imageGenerated: false;
  openAiApiUsed: false;
  externalCallsMade: false;
  ebayApiUsed: false;
  realDraftCreated: false;
  publishedToEbay: false;
  listingMutated: false;
  reportPersisted: false;
  humanReviewRequired: true;
};
```

Estos flags deben dejar claro que el brief es solo una guia manual y no una ejecucion real.

## 10. Estados del brief

Estados:

- `MANUAL_IMAGE_BRIEF_NEEDS_DATA`: faltan datos criticos.
- `MANUAL_IMAGE_BRIEF_READY_FOR_HUMAN_CREATION`: una persona puede crear imagen manual para revision.
- `MANUAL_IMAGE_BRIEF_BLOCKED`: no se debe crear imagen hasta corregir riesgos.

El estado debe ser conservador. Si hay dudas sobre facts, trust signals, autorizacion de persona/modelo o claims, el brief debe quedar en needs data o blocked.

## 11. Reglas para crear el brief

El brief debe crearse solo si:

- hay Product Facts suficientes
- existe PromptPlan
- existe Dry Run Result
- no hay estado rejected
- trust signals estan verificadas o bloqueadas
- claims prohibidos estan excluidos
- hay revision humana requerida

Si el Dry Run Result devuelve `DRY_RUN_REJECTED`, el brief no debe crearse como guia de trabajo. Debe corregirse el plan primero.

## 12. Reglas de idioma

Todo copy visual dirigido al comprador americano debe estar en ingles.

Ejemplos permitidos si son verdaderos:

- `Free Shipping`
- `Ships from USA`
- `In Stock in USA`
- `Easy to Use`
- `Designed for Daily Use`
- `Product in Use`

El brief debe evitar mezclar idiomas en texto visible para compradores de Estados Unidos.

## 13. Reglas para imagen principal

Reglas:

- producto protagonista
- fondo blanco/neutro si aplica
- sin texto excesivo
- sin badges falsos
- sin logos no autorizados
- sin accesorios no incluidos
- sin alterar tamano de forma enganosa
- revisar politicas vigentes de eBay antes de uso real

La imagen principal debe ser clara y honesta. Si un texto o badge puede comprometer cumplimiento o confianza, debe omitirse o moverse a revision.

## 14. Reglas para lifestyle image

Reglas:

- uso realista
- producto protagonista
- persona/modelo no distractora
- sin sexualizacion innecesaria
- sin sugerir endoso real
- sin marcas/logos ajenos
- sin datos personales visibles
- autorizacion/model release si aplica
- revision humana obligatoria

La lifestyle image debe explicar uso y contexto sin inventar beneficios, resultados, escala o autoridad.

## 15. Campos prohibidos

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
- imagenes base64
- payload OpenAI
- eBay draft id real
- listing id real

Si aparece un campo prohibido, el brief debe bloquearse o redactarse antes de cualquier uso humano.

## 16. Ejemplo JSON seguro: needs data

Ejemplo simulado para `LISTING-GEN-001`:

```json
{
  "briefVersion": "IMAGE_GENERATION_MANUAL_IMAGE_BRIEF_SCHEMA_V1",
  "caseId": "LISTING-GEN-001",
  "candidateName": "Simulated manual image brief candidate",
  "createdAt": "2026-01-01T00:00:00.000Z",
  "sourcePromptPlanVersion": "IMAGE_GENERATION_PROMPT_PLAN_SCHEMA_V1",
  "sourceDryRunResultVersion": "IMAGE_GENERATION_DRY_RUN_RESULT_SCHEMA_V1",
  "imageRole": "lifestyle_product_in_use",
  "targetBuyer": "us_ebay_buyer",
  "language": "en",
  "briefStatus": "MANUAL_IMAGE_BRIEF_NEEDS_DATA",
  "creationMode": "manual_external_tool",
  "productFacts": {
    "productName": "Simulated product",
    "category": "Simulated category",
    "color": "neutral",
    "material": "unknown",
    "allowedUseCases": [
      "Everyday use in a clean home or office setting"
    ],
    "knownLimitations": [
      "Verified dimensions are still missing",
      "Verified material is still missing"
    ],
    "factsVerified": false
  },
  "visualGoal": {
    "primaryGoal": "Prepare a safe lifestyle image concept for human review only.",
    "backgroundStyle": "lifestyle",
    "composition": "Keep the product as the clear hero in a realistic everyday setting.",
    "lighting": "Clean, bright, natural-looking light.",
    "mobileFirst": true,
    "productMustRemainHero": true,
    "lifestyleContext": "Clean home or office context with no brands or private data.",
    "avoidVisualClutter": true
  },
  "allowedClaims": [
    "Product in Use",
    "Easy to Use"
  ],
  "prohibitedClaims": [
    "Free Shipping",
    "Ships from USA",
    "In Stock in USA",
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
  "trustSignals": {
    "freeShipping": {
      "allowed": false,
      "verified": false,
      "instruction": "needs_verification"
    },
    "shipsFromUsa": {
      "allowed": false,
      "verified": false,
      "instruction": "needs_verification"
    },
    "inStockInUsa": {
      "allowed": false,
      "verified": false,
      "instruction": "needs_verification"
    },
    "usaFlag": {
      "allowed": false,
      "verified": false,
      "instruction": "do_not_use"
    }
  },
  "manualInstructions": [
    "Do not create a final commercial image yet.",
    "Use this brief only to understand what data is missing.",
    "Keep any draft concept internal and subject to human review."
  ],
  "safetyNotes": [
    "Do not include unverified shipping, stock, or Free Shipping signals.",
    "Do not invent dimensions or material.",
    "Do not include logos, private data, or sensitive data."
  ],
  "qaChecklist": [
    "Product matches verified facts.",
    "No unverified dimensions or material are shown.",
    "No unverified trust signal is shown.",
    "Human review is required before any use."
  ],
  "requiredHumanActions": [
    "Verify product dimensions.",
    "Verify product material.",
    "Verify shipping, stock location, and shipping cost.",
    "Review model/image authorization before lifestyle creation."
  ],
  "approvalRequirements": {
    "requiresImageQa": true,
    "requiresHumanReview": true,
    "requiresPolicyReviewBeforeEbayUse": true,
    "approvedForInternalUseOnly": false,
    "approvedForListingReview": false,
    "doNotPublish": true,
    "doNotCreateRealDraft": true
  },
  "safetyFlags": {
    "advisoryOnly": true,
    "manualWorkflowOnly": true,
    "imageGenerated": false,
    "openAiApiUsed": false,
    "externalCallsMade": false,
    "ebayApiUsed": false,
    "realDraftCreated": false,
    "publishedToEbay": false,
    "listingMutated": false,
    "reportPersisted": false,
    "humanReviewRequired": true
  }
}
```

Este ejemplo no incluye imagen real, prompt final de produccion, payload OpenAI, credenciales, URLs privadas, draft real ni listing real.

## 17. Ejemplo ready for human creation

Ejemplo textual:

- facts verificados
- trust signals desactivados o verificados
- sin claims riesgosos
- decision: `MANUAL_IMAGE_BRIEF_READY_FOR_HUMAN_CREATION`
- una persona puede crear una imagen manual para revision
- aun requiere QA y aprobacion humana

Interpretacion:

El brief puede guiar una creacion manual, pero no aprueba publicacion, draft real, subida de imagen ni mutacion de listing.

## 18. Relacion con Admin

La ruta `/admin/ebay-image-generator` ya muestra PromptPlan y Dry Run calculado.

En el futuro puede mostrar Manual Image Brief.

En este loop no se modifica UI.

El Admin debe seguir comunicando no side effects, revision humana requerida y acciones deshabilitadas.

## 19. Relacion con eBay

Reglas:

- Brief no crea listing.
- Brief no crea draft.
- Brief no publica.
- Brief no sube imagenes.
- Brief no modifica listings.
- Uso real requiere revision de politicas vigentes de eBay.

Un brief listo para creacion humana no equivale a un asset listo para eBay.

## 20. Que NO hacer

No hacer:

- no implementar brief real en este loop
- no crear fixture en este loop
- no generar imagenes
- no llamar OpenAI API
- no usar API keys
- no crear draft real
- no publicar
- no modificar listings
- no subir imagenes
- no persistir assets
- no usar datos sensibles

Este schema no autoriza acciones reales. Solo define el formato seguro de un brief futuro.

## 21. Proximos loops recomendados

- `LOOP 092 - Manual Image Brief Fixture V1`
- `LOOP 093 - Admin Manual Image Brief Display V1`
- `LOOP 094 - Manual Image QA Checklist Result V1`

## Fast-track documentation-only

Este loop puede avanzar por fast-track documentation-only solo si:

- el cambio sigue siendo documentation-only
- solo se agrega este documento
- `git diff --check` pasa
- `git diff --cached --check` pasa
- `npx tsc --noEmit` pasa
- `node --test tools/ebay-winner-pipeline-tests.mjs` pasa
- el grep de seguridad encuentra solo menciones educativas, campos esperados o reglas de bloqueo
- Vercel y Vercel Preview Comments quedan en success
