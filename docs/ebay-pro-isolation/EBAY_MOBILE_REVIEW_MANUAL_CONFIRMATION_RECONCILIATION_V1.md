# EBAY-MOBILE-REVIEW-MANUAL-CONFIRMATION-RECONCILIATION V1

## Objetivo

Reconciliar evidencia humana capturada desde Mobile Review con las guardas del
Radar sin convertir una confirmación browser-only en aprobación oficial.

## Evidencia reconciliada

- Stock confirmado con cantidad positiva resuelve `stockUnknown` y
  `stockAvailabilityOnly`; la fuente pasa a `HUMAN_MOBILE_CONFIRMED`.
- Cantidad igual o menor a dos produce `STOCK_LIMITED_WARNING`, no un bloqueo.
- Imagen confirmada resuelve `missingImageValidation` y registra fuente humana.
- `CONFIRM_LUNA_PRICE` con valor positivo resuelve `missingLunaPrice`.
- Same product confirmado registra `productMatchSource` humano.

No se resuelven automáticamente snapshot, variant, SKU, precio eBay, demanda,
margen ni Category ID. Cuando identidad/stock/proveedor ya están resueltos y
queda evidencia comercial eBay, la ruta es `NEED_EBAY_MARKET_VALIDATION`.

## Límites

Las confirmaciones viven en `BROWSER_STATE_ONLY`, se pierden al recargar y no
son un registro oficial. `canProceedToB2RunPreflight` y `canPublish` permanecen
false mientras falten precio eBay, demanda, margen o categoría.

Sin Production/main, Staging DB o Supabase writes; sin eBay API/write, draft,
offer, listing, publicación, tokens, secretos, `.env`, imágenes, scraper,
Amazon, WhatsApp real u OpenAI/Codex API.
