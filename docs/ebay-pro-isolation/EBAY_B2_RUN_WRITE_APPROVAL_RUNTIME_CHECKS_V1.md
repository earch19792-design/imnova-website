# EBAY-RESUME-B2-RUN — Write Approval Runtime Checks V1

## Why this gate exists

B2-RUN Preflight preparó los payload previews del producto móvil aprobado, pero dejó ocho dependencias abiertas. Esta compuerta existe para resolverlas de manera modelada y exigir una aprobación humana exacta antes de permitir que un loop futuro siquiera intente un write controlado.

Resolver esta checklist no publica, no crea un listing activo y no ejecuta ninguna API eBay.

## The eight runtime checks

1. Category ID runtime confirmation.
2. Fulfillment policy runtime confirmation.
3. Return policy runtime confirmation.
4. Payment policy runtime confirmation.
5. Final stock review.
6. Final price review.
7. Final image review.
8. Final human write approval.

## Category runtime confirmation

Confirma de forma local que la señal `Cable Ties & Organizers` debe resolverse a un categoryId antes del write futuro. La simulación usa un identificador sanitizado, nunca un ID inventado enviado a eBay.

## Seller policy runtime confirmation

Fulfillment, return y payment policy deben existir y corresponder a la cuenta real. Este loop solo modela su readiness. Los IDs reales seguirán siendo responsabilidad del runner futuro con OAuth y controles explícitos.

## Final stock review

Las 20 unidades son una observación humana previa. La compuerta exige una cantidad final de al menos uno. Stock cero, negativo o inválido bloquea la ruta. Esto no convierte la observación en inventario garantizado.

## Final price review

El precio USD 12.99 proviene de mercado observado. Debe confirmarse nuevamente antes del write porque competencia, costos y margen pueden cambiar.

## Final image review

Confirma que la revisión humana móvil existe y que no hubo copia, descarga o generación. Una imagen propia o autorizada sigue siendo necesaria para cualquier publicación posterior.

## Final human write approval

La frase exacta es:

`FINAL_WRITE_APPROVED_FOR_UNPUBLISHED_DRAFT_ONLY`

Comparación, mayúsculas y espacios son estrictos. La frase autoriza únicamente que el siguiente loop prepare un write controlado de draft u offer no publicado. No permite un listing activo ni publicación.

## READY_FOR_CONTROLLED_B2_WRITE_DRAFT_ONLY

Este estado significa que los ocho checks pasaron y que el siguiente loop puede implementar una ejecución separada, con credenciales locales, OAuth, allowlist de endpoints, payload final revisado, idempotencia y bloqueo absoluto de publicación.

El estado no ejecuta write en este loop. `canExecuteEbayWriteInThisLoop`, `canCreateDraftInThisLoop` y `canPublish` permanecen false.

## Connection to later loops

El siguiente loop deberá ser un runner controlado limitado a unpublished draft/offer. LOOP 150 seguirá siendo la primera aprobación humana independiente para activar/publicar. LOOP 152 aplicará stock guard, price guard, margin guard y monitor después de listar.

## Safety boundaries

- Sin Production, main, Staging DB o Supabase writes.
- Sin eBay API, OAuth, token exchange o tokens.
- Sin draft, listing, offer o publicación real.
- Sin generación, descarga o copia de imágenes.
- Sin scraper, Amazon, OpenAI/Codex API real, WhatsApp o SMS real.
- Sin secretos, `.env`, dumps, imágenes nuevas o dirección completa del warehouse.
- Sin catálogo real ni consulta al almacén.

## Definition of Done

- Checklist de ocho checks construida.
- Default bloquea en category.
- Simulación runtime confirma siete checks.
- Solo la frase exacta completa el octavo.
- Stock cero bloquea.
- Readiness solo habilita el siguiente loop.
- Write y publicación permanecen imposibles.
- Tests, regresión y auditoría pasan.

## Human explanation rule

El reporte debe explicar que “ready” significa listo para otro runner controlado, no que se haya escrito o publicado nada. Debe distinguir checks modelados, datos observados y autorización humana final limitada.
