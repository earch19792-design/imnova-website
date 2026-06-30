# Image Generation Dry Run Runner Design V1

## 1. Proposito

Este documento disena el futuro runner interno de dry run para generacion de imagenes dentro de IMNOVA.

El runner futuro tomaria un `PromptPlan`, aplicaria reglas de seguridad, evaluaria datos faltantes y produciria un `Dry Run Result` auditable antes de cualquier generacion real.

Este documento es:

- documentation-only
- sin implementacion
- sin runner real en este loop
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

No crea runner, no llama OpenAI, no genera imagenes, no conecta eBay, no crea drafts reales, no publica y no persiste reportes reales.

## 2. Principio principal

El dry run runner debe explicar que pasaria, pero no ejecutar nada.

Regla central:

```text
Evaluate only. Do not generate. Do not publish. Do not mutate.
```

El resultado debe ayudar a una persona a entender si el `PromptPlan` esta listo, si necesita datos, si debe bloquearse o si contradice reglas de seguridad.

## 3. Relacion con arquitectura

Arquitectura futura:

```text
ImagePlan -> PromptPlan -> Dry Run Runner -> Dry Run Result -> Human Review -> Future OpenAI Image Generation -> Image QA Result -> Listing Pipeline
```

Relacion:

- el runner se ubica antes de cualquier llamada futura a OpenAI
- usa `PromptPlan` como entrada
- aplica `Image Generation Safety Rules`
- produce `Dry Run Result`
- no llama OpenAI
- no genera imagen
- no crea draft
- no publica
- no modifica listings

El runner es una compuerta de evaluacion. Si el dry run devuelve needs data, blocked o rejected, no debe existir generacion futura hasta que una persona o proceso autorizado corrija el problema.

## 4. Inputs del runner

Entradas conceptuales:

```ts
type ImnovaImageGenerationDryRunRunnerInput = {
  runnerVersion: "IMAGE_GENERATION_DRY_RUN_RUNNER_DESIGN_V1";
  promptPlan: ImnovaImageGenerationPromptPlan;
  safetyRulesVersion: "IMAGE_GENERATION_SAFETY_RULES_V1";
  runMode: "local_fixture" | "internal_dry_run";
  requestedBy: "system" | "admin_preview";
  allowExternalCalls: false;
  allowOpenAiCall: false;
  allowImageGeneration: false;
  allowEbayMutation: false;
};
```

En este loop no se crea este tipo en codigo. Es diseno conceptual.

El input debe ser suficiente para evaluar seguridad, pero no debe contener secretos, URLs reales, payloads de OpenAI, base64, tokens, credenciales, draft ids reales ni listing ids reales.

## 5. Output del runner

El output debe ser:

```text
ImnovaImageGenerationDryRunResult
```

Basado en:

- `IMAGE_GENERATION_DRY_RUN_RESULT_SCHEMA_V1`
- `tools/fixtures/ebay-listing-image-generation-dry-run-result-v1.json`

Debe incluir:

- `dryRunStatus`
- `recommendedNextState`
- `decisionSummary`
- `blockingReasons`
- `missingData`
- `trustSignalEvaluation`
- `promptSafetyEvaluation`
- `outputRequirements`
- `safetyFlags`
- `humanReviewRequirements`

El output no debe ser un payload de generacion ni un reporte real persistido. Debe ser una evaluacion interna para revision humana.

## 6. Flujo conceptual del runner

Pasos conceptuales:

1. Load PromptPlan.
2. Validate schema shape.
3. Validate safety flags.
4. Validate no prohibited fields.
5. Evaluate product facts.
6. Evaluate trust signals.
7. Evaluate claims.
8. Evaluate lifestyle/model requirements.
9. Evaluate output permissions.
10. Decide dryRunStatus.
11. Decide recommendedNextState.
12. Build DryRun Result.
13. Require human review.
14. Return result without side effects.

Cada paso debe ser determinista y explicable. Si un paso detecta un riesgo, el resultado debe incluir una razon clara en `missingData`, `blockingReasons`, `promptSafetyEvaluation` o `humanReviewRequirements`.

## 7. Reglas de no side effects

El runner nunca debe:

- call OpenAI
- generate images
- call eBay
- create real draft
- publish listing
- mutate listing
- persist real report
- mutate Supabase
- send WhatsApp
- send email
- read secrets
- use API keys
- call external URLs

El runner debe poder ejecutarse como evaluacion local o interna sin red, sin credenciales y sin escribir resultados reales persistidos.

## 8. Validacion de PromptPlan

El runner debe validar:

- `promptVersion` correcto
- `caseId` presente
- `imageRole` permitido
- `targetBuyer` correcto
- `language` en ingles
- `promptStatus` permitido
- `productFacts` presente
- `visualStrategy` presente
- `trustSignals` presente
- `outputRequirements` presente
- `safetyFlags` presente
- `requiredHumanActions` presente si necesita datos
- no `finalPrompt`
- no `productionPrompt`
- no `openAiPayload`
- no API keys
- no tokens
- no URLs reales
- no base64
- no draftId/listingId real

Si el `PromptPlan` contiene campos prohibidos, el runner debe devolver `DRY_RUN_BLOCKED` o `DRY_RUN_REJECTED` segun severidad.

## 9. Evaluacion de datos reales

El runner debe marcar `DRY_RUN_NEEDS_DATA` si faltan:

- verified dimensions
- verified material
- verified package contents
- verified shipping location
- verified Free Shipping
- verified Ships from USA
- verified In Stock in USA
- model/image authorization review
- claim support

Si un dato faltante afecta directamente la imagen solicitada, no debe permitirse generacion futura. El resultado debe explicar que dato falta y que accion humana se necesita.

## 10. Evaluacion de trust signals

Reglas:

- `Free Shipping` solo puede ser allowed si `allowed=true` y `verified=true`.
- `Ships from USA` solo puede ser allowed si `allowed=true` y `verified=true`.
- `In Stock in USA` solo puede ser allowed si `allowed=true` y `verified=true`.
- USA flag solo puede ser allowed si `allowed=true` y `verified=true`.
- Si `verified=false`, `decision` debe ser `needs_data`, `blocked` o `not_requested`.
- Nunca `allowed` con `verified=false`.

El runner debe tratar las senales de confianza como claims comerciales. Si no son verdaderas y verificables, no pueden avanzar hacia generacion final.

## 11. Evaluacion de claims

Bloquear o marcar needs data si hay:

- medical claims
- guaranteed results
- certification claims without evidence
- best on eBay
- official compatibility without authorization
- cures/heals/treats
- before/after misleading claims

Los claims moderados tambien requieren facts suficientes. Por ejemplo, `durable material` no debe permitirse si el material no esta verificado.

## 12. Evaluacion de lifestyle/model

El runner debe exigir revision humana si:

- `imageRole` es `lifestyle_product_in_use`
- prompt implica persona/modelo
- hay imagen base con persona
- se necesita model release
- hay riesgo de endorsement falso
- hay contexto sensible

Para lifestyle, el producto debe seguir siendo protagonista y el contexto no debe sugerir usos, resultados o endorsos no verificados.

## 13. Decision dryRunStatus

Reglas:

### `DRY_RUN_READY_FOR_HUMAN_REVIEW`

- facts suficientes
- no trust signals no verificadas
- no claims riesgosos
- no campos prohibidos
- no side effects

### `DRY_RUN_NEEDS_DATA`

- faltan datos o verificaciones criticas
- no hay violacion grave
- todavia no se puede generar

### `DRY_RUN_BLOCKED`

- hay trust signal falso o no permitido
- hay claim prohibido
- hay marca/logo no autorizado
- hay persona sin permiso
- hay payload OpenAI/API key/URL real

### `DRY_RUN_REJECTED`

- `PromptPlan` contradice Safety Rules
- intenta ejecutar generacion o publicacion
- contiene datos sensibles o credenciales

El status debe ser conservador. Si hay duda entre ready y needs data, el runner debe elegir needs data.

## 14. Decision recommendedNextState

| Condicion                          | recommendedNextState                 |
| ---------------------------------- | ------------------------------------ |
| Faltan dimensiones/material        | REQUEST_MORE_PRODUCT_DATA            |
| Faltan trust signals verificables  | REQUEST_TRUST_SIGNAL_VERIFICATION    |
| Falta model/image authorization    | REQUEST_MODEL_OR_IMAGE_AUTHORIZATION |
| Prompt seguro pero requiere humano | READY_FOR_PROMPT_HUMAN_REVIEW        |
| Hay violacion grave                | BLOCK_IMAGE_GENERATION               |
| PromptPlan sigue incompleto        | KEEP_AS_PROMPT_PLAN_NEEDS_DATA       |

Cuando varias condiciones aplican, el runner debe escoger el next state que desbloquee el riesgo mas critico y documentar el resto en `missingData` o `humanReviewRequirements`.

## 15. Safety flags del runner

Tipo conceptual:

```ts
type ImnovaImageGenerationDryRunRunnerSafetyFlags = {
  advisoryOnly: true;
  dryRunOnly: true;
  localOnly: boolean;
  externalCallsMade: false;
  openAiApiUsed: false;
  imageGenerated: false;
  ebayApiUsed: false;
  realDraftCreated: false;
  publishedToEbay: false;
  listingMutated: false;
  reportPersisted: false;
  humanReviewRequired: true;
};
```

Estos flags deben mantenerse falsos para cualquier capacidad que implique red, generacion, eBay, publicacion, mutacion o persistencia real.

## 16. Logging futuro

Reglas:

- en este loop no se persiste nada
- futuro logging debe ser interno y seguro
- no guardar prompt final de produccion si contiene datos sensibles
- no guardar API keys
- no guardar imagenes base64
- no guardar URLs privadas
- no guardar tokens
- logs deben indicar `dryRunOnly` y no side effects

El logging futuro debe ayudar a auditoria sin convertir el dry run en una fuente de datos sensibles.

## 17. Error model

Errores conceptuales:

- `PROMPT_PLAN_SCHEMA_INVALID`
- `PROMPT_PLAN_CONTAINS_PROHIBITED_FIELD`
- `TRUST_SIGNAL_UNVERIFIED`
- `PRODUCT_FACTS_INCOMPLETE`
- `MODEL_AUTHORIZATION_REQUIRED`
- `OPENAI_PAYLOAD_NOT_ALLOWED_IN_DRY_RUN`
- `REAL_URL_NOT_ALLOWED_IN_DRY_RUN`
- `SECRET_OR_TOKEN_DETECTED`
- `EBAY_MUTATION_NOT_ALLOWED`

Cada error debe mapearse a un `dryRunStatus`, un `recommendedNextState` y una explicacion legible para revision humana.

## 18. Ejemplo conceptual

Ejemplo para `LISTING-GEN-001`:

- input: PromptPlan fixture
- status esperado: `DRY_RUN_NEEDS_DATA`
- recommendedNextState: `REQUEST_MORE_PRODUCT_DATA`
- mayGenerateImage: false
- mayCallOpenAi: false
- mayCreateRealDraft: false
- mayPublish: false
- reportPersisted: false

Interpretacion:

El PromptPlan de `LISTING-GEN-001` puede explicarse internamente, pero no puede avanzar a generacion. Faltan dimensiones/material verificados, trust signals verificables y revision de autorizacion de modelo/imagen.

## 19. Relacion con Admin

Este diseno se relaciona con:

- `/admin/ebay-image-generator`

La pantalla Admin ya muestra PromptPlan + Dry Run Result.

En el futuro podria mostrar resultados producidos por runner.

En este loop no se modifica UI.

## 20. Relacion con tests futuros

Futuros tests deberian validar:

- input seguro
- output seguro
- no external calls
- no OpenAI calls
- no image generation
- no eBay mutation
- no report persistence
- trust signals unverified never allowed
- prohibited fields blocked
- missing data produces `DRY_RUN_NEEDS_DATA`

En este loop no se modifican tests.

## 21. Que NO hacer

No hacer:

- no implementar runner real en este loop
- no crear CLI
- no crear API
- no crear service
- no llamar OpenAI API
- no generar imagenes
- no usar API keys
- no crear draft real
- no publicar
- no mutar listing
- no persistir reportes reales
- no usar URLs reales
- no usar datos reales sensibles
- no tocar Supabase
- no tocar eBay

Este documento no autoriza ejecucion real. Solo define como deberia comportarse un runner futuro.

## 22. Proximos loops recomendados

- `LOOP 085 - Image Generation Dry Run Runner Fixture Test Design V1`
- `LOOP 086 - Image Generation Dry Run Runner Local Implementation V1`
- `LOOP 087 - Image Generator Admin Runner Wiring Design V1`

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
