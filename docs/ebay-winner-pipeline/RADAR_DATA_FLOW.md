# RADAR_DATA_FLOW â€” Luna Portex â†’ Radar IMNOVA â†’ Supabase â†’ WhatsApp

## Flujo actual localizado

```mermaid
flowchart TD
  A[Admin UI: MarketRadarPanel] -->|POST action sync_lunaportex| B[/api/admin/market-radar]
  B --> C[validateAdminApiRequest]
  C --> D[getSupabaseAdminClient]
  D --> E[runLunaPortexMarketRadarSync]
  E --> F[Luna Portex Shopify JSON collections]
  F --> G[Normalize products, variants, images, collections]
  G --> H[market_radar_products upsert]
  H --> I[market_radar_snapshots insert]
  I --> J[market_radar_events upsert by idempotency_key]
  J --> K[market_radar_scores upsert]
  K --> L[market_radar_latest_products view]
  L --> M[Dashboard response]
  M --> A
  A -->|POST action notify_ebay_opportunities| B
  B --> N[buildMarketRadarWhatsAppAnalysis]
  N --> O[sendWhatsAppUpdate]
  O --> P[WhatsApp Cloud API]
```

## Paso a paso

1. El panel admin carga el dashboard con `GET /api/admin/market-radar` usando Bearer token.
2. Para sincronizar, el panel envÃ­a `POST /api/admin/market-radar` con `action: "sync_lunaportex"`.
3. La ruta valida admin con `validateAdminApiRequest`.
4. La ruta crea cliente Supabase admin con service-role.
5. `runLunaPortexMarketRadarSync` asegura la fuente `lunaportex` y marca `last_run_at`.
6. Se descargan productos por colecciÃ³n desde Luna Portex.
7. Se deduplican productos por `supplier_product_id` y se agregan colecciones observadas.
8. Si existe `LUNAPORTEX_AUTH_COOKIE`, se hidrata inventario por producto desde `/products/{handle}.js`.
9. Se upsertean productos por `(source_id, supplier_product_id)`.
10. Se leen snapshots previos desde `market_radar_latest_snapshots`.
11. Se crean snapshots actuales por variante.
12. Se crean eventos comparando snapshot previo vs actual: nuevo producto, stock, precio, colecciÃ³n y descuento.
13. Los eventos se upsertean con `idempotency_key` Ãºnico e `ignoreDuplicates`.
14. Se recalculan scores por producto usando eventos de 7 dÃ­as y snapshot actual.
15. Se marca `last_success_at` o `last_error`.
16. Para notificar, la misma ruta evalÃºa productos con `opportunity_score >= 70` y `available === true`, toma mÃ¡ximo 3 y envÃ­a WhatsApp.

## Formato real de producto detectado

El formato normalizado disponible para candidatos sale principalmente de la vista `market_radar_latest_products`, compuesta por `market_radar_products`, Ãºltimo snapshot y `market_radar_scores`.

| Campo solicitado | Campo actual | Notas |
|---|---|---|
| SKU | `sku` | Viene del variant Shopify; puede ser null. |
| tÃ­tulo | `title` | Requerido en producto Radar; fallback â€œProducto sin tituloâ€. |
| URL | `product_url` | Construida como `https://lunaportex.com/products/{handle}`. |
| costo | `price` | Es precio/costo observado del proveedor, no costo landed. |
| stock | `available`, `inventory_quantity` | `inventory_quantity` puede ser null si Luna Portex no lo expone o no hay cookie. |
| marca | `vendor` | Puede ser null. |
| UPC/GTIN/MPN | No normalizado | Solo podrÃ­a existir dentro de `raw.product` o tags/body si Luna Portex lo incluye. Requiere enriquecimiento. |
| peso | No normalizado | Shopify JSON pÃºblico revisado por tipos no modela weight. Requiere enriquecimiento. |
| dimensiones | No disponible | Requiere enriquecimiento manual/API externa. |
| imÃ¡genes | `featured_image_url`, `image_urls` | Deduplicadas desde `product.image.src` e `images[].src`. |
| fecha observaciÃ³n | `last_captured_at`, `last_seen_at`, `first_seen_at` | Snapshot y producto. |
| historial stock | `market_radar_snapshots`, `market_radar_events` | Snapshots por variante + eventos restock/out_of_stock. |
| colecciones | `collections` | Colecciones de Luna Portex observadas en snapshot. |
| descuento | `compare_at_price`, `discount_percent` | Calculado si compare_at > price. |
| seÃ±ales | `opportunity_score`, scores parciales y conteos 24h/7d | Usadas por dashboard y WhatsApp. |
| raw | `market_radar_snapshots.raw` | Contiene `product` y `variant` originales. |

## Observaciones de idempotencia actuales

- Productos: idempotentes por `source_id,supplier_product_id`.
- Eventos: idempotentes por `idempotency_key`.
- Scores: idempotentes por `product_id`.
- Snapshots: no tienen clave idempotente; cada sync inserta nueva observaciÃ³n. Esto es correcto para histÃ³rico, pero un reintento del mismo minuto puede duplicar snapshots equivalentes.

## Punto de extensiÃ³n recomendado

Crear el eBay Winner Pipeline como consumidor aguas abajo de `market_radar_latest_products` y `market_radar_events`, sin modificar la sincronizaciÃ³n Luna Portex. El pipeline debe crear su propia tabla de candidatos/drafts con referencias a `market_radar_products.product_id` y `supplier_variant_id` para mantener trazabilidad y reversibilidad.
