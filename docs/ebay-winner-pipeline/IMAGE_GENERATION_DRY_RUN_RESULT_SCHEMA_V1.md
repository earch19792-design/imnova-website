# Image Generation Dry Run Result Schema V1

## 1. Proposito

Este documento define el formato del resultado de un dry run para la futura generacion o edicion de imagenes con OpenAI dentro de IMNOVA.

El objetivo es documentar como IMNOVA debe explicar una decision antes de cualquier generacion real: si un `PromptPlan` esta listo para revision humana, si necesita datos, si esta bloqueado o si debe rechazarse por seguridad.

Este documento es:

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
- sin reportes reales persistidos
- human-review-required

No ejecuta generacion, no llama OpenAI, no conecta eBay, no crea drafts reales, no publica y no persiste reportes reales.

## 2. Principio principal

Un dry run no genera imagenes. Solo evalua si un `PromptPlan` estaria listo, bloqueado o incompleto.

Regla:

`Dry run explains the decision. It does not execute generation.`

El dry run debe producir un resultado auditable para que una persona entienda que datos faltan, que reglas bloquearon el flujo y que accion humana se necesita antes de cualquier generacion futura.

## 3. Relacion con arquitectura

Arquitectura futura:

```text
ImagePlan -> PromptPlan -> OpenAI Image Generation -> Image QA Result -> Human Review -> Listing Pipeline
```

Relacion:

- el dry run ocurre antes de `OpenAI Image Generation`
- puede usar `PromptPlan`
- puede aplicar `Image Generation Safety Rules`
- produce un resultado auditable
- no llama OpenAI
- no genera imagen
- no avanza a eBay

El dry run funciona como una compuerta de explicacion previa. Si el resultado dice needs data o blocked, no debe existir generacion final.

## 4. Tipo principal: ImnovaImageGenerationDryRunResult

Tipo conceptual TypeScript:

```ts
type ImnovaImageGenerationDryRunResult = {
  resultVersion: "IMAGE_GENERATION_DRY_RUN_RESULT_SCHEMA_V1";
  caseId: string;
  candidateName: string;
  evaluatedAt: string;
  sourcePromptPlanVersion: "IMAGE_GENERATION_PROMPT_PLAN_SCHEMA_V1";
  imageRole: ImnovaDryRunImageRole;
  targetBuyer: "us_ebay_buyer";
  language: "en";
  dryRunStatus:
    | "DRY_RUN_READY_FOR_HUMAN_REVIEW"
    | "DRY_RUN_NEEDS_DATA"
    | "DRY_RUN_BLOCKED"
    | "DRY_RUN_REJECTED";
  recommendedNextState:
    | "KEEP_AS_PROMPT_PLAN_NEEDS_DATA"
    | "READY_FOR_PROMPT_HUMAN_REVIEW"
    | "BLOCK_IMAGE_GENERATION"
    | "REQUEST_MORE_PRODUCT_DATA"
    | "REQUEST_TRUST_SIGNAL_VERIFICATION"
    | "REQUEST_MODEL_OR_IMAGE_AUTHORIZATION";
  decisionSummary: string;
  blockingReasons: string[];
  missingData: string[];
  verifiedFactsUsed: string[];
  unverifiedFacts: string[];
  trustSignalEvaluation: ImnovaDryRunTrustSignalEvaluation;
  promptSafetyEvaluation: ImnovaDryRunPromptSafetyEvaluation;
  humanReviewRequirements: string[];
  outputRequirements: ImnovaDryRunOutputRequirements;
  safetyFlags: ImnovaDryRunSafetyFlags;
};
```

Este resultado no es un payload de OpenAI, no es un reporte persistido real y no representa una decision de publicacion en eBay.

## 5. Tipo: ImnovaDryRunImageRole

Tipo conceptual TypeScript:

```ts
type ImnovaDryRunImageRole =
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
```

El rol debe coincidir con el rol del `PromptPlan` evaluado.

## 6. Tipo: ImnovaDryRunTrustSignalEvaluation

Tipo conceptual TypeScript:

```ts
type ImnovaDryRunTrustSignalEvaluation = {
  freeShipping: {
    requested: boolean;
    allowed: boolean;
    verified: boolean;
    decision: "allowed" | "needs_data" | "blocked" | "not_requested";
    reason: string;
  };
  shipsFromUsa: {
    requested: boolean;
    allowed: boolean;
    verified: boolean;
    decision: "allowed" | "needs_data" | "blocked" | "not_requested";
    reason: string;
  };
  inStockInUsa: {
    requested: boolean;
    allowed: boolean;
    verified: boolean;
    decision: "allowed" | "needs_data" | "blocked" | "not_requested";
    reason: string;
  };
  usaFlag: {
    requested: boolean;
    allowed: boolean;
    verified: boolean;
    decision: "allowed" | "needs_data" | "blocked" | "not_requested";
    reason: string;
  };
};
```

Si una senal no esta verificada, el dry run debe marcar `needs_data` o `blocked`.

Un dry run no debe convertir una senal atractiva en una senal permitida. Solo facts verificados pueden permitir trust signals en un flujo futuro.

## 7. Tipo: ImnovaDryRunPromptSafetyEvaluation

Tipo conceptual TypeScript:

```ts
type ImnovaDryRunPromptSafetyEvaluation = {
  promptPlanBasedOnVerifiedFacts: boolean;
  containsFinalProductionPrompt: boolean;
  containsOpenAiPayload: boolean;
  containsApiKeyOrSecret: boolean;
  containsBase64Image: boolean;
  containsRealImageUrl: boolean;
  containsUnauthorizedBrandOrLogo: boolean;
  containsMedicalClaim: boolean;
  containsGuaranteedResultClaim: boolean;
  containsUnverifiedTrustSignal: boolean;
  containsUnverifiedDimensions: boolean;
  containsUnverifiedMaterial: boolean;
  containsPersonOrModel: boolean;
  requiresModelRelease: boolean;
  safeForInternalReviewOnly: boolean;
};
```

Esta evaluacion describe riesgos del plan. No analiza una imagen generada porque el dry run no genera imagenes.

## 8. Tipo: ImnovaDryRunOutputRequirements

Tipo conceptual TypeScript:

```ts
type ImnovaDryRunOutputRequirements = {
  intendedUse: "internal_review_only";
  mayGenerateImage: false;
  mayCallOpenAi: false;
  mayCreateRealDraft: false;
  mayPublish: false;
  mayMutateListing: false;
  requiresImageQaBeforeUse: true;
  requiresHumanReview: true;
};
```

El resultado del dry run siempre debe dejar claro que no autoriza generacion, draft real, publicacion ni mutacion de listings.

## 9. Tipo: ImnovaDryRunSafetyFlags

Tipo conceptual TypeScript:

```ts
type ImnovaDryRunSafetyFlags = {
  advisoryOnly: true;
  dryRunOnly: true;
  documentationOnly: true;
  openAiApiUsed: false;
  imageGenerated: false;
  externalCallsMade: false;
  ebayApiUsed: false;
  realDraftCreated: false;
  publishedToEbay: false;
  listingMutated: false;
  reportPersisted: false;
  humanReviewRequired: true;
};
```

Estos flags deben impedir confundir un dry run con una ejecucion real.

## 10. Decisiones del dry run

Reglas de decision:

- `DRY_RUN_READY_FOR_HUMAN_REVIEW`: facts suficientes, sin trust signals no verificadas, sin claims riesgosos.
- `DRY_RUN_NEEDS_DATA`: faltan datos criticos, por ejemplo dimensiones, material, ubicacion de stock o shipping.
- `DRY_RUN_BLOCKED`: hay claims prohibidos, marcas/logos no autorizados, trust signals falsos o persona sin autorizacion.
- `DRY_RUN_REJECTED`: el `PromptPlan` contradice reglas de seguridad.

La decision debe estar explicada por `decisionSummary`, `missingData`, `blockingReasons` y `humanReviewRequirements`.

## 11. Reglas para missingData

Ejemplos de `missingData`:

- `verified dimensions required`
- `verified material required`
- `shipping location verification required`
- `free shipping verification required`
- `ships from USA verification required`
- `model release required`
- `package contents verification required`

`missingData` debe indicar datos verificables que una persona o sistema autorizado debe completar antes de permitir cualquier generacion futura.

## 12. Reglas para blockingReasons

Ejemplos de `blockingReasons`:

- `unverified Free Shipping cannot be used`
- `unverified Ships from USA cannot be used`
- `unauthorized brand/logo requested`
- `medical claim requested`
- `final production prompt included too early`
- `OpenAI payload included in dry run`
- `API key or secret included`
- `real image URL included`

Un blocking reason debe ser accionable. Debe explicar que regla se rompio y por que el plan no puede avanzar.

## 13. Ejemplo JSON seguro: needs data

Ejemplo simulado para `LISTING-GEN-001`, basado en el fixture `tools/fixtures/ebay-listing-image-generation-prompt-plan-v1.json`:

```json
{
  "resultVersion": "IMAGE_GENERATION_DRY_RUN_RESULT_SCHEMA_V1",
  "caseId": "LISTING-GEN-001",
  "candidateName": "Simulated listing image generation prompt plan candidate",
  "evaluatedAt": "2026-01-01T00:00:00.000Z",
  "sourcePromptPlanVersion": "IMAGE_GENERATION_PROMPT_PLAN_SCHEMA_V1",
  "imageRole": "lifestyle_product_in_use",
  "targetBuyer": "us_ebay_buyer",
  "language": "en",
  "dryRunStatus": "DRY_RUN_NEEDS_DATA",
  "recommendedNextState": "REQUEST_MORE_PRODUCT_DATA",
  "decisionSummary": "The simulated PromptPlan needs verified dimensions, material, shipping, stock location, and trust signal facts before any future image generation can be considered.",
  "blockingReasons": [],
  "missingData": [
    "verified dimensions required",
    "verified material required",
    "shipping location verification required",
    "free shipping verification required",
    "ships from USA verification required"
  ],
  "verifiedFactsUsed": [
    "caseId LISTING-GEN-001",
    "imageRole lifestyle_product_in_use",
    "targetBuyer us_ebay_buyer",
    "language en"
  ],
  "unverifiedFacts": [
    "product dimensions",
    "product material",
    "shipping location",
    "stock location",
    "free shipping status"
  ],
  "trustSignalEvaluation": {
    "freeShipping": {
      "requested": false,
      "allowed": false,
      "verified": false,
      "decision": "needs_data",
      "reason": "Free Shipping is not verified and must not be used."
    },
    "shipsFromUsa": {
      "requested": false,
      "allowed": false,
      "verified": false,
      "decision": "needs_data",
      "reason": "Ships from USA is not verified and must not be used."
    },
    "inStockInUsa": {
      "requested": false,
      "allowed": false,
      "verified": false,
      "decision": "needs_data",
      "reason": "In Stock in USA is not verified and must not be used."
    },
    "usaFlag": {
      "requested": false,
      "allowed": false,
      "verified": false,
      "decision": "needs_data",
      "reason": "USA flag is not allowed until stock or shipping claims are verified."
    }
  },
  "promptSafetyEvaluation": {
    "promptPlanBasedOnVerifiedFacts": false,
    "containsFinalProductionPrompt": false,
    "containsOpenAiPayload": false,
    "containsApiKeyOrSecret": false,
    "containsBase64Image": false,
    "containsRealImageUrl": false,
    "containsUnauthorizedBrandOrLogo": false,
    "containsMedicalClaim": false,
    "containsGuaranteedResultClaim": false,
    "containsUnverifiedTrustSignal": true,
    "containsUnverifiedDimensions": true,
    "containsUnverifiedMaterial": true,
    "containsPersonOrModel": false,
    "requiresModelRelease": false,
    "safeForInternalReviewOnly": true
  },
  "humanReviewRequirements": [
    "Verify product dimensions.",
    "Verify product material.",
    "Verify shipping, stock location, and shipping cost before allowing trust signals.",
    "Review the PromptPlan before any future generated image can enter QA."
  ],
  "outputRequirements": {
    "intendedUse": "internal_review_only",
    "mayGenerateImage": false,
    "mayCallOpenAi": false,
    "mayCreateRealDraft": false,
    "mayPublish": false,
    "mayMutateListing": false,
    "requiresImageQaBeforeUse": true,
    "requiresHumanReview": true
  },
  "safetyFlags": {
    "advisoryOnly": true,
    "dryRunOnly": true,
    "documentationOnly": true,
    "openAiApiUsed": false,
    "imageGenerated": false,
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

Este ejemplo no incluye prompt final de produccion, payload OpenAI, API key, token, secret, base64, URL real, imagen real, eBay draft id real ni listing id real.

## 14. Ejemplo bloqueado

Ejemplo textual:

```text
PromptPlan:
- imageRole: us_buyer_trust_visual
- requests visible copy: "Free Shipping" and "Ships from USA"
- shipping facts: not verified
- stock location: not verified

Dry run decision:
- dryRunStatus: DRY_RUN_BLOCKED
- recommendedNextState: BLOCK_IMAGE_GENERATION

Reason:
Trust signals are not verified. The plan could mislead the buyer about shipping cost, shipping origin, or stock location.
```

Un plan bloqueado no debe avanzar a generacion, QA de imagen ni revision como imagen candidata. Primero debe corregirse o descartarse.

## 15. Relacion con PromptPlan fixture

Este schema se relaciona con:

- `tools/fixtures/ebay-listing-image-generation-prompt-plan-v1.json`

Ese fixture deberia producir un dry run tipo `DRY_RUN_NEEDS_DATA`, porque usa `PROMPT_PLAN_NEEDS_DATA`, tiene facts no verificados y mantiene trust signals desactivados o no verificados.

El fixture no debe producir generacion real.

## 16. Relacion con Admin Placeholder

Este schema se relaciona con:

- `/admin/ebay-image-generator`

En el futuro, la pantalla Admin podria mostrar un dry run result junto al `PromptPlan`.

En este loop no se modifica UI.

## 17. Relacion con eBay

Reglas:

- dry run no crea listing
- dry run no crea draft
- dry run no publica
- dry run no sube imagenes a eBay
- dry run no modifica listings
- cualquier uso real futuro debe revisar politicas vigentes de eBay

Un resultado listo para revision humana no equivale a una autorizacion para publicar ni crear draft real.

## 18. Que NO hacer

No hacer:

- no implementar dry run real en este loop
- no llamar OpenAI API
- no generar imagenes
- no crear prompt final de produccion
- no guardar payload OpenAI
- no usar API keys
- no crear draft real
- no publicar
- no mutar listing
- no persistir reportes reales
- no usar URLs reales
- no usar datos reales sensibles

Este documento no autoriza ejecucion real. Solo define el formato futuro de un resultado auditable.

## 19. Proximos loops recomendados

- `LOOP 082 - Image Generation Dry Run Result Fixture V1`
- `LOOP 083 - Image Generator Admin Dry Run Result Display V1`
- `LOOP 084 - Image Generation Dry Run Runner Design V1`

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
