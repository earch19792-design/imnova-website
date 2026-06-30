# Image Generator Admin Runner Wiring Design V1

## 1. Proposito

Este documento disena como conectar en el futuro la pantalla Admin `/admin/ebay-image-generator` con el runner local `runImageGenerationDryRun`.

Este loop es:

- documentation-only
- sin implementacion en este loop
- sin UI changes
- sin API
- sin OpenAI
- sin image generation
- sin eBay
- sin persistence
- sin side effects

No modifica la pantalla Admin, no crea rutas API, no cambia tests, no crea fixtures, no llama OpenAI, no genera imagenes, no toca eBay, no persiste reportes y no ejecuta acciones externas.

## 2. Estado actual

La pantalla Admin `/admin/ebay-image-generator` ya muestra:

- PromptPlan fixture
- Dry Run Result fixture
- mensajes de seguridad
- acciones visibles deshabilitadas
- estado `PROMPT_PLAN_NEEDS_DATA`
- estado `DRY_RUN_NEEDS_DATA`
- revision humana requerida

El PromptPlan fixture actual vive en:

```text
tools/fixtures/ebay-listing-image-generation-prompt-plan-v1.json
```

El Dry Run Result fixture actual vive en:

```text
tools/fixtures/ebay-listing-image-generation-dry-run-result-v1.json
```

El runner local ya existe en:

```text
lib/ebay-winner-pipeline/image-generation-dry-run-runner.mjs
```

El runner exporta:

```js
runImageGenerationDryRun
```

El runner local es puro. Evalua un PromptPlan en memoria y devuelve un resultado compatible con `ImnovaImageGenerationDryRunResult` sin leer archivos, escribir archivos, llamar red, llamar OpenAI, tocar Supabase, tocar eBay, generar imagenes ni persistir reportes.

## 3. Objetivo futuro del wiring

El objetivo futuro es pasar de un Dry Run Result fixture estatico a un Dry Run Result calculado localmente por el runner:

```text
PromptPlan fixture -> runImageGenerationDryRun(promptPlan) -> Dry Run Result calculated -> Admin read-only display
```

El Admin no debe llamar OpenAI.

El Admin no debe crear draft.

El Admin no debe publicar.

El Admin no debe persistir reportes.

El Admin solo mostraria un resultado calculado localmente y read-only.

## 4. Principio principal

Regla central:

```text
Admin can display runner output, but Admin must not execute real external actions.
```

La pantalla Admin puede presentar informacion calculada por el runner local, pero no debe convertirse en una superficie operativa para generacion, publicacion, mutacion, persistencia o llamadas externas.

## 5. Fuente de datos permitida para el primer wiring

El primer wiring debe usar unicamente:

- `tools/fixtures/ebay-listing-image-generation-prompt-plan-v1.json`
- `runImageGenerationDryRun`

No debe usar:

- Supabase
- API route
- OpenAI
- eBay
- file writes
- external URLs
- environment variables

La fuente inicial debe seguir siendo fixture-only. Cualquier dato real o candidato interno futuro requiere un loop separado, nuevas validaciones y revision humana.

## 6. Flujo conceptual

Pasos del wiring futuro:

1. Import PromptPlan fixture.
2. Import `runImageGenerationDryRun`.
3. Execute runner locally during render/build context if safe.
4. Pass deterministic `evaluatedAt`.
5. Receive Dry Run Result.
6. Render result in existing read-only UI.
7. Keep disabled actions.
8. Keep all safety messaging.
9. Do not persist result.

Ejemplo conceptual, no implementado en este loop:

```ts
const dryRunResult = runImageGenerationDryRun(promptPlan, {
  evaluatedAt: promptPlan.generatedAt,
});
```

El wiring debe permanecer como evaluacion local. El resultado se calcula para mostrarlo, no para guardarlo ni para activar generacion.

## 7. Reglas de seguridad del wiring

El wiring futuro debe garantizar:

- no `fetch`
- no `createClient`
- no `process.env`
- no `new OpenAI`
- no `images.generate`
- no `openai.images`
- no eBay API
- no Supabase mutation
- no file writes
- no report persistence
- no active buttons
- no `onClick` for generation/publish
- no real draft
- no publishing

La pantalla debe mantener los botones visibles como comunicacion de bloqueo, pero siempre disabled y sin handlers reales para generacion, envio a OpenAI, creacion de draft o publicacion.

## 8. Determinismo

El wiring futuro debe usar un `evaluatedAt` fijo o derivado del fixture para evitar diferencias innecesarias.

Reglas:

- mismo PromptPlan debe producir mismo Dry Run Result
- mismo `evaluatedAt` debe producir salida serializada estable
- Admin debe mostrar resultado estable
- el render no debe depender de fecha actual si no es necesario
- no debe haber llamadas externas que cambien el resultado

Para el primer wiring, el valor recomendado es usar `promptPlan.generatedAt` o un valor fijo documentado.

## 9. Output esperado en Admin

La pantalla debe seguir mostrando:

- `PromptPlan`
- `Dry Run Result`
- `DRY_RUN_NEEDS_DATA`
- `REQUEST_MORE_PRODUCT_DATA`
- `Image generation cannot proceed yet`
- missing data
- trust signal evaluation
- prompt safety evaluation
- output requirements
- safety flags
- human review requirements

Debe seguir comunicando:

- OpenAI is not connected
- No image is generated
- No OpenAI call was made
- No eBay draft was created
- No listing was published
- Human review required
- Internal review only

El resultado calculado no debe cambiar el rol de la pantalla. Sigue siendo una vista read-only de evaluacion segura.

## 10. Tests futuros del wiring

Tests futuros deberian confirmar:

- Admin importa runner local
- Admin importa PromptPlan fixture
- Admin no importa Dry Run Result fixture como fuente principal, o lo deja solo como fallback/documentacion si se decide
- Admin contiene `runImageGenerationDryRun`
- Admin no contiene `fetch`
- Admin no contiene `createClient`
- Admin no contiene `process.env`
- Admin no contiene OpenAI
- Admin no contiene eBay mutation
- Admin no contiene active `onClick`
- Admin sigue mostrando disabled actions
- Admin sigue mostrando no side effects

Tambien deberian confirmar que el resultado calculado mantiene:

- `DRY_RUN_NEEDS_DATA`
- `REQUEST_MORE_PRODUCT_DATA`
- `mayGenerateImage: false`
- `mayCallOpenAi: false`
- `mayCreateRealDraft: false`
- `mayPublish: false`
- `mayMutateListing: false`
- `openAiApiUsed: false`
- `imageGenerated: false`
- `externalCallsMade: false`
- `ebayApiUsed: false`
- `realDraftCreated: false`
- `publishedToEbay: false`
- `listingMutated: false`
- `reportPersisted: false`

## 11. Migracion futura desde fixture a datos reales

Etapas seguras recomendadas:

1. Fixture only.
2. Runner local from fixture.
3. Runner local from selected internal candidate.
4. Admin preview with human review.
5. Only much later, OpenAI generation behind safety gates.

La primera conexion debe quedarse en fixture-only.

No conectar Supabase ni OpenAI en el primer wiring.

No usar datos reales de producto, proveedor, cliente, credenciales, URLs privadas o listings reales sin un loop especifico de seguridad y revision.

El paso a candidatos internos debe mantener el runner local y sin side effects. El paso a OpenAI futuro solo puede ocurrir despues de safety gates, QA visual y revision humana.

## 12. Que NO hacer

No hacer:

- no implementar wiring en este loop
- no crear API
- no crear service
- no conectar OpenAI
- no generar imagenes
- no crear drafts
- no publicar
- no persistir dry run result
- no mutar listings
- no tocar Supabase
- no usar env vars
- no usar URLs reales
- no usar datos sensibles

Este documento no habilita generacion real. Solo define como deberia disenarse el wiring futuro de forma segura.

## 13. Proximos loops recomendados

Loops recomendados:

- `LOOP 089 — Image Generator Admin Runner Local Wiring V1`
- `LOOP 090 — Image Generator Admin Runner Wiring Tests V1`
- `LOOP 091 — Image Generation Manual Image Creation Workflow V1`
