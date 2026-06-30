# Image Generation Dry Run Runner Fixture Test Design V1

## 1. Proposito

Este documento disena las futuras pruebas del Dry Run Runner de generacion de imagenes.

El objetivo es definir que fixtures de prueba necesitara IMNOVA, que casos deben pasar, que casos deben bloquearse, que invariantes de seguridad deben cumplirse siempre y que nunca debe hacer el runner.

Este documento es:

- documentation-only
- sin implementacion de tests en este loop
- sin fixtures nuevos en este loop
- sin runner real
- sin conexion OpenAI
- sin OpenAI API call
- sin API keys
- sin generacion de imagenes
- sin eBay API real
- sin drafts reales
- sin publicacion
- sin cambios reales de listings
- sin reportes reales persistidos

No modifica tests, no crea fixtures, no implementa runner, no llama OpenAI, no genera imagenes, no conecta eBay y no persiste reportes reales.

## 2. Principio principal

Las pruebas futuras deben confirmar que el runner evalua, explica y bloquea, pero nunca ejecuta.

Regla central:

```text
Tests must prove: evaluate only, no side effects.
```

Un test del runner debe probar tanto la decision funcional como las garantias de seguridad. Un resultado correcto que permita efectos externos no es aceptable.

## 3. Relacion con el Runner Design

Este diseno se relaciona con:

- `IMAGE_GENERATION_DRY_RUN_RUNNER_DESIGN_V1.md`
- `IMAGE_GENERATION_DRY_RUN_RESULT_SCHEMA_V1.md`
- `IMAGE_GENERATION_PROMPT_PLAN_SCHEMA_V1.md`
- `IMAGE_GENERATION_SAFETY_RULES_V1.md`

Los tests futuros deben validar que el runner:

- recibe `PromptPlan`
- aplica Safety Rules
- produce `Dry Run Result`
- no llama OpenAI
- no genera imagen
- no toca eBay
- no persiste reportes reales

La estrategia de pruebas debe cubrir casos positivos, casos incompletos y casos bloqueados. Tambien debe probar que todos los flags de seguridad se mantienen en valores seguros.

## 4. Alcance de pruebas futuras

Disenar pruebas para:

- schema validation
- prohibited fields
- missing data
- trust signals
- claims
- lifestyle/model authorization
- output requirements
- safety flags
- no side effects
- deterministic output
- human review requirements

El alcance no incluye pruebas contra OpenAI, eBay, Supabase, servicios externos ni UI real. Esas integraciones no deben existir antes de que el runner local puro sea seguro.

## 5. Fixtures futuros recomendados

Futuros fixtures recomendados, sin crearlos todavia:

1. `image-generation-prompt-plan-needs-data-v1.json`

   - basado en `LISTING-GEN-001`
   - expected: `DRY_RUN_NEEDS_DATA`

2. `image-generation-prompt-plan-ready-for-human-review-v1.json`

   - facts verificados
   - trust signals desactivados o verificados
   - expected: `DRY_RUN_READY_FOR_HUMAN_REVIEW`

3. `image-generation-prompt-plan-blocked-unverified-trust-signals-v1.json`

   - solicita Free Shipping / Ships from USA sin verificacion
   - expected: `DRY_RUN_BLOCKED` o `REQUEST_TRUST_SIGNAL_VERIFICATION`

4. `image-generation-prompt-plan-blocked-openai-payload-v1.json`

   - contiene `openAiPayload`
   - expected: blocked/rejected

5. `image-generation-prompt-plan-blocked-secret-v1.json`

   - contiene API key/token/secret simulado seguro, no real
   - expected: rejected

6. `image-generation-prompt-plan-blocked-real-url-v1.json`

   - contiene URL simulada segura o placeholder prohibido, no real
   - expected: rejected

7. `image-generation-prompt-plan-blocked-brand-logo-v1.json`

   - solicita marca/logo no autorizado
   - expected: blocked

8. `image-generation-prompt-plan-blocked-medical-claim-v1.json`

   - contiene claim medico
   - expected: blocked

9. `image-generation-prompt-plan-lifestyle-model-auth-required-v1.json`

   - lifestyle con persona/modelo sin autorizacion
   - expected: needs data or blocked

10. `image-generation-dry-run-result-needs-data-v1.json`

    - resultado esperado para `LISTING-GEN-001`

En este loop no se crea ninguno de estos fixtures.

## 6. Invariantes de seguridad

Todos los tests futuros deben validar:

- `openAiApiUsed === false`
- `imageGenerated === false`
- `externalCallsMade === false`
- `ebayApiUsed === false`
- `realDraftCreated === false`
- `publishedToEbay === false`
- `listingMutated === false`
- `reportPersisted === false`
- `humanReviewRequired === true`
- `mayGenerateImage === false` en dry runs bloqueados o needs data
- `mayCallOpenAi === false`
- `mayCreateRealDraft === false`
- `mayPublish === false`
- `mayMutateListing === false`

Estas invariantes deben mantenerse incluso cuando un fixture representa un caso listo para revision humana. Revision humana no equivale a generacion, draft, publicacion ni mutacion.

## 7. Tests de schema

Tests futuros:

- PromptPlan JSON parsea correctamente.
- DryRunResult JSON parsea correctamente.
- `promptVersion` correcto.
- `resultVersion` correcto.
- `caseId` consistente.
- `sourcePromptPlanVersion` correcto.
- `imageRole` dentro del enum permitido.
- `targetBuyer` igual a `us_ebay_buyer`.
- `language` igual a `en`.
- status dentro del enum permitido.
- required arrays presentes.

Los tests de schema deben fallar con mensajes claros si el fixture pierde un campo requerido o usa un enum no permitido.

## 8. Tests de campos prohibidos

Validaciones recursivas futuras para bloquear:

- `finalPrompt`
- `productionPrompt`
- `openAiPayload`
- `apiKey`
- `authorization`
- `token`
- `secret`
- `password`
- `base64Image`
- `imageUrl`
- `draftId`
- `listingId`
- `publishedListingId`
- valores con `http://`
- valores con `https://`

Usar valores simulados seguros, nunca secretos reales.

Un fixture con campos prohibidos debe probar el bloqueo, no conservar datos sensibles. Por ejemplo, usar placeholders seguros como `SIMULATED_SECRET_PLACEHOLDER`, sin formato de credencial real.

## 9. Tests de trust signals

Tests futuros:

- Free Shipping no puede ser `allowed` si `verified === false`.
- Ships from USA no puede ser `allowed` si `verified === false`.
- In Stock in USA no puede ser `allowed` si `verified === false`.
- USA flag no puede ser `allowed` si `verified === false`.
- Si una senal esta no verificada, la decision debe ser:
  - `needs_data`
  - `blocked`
  - `not_requested`
- Nunca `allowed` con `verified === false`.

Los tests deben cubrir senales no solicitadas, senales solicitadas sin verificacion y senales permitidas solo cuando estan verificadas.

## 10. Tests de missing data

Tests para confirmar que faltantes producen `DRY_RUN_NEEDS_DATA`:

- verified dimensions required
- verified material required
- package contents verification required
- shipping location verification required
- free shipping verification required
- ships from USA verification required
- in stock in USA verification required
- model/image authorization review required
- claim support required

Cada missing data debe mapearse a una accion humana clara. El runner no debe llenar datos faltantes por inferencia.

## 11. Tests de blocking reasons

Tests para confirmar que riesgos producen `DRY_RUN_BLOCKED` o `DRY_RUN_REJECTED`:

- unverified Free Shipping used as final trust signal
- unverified Ships from USA used as final trust signal
- unauthorized brand/logo requested
- medical claim requested
- guaranteed result claim requested
- OpenAI payload included
- API key or secret included
- real image URL included
- eBay draft/listing id included
- attempt to publish or mutate listing

Los blocking reasons deben ser explicables y auditable-friendly. No deben ocultar por que se bloqueo el flujo.

## 12. Tests de output requirements

Tests para validar:

- `intendedUse === "internal_review_only"`
- `mayGenerateImage === false`
- `mayCallOpenAi === false`
- `mayCreateRealDraft === false`
- `mayPublish === false`
- `mayMutateListing === false`
- `requiresImageQaBeforeUse === true`
- `requiresHumanReview === true`

Estos tests protegen la frontera entre evaluacion y ejecucion. El dry run no debe convertirse en autorizacion operacional.

## 13. Tests de safety flags

Tests para validar:

- advisoryOnly true
- dryRunOnly true
- openAiApiUsed false
- imageGenerated false
- externalCallsMade false
- ebayApiUsed false
- realDraftCreated false
- publishedToEbay false
- listingMutated false
- reportPersisted false
- humanReviewRequired true

Los safety flags deben revisarse tanto en casos needs data como en casos blocked, rejected y ready for human review.

## 14. Tests de deterministic output

Disenar:

- mismo input seguro => mismo dryRunStatus
- mismo input seguro => mismas missingData
- mismo input seguro => mismas trustSignalEvaluation decisions
- no dependencia de fecha actual salvo `evaluatedAt`, si se permite
- no llamadas externas

Si `evaluatedAt` se permite como fecha dinamica en implementacion futura, los tests deben aislarlo o inyectarlo para mantener determinismo.

## 15. Tests de no side effects

Disenar test que confirme que el runner futuro no usa:

- fetch
- createClient
- Supabase insert/update/delete/upsert/rpc
- process.env
- new OpenAI
- images.generate
- openai.images
- eBay API
- createDraft
- publishListing
- WhatsApp/email senders

Estos tests pueden combinar inspeccion estatica del modulo con mocks que fallen si se intenta ejecutar una llamada externa.

## 16. Test names sugeridos

Nombres sugeridos de tests futuros:

- `image generation dry run runner returns needs data for incomplete prompt plan`
- `image generation dry run runner blocks unverified trust signals`
- `image generation dry run runner rejects OpenAI payload in dry run`
- `image generation dry run runner rejects secrets and tokens`
- `image generation dry run runner rejects real URLs`
- `image generation dry run runner requires model authorization for lifestyle images`
- `image generation dry run runner never allows OpenAI or eBay side effects`
- `image generation dry run result preserves safe output flags`

Los nombres deben describir el comportamiento y la garantia de seguridad, no solo el archivo bajo prueba.

## 17. Orden recomendado de implementacion futura

Orden recomendado:

1. Crear fixtures seguros.
2. Agregar tests de fixture shape.
3. Implementar runner local puro.
4. Agregar tests de runner.
5. Conectar Admin solo a resultados locales/fixture.
6. Nunca conectar OpenAI antes de pasar safety gates.

El runner debe nacer como funcion pura y local. Cualquier integracion externa debe esperar a loops posteriores y aprobaciones explicitas.

## 18. Que NO hacer

No hacer:

- no implementar tests reales en este loop
- no crear fixtures reales en este loop
- no implementar runner real
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

Este documento solo disena la estrategia de pruebas futura. No autoriza implementacion ni ejecucion real.

## 19. Proximos loops recomendados

- `LOOP 086 - Image Generation Dry Run Runner Fixture Set V1`
- `LOOP 087 - Image Generation Dry Run Runner Local Implementation V1`
- `LOOP 088 - Image Generator Admin Runner Wiring Design V1`

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
