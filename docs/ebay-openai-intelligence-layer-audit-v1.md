# OpenAI Intelligence Layer para eBay Seller OS

Fecha de auditoria: 2026-07-26.

Rama: `feature/centralize-ebay-mobile-center`.

Entorno autorizado: Preview/Staging. Las capacidades nuevas quedan deshabilitadas,
en Shadow Mode, con presupuesto cero y kill switch activo.

## Resultado ejecutivo

OpenAI no es fuente de verdad. El gateway nuevo solo acepta expedientes
sanitizados, exige evidencia referenciable, valida Structured Outputs, no guarda
prompts ni respuestas crudas y siempre devuelve cero efectos comerciales.

La auditoria encontro:

- Tres clientes de Responses API duplicados: Listing Factory V1, V2 y Strategic
  Advisor.
- Dos familias de OpenAI Images realmente ejecutables en Preview: scene boards y
  reference-guided edits.
- Listing Factory V2 tiene mejor validacion y ledger que V1, pero su resultado
  termina en el panel y no alimenta el paquete visual ni un draft.
- Strategic Advisor crea y aprueba jobs, pero no existe worker que consuma su
  claim. Los jobs quedan en `OPENAI_CALL_QUEUED`.
- El modelo revisor V2 se muestra y persiste, pero no se invoca.
- No existen embeddings, `pgvector`, memoria semantica ni Batch API implementados.
- Los presupuestos son incompatibles: V1 no tiene costo, V2 usa una tabla fija,
  Advisor usa limites diarios y las imagenes solo cuentan llamadas.

## Matriz de capacidades

| Capacidad | Implementacion actual | API | E2E | Activada | Schema | Budget | Resultado utilizado | Brecha |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Listing Factory V1 | Real y fake adapter | Responses | Manual | Preview gated | Strict | No monetario | Imagenes consume V1 aprobada | Intake puede llegar desde request sin provenance fuerte |
| Listing Factory V2 | Real y fake adapter | Responses | Parcial | Manual | Strict | Mensual fijo | Solo panel | Sin consumidor downstream; review model decorativo |
| Strategic Advisor | Transporte real | Responses | No | Dormant | Strict | Daily fail-closed | Ninguno | Sin worker |
| Scene board | Real | Images generations | Si | Preview gated | QA determinista | Limite de llamadas | Paquete visual | Sin presupuesto monetario comun |
| Reference-guided | Real experimental | Images edits | Canarios one-off | Flag | QA especifica | Incompleto | Revision humana | Sin timeout ambiguo/ledger comun equivalente |
| Dossier distillation | Determinista | Ninguna | Si en V2 | Activa sin OpenAI | N/A | N/A | V2 | Buen fallback y baseline |
| Comparable classifier | Determinista | Ninguna | Si | Activa sin OpenAI | N/A | N/A | Precio/listing | No evaluador semantico shadow |
| Listing reviewer | Disenado | Ninguna | No | No | No | No | Ninguno | Segundo pase no implementado |
| Experiment analyst | No existe | Ninguna | No | No | No | No | Ninguno | Shadow pendiente de evals |
| Quarantine triage | No existe | Ninguna | No | No | No | No | Ninguno | Shadow pendiente de evals |
| Semantic memory | No existe | Ninguna | No | No | No | No | Ninguno | No hay pgvector |

## Flujo anterior

`evento/manual -> cliente OpenAI especifico -> validacion local -> tabla propia ->
panel o imagenes`

Cada modulo tenia sus propios modelos, limites, costos, retries y persistencia.
Advisor se detenia antes de OpenAI porque no habia consumidor de la cola.

## Flujo endurecido

`evento -> expediente destilado -> allowlist/denylist -> manifiesto ->
config/kill switch -> budget atomico -> dedupe -> circuit breaker ->
modelo por tier -> Responses strict/store:false -> validacion de schema ->
validacion de evidence refs -> resultado sanitizado -> shadow eval ->
panel`

El gateway no contiene transporte de red automatico ni puede mutar estados. Los
clientes existentes comparten ahora un transporte HTTP server-only, pero conservan
sus gates y comportamiento.

## Registro de casos

1. `DOSSIER_DISTILLATION`: Economy, fallback determinista, prioridad Shadow 1.
2. `COMPARABLE_CLASSIFICATION`: Economy, hard gates de identidad, prioridad 2.
3. `LISTING_REVIEW`: Balanced, revision independiente, prioridad 3.
4. `PERFORMANCE_DIAGNOSIS`: Balanced, Advisor sin ejecucion, prioridad 4.
5. `QUARANTINE_TRIAGE`: Economy, solo envelope sanitizado, prioridad 5.
6. `EXPERIMENT_ANALYSIS`: Balanced, sin causalidad automatica, prioridad 6.
7. `LISTING_GENERATION`: existente/manual; consolidar sobre V2.
8. `DAILY_EXECUTIVE_SUMMARY`: candidato Batch, no inmediato.
9. `IMAGE_GENERATION`: runtime existente; no migrado automaticamente al shadow.
10. `SEMANTIC_EMBEDDING`: rechazado por ahora; no hay pgvector ni evals.

## Allowlist y denylist

Permitidos segun caso:

- Referencias internas no reversibles.
- Hash del expediente.
- Hechos verificados y minimizados.
- Referencias de evidencia.
- Metricas propias agregadas.
- Guardrails economicos, nunca secretos del motor.
- Listing candidato sanitizado.
- Error envelope sanitizado.
- Experimento y baseline agregados.

Prohibidos:

- API keys, OAuth, tokens eBay y headers Authorization.
- Buyer PII, email, telefono y direccion.
- URLs publicas o privadas.
- Fotografias, URLs y texto completo de competidores.
- Prompts o respuestas crudas en la base de datos.
- Datos sin provenance presentados como hechos.

## Autoridad y validacion

La salida strict incluye resultado, confianza, evidencia usada/faltante,
hipotesis, riesgos, accion recomendada, acciones prohibidas, revision humana,
version de prompt y version de schema.

Despues de OpenAI:

1. Se valida la forma exacta.
2. Se comprueba cada referencia contra el expediente.
3. Se rechazan claims sin evidencia.
4. Se restringen los campos que cada caso puede proponer.
5. Numeros, identidad, categoria, stock, costo y economia siguen siendo
   deterministas.
6. Se guarda solo el resultado sanitizado y hashes.
7. Los efectos externos permanecen en cero.

## Router y documentacion oficial

La guia oficial vigente recomienda Responses API para proyectos nuevos,
Structured Outputs mediante `text.format`, `store:false` cuando no se desea
almacenamiento y medir cache reads/writes. Tambien recomienda elegir el modelo
por workload y comparar calidad, latencia y costo.

Por eso el router usa tiers `ECONOMY`, `BALANCED`, `ADVANCED`, `IMAGE` y
`EMBEDDING`, pero no cambia los modelos actuales. Los IDs vienen de configuracion
server-side. Un caso ambiguo puede escalar una vez, nunca repetidamente.

Referencias oficiales:

- https://developers.openai.com/api/docs/guides/migrate-to-responses
- https://developers.openai.com/api/docs/guides/structured-outputs
- https://developers.openai.com/api/docs/guides/prompt-caching
- https://developers.openai.com/api/docs/guides/batch
- https://developers.openai.com/api/docs/guides/latest-model.md

## Budgets, dedupe y circuito

La configuracion en base de datos mantiene:

- Budget diario.
- Budget mensual.
- Maximo por producto.
- Maximo diario por caso.
- Maximo por invocacion.
- Model tier y modelo.
- Timeout, retries y threshold del circuito.
- Kill switch independiente.

Cada invocacion se identifica por use case, versiones, modelo, hash del input y
hash del expediente. Una misma combinacion no vuelve a comprar tokens. El ledger
registra input, cached input, cache writes, output, costo estimado/real y estado.

Un fallo global repetido abre el circuito. Los casos opcionales usan fallback
determinista; los necesarios quedan esperando retry sin bloquear los otros cuatro
productos.

## Baseline y evaluaciones

Baseline funcional:

- Destilacion determinista ya separa `SOLD_CONFIRMED` y `ACTIVE_ONLY`.
- Comparables y economia tienen hard gates existentes.
- OpenAI comercial no tiene eval dataset ni ground truth completo.
- No existe baseline confiable de minutos humanos por listing.

Antes de activar se debe registrar por dataset:

- 100% parseable.
- 100% evidence refs validas.
- Cero atributos inventados.
- Cero claims sin respaldo.
- Cero bypass de hard gates.
- Mejora medible contra el baseline determinista.
- Costo dentro del budget aprobado.

Clasificaciones Shadow:

- `REJECTED_NO_VALUE`
- `NEEDS_PROMPT_IMPROVEMENT`
- `HUMAN_ASSISTED_ONLY`
- `SAFE_ADVISORY`
- `SAFE_FOR_POLICY_AUTOMATION`

## Recomendacion de activacion

Seguro para evaluar primero, sin activar:

- Dossier distillation.
- Comparable classification.
- Listing review.

Mantener deshabilitado:

- Advisor hasta implementar y probar un worker durable.
- Embeddings hasta demostrar necesidad, instalar pgvector de forma revisada y
  superar evals de retrieval.
- Daily summary generativo hasta probar que mejora al digest determinista.
- Quarantine triage hasta disponer de ground truth de fingerprints.
- Fine-tuning; no hay dataset limpio suficiente.

## Plan de canarios

1. Aplicar la migracion solo en Supabase staging.
2. Mantener todos los rows deshabilitados, presupuesto cero y kill switch activo.
3. Ejecutar fixtures locales de cinco productos.
4. Preparar datasets sanitizados y ground truth humano.
5. Configurar un solo caso con presupuesto minimo y Shadow.
6. Autorizar por separado la primera llamada real.
7. Medir calidad, costo y latencia.
8. Clasificar el caso y decidir si sigue apagado o pasa a asistencia humana.
9. Ningun canario autoriza escrituras eBay.
