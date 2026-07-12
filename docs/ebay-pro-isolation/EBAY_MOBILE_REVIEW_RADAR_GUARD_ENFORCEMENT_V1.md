# EBAY-MOBILE-REVIEW-RADAR-GUARD-ENFORCEMENT V1

## Objetivo

Impedir que una confirmación local de Mobile Review omita guardas pendientes del
Market Radar real. El botón de aprobación evalúa Radar antes de llegar al
reducer del MVP; si existe un bloqueo, no modifica el estado de preflight.

## Prioridad

El orden operativo es `STOCK_HOLD`, confirmación o reconfirmación de stock,
identidad y precio del proveedor, precio eBay, margen, Category ID, demanda,
imagen, revisión móvil y finalmente readiness de preflight. Así, stock unknown,
missing o `availability_only` siempre produce `NEED_STOCK_CONFIRMATION` antes de
considerar precio eBay, margen o categoría.

## Guardas obligatorias

Snapshot, variant, SKU, stock, freshness, precio Luna/eBay, margen, categoría,
demanda e imagen deben estar completos. Risk hold, out of stock y stale source
bloquean con prioridad máxima. Las confirmaciones del navegador no sustituyen
ninguna evidencia del Radar.

La UI muestra `pendingGuards`, la razón primaria y el mensaje humano de bloqueo.
`DEMO_FIXTURE_ONLY` y `NO_REAL_RADAR_DATA_AVAILABLE` nunca avanzan.

## Score provisional

Si los cinco scores coinciden, el resultado declara
`PROVISIONAL_OR_UNDIFFERENTIATED`, muestra una advertencia y exige desambiguación.
El empate no se presenta como ranking definitivo.

## Safety

Solo evaluación local/read-only. Sin Production/main, Staging DB o Supabase
writes; sin eBay API/write, draft, offer, listing, publicación, WhatsApp real,
tokens, secretos, `.env`, imágenes, scraper, Amazon u OpenAI/Codex API.
`canPublish` permanece false.

## Definition of Done

- Las rutas respetan la prioridad documentada.
- Un intento de aprobación con cualquier guarda no llega al reducer.
- La lista de guardas es visible y copiable.
- Empates de score generan warning.
- Fuentes demo/vacía permanecen bloqueadas.
- TypeScript, tests y regresiones pasan.
