# IMNOVA Self-Improvement Codex Handoff V1

## Why

IMNOVA OS necesita una forma segura de proponerse mejoras sin ejecutar automatizacion peligrosa. LOOP 149CODEX-A crea una capa local/read-only que convierte oportunidades de mejora en backlog items, work orders y prompts seguros para handoff manual a Codex.

## Current State

Marketplace OS ya muestra Amazon Decision Center en `/admin/marketplace-os`. El siguiente paso estrategico es que IMNOVA pueda detectar mejoras operativas, documentarlas y preparar instrucciones revisables para Codex. En este loop no se conecta Codex API, OpenAI API ni ningun sistema externo.

## Que Es IMNOVA Self-Improvement Engine

Es el marco donde IMNOVA OS detecta oportunidades internas de mejora desde pantallas, dry-runs, tests, bloqueos, decisiones humanas y gaps de UX. En 149CODEX-A solo modela esas oportunidades de forma local.

## Que Es Codex Handoff Layer

Es la capa que transforma una oportunidad en un paquete de trabajo para Codex. Incluye objetivo, rama sugerida, archivos permitidos, archivos prohibidos, tests, guardrails, Definition of Done y explicacion humana requerida.

## Por Que No Conectamos Codex API Todavia

Conectar Codex API antes de tener gates puede producir cambios automaticos, prompts con informacion sensible, branch automation, PR automation o merges no aprobados. 149CODEX-A solo prepara handoff manual. La conexion real queda para 149CODEX-B con Safe Execution Gate.

## Como IMNOVA Detecta Oportunidades De Mejora

En este loop las oportunidades vienen de fixture sanitizado. Ejemplos:

- Filtros del Marketplace OS por bloqueados, watchlist y rechazados.
- Panel detalle para DM0628N.
- Preview de WhatsApp Remote Control para decisiones Amazon.
- Explicacion de productos con ROI positivo pero bloqueados para listing.

En loops futuros, estas senales podran venir de dashboards, tests fallidos, feedback humano, dry-runs y patrones de uso.

## Que Es Un Backlog Item

Un backlog item describe una mejora en lenguaje revisable:

- improvementKey.
- title.
- sourceModule.
- problemStatement.
- whyItMatters.
- expectedImpact.
- implementationRisk.
- priorityScore.
- suggestedBranchName.
- suggestedFiles.
- suggestedTests.
- guardrails.
- humanApprovalRequired.
- codexHandoffMode.

Por defecto `canSendToCodex` es false y `codexHandoffMode` es `MANUAL_COPY_ONLY`.

## Que Es Un Codex Work Order

Un work order es el contrato operativo para Codex. Debe incluir:

- objetivo.
- rama sugerida.
- archivos permitidos.
- archivos prohibidos.
- tests requeridos.
- dry-run requerido.
- limites de seguridad.
- Definition of Done.
- explicacion humana obligatoria.
- comandos prohibidos.
- acciones prohibidas.

## Que Es Un Codex Handoff Prompt

Es el prompt seguro para copiar manualmente a Codex. Debe contener suficiente contexto para implementar, pero no debe incluir secretos, tokens, `.env`, auth codes, credenciales ni datos sensibles.

## Por Que Todo Requiere Aprobacion Humana

La automejora puede tocar rutas, tests, dashboards y eventualmente flujos de marketplace. Por eso ningun backlog item puede ejecutar cambios automaticos. Un humano debe aprobar antes de crear rama, editar codigo, abrir PR o mergear.

## Que Nunca Debe Incluir Un Prompt

- Secrets.
- Tokens.
- `.env`.
- Auth codes.
- Credenciales Amazon, SP-API, Seller Central, Codex u OpenAI.
- Datos sensibles de clientes.
- Instrucciones para tocar Production.
- Instrucciones para hacer merge automatico.

## Reglas De Sanitizacion

El sanitizer redacta patrones como:

- prefijos de API key tipo `sk` + guion.
- valores tipo Supabase secret.
- access token.
- refresh token.
- client secret.
- OpenAI API key.
- Codex API key.
- auth code.
- tokens largos sospechosos.

Los prompts generados por el fixture deben salir sin secretos detectados.

## Guardrails

- No Production touch.
- No main touch.
- No Staging DB write.
- No Codex API real.
- No OpenAI API.
- No automatic code changes.
- No branch automation.
- No PR automation.
- No merge automation.
- No Amazon API/SP-API.
- No Seller Central write.
- No ASIN/listing creation.
- No publication.
- No scraper.
- No WhatsApp real.
- No `.env`, secrets, tokens, dumps, backups o imagenes.

## Ejemplos De Mejoras

1. Filtros del Marketplace OS por bloqueados / watchlist / rechazados.
2. Panel detalle para DM0628N.
3. Preview de WhatsApp Remote Control para decisiones Amazon.
4. Explicacion de productos con ROI positivo pero bloqueados para listing.

## Como Esto Alimenta 149CODEX-B

149CODEX-B podra tomar este formato de backlog/work order/prompt y agregar una capa de conexion Codex API con gates de ejecucion segura. Esa fase debe validar aprobacion humana, branch segura, scope permitido, prompt sanitizado y bloqueo de merges automaticos.

## Como Despues Continua 149G

Despues de preparar automejora segura, Amazon Track continua con 149G - Amazon Listing Package Builder. La automejora ayuda a mejorar la UX y los controles antes de preparar packages de listing.

## Safety Boundaries

149CODEX-A es local/read-only. No ejecuta automatizacion real, no crea ramas, no abre PRs, no mergea, no llama Codex API, no llama OpenAI API y no toca marketplaces.

## Definition Of Done

El loop queda listo cuando:

- fixture sanitizado existe.
- modulo puro construye backlog, work orders y prompts.
- sanitizer redacta secretos en prueba negativa.
- UI `/admin/self-improvement` muestra backlog y preview.
- CLI dry-run reporta flags de seguridad.
- tests pasan.
- TypeScript pasa.
- git status queda limpio.

## Human Explanation Rule

Cada handoff debe explicar que se quiere mejorar, por que importa, que archivos tocar, que tests correr, que esta prohibido, que se protegio y que sigue. La explicacion debe poder entenderla un operador humano antes de aprobar trabajo con Codex.
