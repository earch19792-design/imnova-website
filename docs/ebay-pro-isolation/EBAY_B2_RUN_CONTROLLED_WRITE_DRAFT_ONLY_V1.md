# EBAY-RESUME-B2-RUN — Controlled Write Draft Only V1

## Exact approval scope

`FINAL_WRITE_APPROVED_FOR_UNPUBLISHED_DRAFT_ONLY` confirma que el usuario permite diseñar la siguiente compuerta controlada. No autoriza publicación activa, listing live ni una acción de publicación de offer. `canPublish` permanece siempre en false.

## What controlled draft/unpublished-only means

Un runner futuro, separado y nuevamente aprobado, podría crear o reemplazar un inventory item y crear un offer que permanezca no publicado. Esta implementación solo construye payload previews y valida readiness; no llama eBay, no intercambia tokens y no crea ningún recurso.

## Permanent prohibition

La allowlist futura se limita a `createOrReplaceInventoryItem` y `createOfferUnpublishedOnly`. Las acciones `publishOffer`, `createActiveListing`, `reviseActiveListing`, `publish` y `bulkPublish` están expresamente prohibidas. No existe endpoint de publicación en el módulo ni en el runner.

## Execution modes

- `SAFE_NO_WRITE`: modo default; no solicita ni ejecuta write.
- Dry-run aprobado: construye payloads y simula todas las compuertas en memoria.
- Controlled execution preparado: representa readiness para un RUN futuro, pero sigue sin red ni write en esta implementación.

## Hard gates before any future write

1. Frase humana exacta.
2. Ocho runtime checks confirmados.
3. Flag explícito de ejecución controlada.
4. Aprobación exacta en el entorno local.
5. Confirmación interactiva exacta `CREATE_UNPUBLISHED_DRAFT_ONLY_NO_PUBLICATION`.
6. Guardia que excluye endpoints de publicación.
7. Imagen propia o autorizada.
8. Seller policies confirmadas en runtime.
9. Category ID confirmado en runtime.
10. Stock final positivo.
11. Precio final positivo.

La presencia de algunas compuertas nunca compensa la ausencia de otra.

## Payload previews

El inventory item preview usa un SKU draft-only, título, condición y cantidad preview. El offer preview usa precio observado, marketplace, categoría y políticas todavía requeridas en runtime, y exige estado no publicado. Ningún preview contiene una llamada ejecutable.

## Data sources and guards

- Título, estructura y precio: `EBAY_MARKET_OBSERVED`.
- Stock observado: `HUMAN_MOBILE_CONFIRMED`; requiere confirmación runtime antes de write.
- Supplier cost: `UNKNOWN_FROM_SUPPLIER` con `LOW_CONFIDENCE_GUARD`.
- Imagen: debe ser propia o autorizada; las imágenes eBay son referencia estructural y no pueden copiarse ni descargarse.

## Accidental publication protection

La guardia rechaza cualquier solicitud marcada como publicación y envía la ruta a `EBAY-RESUME-HOLD`. Todas las salidas mantienen `publicationExecuted`, `listingCreated` y `canPublish` en false. La lista de acciones futuras permitidas se valida para excluir términos de publicación, listing activo o revisión de listing activo.

## What the next real RUN needs

El RUN real futuro necesitará una autorización independiente, runtime checks reales, credenciales locales no impresas, OAuth controlado, identificador idempotente, category ID y policies reales, stock/precio finales, URL de imagen autorizada, confirmación interactiva y una allowlist técnica sin publicación. Este documento no concede esa ejecución.

## LOOP 150 and LOOP 152

Si un RUN futuro llegara a crear un inventory item y offer no publicado, LOOP 150 realizará la revisión humana separada antes de cualquier publicación. Solo después de existir un listing activo, LOOP 152 podrá aplicar stock, price y margin guards y monitoreo continuo.

## Safety boundaries

- Sin writes en Production, main, Staging DB o Supabase.
- Sin eBay API, OAuth, token exchange o persistencia/impresión de tokens durante esta implementación.
- Sin draft, inventory item, offer, listing o publicación real.
- Sin generación, descarga o copia de imágenes.
- Sin scraper, Amazon, eBay LOOP 149 antiguo, OpenAI/Codex API real, WhatsApp o SMS real.
- Sin secretos, `.env`, dumps, imágenes nuevas o dirección completa de Luna Portex.

## Definition of Done

- Modo default seguro probado.
- Payloads preview de inventory item y offer no publicado construidos.
- Simulación aprobada deja listo un RUN futuro sin ejecutar write.
- Solicitud de publicación bloqueada con HOLD.
- Todas las compuertas se validan de forma independiente.
- Runner local permanece deliberadamente deshabilitado para ejecución.
- Tests, regresión y auditoría pasan con Git limpio.

## Human explanation rule

El reporte debe distinguir claramente “ready for a future controlled runner” de “write executed”. Debe afirmar que la aprobación recibida no publicó nada y que cualquier draft/offer real requerirá un nuevo RUN explícito con todos los seguros.
