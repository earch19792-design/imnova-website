# eBay Listing Image Plan Schema V1

## 1. Propósito

Este schema define cómo estructurar el plan de imágenes de una propuesta interna de listing eBay.

El objetivo es ordenar qué imágenes necesita un producto, cuáles existen, cuáles faltan, cuáles requieren reemplazo, cuáles están bloqueadas y cuáles tienen autorización confirmada antes de avanzar en el pipeline.

Este documento es:

- documentation-only
- advisory-only
- human-review-required
- sin generación de imágenes
- sin eBay API real
- sin drafts reales
- sin publicación
- sin cambios reales de listings

No genera imágenes, no sube imágenes, no conecta eBay, no crea drafts reales y no autoriza publicación.

## 2. Principio principal

Todo listing debe tener un plan visual claro antes de avanzar.

El plan debe indicar:

- qué imágenes existen
- qué imágenes faltan
- qué imágenes requieren reemplazo
- qué imágenes están autorizadas
- qué imágenes requieren revisión
- qué riesgos visuales existen
- qué acciones humanas son necesarias

Una propuesta con buen título, buen precio o buen margen no debe avanzar visualmente si su galería no está clara, autorizada y revisada.

## 3. Tipo principal: EbayListingImagePlan

Tipo conceptual TypeScript:

```ts
type EbayListingImagePlan = {
  schemaVersion: "EBAY_LISTING_IMAGE_PLAN_SCHEMA_V1";
  caseId: string;
  candidateName: string;
  generatedAt: string;
  imagePlanStatus:
    | "IMAGE_PLAN_READY_FOR_REVIEW"
    | "IMAGE_PLAN_NEEDS_DATA"
    | "IMAGE_PLAN_NEEDS_REPLACEMENT"
    | "IMAGE_PLAN_COMPLIANCE_REVIEW_REQUIRED"
    | "IMAGE_PLAN_BLOCKED";
  imageAuthorizationStatus: "authorized" | "unknown" | "unauthorized";
  requiredImages: EbayListingImageSlot[];
  optionalImages: EbayListingImageSlot[];
  missingImages: string[];
  blockedImages: string[];
  visualRisks: string[];
  requiredHumanActions: string[];
  safetyFlags: EbayListingImageSafetyFlags;
};
```

Este tipo no representa un payload real de eBay. Es una estructura interna para revisión humana segura.

## 4. Tipo: EbayListingImageSlot

Tipo conceptual TypeScript:

```ts
type EbayListingImageSlot = {
  slotId: string;
  imageRole:
    | "main"
    | "angle"
    | "lifestyle"
    | "dimensions"
    | "detail"
    | "package_contents"
    | "comparison"
    | "infographic"
    | "variant"
    | "other";
  label: string;
  purpose: string;
  required: boolean;
  status:
    | "available"
    | "missing"
    | "needs_replacement"
    | "needs_authorization"
    | "blocked";
  authorizationStatus: "authorized" | "unknown" | "unauthorized";
  qualityStatus:
    | "acceptable"
    | "low_resolution"
    | "unclear"
    | "misleading"
    | "compliance_risk"
    | "not_reviewed";
  notes: string[];
};
```

Cada slot describe una imagen esperada o disponible. El slot debe explicar el propósito visual, el estado de autorización y la calidad revisada.

## 5. Tipo: EbayListingImageSafetyFlags

Tipo conceptual TypeScript:

```ts
type EbayListingImageSafetyFlags = {
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

Los safety flags tienen prioridad sobre cualquier estado visual. Si un flag contradice la seguridad esperada, el plan debe bloquearse o revisarse antes de avanzar.

## 6. Roles de imágenes

Roles permitidos:

- `main`: imagen principal clara del producto.
- `angle`: ángulo adicional para mostrar forma, laterales o parte trasera.
- `lifestyle`: uso o contexto realista.
- `dimensions`: medidas o escala.
- `detail`: material, textura, cierre o detalle importante.
- `package_contents`: qué incluye el paquete.
- `comparison`: comparación visual segura y no engañosa.
- `infographic`: explicación visual simple.
- `variant`: color, tamaño o variante.
- `other`: imagen adicional justificada.

Cada rol debe aportar información útil. No debe agregarse una imagen solo para llenar la galería si no mejora claridad, confianza o revisión humana.

## 7. Imágenes mínimas recomendadas

Plan mínimo recomendado:

- main image
- second angle
- detail image
- dimensions/scale image si aplica
- package contents si aplica
- lifestyle/use case si aplica

El mínimo puede variar por producto, categoría y riesgo. Sin embargo, la main image clara y autorizada es obligatoria para considerar el plan visual listo para revisión.

Si la main image está ausente, no autorizada o no permite entender el producto, el plan no debe marcarse como final-ready.

## 8. Estados del plan

Estados recomendados:

- `IMAGE_PLAN_READY_FOR_REVIEW`: plan visual suficientemente completo para revisión humana.
- `IMAGE_PLAN_NEEDS_DATA`: faltan imágenes, dimensiones o autorización.
- `IMAGE_PLAN_NEEDS_REPLACEMENT`: hay imágenes de baja calidad, poco claras o inconsistentes.
- `IMAGE_PLAN_COMPLIANCE_REVIEW_REQUIRED`: hay riesgo visual de compliance.
- `IMAGE_PLAN_BLOCKED`: hay imágenes no autorizadas o riesgo crítico.

Ningún estado crea draft real, publica, llama eBay ni modifica listings. Estos estados solo ordenan revisión interna.

## 9. Reglas de autorización

Estados de autorización:

- `authorized`: puede avanzar a revisión humana.
- `unknown`: no puede ser final-ready.
- `unauthorized`: bloqueado.

Reglas:

- Ninguna imagen sin autorización confirmada debe avanzar como final-ready.
- `authorized` no significa que la imagen sea buena para conversión; todavía requiere revisión de calidad y compliance.
- `unknown` requiere acción humana para confirmar derechos o reemplazar la imagen.
- `unauthorized` debe bloquear el slot y puede bloquear el plan completo si afecta una imagen requerida.

## 10. Reglas de calidad

Revisar:

- nitidez
- resolución
- iluminación
- enfoque
- legibilidad móvil
- ausencia de pixelación
- ausencia de distorsión
- claridad del producto
- consistencia con descripción
- no engañar sobre tamaño o contenido

Si una imagen es autorizada pero débil en calidad, marcar `needs_replacement` o `not_reviewed` hasta que exista una revisión humana suficiente.

Los requisitos técnicos exactos de marketplace deben verificarse antes de producción porque pueden cambiar.

## 11. Reglas de compliance visual

Marcar riesgo si aparece:

- logos/marcas no autorizadas
- claims médicos visuales
- certificaciones no verificadas
- before/after engañoso
- screenshots con datos sensibles
- imágenes de proveedor sin permiso
- dimensiones inventadas
- producto visualmente distinto al descrito

Los riesgos visuales de compliance deben priorizarse sobre conversión. Si una imagen aumenta clics pero introduce riesgo legal, de marca, VeRO/IP o de comprador, no debe avanzar sin revisión.

## 12. Mapeo desde Image QA Checklist

Mapeo recomendado:

- `IMAGE_QA_PASSED_FOR_HUMAN_REVIEW` -> `IMAGE_PLAN_READY_FOR_REVIEW`
- `IMAGE_QA_NEEDS_DATA` -> `IMAGE_PLAN_NEEDS_DATA`
- `IMAGE_QA_NEEDS_REPLACEMENT` -> `IMAGE_PLAN_NEEDS_REPLACEMENT`
- `IMAGE_QA_COMPLIANCE_REVIEW_REQUIRED` -> `IMAGE_PLAN_COMPLIANCE_REVIEW_REQUIRED`
- `IMAGE_QA_BLOCKED` -> `IMAGE_PLAN_BLOCKED`

Este mapeo traduce el resultado del checklist visual a un estado estructurado del plan de imágenes.

## 13. Mapeo al listing pipeline

Mapeo recomendado:

- plan listo -> puede seguir a revisión humana
- faltan imágenes/datos -> `LISTING_DATA_INCOMPLETE`
- riesgo visual medio -> `LISTING_REVIEW_REQUIRED`
- riesgo visual alto -> `LISTING_BLOCKED`
- autorización `unknown` -> no final-ready
- autorización `unauthorized` -> blocked

El plan de imágenes no aprueba listings por sí mismo. Solo informa si la parte visual está lista, incompleta, en revisión o bloqueada.

## 14. Ejemplo JSON simulado seguro

Ejemplo simulado para `LISTING-GEN-001`:

```json
{
  "schemaVersion": "EBAY_LISTING_IMAGE_PLAN_SCHEMA_V1",
  "caseId": "LISTING-GEN-001",
  "candidateName": "Simulated compact desk organizer",
  "generatedAt": "2026-06-29T00:00:00.000Z",
  "imagePlanStatus": "IMAGE_PLAN_READY_FOR_REVIEW",
  "imageAuthorizationStatus": "authorized",
  "requiredImages": [
    {
      "slotId": "main-001",
      "imageRole": "main",
      "label": "Main product image",
      "purpose": "Show the product clearly with a neutral background.",
      "required": true,
      "status": "available",
      "authorizationStatus": "authorized",
      "qualityStatus": "acceptable",
      "notes": ["Simulated authorized image reference. No real image URL included."]
    },
    {
      "slotId": "angle-001",
      "imageRole": "angle",
      "label": "Second angle",
      "purpose": "Show product depth and side profile.",
      "required": true,
      "status": "available",
      "authorizationStatus": "authorized",
      "qualityStatus": "acceptable",
      "notes": ["Simulated second angle for internal planning."]
    },
    {
      "slotId": "detail-001",
      "imageRole": "detail",
      "label": "Material and detail image",
      "purpose": "Show texture, drawer detail, and finish.",
      "required": true,
      "status": "available",
      "authorizationStatus": "authorized",
      "qualityStatus": "acceptable",
      "notes": ["Detail image is simulated and safe for documentation."]
    },
    {
      "slotId": "dimensions-001",
      "imageRole": "dimensions",
      "label": "Dimensions and scale",
      "purpose": "Explain size without inventing measurements.",
      "required": true,
      "status": "available",
      "authorizationStatus": "authorized",
      "qualityStatus": "acceptable",
      "notes": ["Uses simulated verified dimensions for example only."]
    }
  ],
  "optionalImages": [
    {
      "slotId": "lifestyle-001",
      "imageRole": "lifestyle",
      "label": "Desk use case",
      "purpose": "Show realistic workspace use.",
      "required": false,
      "status": "missing",
      "authorizationStatus": "unknown",
      "qualityStatus": "not_reviewed",
      "notes": ["Optional image can be added after authorization is confirmed."]
    },
    {
      "slotId": "package-001",
      "imageRole": "package_contents",
      "label": "Package contents",
      "purpose": "Clarify what the buyer receives.",
      "required": false,
      "status": "available",
      "authorizationStatus": "authorized",
      "qualityStatus": "acceptable",
      "notes": ["Simulated package contents image."]
    }
  ],
  "missingImages": ["lifestyle/use case image"],
  "blockedImages": [],
  "visualRisks": [],
  "requiredHumanActions": [
    "Review image clarity before any future manual listing step.",
    "Confirm authorization evidence remains available.",
    "Confirm dimensions are accurate before production."
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

Este ejemplo es simulado. No contiene URLs reales, imágenes base64, proveedor real, credenciales, token, API key, customer data ni dato sensible.

## 15. Campos prohibidos

No incluir:

- URLs privadas
- credenciales
- tokens
- API keys
- Authorization headers
- cookies
- datos reales de proveedor
- datos de cliente
- imágenes base64 completas
- rutas locales sensibles
- payload completo del candidato

Si una fuente futura contiene campos prohibidos, el plan debe rechazarse, redactarse o marcarse para revisión antes de llegar a una vista Admin o a cualquier reporte compartible.

## 16. Checklist de validación del schema

Confirmar:

- `schemaVersion` correcto
- `caseId` presente
- `imagePlanStatus` válido
- `requiredImages` es array
- cada image slot tiene `imageRole`
- cada image slot tiene `authorizationStatus`
- cada image slot tiene `qualityStatus`
- `safetyFlags` completos
- no hay campos prohibidos
- no hay URLs reales

Si falta un campo crítico, marcar el plan como incompleto. Si aparece un campo prohibido, no mostrar payload completo en errores.

## 17. Qué NO hacer

No hacer:

- no generar imágenes
- no subir imágenes a eBay
- no usar eBay API
- no crear draft real
- no publicar
- no modificar listings
- no usar imágenes no autorizadas
- no inventar medidas
- no inventar certificaciones
- no usar datos reales sensibles

Este schema no autoriza acciones reales. Solo estructura revisión humana segura.

## 18. Relación con documentos existentes

Este schema complementa:

- `EBAY_LISTING_IMAGE_QUALITY_CONVERSION_STRATEGY_V1.md`
- `EBAY_LISTING_IMAGE_QA_CHECKLIST_V1.md`
- `EBAY_LISTING_DRAFT_SCHEMA_V1.md`
- `EBAY_LISTING_ADMIN_READ_ONLY_DATA_CONTRACT_V1.md`
- `EBAY_LISTING_MANUAL_REVIEW_WORKFLOW_V1.md`

Debe usarse como capa estructurada entre la estrategia visual, el checklist de QA de imágenes y futuros fixtures o vistas Admin.

## 19. Próximos loops recomendados

- `LOOP 071 — eBay Listing Image Plan Fixture V1`
- `LOOP 072 — eBay Listing Image QA Service Design V1`
- `LOOP 073 — eBay Listing Admin Image Review Placeholder V1`
