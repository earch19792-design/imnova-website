# eBay Listing Draft Schema V1

## 1. Propósito

Este schema define la estructura de una propuesta interna de listing. No define un draft real de eBay y no debe conectarse a eBay.

Reglas de seguridad:

- advisory-only
- local-first
- human-review-required
- no eBay API real
- no OAuth/tokens
- no drafts reales
- no publicación
- no cambios reales de listings

## 2. Principio Principal

Una propuesta de listing es un documento interno revisable. No debe ser tratada como autorización para publicar.

Valores obligatorios:

```text
listingProposal.advisoryOnly = true
listingProposal.humanReviewRequired = true
```

## 3. Estructura Raíz

Objeto raíz:

```json
{
  "schemaVersion": "EBAY_LISTING_DRAFT_SCHEMA_V1",
  "source": {},
  "listingProposal": {},
  "review": {},
  "safety": {}
}
```

## 4. Source

Campos:

- `productCandidateId`
- `sourceCaseId`
- `sourceType`
- `selectionDecision`
- `selectionState`
- `selectedAt`
- `notes`

`source` puede venir de shortlist, runner manual, pipeline interno o candidato simulado. No debe incluir datos sensibles, credenciales, URLs privadas ni información confidencial de proveedor.

## 5. Listing Proposal

Campos principales:

- `title`
- `subtitle`
- `category`
- `condition`
- `price`
- `quantity`
- `itemSpecifics`
- `description`
- `shippingPlan`
- `returnPlan`
- `imagePlan`
- `complianceNotes`
- `humanReviewRequired`
- `advisoryOnly`

## 6. Title Schema

Campos:

- `value`
- `keywordsUsed`
- `excludedKeywords`
- `titleRiskFlags`
- `notes`

Reglas:

- no keyword stuffing
- no marcas no autorizadas
- no claims exagerados
- máximo futuro debe respetar límites de eBay, pero no validar con API en este loop

## 7. Category Schema

Campos:

- `categoryName`
- `categoryId`
- `categoryConfidence`
- `categoryNotes`
- `requiresHumanConfirmation`

`categoryId` puede quedar `null` hasta confirmación humana.

## 8. Price Schema

Campos:

- `listingPrice`
- `currency`
- `soldCompsMedianPrice`
- `supplierCost`
- `supplierShippingCost`
- `buyerShippingCharge`
- `estimatedFees`
- `estimatedProfit`
- `estimatedRoiPercent`
- `estimatedNetMarginPercent`
- `priceReviewRequired`
- `priceNotes`

La economía debe volver a Product Selection si cambia costo, shipping, fees, sold comps o precio viable.

## 9. Item Specifics Schema

Objeto:

- `required`
- `recommended`
- `missing`
- `notes`

Ejemplos:

- `Brand`
- `Type`
- `Color`
- `Material`
- `Size`
- `Model`
- `MPN`
- `Features`

Regla: no inventar item specifics. Si falta información, agregar a `missing`.

## 10. Description Schema

Campos:

- `headline`
- `benefitBullets`
- `technicalDetails`
- `packageIncludes`
- `recommendedUse`
- `safetyNotes`
- `shippingAndReturnsSummary`
- `fullDescription`
- `copyRiskFlags`

Reglas:

- no claims médicos fuertes
- no promesas absolutas
- no copiar texto del proveedor sin revisión
- no inventar certificaciones

## 11. Image Plan Schema

Array con:

- `slot`
- `purpose`
- `imageStatus`
- `authorizationStatus`
- `notes`

Ejemplos de `purpose`:

- `main`
- `dimensions`
- `usage`
- `package_contents`
- `detail_closeup`

Regla: si `authorizationStatus` es `unknown`, el listing no puede pasar a listo final.

## 12. Shipping Plan Schema

Campos:

- `weight`
- `dimensions`
- `shippingMethod`
- `estimatedShippingCost`
- `handlingTime`
- `shippingRiskFlags`
- `shippingNotes`

## 13. Return Plan Schema

Campos:

- `returnsAccepted`
- `returnWindowDays`
- `buyerPaysReturnShipping`
- `returnRiskLevel`
- `returnNotes`

## 14. Compliance Schema

Campos:

- `brandRisk`
- `veroRisk`
- `medicalClaimsRisk`
- `restrictedProductRisk`
- `imageAuthorizationStatus`
- `complianceStatus`
- `complianceNotes`
- `blockedReasons`

Reglas:

- `brandRisk high` o `veroRisk high` bloquea propuesta final
- `medicalClaimsRisk high` bloquea propuesta final
- `imageAuthorizationStatus unknown` deja propuesta incompleta
- `complianceStatus unresolved` requiere revisión humana

## 15. Review Schema

Campos:

- `listingState`
- `reviewStatus`
- `requiredHumanActions`
- `missingData`
- `riskFlags`
- `approvalNotes`
- `reviewedBy`
- `reviewedAt`

Estados recomendados:

- `LISTING_NOT_STARTED`
- `LISTING_DATA_INCOMPLETE`
- `LISTING_DRAFT_READY`
- `LISTING_REVIEW_REQUIRED`
- `LISTING_BLOCKED`
- `LISTING_APPROVED_FOR_MANUAL_DRAFT`

`LISTING_APPROVED_FOR_MANUAL_DRAFT` no publica ni crea draft real automáticamente.

## 16. Safety Schema

Campos:

- `advisoryOnly`
- `localOnly`
- `externalCallsMade`
- `ebayApiUsed`
- `realDraftCreated`
- `publishedToEbay`
- `listingMutated`
- `requiresHumanReview`

Valores esperados en V1:

- `advisoryOnly: true`
- `localOnly: true`
- `externalCallsMade: false`
- `ebayApiUsed: false`
- `realDraftCreated: false`
- `publishedToEbay: false`
- `listingMutated: false`
- `requiresHumanReview: true`

## 17. Ejemplo Conceptual Completo

```json
{
  "schemaVersion": "EBAY_LISTING_DRAFT_SCHEMA_V1",
  "source": {
    "productCandidateId": "SIM-LISTING-001",
    "sourceCaseId": "SHORTLIST-001",
    "sourceType": "manual_shortlist_fixture",
    "selectionDecision": "approve",
    "selectionState": "APPROVED_FOR_DRAFT",
    "selectedAt": null,
    "notes": "Simulated candidate for schema documentation."
  },
  "listingProposal": {
    "title": {
      "value": "Compact Desk Organizer with Drawer, Space Saving Office Storage, Black",
      "keywordsUsed": ["desk organizer", "drawer", "office storage"],
      "excludedKeywords": [],
      "titleRiskFlags": [],
      "notes": "Simulated title. Human review required."
    },
    "subtitle": null,
    "category": {
      "categoryName": "Home Office Organization",
      "categoryId": null,
      "categoryConfidence": "medium",
      "categoryNotes": "Category requires human confirmation.",
      "requiresHumanConfirmation": true
    },
    "condition": "New",
    "price": {
      "listingPrice": 32,
      "currency": "USD",
      "soldCompsMedianPrice": 31,
      "supplierCost": 12,
      "supplierShippingCost": 2,
      "buyerShippingCharge": 0,
      "estimatedFees": 4.54,
      "estimatedProfit": 13.46,
      "estimatedRoiPercent": 112.17,
      "estimatedNetMarginPercent": 42.06,
      "priceReviewRequired": false,
      "priceNotes": "Simulated economics based on V1 fixture values."
    },
    "quantity": 1,
    "itemSpecifics": {
      "required": {
        "Brand": "Unbranded",
        "Type": "Desk Organizer",
        "Color": "Black"
      },
      "recommended": {
        "Material": "Plastic",
        "Features": ["Drawer", "Space Saving"]
      },
      "missing": ["Model", "MPN"],
      "notes": "Missing fields require human confirmation, not invention."
    },
    "description": {
      "headline": "Compact desk organizer for everyday office storage.",
      "benefitBullets": [
        "Helps keep small desk items organized.",
        "Compact simulated design for limited workspaces.",
        "Drawer-style storage for small accessories."
      ],
      "technicalDetails": ["Simulated dimensions: 10 x 6 x 4 in", "Simulated weight: 1.2 lb"],
      "packageIncludes": ["1 simulated desk organizer"],
      "recommendedUse": "Home office, study desk, or workspace organization.",
      "safetyNotes": [],
      "shippingAndReturnsSummary": "Shipping and returns require human confirmation before any real listing step.",
      "fullDescription": "Simulated listing copy for internal review only.",
      "copyRiskFlags": []
    },
    "shippingPlan": {
      "weight": {
        "value": 1.2,
        "unit": "lb"
      },
      "dimensions": {
        "length": 10,
        "width": 6,
        "height": 4,
        "unit": "in"
      },
      "shippingMethod": "standard_simulated",
      "estimatedShippingCost": 2,
      "handlingTime": "2 business days simulated",
      "shippingRiskFlags": [],
      "shippingNotes": "Simulated shipping plan. Human confirmation required."
    },
    "returnPlan": {
      "returnsAccepted": true,
      "returnWindowDays": 30,
      "buyerPaysReturnShipping": false,
      "returnRiskLevel": "low",
      "returnNotes": "Simulated return policy for internal planning."
    },
    "imagePlan": [
      {
        "slot": 1,
        "purpose": "main",
        "imageStatus": "needed",
        "authorizationStatus": "authorized_simulated",
        "notes": "Use only authorized or original images in real workflows."
      }
    ],
    "complianceNotes": [],
    "humanReviewRequired": true,
    "advisoryOnly": true
  },
  "review": {
    "listingState": "LISTING_DRAFT_READY",
    "reviewStatus": "pending_human_review",
    "requiredHumanActions": ["Confirm category", "Confirm item specifics", "Confirm image rights"],
    "missingData": ["Model", "MPN"],
    "riskFlags": [],
    "approvalNotes": null,
    "reviewedBy": null,
    "reviewedAt": null
  },
  "safety": {
    "advisoryOnly": true,
    "localOnly": true,
    "externalCallsMade": false,
    "ebayApiUsed": false,
    "realDraftCreated": false,
    "publishedToEbay": false,
    "listingMutated": false,
    "requiresHumanReview": true
  }
}
```

## 18. Qué Queda Fuera De Alcance V1

Fuera de alcance:

- no eBay API real
- no OAuth
- no drafts reales
- no publicación
- no actualización de listings activos
- no sincronización automática
- no validación real contra categorías eBay
- no generación automática desde productos reales
- no decisiones sin humano

## 19. Relación Con Documentos Existentes

Referencias relacionadas:

- `docs/ebay-winner-pipeline/EBAY_LISTING_CREATION_STRATEGY_V1.md`
- `docs/ebay-winner-pipeline/PRODUCT_SELECTION_STRATEGY_V1.md`
- `docs/ebay-winner-pipeline/PRODUCT_SELECTION_MANUAL_INTAKE_CHECKLIST_V1.md`
- `docs/ebay-winner-pipeline/PRODUCT_SELECTION_MANUAL_SHORTLIST_TEMPLATE_V1.md`

## 20. Próximos Loops Recomendados

- `LOOP 050 — eBay Listing Copywriting Rules V1`
- `LOOP 051 — eBay Listing QA Checklist V1`
- `LOOP 052 — eBay Listing Proposal Generator Dry Run V1`
