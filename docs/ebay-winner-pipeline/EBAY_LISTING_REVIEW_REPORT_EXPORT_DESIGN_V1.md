# eBay Listing Review Report Export Design V1

## 1. Propósito

Este diseño define cómo exportar de forma segura el `reviewReport` generado por el flujo local de propuestas internas de listing eBay.

Este loop es:

* documentation-only
* local-only
* advisory-only
* human-review-required
* sin eBay API real
* sin OAuth/tokens
* sin drafts reales
* sin publicación
* sin cambios reales de listings
* sin Supabase changes en este loop

No se implementa exportador en este loop. No se modifica el runner, no se escriben archivos reales y no se crean carpetas locales.

## 2. Principio principal

La exportación nunca autoriza acciones reales.

Reglas:

* Exportar un reporte no crea draft real.
* Exportar un reporte no publica.
* Exportar un reporte no sincroniza eBay.
* Exportar un reporte no modifica listings activos.
* Exportar un reporte no aprueba automáticamente un producto.
* Toda acción futura requiere revisión humana explícita.

El export solo debe servir para lectura, trazabilidad interna y revisión humana.

## 3. Alcance V1

Este loop diseña únicamente:

* formatos futuros permitidos
* campos seguros
* estructura de salida
* redacción de datos sensibles
* naming convention
* relación con Admin read-only
* validaciones futuras

No implementar nada en este loop.

## 4. Inputs esperados

El export futuro debe partir de:

* `candidate`
* `listingProposalOutput`
* `qaResult`
* `reviewReport`

El exportador futuro debe preferir `reviewReport` como fuente principal y no copiar payloads completos innecesarios. `candidate`, `listingProposalOutput` y `qaResult` solo deben usarse para completar summaries seguros o validar consistencia.

## 5. Formatos de exportación permitidos

### Markdown human-readable

Formato para revisión humana.

Debe incluir:

* executive summary
* listing state
* QA state
* recommended decision
* missing data
* risk flags
* blocked reasons
* required human actions
* safety flags

### Safe JSON summary

Formato para una posible vista Admin read-only futura.

Debe incluir solo campos seguros y resumidos. No debe incluir payload completo ni datos privados.

### Console safe summary

Debe mantenerse como salida breve del runner, sin payload completo.

No exportar HTML ejecutable, scripts, tokens, headers ni credenciales.

## 6. Campos seguros permitidos

Campos permitidos:

* `reportVersion`
* `caseId`
* `candidateName`
* `generatedAt`
* `listingState`
* `qaState`
* `recommendedDecision`
* `executiveSummary`
* `missingData`
* `riskFlags`
* `blockedReasons`
* `requiredHumanActions`
* `economicsSummary`
* `complianceSummary`
* `copywritingSummary`
* `imageSummary`
* `shippingReturnsSummary`
* `safetyFlags`

Cada campo debe representar una lectura resumida y segura del reporte. Si un campo requiere datos sensibles para explicarse, debe redactarse o convertirse en summary.

## 7. Campos prohibidos o restringidos

No exportar por defecto:

* payload completo del candidato
* supplier private data
* supplier URLs privadas
* credenciales
* tokens
* API keys
* OAuth headers
* Authorization headers
* cookies
* customer data
* datos bancarios
* datos personales reales
* secretos de entorno
* headers HTTP
* respuestas completas de servicios externos
* imágenes base64 completas
* rutas locales sensibles

Si un futuro exportador detecta alguno de estos campos, debe redactarlo o bloquear la exportación.

## 8. Redacción y minimización

Reglas:

* mostrar conteos antes que listas largas
* truncar textos largos
* reemplazar valores sensibles con `[REDACTED]`
* no mostrar URLs privadas
* no mostrar headers
* no mostrar payload completo
* usar summaries para economics, compliance, copy, images y shipping
* mostrar razones de bloqueo sin exponer datos privados

La exportación debe minimizar datos. El reviewer necesita entender el estado y la razón de la decisión, no inspeccionar todo el objeto original.

## 9. Naming convention futura

Naming propuesto para archivos locales futuros:

```text
ebay-listing-review-report-{caseId}-{YYYYMMDD-HHMMSS}.md
ebay-listing-review-report-{caseId}-{YYYYMMDD-HHMMSS}.summary.json
```

Reglas:

* Deben guardarse en una carpeta local no versionada.
* No deben commitearse.
* La implementación futura debe confirmar que la carpeta de salida está ignorada o controlada manualmente.
* No crear archivos reales en este loop.

## 10. Carpeta local futura

Carpeta futura sugerida:

```text
.local/ebay-listing-review-reports/
```

Reglas:

* La carpeta no debe usarse hasta un loop de implementación aprobado.
* La implementación futura debe validar `.gitignore` antes de escribir.
* No crear `.local` ni modificar `.gitignore` en este loop.

## 11. CLI futura sugerida

Flags futuros sugeridos, sin implementarlos:

```text
--export-report
--export-format markdown
--export-format json
--export-format both
--export-dir <local-path>
--redact
--no-full-payload
```

Reglas:

* `--export-report` debe ser opt-in.
* Por defecto no escribir archivos.
* `--redact` debe estar activo por defecto.
* `--no-full-payload` debe ser obligatorio.
* El comando debe seguir siendo local-only.

## 12. Estructura Markdown sugerida

Secciones sugeridas:

* Title
* Safety Banner
* Executive Summary
* Decision
* Listing/QA States
* Missing Data
* Risks
* Blocked Reasons
* Economics Review
* Compliance Review
* Copywriting Review
* Images Review
* Shipping/Returns Review
* Required Human Actions
* Safety Flags
* Final Reminder: No eBay action was performed

El Markdown debe estar optimizado para lectura humana y revisión manual, no para automatizar publicación.

## 13. Estructura JSON sugerida

Ejemplo simulado seguro:

```json
{
  "reportVersion": "EBAY_LISTING_PROPOSAL_REVIEW_REPORT_V1",
  "caseId": "LISTING-GEN-001",
  "candidateName": "Simulated candidate",
  "listingState": "LISTING_DRAFT_READY",
  "qaState": "QA_PASSED_FOR_HUMAN_REVIEW",
  "recommendedDecision": "PROCEED_TO_HUMAN_REVIEW",
  "missingData": [],
  "riskFlags": [],
  "blockedReasons": [],
  "requiredHumanActions": ["Review manually before any future preparation"],
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
```

Este ejemplo es simulado. No representa payload real, proveedor real, URL ni dato sensible.

## 14. Safety gate obligatorio

Antes de exportar en una implementación futura, confirmar:

* `advisoryOnly: true`
* `localOnly: true`
* `externalCallsMade: false`
* `ebayApiUsed: false`
* `realDraftCreated: false`
* `publishedToEbay: false`
* `listingMutated: false`
* `requiresHumanReview: true`

Si cualquier flag contradice V1, no exportar y mostrar alerta. El safety gate tiene prioridad sobre cualquier decisión recomendada.

## 15. Relación con Admin read-only

El export seguro podría alimentar una vista Admin read-only futura.

Reglas:

* Admin no debe recibir payload completo.
* Admin debe mostrar summaries, decisiones, riesgos, bloqueos y safety flags.
* Admin no debe tener botones de publicación, draft real ni sincronización eBay.
* Admin debe mantener el flujo como read-only y human-review-required.

## 16. Relación con revisión humana

El export Markdown ayuda al reviewer humano.

El JSON summary ayuda a sistemas internos read-only.

Ningún export reemplaza la decisión humana. Toda decisión debe seguir el Manual Review Workflow V1.

## 17. Manejo de errores futuro

Errores futuros a diseñar:

* missing reviewReport
* invalid reportVersion
* unsafe safety flag
* export directory not allowed
* attempted full payload export
* sensitive field detected
* write failure

Los errores no deben mostrar secretos, headers ni payload completo. Deben explicar la causa operativa de forma breve y segura.

## 18. Ejemplos simulados

### LISTING-GEN-001

* Export Markdown permitido en futuro.
* Export JSON summary permitido en futuro.
* Decisión: `PROCEED_TO_HUMAN_REVIEW`.
* Reminder: no publicar.

### LISTING-GEN-004

* Export permitido solo como reporte bloqueado.
* Decisión: `BLOCK_DO_NOT_ADVANCE`.
* Reminder: no avanzar por riesgo.

### LISTING-GEN-006

* Export permitido como reporte de revisión económica.
* Decisión: `REVIEW_ECONOMICS`.
* Reminder: revisar precio, margen, ROI y sold comps.

## 19. Qué NO hacer

No hacer:

* no implementar exportador en este loop
* no escribir archivos reales
* no modificar runner
* no modificar tests
* no crear API
* no crear UI
* no tocar Supabase
* no crear migrations
* no hacer db push
* no conectar eBay
* no OAuth/tokens
* no draft real
* no publicar
* no modificar listings
* no exportar payload completo
* no commitear reportes generados
* no incluir secretos

## 20. Relación con archivos existentes

Este diseño se relaciona con:

* `EBAY_LISTING_PROPOSAL_REVIEW_REPORT_V1.md`
* `EBAY_LISTING_MANUAL_REVIEW_WORKFLOW_V1.md`
* `EBAY_LISTING_ADMIN_READ_ONLY_VISIBILITY_DESIGN_V1.md`
* `EBAY_LISTING_PROPOSAL_DRY_RUN_RUNBOOK_V1.md`
* `tools/ebay-listing-proposal-dry-run.mjs`
* `lib/ebay-winner-pipeline/listing-proposal-review-report-formatter.mjs`

## 21. Próximos loops recomendados

* `LOOP 064 — eBay Listing Admin Read-Only Data Contract V1`
* `LOOP 065 — eBay Listing Preproduction Dry Run Plan V1`
* `LOOP 066 — eBay Listing Review Report Exporter Implementation V1`
