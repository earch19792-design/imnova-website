# EBAY-RESUME-B2-RUN — Controlled Write Draft Only RUN V1

## What this RUN is

Este loop separa el comando operacional futuro del framework de diseño ya integrado. El framework definió payloads y seguros; el RUN valida nuevamente aprobación, inputs y checks antes de permitir siquiera la habilitación manual de una ejecución draft/unpublished-only.

La implementación local permanece deshabilitada mediante `LOCAL_REAL_WRITE_EXECUTION_DISABLED`. No contiene cliente de red ni endpoint eBay y no ejecuta writes.

## Exact RUN approval

El RUN real requiere exactamente:

`RUN_CONTROLLED_DRAFT_ONLY_NOW_NO_PUBLICATION`

También requiere la confirmación interactiva exacta:

`CREATE_UNPUBLISHED_DRAFT_ONLY_NO_PUBLICATION`

Estas frases no autorizan publicación, listing activo ni una acción de publicación de offer. `canPublish` permanece false.

## Allowed actions

La allowlist contiene únicamente:

- `createOrReplaceInventoryItem`
- `createOfferUnpublishedOnly`

Ambas representan acciones futuras y no se ejecutan en esta implementación.

## Forbidden actions

Se prohíben permanentemente `publishOffer`, `publish`, `createActiveListing`, `reviseActiveListing` y `bulkPublish`. La guardia manda cualquier intención de publicación a `EBAY-RESUME-HOLD`. No hay endpoint publish en el módulo, dry-run o runner.

## Runtime inputs

El futuro RUN necesita entorno SANDBOX o Production explícitamente autorizado, token entregado solo en memoria, marketplace `EBAY_US`, aprobación exacta, run ID único e imagen autorizada o bypass limitado al estado no publicado. El runner solo comprueba presencia del token: no lo imprime, serializa ni guarda.

SANDBOX es la preferencia predeterminada. Production requiere una autorización independiente y explícita.

## Runtime checks

Antes de habilitar el RUN deben confirmarse category ID, fulfillment policy, return policy, payment policy, stock positivo, precio positivo, imagen autorizada o bypass unpublished-only y confirmación interactiva exacta.

- Sin token: `NEED_RUNTIME_EBAY_ACCESS_TOKEN`.
- Sin categoría, policies, stock, precio, imagen o confirmación: `NEED_RUNTIME_GATES`.
- Stock cero o precio inválido: gate bloqueado.
- Intención publish: `EBAY-RESUME-HOLD`.

## READY_FOR_REAL_RUN_COMMAND

Este estado solo aparece en simulación cuando inputs y checks pasan. Significa que la forma del comando futuro es válida; no significa que se haya usado API o creado un recurso.

## READY_FOR_MANUAL_REAL_RUN_ENABLEMENT

Este estado aparece cuando el runner local observa los gates de entorno permitidos pero continúa bloqueado por diseño. Una implementación posterior deberá añadir de forma separada el cliente eBay, confirmación interactiva real, idempotencia, sanitización y allowlist técnica, con nueva autorización del usuario.

## Sanitized result

El plan permite reportar únicamente run ID, estado del inventory item, estado del offer no publicado, ID de offer enmascarado y ruta siguiente. Respuestas crudas, token, buyer data y secretos quedan fuera del resultado.

## LOOP 150 and LOOP 152

Si un RUN futuro crea un inventory item y offer no publicado, LOOP 150 debe revisar y aprobar humanamente ese resultado antes de cualquier publicación. LOOP 152 solo entra después de que exista, en otro loop, un listing activo autorizado; entonces aplicará stock, price y margin guards y monitoreo.

## Safety boundaries

- Sin writes en main, Production deployment, Staging DB o Supabase.
- Sin API eBay, OAuth o write durante esta implementación local.
- Sin persistencia o impresión de tokens.
- Sin draft, inventory item, offer, listing o publicación real.
- Sin generación, descarga o copia de imágenes.
- Sin scraper, Amazon, eBay LOOP 149 antiguo, OpenAI/Codex API real, WhatsApp o SMS real.
- Sin secretos, `.env`, dumps, imágenes nuevas o dirección completa de Luna Portex.

## Definition of Done

- Modo default `SAFE_NO_WRITE`.
- Dry-run default bloqueado.
- Simulación aprobada construye ambos payloads sin red.
- Falta de token bloqueada explícitamente.
- Intento publish deriva a HOLD.
- Runner con flag pero sin entorno deriva a `NEED_RUNTIME_GATES`.
- Runner con gates de entorno permanece localmente deshabilitado.
- Tests, regresión y auditoría pasan.

## Human explanation rule

El reporte debe explicar que el RUN quedó modelado y validado, no ejecutado. Debe distinguir readiness de write real y recordar que un offer unpublished no es un listing live ni una publicación.
