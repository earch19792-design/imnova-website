# eBay Listing Admin Read-Only Data Contract V1

## 1. Propósito

Este contrato define qué datos seguros podrá consumir en el futuro la pantalla Admin `/admin/ebay-listings` para mostrar propuestas internas de listing eBay.

Este loop es:

* documentation-only
* read-only
* advisory-only
* human-review-required
* sin eBay API real
* sin OAuth/tokens
* sin drafts reales
* sin publicación
* sin cambios reales de listings
* sin Supabase changes en este loop

No se implementa conexión, API, servicio, migración, UI nueva ni persistencia en este loop.

## 2. Principio principal

El contrato solo permite visualización segura.

Reglas:

* El contrato no autoriza publicación.
* El contrato no crea draft real.
* El contrato no sincroniza eBay.
* El contrato no modifica listings activos.
* El contrato no aprueba automáticamente productos.
* Toda acción futura requiere revisión humana explícita.

El contrato existe para transportar summaries seguros desde un reporte local hacia una vista Admin read-only. No es un contrato de ejecución.

## 3. Consumidor futuro

Consumidor:

* Admin route futura: `/admin/ebay-listings`
* Uso: mostrar propuestas internas read-only
* Tipo: pantalla de revisión humana
* Estado actual: placeholder con datos simulados
* Estado futuro: consumo de summaries seguros

La pantalla debe seguir mostrando que no hay acción real de eBay, draft, publicación ni mutación de listing.

## 4. Fuente futura permitida

Fuentes permitidas futuras:

* `reviewReport` seguro generado por el dry-run local
* export safe JSON summary aprobado por `EBAY_LISTING_REVIEW_REPORT_EXPORT_DESIGN_V1`
* fixtures simulados para testing
* futuro backend read-only, solo después de diseño y aprobación

Reglas:

* No consumir payload completo del candidato.
* No consumir datos privados de proveedor.
* No consumir datos de eBay real.
* No consumir datos sensibles reales.
* No consumir headers, credenciales, tokens ni URLs privadas.

## 5. Tipo principal: EbayListingAdminReadOnlyItem

```ts
type EbayListingAdminReadOnlyItem = {
  id: string;
  caseId: string;
  candidateName: string;
  generatedAt: string;
  sourceType: "simulated" | "local_review_report" | "safe_json_summary";
  listingState:
    | "LISTING_DRAFT_READY"
    | "LISTING_DATA_INCOMPLETE"
    | "LISTING_REVIEW_REQUIRED"
    | "LISTING_BLOCKED";
  qaState:
    | "QA_PASSED_FOR_HUMAN_REVIEW"
    | "QA_INCOMPLETE"
    | "QA_REVIEW_REQUIRED"
    | "QA_BLOCKED";
  recommendedDecision:
    | "PROCEED_TO_HUMAN_REVIEW"
    | "COMPLETE_MISSING_DATA"
    | "REVIEW_ECONOMICS"
    | "REVIEW_COMPLIANCE"
    | "BLOCK_DO_NOT_ADVANCE"
    | "DISCARD_CANDIDATE";
  executiveSummary: string;
  missingData: string[];
  riskFlags: string[];
  blockedReasons: string[];
  requiredHumanActions: string[];
  badges: string[];
  safetyFlags: EbayListingSafetyFlags;
};
```

Este tipo representa una unidad segura de lectura para Admin. No contiene payload completo, supplier private data, URLs privadas, imágenes completas ni información sensible.

## 6. Tipo: EbayListingSafetyFlags

```ts
type EbayListingSafetyFlags = {
  advisoryOnly: true;
  localOnly: true;
  externalCallsMade: false;
  ebayApiUsed: false;
  realDraftCreated: false;
  publishedToEbay: false;
  listingMutated: false;
  requiresHumanReview: true;
};
```

Si cualquier flag contradice V1, el item debe mostrarse como bloqueado o no mostrarse. El safety gate tiene prioridad sobre `recommendedDecision`.

## 7. Tipo: EbayListingAdminReadOnlyCollection

```ts
type EbayListingAdminReadOnlyCollection = {
  contractVersion: "EBAY_LISTING_ADMIN_READ_ONLY_DATA_CONTRACT_V1";
  generatedAt: string;
  source: "simulated" | "local_export" | "future_read_only_backend";
  items: EbayListingAdminReadOnlyItem[];
  safetySummary: {
    totalItems: number;
    blockedItems: number;
    itemsRequiringHumanReview: number;
    unsafeItemsRejected: number;
  };
};
```

La colección agrupa items seguros y un resumen operativo. No debe incluir logs completos, payloads originales ni datos privados.

## 8. Campos permitidos en Admin

Campos permitidos:

* `contractVersion`
* `generatedAt`
* `source`
* `id`
* `caseId`
* `candidateName`
* `listingState`
* `qaState`
* `recommendedDecision`
* `executiveSummary`
* `missingData`
* `riskFlags`
* `blockedReasons`
* `requiredHumanActions`
* `badges`
* `safetyFlags`
* `safetySummary`

Todo campo debe ser seguro, resumido y útil para revisión humana. Si un dato requiere contexto sensible para entenderse, debe omitirse o redactarse antes de llegar a Admin.

## 9. Campos prohibidos

No permitir:

* payload completo del candidato
* supplier private data
* URLs privadas
* credenciales
* tokens
* API keys
* OAuth headers
* Authorization headers
* cookies
* datos bancarios
* datos personales reales
* customer data
* secretos de entorno
* headers HTTP
* respuestas completas de servicios externos
* imágenes base64 completas
* rutas locales sensibles

Si cualquier campo prohibido aparece en una fuente futura, el item debe rechazarse o redactarse antes de mostrarlo.

## 10. Validación obligatoria del contrato

Reglas:

* `contractVersion` debe coincidir con `EBAY_LISTING_ADMIN_READ_ONLY_DATA_CONTRACT_V1`.
* `items` debe ser array.
* cada item debe tener `requiresHumanReview: true`.
* cada item debe tener `ebayApiUsed: false`.
* cada item debe tener `realDraftCreated: false`.
* cada item debe tener `publishedToEbay: false`.
* cada item debe tener `listingMutated: false`.
* si falta `safetyFlags`, no mostrar item.
* si hay unsafe flag, mostrar alerta o rechazar item.
* si hay campos sensibles detectados, rechazar item.

La validación debe ocurrir antes de que Admin renderice datos futuros. Una validación fallida no debe mostrar payload completo ni secretos en errores.

## 11. Mapeo desde reviewReport

Mapeo recomendado:

* `reportVersion` -> validar contra `EBAY_LISTING_PROPOSAL_REVIEW_REPORT_V1`
* `caseId` -> `caseId`
* `candidateName` o nombre seguro -> `candidateName`
* `listingState` -> `listingState`
* `qaState` -> `qaState`
* `recommendedDecision` -> `recommendedDecision`
* `executiveSummary` -> `executiveSummary`
* `missingData` -> `missingData`
* `riskFlags` -> `riskFlags`
* `blockedReasons` -> `blockedReasons`
* `requiredHumanActions` -> `requiredHumanActions`
* `safetyFlags` -> `safetyFlags`

No mapear payload completo. No mapear supplier private data. No mapear datos de eBay real.

## 12. Mapeo visual sugerido

Badges sugeridos por decisión:

* `PROCEED_TO_HUMAN_REVIEW` -> `Proceed to human review`
* `COMPLETE_MISSING_DATA` -> `Needs data`
* `REVIEW_ECONOMICS` -> `Review economics`
* `REVIEW_COMPLIANCE` -> `Review compliance`
* `BLOCK_DO_NOT_ADVANCE` -> `Blocked`
* `DISCARD_CANDIDATE` -> `Discard candidate`

Badges de seguridad recomendados:

* `Read-only`
* `Dry-run`
* `No eBay API`
* `No real draft`
* `Not published`
* `Human review required`

Los badges no son acciones. Solo resumen estado y seguridad.

## 13. Estados vacíos/error

Empty:

* `No listing proposals connected yet.`
* `Run local dry-run and export a safe summary in a future approved loop.`

Error:

* `Unable to read listing proposal summary.`
* `Unsafe listing proposal data rejected.`
* `Safety flags missing or invalid.`

Los errores no deben mostrar secretos, headers, payload completo ni datos sensibles.

## 14. Ejemplo JSON simulado seguro

```json
{
  "contractVersion": "EBAY_LISTING_ADMIN_READ_ONLY_DATA_CONTRACT_V1",
  "generatedAt": "2026-06-29T00:00:00.000Z",
  "source": "simulated",
  "items": [
    {
      "id": "sim-listing-gen-001",
      "caseId": "LISTING-GEN-001",
      "candidateName": "Simulated ideal candidate",
      "generatedAt": "2026-06-29T00:00:00.000Z",
      "sourceType": "simulated",
      "listingState": "LISTING_DRAFT_READY",
      "qaState": "QA_PASSED_FOR_HUMAN_REVIEW",
      "recommendedDecision": "PROCEED_TO_HUMAN_REVIEW",
      "executiveSummary": "Ready for human review.",
      "missingData": [],
      "riskFlags": [],
      "blockedReasons": [],
      "requiredHumanActions": ["Review manually before any future preparation."],
      "badges": ["Read-only", "Dry-run", "Proceed to human review"],
      "safetyFlags": {
        "advisoryOnly": true,
        "localOnly": true,
        "externalCallsMade": false,
        "ebayApiUsed": false,
        "realDraftCreated": false,
        "publishedToEbay": false,
        "listingMutated": false,
        "requiresHumanReview": true
      }
    },
    {
      "id": "sim-listing-gen-004",
      "caseId": "LISTING-GEN-004",
      "candidateName": "Simulated blocked compliance candidate",
      "generatedAt": "2026-06-29T00:00:00.000Z",
      "sourceType": "simulated",
      "listingState": "LISTING_BLOCKED",
      "qaState": "QA_BLOCKED",
      "recommendedDecision": "BLOCK_DO_NOT_ADVANCE",
      "executiveSummary": "Blocked by high brand or VeRO/IP risk.",
      "missingData": [],
      "riskFlags": ["brand_or_vero_high"],
      "blockedReasons": ["brand_or_vero_high"],
      "requiredHumanActions": ["Do not advance unless reviewed through an audited process."],
      "badges": ["Read-only", "Dry-run", "Blocked"],
      "safetyFlags": {
        "advisoryOnly": true,
        "localOnly": true,
        "externalCallsMade": false,
        "ebayApiUsed": false,
        "realDraftCreated": false,
        "publishedToEbay": false,
        "listingMutated": false,
        "requiresHumanReview": true
      }
    },
    {
      "id": "sim-listing-gen-006",
      "caseId": "LISTING-GEN-006",
      "candidateName": "Simulated economics review candidate",
      "generatedAt": "2026-06-29T00:00:00.000Z",
      "sourceType": "simulated",
      "listingState": "LISTING_REVIEW_REQUIRED",
      "qaState": "QA_REVIEW_REQUIRED",
      "recommendedDecision": "REVIEW_ECONOMICS",
      "executiveSummary": "Review pricing, margin, ROI, fees, and sold comps.",
      "missingData": [],
      "riskFlags": ["weak_margin", "price_risk"],
      "blockedReasons": [],
      "requiredHumanActions": ["Review economics before any future preparation."],
      "badges": ["Read-only", "Dry-run", "Review economics"],
      "safetyFlags": {
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
  ],
  "safetySummary": {
    "totalItems": 3,
    "blockedItems": 1,
    "itemsRequiringHumanReview": 3,
    "unsafeItemsRejected": 0
  }
}
```

Este ejemplo es simulado. No contiene producto real, proveedor real, URL, secreto, credencial ni dato sensible.

## 15. Relación con la UI placeholder actual

La pantalla actual `/admin/ebay-listings` usa datos simulados estáticos.

Este contrato define cómo reemplazar esos datos simulados en un loop futuro, sin cambiar la naturaleza read-only de la vista.

Reglas para la UI futura:

* seguir siendo read-only
* no agregar botón de publicar
* no agregar botón de crear draft real
* no agregar sincronización eBay
* no agregar mutación de listings
* no mostrar payload completo
* no mostrar datos sensibles reales

## 16. Relación con export design

Documento relacionado:

* `EBAY_LISTING_REVIEW_REPORT_EXPORT_DESIGN_V1.md`

El export safe JSON summary futuro debe cumplir este contrato antes de llegar a Admin. El Admin no debe consumir Markdown como fuente primaria estructurada; Markdown es para humanos.

## 17. Relación con manual review

Documento relacionado:

* `EBAY_LISTING_MANUAL_REVIEW_WORKFLOW_V1.md`

Toda decisión visible en Admin debe seguir revisión humana. El Admin no aprueba automáticamente productos y no convierte una decisión recomendada en acción real.

## 18. Qué NO hacer

No hacer:

* no implementar contrato en código en este loop
* no modificar UI en este loop
* no crear API
* no crear servicio
* no tocar Supabase
* no crear migrations
* no hacer db push
* no conectar eBay
* no OAuth/tokens
* no draft real
* no publicar
* no modificar listings
* no mostrar payload completo
* no usar datos reales sensibles

## 19. Próximos loops recomendados

* `LOOP 066 — eBay Listing Admin Read-Only Fixture Contract V1`
* `LOOP 067 — eBay Listing Admin Fixture-Driven UI V1`
* `LOOP 068 — eBay Listing Preproduction Dry Run Plan V1`
