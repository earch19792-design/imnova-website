# EBAY-MOBILE-REVIEW-PINNED-CANDIDATE-CONTINUITY V1

## Objetivo

Mantener visible un candidato ya revisado aunque un scan posterior cambie el Top
5. La página separa “Top 5 actual” de “En revisión / Pinned Candidates” y
preserva las confirmaciones humanas del iDesign Paper Towel Holder.

## Continuidad y dedupe

Los pinned se comparan contra Radar por product ID, supplier product ID, handle
y nombre normalizado. Si vuelven al Top 5 no se duplican: la tarjeta actual
muestra `PINNED_AND_IN_CURRENT_TOP5` y conserva el contexto humano. Si no están,
permanecen en la sección En revisión con `NEEDS_RADAR_RECHECK`.

## Acciones locales

Recheck puede devolver la ruta a `NEED_EBAY_MARKET_VALIDATION` cuando existe una
referencia conocida. Continuar validación exige producto, stock positivo, precio
Luna e imagen confirmados. Marcar no disponible produce `STOCK_HOLD`; Hold produce
`EBAY-RESUME-HOLD`; Unpin solo retira el registro del navegador y nunca borra
Radar ni historial.

## Persistencia y guardas

`BROWSER_STATE_OR_LOCAL_STORAGE` guarda datos operativos no sensibles. No es un
registro oficial. Precio eBay, demanda, margen, Category ID y riesgos siguen
bloqueando B2-RUN. `canProceedToB2RunPreflight` y `canPublish` son false.

## Safety

Sin Production/main, DB/Supabase writes, eBay API/write, draft, offer, listing,
publicación, tokens, secretos, `.env`, imágenes, scraper, Amazon, WhatsApp real
u OpenAI/Codex API.
