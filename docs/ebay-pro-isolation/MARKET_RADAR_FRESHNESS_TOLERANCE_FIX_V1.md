# MARKET-RADAR-FRESHNESS-TOLERANCE-FIX V1

## Problema

El cálculo anterior aplicaba un mínimo de un scan ausente a cualquier diferencia
positiva entre `last_seen_at` y `last_success_at`. El desfase normal de escritura
de milisegundos o segundos convertía productos del mismo scan en
`not_observed_latest_scan` y luego `STOCK_HOLD`.

## Corrección

Freshness cuenta únicamente intervalos completos de polling mediante
`floor(delta / pollInterval)`. Dentro del mismo intervalo el producto permanece
`observed`; al completar un intervalo pasa a `not_observed_latest_scan`, y al
completar dos pasa a `stale_missing_from_source`. Si falta `last_success_at`, se
usa el fallback seguro `observed` en lugar de inventar ausencia.

## Guardas independientes

La corrección temporal no crea snapshots, SKU, variant, stock, precio Luna/eBay,
margen, categoría, demanda ni imagen. Mobile Review puede volver a recibir
candidatos frescos, pero esas guardas siguen determinando la siguiente ruta y
mantienen B2-RUN bloqueado.

## Safety

Transformación pura read-only. Sin Production/main, DB/Supabase writes, eBay
API/write, draft, offer, listing, publicación, tokens, secretos, imágenes,
scraper, Amazon u OpenAI/Codex API. `canPublish` permanece false aguas abajo.
