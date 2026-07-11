# Seller Runtime Data Resolver RUN V1

## Purpose

Este RUN confirma localmente datos runtime antes del Controlled Write RUN. Permanece separado porque resolver readiness no equivale a escribir en eBay. No contiene API, OAuth, token exchange ni acciones write.

## Local runtime confirmation

La frase exacta `LOCAL_RUNTIME_DATA_CONFIRMED_NO_EBAY_WRITE` habilita únicamente el modelo local. Puede confirmar category ID, fulfillment/return/payment policies, stock, precio, imagen o bypass unpublished-only, entorno SANDBOX y presencia booleana del token. No debe inventarse ningún ID: la confirmación representa datos aportados y revisados fuera del módulo.

Un flujo read-only futuro puede aportar category y policies con `READ_ONLY_RUNTIME_CHECK_APPROVED_NO_WRITE`, pero no se ejecuta aquí.

## Token handling

El token se reduce a un booleano. No se imprime, guarda, intercambia ni incluye en reportes. Token presente no significa token válido.

## Readiness

`READY_FOR_CONTROLLED_DRAFT_ONLY_REAL_RUN` exige frase exacta, 8/8 datos y token booleano. Incluso entonces `canExecuteEbayWrite` y `canPublish` son false. Faltantes producen rutas específicas para categoría, policies, stock, precio, imagen, entorno o token.

## Connections

El resultado alimentará `EBAY-RESUME-B2-RUN-CONTROLLED-WRITE-DRAFT-ONLY-RUN`. LOOP 150 revisará cualquier draft futuro antes de publicación. LOOP 152 solo operará después de un listing activo autorizado.

## Safety boundaries

- Sin Production, main, Staging DB o Supabase writes.
- Sin eBay API/write, OAuth o token exchange.
- Sin draft, inventory item, offer, listing o publicación.
- `publishOffer` y acciones write prohibidas.
- Sin imágenes generadas/descargadas/copiadas, scraper, Amazon, OpenAI/Codex, WhatsApp o SMS real.
- Sin secretos, `.env`, dumps, imágenes o dirección completa Luna.

## Definition of Done

Default seguro; 8/8 solo con confirmación completa; faltantes bloqueados; token boolean-only; runner sin runtime read; regresión y auditoría verdes.

## Human explanation rule

Explicar siempre que readiness no es write y que ninguna publicación fue autorizada ni ejecutada.
