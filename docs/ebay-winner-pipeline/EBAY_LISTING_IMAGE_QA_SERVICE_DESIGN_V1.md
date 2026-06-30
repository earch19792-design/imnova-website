# eBay Listing Image QA Service Design V1

## 1. Propósito

Este documento diseña cómo un futuro servicio evaluará planes de imágenes de listings eBay.

El servicio futuro tomará un plan visual interno, revisará su completitud, autorización, calidad, riesgos y safety flags, y devolverá una recomendación visual para revisión humana.

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

No implementa servicio, no llama APIs, no genera imágenes, no conecta eBay y no autoriza publicación.

## 2. Principio principal

El servicio nunca aprueba publicación. Solo recomienda un resultado visual para revisión humana.

Debe ayudar a detectar:

- imágenes faltantes
- autorización desconocida o no autorizada
- baja calidad
- riesgos de compliance
- riesgos de conversión
- acciones humanas requeridas

Una respuesta positiva del servicio solo significa que la parte visual puede pasar a revisión humana. No significa crear draft real, publicar, sincronizar eBay ni modificar listings.

## 3. Input esperado

El input futuro debe ser un `EbayListingImagePlan` basado en:

- `EBAY_LISTING_IMAGE_PLAN_SCHEMA_V1`
- fixture seguro de referencia:
  - `tools/fixtures/ebay-listing-image-plan-v1.json`

El input debe contener únicamente datos seguros y resumidos necesarios para QA visual.

No debe aceptar:

- payload completo del candidato
- URLs privadas
- imágenes base64
- credenciales
- datos reales sensibles
- respuestas completas de proveedores

Si el input tiene campos prohibidos o safety flags inválidos, el servicio futuro debe rechazarlo o devolver un bloqueo seguro.

## 4. Output esperado: EbayListingImageQaResult

Tipo conceptual TypeScript:

```ts
type EbayListingImageQaResult = {
  resultVersion: "EBAY_LISTING_IMAGE_QA_RESULT_V1";
  caseId: string;
  evaluatedAt: string;
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

El output debe ser seguro para revisión interna. No debe incluir imágenes completas, URLs privadas, payload original, datos de proveedor, datos de cliente, secretos ni headers.

## 5. Tipo: EbayListingImageSlotQaResult

Tipo conceptual TypeScript:

```ts
type EbayListingImageSlotQaResult = {
  slotId: string;
  imageRole: string;
  status:
    | "passed"
    | "needs_data"
    | "needs_replacement"
    | "needs_compliance_review"
    | "blocked";
  reason: string;
  requiredHumanAction?: string;
};
```

Cada slot evaluado debe explicar por qué pasó, qué falta, qué debe reemplazarse, qué requiere revisión de compliance o por qué está bloqueado.

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

Estos flags deben acompañar cualquier resultado futuro. Si alguno contradice V1, el resultado debe bloquearse.

## 7. Reglas de decisión

### Passed

Si:

- main image existe
- imágenes requeridas principales están disponibles
- autorización confirmada
- calidad aceptable
- sin riesgos críticos

Resultado:

- `IMAGE_QA_PASSED_FOR_HUMAN_REVIEW`

### Needs data

Si:

- faltan dimensiones
- falta autorización
- falta imagen requerida no crítica
- faltan notas necesarias

Resultado:

- `IMAGE_QA_NEEDS_DATA`

### Needs replacement

Si:

- imagen pixelada
- imagen poco clara
- baja resolución
- imagen confusa

Resultado:

- `IMAGE_QA_NEEDS_REPLACEMENT`

### Compliance review required

Si:

- posible marca no autorizada
- posible claim visual riesgoso
- certificación no verificada
- comparación dudosa

Resultado:

- `IMAGE_QA_COMPLIANCE_REVIEW_REQUIRED`

### Blocked

Si:

- imagen no autorizada
- riesgo VeRO/IP visual alto
- claim médico visual fuerte
- imagen engañosa crítica
- safety flag inválido

Resultado:

- `IMAGE_QA_BLOCKED`

La severidad más alta debe dominar. Por ejemplo, una imagen principal disponible no compensa una imagen no autorizada o un safety flag inseguro.

## 8. Mapeo desde Image Plan

Mapeo recomendado:

- `IMAGE_PLAN_READY_FOR_REVIEW` -> evaluar para `IMAGE_QA_PASSED_FOR_HUMAN_REVIEW`
- `IMAGE_PLAN_NEEDS_DATA` -> `IMAGE_QA_NEEDS_DATA`
- `IMAGE_PLAN_NEEDS_REPLACEMENT` -> `IMAGE_QA_NEEDS_REPLACEMENT`
- `IMAGE_PLAN_COMPLIANCE_REVIEW_REQUIRED` -> `IMAGE_QA_COMPLIANCE_REVIEW_REQUIRED`
- `IMAGE_PLAN_BLOCKED` -> `IMAGE_QA_BLOCKED`

El servicio futuro puede elevar severidad si detecta un riesgo mayor que el estado original del plan.

## 9. Mapeo al listing pipeline

Mapeo recomendado:

- `IMAGE_QA_PASSED_FOR_HUMAN_REVIEW` -> `LISTING_DRAFT_READY` solo como propuesta interna, no eBay real
- `IMAGE_QA_NEEDS_DATA` -> `LISTING_DATA_INCOMPLETE`
- `IMAGE_QA_NEEDS_REPLACEMENT` -> `LISTING_REVIEW_REQUIRED`
- `IMAGE_QA_COMPLIANCE_REVIEW_REQUIRED` -> `LISTING_REVIEW_REQUIRED`
- `IMAGE_QA_BLOCKED` -> `LISTING_BLOCKED`

`LISTING_DRAFT_READY` no significa crear draft real ni publicar. Solo significa que el listing puede seguir en revisión interna.

## 10. Safety gate obligatorio

Antes de devolver resultado, confirmar:

- `advisoryOnly` es `true`
- `localOnly` es `true`
- `imageGenerationPerformed` es `false`
- `externalCallsMade` es `false`
- `ebayApiUsed` es `false`
- `realDraftCreated` es `false`
- `publishedToEbay` es `false`
- `listingMutated` es `false`
- `requiresHumanReview` es `true`

Si cualquier safety flag contradice V1, el resultado debe ser `IMAGE_QA_BLOCKED`.

El safety gate tiene prioridad sobre conversión, calidad técnica y estado del plan.

## 11. Validación de campos prohibidos

El servicio futuro debe rechazar input si detecta:

- URLs reales
- tokens
- credenciales
- API keys
- Authorization headers
- cookies
- datos de proveedor reales
- datos de cliente
- imágenes base64 completas
- rutas locales sensibles
- payload completo del candidato

El rechazo no debe mostrar secretos, payload completo ni datos sensibles en mensajes de error.

## 12. Ejemplo aplicado a LISTING-GEN-001

Usando el fixture de LOOP 071:

- main disponible
- angle disponible
- detail disponible
- package contents disponible
- dimensions faltante

Resultado esperado:

```json
{
  "resultVersion": "EBAY_LISTING_IMAGE_QA_RESULT_V1",
  "caseId": "LISTING-GEN-001",
  "evaluatedAt": "2026-01-01T00:00:00.000Z",
  "imageQaStatus": "IMAGE_QA_NEEDS_DATA",
  "recommendedPipelineState": "LISTING_DATA_INCOMPLETE",
  "summary": "Image plan needs verified dimensions before final-ready review.",
  "missingImageRoles": ["dimensions"],
  "imagesNeedingReplacement": [],
  "complianceRisks": [],
  "conversionRisks": ["dimensions_missing"],
  "blockedReasons": [],
  "requiredHumanActions": [
    "Add or verify a dimensions image before final-ready review."
  ],
  "evaluatedSlots": [
    {
      "slotId": "main-001",
      "imageRole": "main",
      "status": "passed",
      "reason": "Main image slot is available, authorized, and acceptable."
    },
    {
      "slotId": "dimensions-001",
      "imageRole": "dimensions",
      "status": "needs_data",
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

Este ejemplo es simulado y no contiene URLs reales, imágenes, proveedor real, credenciales, tokens, API keys, customer data ni dato sensible.

## 13. Errores futuros del servicio

Errores esperados:

- `missing_image_plan`
- `invalid_schemaVersion`
- `missing_safetyFlags`
- `unsafe_safety_flag`
- `prohibited_field_detected`
- `invalid_image_role`
- `invalid_status`
- `no_main_image`
- `unauthorized_image`

Los errores no deben mostrar secretos ni payload completo. Deben devolver un mensaje seguro, un código resumido y una acción humana recomendada.

## 14. Qué NO hacer

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

Este diseño no autoriza acciones reales. Solo define reglas para un futuro servicio de QA visual seguro.

## 15. Relación con archivos existentes

Este diseño complementa:

- `EBAY_LISTING_IMAGE_QUALITY_CONVERSION_STRATEGY_V1.md`
- `EBAY_LISTING_IMAGE_QA_CHECKLIST_V1.md`
- `EBAY_LISTING_IMAGE_PLAN_SCHEMA_V1.md`
- `tools/fixtures/ebay-listing-image-plan-v1.json`
- `EBAY_LISTING_DRAFT_SCHEMA_V1.md`
- `EBAY_LISTING_ADMIN_READ_ONLY_DATA_CONTRACT_V1.md`

Debe mantenerse alineado con el schema del plan de imágenes y con el fixture seguro de LOOP 071.

## 16. Próximos loops recomendados

- `LOOP 073 — eBay Listing Image QA Result Schema V1`
- `LOOP 074 — eBay Listing Image QA Service Implementation V1`
- `LOOP 075 — eBay Listing Admin Image Review Placeholder V1`
