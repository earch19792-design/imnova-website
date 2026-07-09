# IMNOVA Codex API Safe Execution Gate V1

## Why

IMNOVA OS ya puede crear backlog, work orders y prompts seguros para Codex. El siguiente riesgo es conectar ejecucion real demasiado pronto. LOOP 149CODEX-B existe para disenar la capa de seguridad antes de cualquier futura conexion con Codex API.

El objetivo no es ejecutar Codex. El objetivo es validar si un work order podria pasar por un gate local antes de una ejecucion futura.

## Current state

- LOOP 149CODEX-A esta integrado en PRE/Staging.
- `/admin/self-improvement` muestra backlog y handoff manual.
- Este loop agrega `/admin/self-improvement/codex-gate`.
- Codex API sigue desactivada.
- OpenAI API sigue desactivada.
- No hay ejecucion automatica de codigo.
- No hay branch automation, PR automation ni merge automation.

## Que es Codex Safe Execution Gate

Es una capa local/read-only que toma work orders de IMNOVA Self-Improvement y genera execution plans simulados.

Cada plan responde:

- cual seria el objetivo;
- que branch se propondria;
- que archivos se tocarian;
- que tests se correrian;
- que prompt sanitizado se prepararia;
- si hay aprobacion humana;
- si hay secrets;
- si hay riesgo alto;
- si Production o main estan en riesgo;
- si la ejecucion queda bloqueada.

## Por que no llamamos Codex API real todavia

Una conexion real requiere controles adicionales:

- manejo seguro de credenciales;
- auditoria;
- aprobacion humana persistente;
- control de branch;
- control de PR;
- control de merge;
- rollback;
- revision de prompts;
- bloqueo de secrets;
- politicas de ejecucion.

Este loop solo modela el gate. No envia prompts a servicios externos.

## Handoff manual vs ejecucion via API

Handoff manual significa que IMNOVA genera un prompt seguro y un humano decide copiarlo a Codex.

Ejecucion via API significaria que IMNOVA enviaria un payload a una API externa. Ese modo no esta activo. LOOP 149CODEX-B solo prepara el diseno para un futuro 149CODEX-C.

## Que valida antes de permitir una ejecucion futura

- Codex API key no permitida en dry-run.
- Endpoint no asumido.
- External network disabled.
- Real Codex call disabled.
- Human approval required.
- Secrets policy pass.
- Production off limits.
- Main off limits.
- Branch automation disabled.
- PR automation disabled.
- Merge automation disabled.

## Human approval gate

Cada work order requiere aprobacion humana. Si falta aprobacion, el plan queda bloqueado con:

`BLOCKED_MISSING_HUMAN_APPROVAL`

Esto aplica aunque el trabajo sea de bajo riesgo.

## Secret sanitizer

El sanitizer redacta patrones peligrosos antes de cualquier preview:

- API keys tipo prefijo comun;
- valores tipo Supabase secret;
- access token;
- refresh token;
- client secret;
- OpenAI API key;
- Codex API key;
- authorization code;
- bearer token;
- contenido `.env`;
- tokens largos sospechosos.

Si detecta cualquier patron, el plan queda bloqueado con:

`BLOCKED_SECRET_DETECTED`

## Production/main blockers

Un work order que intente tocar `main`, Production o rutas equivalentes debe quedar bloqueado. Este loop no escribe en main, no escribe en Production y no puede aprobar una ejecucion real.

## Branch/PR/merge automation blockers

La capa fuerza:

- `canCreateBranch: false`
- `canCreatePr: false`
- `canMerge: false`

El gate puede simular un plan, pero no crea ramas, no abre PRs y no hace merge.

## External network blockers

El gate fuerza:

- no Codex API real;
- no OpenAI API;
- no GitHub API desde el runtime de IMNOVA;
- no external network call.

Las validaciones locales de desarrollo pueden usar git/GitHub para entregar el loop, pero el producto implementado no agrega llamadas externas.

## Acciones prohibidas

- `CALL_CODEX_API`
- `CALL_OPENAI_API`
- `EXECUTE_CODE_CHANGE`
- `CREATE_BRANCH`
- `CREATE_PR`
- `MERGE_PR`
- `TOUCH_PRODUCTION`
- `WRITE_MAIN`
- `WRITE_STAGING_DB`
- `COMMIT_SECRET`
- `MODIFY_ENV`
- `RUN_EXTERNAL_NETWORK_CALL`

## Que se simula en este loop

El fixture simula cuatro work orders provenientes de 149CODEX-A:

1. Filtros del Marketplace OS por bloqueados, watchlist y rechazados.
2. Panel detalle para DM0628N.
3. Preview de WhatsApp Remote Control para decisiones Amazon.
4. Explicacion de productos con ROI positivo pero bloqueados para listing.

El gate produce:

- un plan aprobado solo para preview local;
- un plan bloqueado por falta de aprobacion humana;
- un plan bloqueado por riesgo alto;
- un plan bloqueado por secret pattern detectado.

## Como esto alimenta 149CODEX-C

149CODEX-C podra usar este modelo como base para un piloto de ejecucion aprobada. Ese futuro loop debera resolver credenciales, auditoria, permisos, logs, aprobacion humana persistente y controles de rollback.

## Por que ahora volvemos a 149G

El objetivo principal del Marketplace Seller OS sigue siendo vender productos ganadores en Amazon sin perder eBay. Con 149CODEX-A y 149CODEX-B queda definida la ruta de automejora segura. Ahora la ruta comercial puede continuar con:

`149G - Amazon Listing Package Builder`

## Safety boundaries

- No Production touch.
- No main touch.
- No Staging DB write.
- No Codex API real.
- No OpenAI API.
- No external network call.
- No automatic code changes.
- No branch automation.
- No PR automation.
- No merge automation.
- No token storage.
- No Amazon API/SP-API.
- No Seller Central write.
- No ASIN/listing creation.
- No scraper.
- No publication.
- No WhatsApp real.
- No secrets, tokens, `.env`, dumps, backups o imagenes.

## Definition of Done

- Fixture sanitizado creado.
- Modulo puro creado.
- UI read-only creada en `/admin/self-improvement/codex-gate`.
- CLI dry-run imprime resumen numerico.
- Tests validan bloqueos, sanitizer, decisiones y ausencia de integraciones reales.
- Build TypeScript pasa.
- Regresiones 149CODEX-A, Marketplace OS, Amazon 149A-149F y eBay/Luna existentes pasan.
- Git status queda limpio.

## Human explanation rule

Todo reporte debe explicar:

- que se hizo;
- por que se hizo;
- que problema resuelve;
- que protegio;
- que cambio realmente;
- que no se toco;
- como prepara una futura conexion Codex API sin ejecutarla;
- como mantiene el control humano;
- que sigue.

## Next step

`149G - Amazon Listing Package Builder`

## Future

`149CODEX-C - Approved Codex Execution Pilot`
