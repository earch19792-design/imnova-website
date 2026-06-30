# eBay Listing Image QA Result Schema V1

## 1. Propósito

Este documento define el formato oficial del resultado que devolverá un futuro servicio de QA visual de imágenes.

El resultado debe resumir qué ocurrió con el plan de imágenes, qué falta, qué está en riesgo, qué está bloqueado y qué acción humana debe ocurrir antes de avanzar.

Este documento es:

- documentation-only
- advisory-only
- human-review-required
- sin implementación en este loop
- sin generación de imágenes
- sin eBay API real
- sin drafts reales
- sin publicación
- sin cambios reales de listings

No implementa servicio, no genera imágenes, no conecta eBay, no crea drafts reales y no autoriza publicación.

## 2. Principio principal

El resultado del QA visual nunca aprueba publicación. Solo recomienda una decisión interna para revisión humana.

Debe responder:

- qué pasó con el plan de imágenes
- qué falta
- qué está en riesgo
- qué está bloqueado
- qué acción humana hace falta
- qué estado interno del listing se recomienda

Un resultado aprobado para revisión humana no significa crear draft real, publicar, sincronizar eBay ni modificar listings.

## 3. Relación con el servicio de QA visual

Este schema complementa:

- `EBAY_LISTING_IMAGE_QA_SERVICE_DESIGN_V1.md`

El diseño del servicio explica cómo evaluar. Este schema explica cómo debe verse el resultado de esa evaluación.

El schema debe mantenerse alineado con el plan de imágenes, el checklist visual y cualquier futuro fixture de resultado.

## 4. Tipo principal: EbayListingImageQaResult

Tipo conceptual TypeScript:

```ts
type EbayListingImageQaResult = {
  resultVersion: "EBAY_LISTING_IMAGE_QA_RESULT_SCHEMA_V1";
  sourceSchemaVersion: "EBAY_LISTING_IMAGE_PLAN_SCHEMA_V1";
  caseId: string;
  candidateName: string;
  evaluatedAt: string;
  sourceImagePlanStatus:
    | "IMAGE_PLAN_READY_FOR_REVIEW"
    | "IMAGE_PLAN_NEEDS_DATA"
    | "IMAGE_PLAN_NEEDS_REPLACEMENT"
    | "IMAGE_PLAN_COMPLIANCE_REVIEW_REQUIRED"
    | "IMAGE_PLAN_BLOCKED";
  imageQaStatus:
    | "IMAGE_QA_PASSED_FOR_HUMAN_REVIEW"
    | "IMAGE_QA_NEEDS_DATA"
    | "IMAGE_QA_NEEDS_REPLACEMENT"
    | "IMAGE_QA_COMPLIANCE_REVIEW_REQUIRED"
    | "IMAGE_QA_BLOCKED";
  recommendedPipelineState:
    | "LISTING_DRAFT_READY"
    | "LISTING_DATA_INCOMPLETE"
    | "LISTING_REVIEW_REQUIRED"
    | "LISTING_BLOCKED";
  summary: string;
  decisionReasons: string[];
  missingImageRoles: string[];
  imagesNeedingReplacement: string[];
  complianceRisks: string[];
  conversionRisks: string[];
  blockedReasons: string[];
  requiredHumanActions: string[];
  evaluatedSlots: EbayListingImageSlotQaResult[];
  safetyFlags: EbayListingImageQaSafetyFlags;
};
```

El resultado debe ser seguro para lectura interna. No debe incluir payload completo del candidato, imágenes completas, URLs privadas, secretos ni datos reales sensibles.

## 5. Tipo: EbayListingImageSlotQaResult

Tipo conceptual TypeScript:

```ts
type EbayListingImageSlotQaResult = {
  slotId: string;
  imageRole: string;
  slotStatus:
    | "passed"
    | "needs_data"
    | "needs_replacement"
    | "needs_compliance_review"
    | "blocked";
  reason: string;
  requiredHumanAction?: string;
};
```

Cada slot evaluado debe explicar su estado visual. El resultado por slot debe ser breve, seguro y accionable para revisión humana.

## 6. Tipo: EbayListingImageQaSafetyFlags

Tipo conceptual TypeScript:

```ts
type EbayListingImageQaSafetyFlags = {
  advisoryOnly: true;
  localOnly: true;
  imageGenerationPerformed: false;
  externalCallsMade: false;
  ebayApiUsed: false;
  realDraftCreated: false;
  publishedToEbay: false;
  listingMutated: false;
  requiresHumanReview: true;
};
```

Estos flags deben acompañar cualquier resultado futuro. Si un flag contradice V1, el resultado no debe considerarse válido para avanzar.

## 7. Estados permitidos de imageQaStatus

Estados permitidos:

- `IMAGE_QA_PASSED_FOR_HUMAN_REVIEW`: el plan visual puede pasar a revisión humana.
- `IMAGE_QA_NEEDS_DATA`: faltan datos o imágenes necesarias.
- `IMAGE_QA_NEEDS_REPLACEMENT`: hay imágenes que deben reemplazarse por calidad o claridad.
- `IMAGE_QA_COMPLIANCE_REVIEW_REQUIRED`: hay riesgo visual que requiere revisión de compliance.
- `IMAGE_QA_BLOCKED`: el plan visual no debe avanzar.

Ninguno de estos estados crea draft real ni publica en eBay. Son estados internos para revisión humana.

## 8. Estados recomendados del listing pipeline

Mapeo recomendado:

- `IMAGE_QA_PASSED_FOR_HUMAN_REVIEW` -> `LISTING_DRAFT_READY` solo como estado interno, no eBay real.
- `IMAGE_QA_NEEDS_DATA` -> `LISTING_DATA_INCOMPLETE`
- `IMAGE_QA_NEEDS_REPLACEMENT` -> `LISTING_REVIEW_REQUIRED`
- `IMAGE_QA_COMPLIANCE_REVIEW_REQUIRED` -> `LISTING_REVIEW_REQUIRED`
- `IMAGE_QA_BLOCKED` -> `LISTING_BLOCKED`

`LISTING_DRAFT_READY` no significa crear draft real. Solo significa que el listing podría continuar a revisión interna si otras áreas también están listas.

## 9. Prioridad de decisión

Orden de prioridad si hay múltiples señales:

1. Safety flag inválido -> `IMAGE_QA_BLOCKED`
2. Imagen no autorizada -> `IMAGE_QA_BLOCKED`
3. Riesgo visual crítico de compliance -> `IMAGE_QA_BLOCKED`
4. Riesgo compliance revisable -> `IMAGE_QA_COMPLIANCE_REVIEW_REQUIRED`
5. Imagen requerida faltante -> `IMAGE_QA_NEEDS_DATA`
6. Imagen de baja calidad -> `IMAGE_QA_NEEDS_REPLACEMENT`
7. Sin problemas críticos -> `IMAGE_QA_PASSED_FOR_HUMAN_REVIEW`

La decisión más severa debe dominar. Un buen slot visual no compensa un bloqueador crítico en otro slot.

## 10. Campos de resumen

Campos:

- `summary`: explicación breve en lenguaje humano.
- `decisionReasons`: razones principales de la decisión.
- `missingImageRoles`: roles faltantes.
- `imagesNeedingReplacement`: slots que necesitan reemplazo.
- `complianceRisks`: riesgos visuales de compliance.
- `conversionRisks`: riesgos de conversión por falta de claridad.
- `blockedReasons`: razones de bloqueo.
- `requiredHumanActions`: acciones que debe ejecutar una persona.

Estos campos deben ser seguros, resumidos y útiles para revisión. No deben incluir datos sensibles ni payload completo.

## 11. Safety gate obligatorio

Antes de considerar válido un resultado, confirmar:

- `advisoryOnly` es `true`
- `localOnly` es `true`
- `imageGenerationPerformed` es `false`
- `externalCallsMade` es `false`
- `ebayApiUsed` es `false`
- `realDraftCreated` es `false`
- `publishedToEbay` es `false`
- `listingMutated` es `false`
- `requiresHumanReview` es `true`

Si cualquier flag contradice V1, el resultado debe considerarse inválido o bloqueado.

## 12. Validación de campos prohibidos

El resultado no debe contener:

- URLs reales
- tokens
- credenciales
- API keys
- Authorization headers
- cookies
- datos reales de proveedor
- datos de cliente
- imágenes base64 completas
- rutas locales sensibles
- payload completo del candidato

Si un resultado contiene un campo prohibido, debe rechazarse o redactarse antes de llegar a Admin, reportes compartibles o cualquier integración futura.

## 13. Ejemplo JSON seguro: LISTING-GEN-001

Ejemplo simulado basado en el fixture del LOOP 071:

```json
{
  "resultVersion": "EBAY_LISTING_IMAGE_QA_RESULT_SCHEMA_V1",
  "sourceSchemaVersion": "EBAY_LISTING_IMAGE_PLAN_SCHEMA_V1",
  "caseId": "LISTING-GEN-001",
  "candidateName": "Simulated listing image plan candidate",
  "evaluatedAt": "2026-01-01T00:00:00.000Z",
  "sourceImagePlanStatus": "IMAGE_PLAN_NEEDS_DATA",
  "imageQaStatus": "IMAGE_QA_NEEDS_DATA",
  "recommendedPipelineState": "LISTING_DATA_INCOMPLETE",
  "summary": "Image QA needs verified dimensions before final-ready review.",
  "decisionReasons": [
    "Required dimensions image is missing.",
    "The image plan cannot be final-ready until dimensions are verified."
  ],
  "missingImageRoles": ["dimensions"],
  "imagesNeedingReplacement": [],
  "complianceRisks": [],
  "conversionRisks": ["dimensions_missing"],
  "blockedReasons": [],
  "requiredHumanActions": [
    "Add or verify dimensions before advancing the visual plan."
  ],
  "evaluatedSlots": [
    {
      "slotId": "main-001",
      "imageRole": "main",
      "slotStatus": "passed",
      "reason": "Main image slot is available, authorized, and acceptable."
    },
    {
      "slotId": "dimensions-001",
      "imageRole": "dimensions",
      "slotStatus": "needs_data",
      "reason": "Dimensions image is required but missing.",
      "requiredHumanAction": "Add verified dimensions or a safe scale image."
    }
  ],
  "safetyFlags": {
    "advisoryOnly": true,
    "localOnly": true,
    "imageGenerationPerformed": false,
    "externalCallsMade": false,
    "ebayApiUsed": false,
    "realDraftCreated": false,
    "publishedToEbay": false,
    "listingMutated": false,
    "requiresHumanReview": true
  }
}
```

Este ejemplo es simulado, sin URLs reales, sin imágenes base64, sin proveedor real, sin credenciales y sin datos sensibles.

## 14. Ejemplo de resultado bloqueado

Ejemplo resumido:

```json
{
  "resultVersion": "EBAY_LISTING_IMAGE_QA_RESULT_SCHEMA_V1",
  "sourceSchemaVersion": "EBAY_LISTING_IMAGE_PLAN_SCHEMA_V1",
  "caseId": "SIM-BLOCKED-IMAGE-001",
  "candidateName": "Simulated blocked image candidate",
  "evaluatedAt": "2026-01-01T00:00:00.000Z",
  "sourceImagePlanStatus": "IMAGE_PLAN_BLOCKED",
  "imageQaStatus": "IMAGE_QA_BLOCKED",
  "recommendedPipelineState": "LISTING_BLOCKED",
  "summary": "Image QA blocked because a required image is not authorized.",
  "decisionReasons": ["Required image authorization is unauthorized."],
  "missingImageRoles": [],
  "imagesNeedingReplacement": [],
  "complianceRisks": ["unauthorized_image"],
  "conversionRisks": [],
  "blockedReasons": ["unauthorized_image"],
  "requiredHumanActions": ["Replace the image or confirm valid authorization before any future review."],
  "evaluatedSlots": [
    {
      "slotId": "main-001",
      "imageRole": "main",
      "slotStatus": "blocked",
      "reason": "Main image is not authorized.",
      "requiredHumanAction": "Do not use this image."
    }
  ],
  "safetyFlags": {
    "advisoryOnly": true,
    "localOnly": true,
    "imageGenerationPerformed": false,
    "externalCallsMade": false,
    "ebayApiUsed": false,
    "realDraftCreated": false,
    "publishedToEbay": false,
    "listingMutated": false,
    "requiresHumanReview": true
  }
}
```

Este ejemplo es simulado y no autoriza ninguna acción real.

## 15. Ejemplo de resultado aprobado para revisión humana

Ejemplo resumido:

```json
{
  "resultVersion": "EBAY_LISTING_IMAGE_QA_RESULT_SCHEMA_V1",
  "sourceSchemaVersion": "EBAY_LISTING_IMAGE_PLAN_SCHEMA_V1",
  "caseId": "SIM-PASSED-IMAGE-001",
  "candidateName": "Simulated passed image candidate",
  "evaluatedAt": "2026-01-01T00:00:00.000Z",
  "sourceImagePlanStatus": "IMAGE_PLAN_READY_FOR_REVIEW",
  "imageQaStatus": "IMAGE_QA_PASSED_FOR_HUMAN_REVIEW",
  "recommendedPipelineState": "LISTING_DRAFT_READY",
  "summary": "Image QA passed for human review.",
  "decisionReasons": ["Required image roles are available, authorized, and acceptable."],
  "missingImageRoles": [],
  "imagesNeedingReplacement": [],
  "complianceRisks": [],
  "conversionRisks": [],
  "blockedReasons": [],
  "requiredHumanActions": ["Review manually before any future listing step."],
  "evaluatedSlots": [],
  "safetyFlags": {
    "advisoryOnly": true,
    "localOnly": true,
    "imageGenerationPerformed": false,
    "externalCallsMade": false,
    "ebayApiUsed": false,
    "realDraftCreated": false,
    "publishedToEbay": false,
    "listingMutated": false,
    "requiresHumanReview": true
  }
}
```

`LISTING_DRAFT_READY` aquí es solo un estado interno. No crea draft real, no publica en eBay ni modifica listings.

## 16. Errores del resultado

Errores posibles:

- `missing_resultVersion`
- `invalid_sourceSchemaVersion`
- `missing_caseId`
- `missing_safetyFlags`
- `unsafe_safety_flag`
- `invalid_imageQaStatus`
- `invalid_recommendedPipelineState`
- `prohibited_field_detected`
- `result_contains_url`
- `result_contains_base64_image`
- `result_exposes_private_data`

Los errores no deben mostrar secretos ni payload completo. Deben usar códigos resumidos y acciones humanas seguras.

## 17. Relación con archivos existentes

Este schema complementa:

- `EBAY_LISTING_IMAGE_QA_SERVICE_DESIGN_V1.md`
- `EBAY_LISTING_IMAGE_PLAN_SCHEMA_V1.md`
- `EBAY_LISTING_IMAGE_QA_CHECKLIST_V1.md`
- `tools/fixtures/ebay-listing-image-plan-v1.json`
- `EBAY_LISTING_DRAFT_SCHEMA_V1.md`
- `EBAY_LISTING_ADMIN_READ_ONLY_DATA_CONTRACT_V1.md`

El resultado futuro debe poder alimentar reportes seguros, fixtures y una vista Admin read-only sin contener datos sensibles.

## 18. Qué NO hacer

No hacer:

- no implementar servicio en este loop
- no generar imágenes
- no llamar APIs externas
- no usar eBay API
- no crear draft real
- no publicar
- no modificar listings
- no aceptar URLs privadas
- no aceptar imágenes base64 completas
- no usar datos reales sensibles

Este schema no autoriza acciones reales. Solo define el formato del resultado interno del QA visual.

## 19. Próximos loops recomendados

- `LOOP 074 — eBay Listing Image QA Result Fixture V1`
- `LOOP 075 — eBay Listing Image QA Service Implementation V1`
- `LOOP 076 — eBay Listing Admin Image Review Placeholder V1`
