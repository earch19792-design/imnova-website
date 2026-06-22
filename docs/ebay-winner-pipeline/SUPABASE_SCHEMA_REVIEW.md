# SUPABASE_SCHEMA_REVIEW â€” ReutilizaciÃ³n y brechas

## Tablas/vistas Radar existentes reutilizables

| Objeto | ReutilizaciÃ³n para eBay Winner Pipeline |
|---|---|
| `market_radar_sources` | Fuente `lunaportex`, control de health (`last_run_at`, `last_success_at`, `last_error`). |
| `market_radar_products` | Producto proveedor/base candidato; contiene title, vendor, URL, imÃ¡genes, tags y metadata. |
| `market_radar_snapshots` | Observaciones histÃ³ricas por variante: precio, disponibilidad, inventario, colecciones, raw. |
| `market_radar_events` | SeÃ±ales de cambio con idempotencia; Ãºtil para rotaciÃ³n, restocks y auditorÃ­a. |
| `market_radar_scores` | Score actual del Radar; input para Winner Score pero no sustituto. |
| `market_radar_latest_snapshots` | Vista de Ãºltimo snapshot por producto-variante. |
| `market_radar_latest_products` | Vista principal para seleccionar candidatos. |

## Tablas existentes de negocio potencialmente reutilizables

La migraciÃ³n de auditorÃ­a remota lista objetos existentes fuera del Radar: `products`, `product_states`, `product_images`, nichos/subnichos, comunidad, preferencias, referidos, puntos, ideas y transparencia. Para eBay Winner Pipeline no se recomienda escribir en `products` hasta que un draft sea aprobado o publicado en un flujo separado, porque `products` parece representar catÃ¡logo/store pÃºblico de IMNOVA y no candidatos proveedor/eBay.

## Columnas existentes Ãºtiles

### Producto base

- `market_radar_products.id`
- `source_id`
- `supplier_product_id`
- `handle`
- `title`
- `vendor`
- `product_type`
- `tags`
- `body_html`
- `product_url`
- `featured_image_url`
- `image_urls`
- `first_seen_at`
- `last_seen_at`
- `last_snapshot_at`
- `metadata`

### Snapshot/variante

- `supplier_variant_id`
- `variant_title`
- `sku`
- `price`
- `compare_at_price`
- `available`
- `inventory_quantity`
- `collections`
- `discount_percent`
- `raw`
- `captured_at`

### Eventos y scores

- `event_type`, `old_value`, `new_value`, `event_strength`, `idempotency_key`, `created_at`
- `opportunity_score`, `rotation_score`, `price_score`, `stock_score`, `discount_score`, `collection_score`
- `event_count_24h`, `event_count_7d`, `restock_count_7d`, `out_of_stock_count_7d`, `price_change_count_7d`, `last_event_at`

## Tablas nuevas propuestas

> Estas son propuestas de migraciÃ³n futura. No se implementaron en este commit.

### 1. `ebay_winner_candidates`

Registro idempotente de candidato por producto-variante-fuente.

Campos clave:

- `id uuid primary key default gen_random_uuid()`
- `source_id uuid not null references market_radar_sources(id)`
- `market_radar_product_id uuid not null references market_radar_products(id)`
- `supplier_variant_id text not null`
- `current_snapshot_id uuid null references market_radar_snapshots(id)`
- `candidate_key text not null unique` â€” hash estable `source_id:product_id:variant_id`
- `state text not null default 'DETECTED'`
- `winner_score numeric(6,2) null`
- `winner_score_breakdown jsonb not null default '{}'::jsonb`
- `detected_at timestamptz not null default now()`
- `last_evaluated_at timestamptz null`
- `blocked_reason text null`
- `needs_data jsonb not null default '[]'::jsonb`
- `created_at`, `updated_at`

### 2. `ebay_product_validations`

ValidaciÃ³n auditable antes de draft.

Campos:

- `candidate_id uuid references ebay_winner_candidates(id)`
- `validation_version text not null`
- `required_fields jsonb not null`
- `missing_fields jsonb not null default '[]'::jsonb`
- `validation_status text not null` (`passed`, `needs_data`, `blocked`)
- `validated_at timestamptz not null default now()`
- `validator text not null default 'system'`

### 3. `ebay_compliance_checks`

Cumplimiento eBay/marca/categorÃ­a.

Campos:

- `candidate_id uuid references ebay_winner_candidates(id)`
- `brand_status text null`
- `restricted_category_status text null`
- `vero_risk_status text null`
- `hazmat_status text null`
- `image_policy_status text null`
- `overall_status text not null`
- `findings jsonb not null default '{}'::jsonb`
- `checked_at timestamptz not null default now()`

### 4. `ebay_profit_calculations`

CÃ¡lculo versionado de margen.

Campos:

- `candidate_id uuid references ebay_winner_candidates(id)`
- `input_cost numeric(12,2) null`
- `shipping_cost numeric(12,2) null`
- `marketplace_fee numeric(12,2) null`
- `payment_fee numeric(12,2) null`
- `target_price numeric(12,2) null`
- `estimated_profit numeric(12,2) null`
- `estimated_margin_percent numeric(6,2) null`
- `assumptions jsonb not null default '{}'::jsonb`
- `calculation_version text not null`
- `calculated_at timestamptz not null default now()`

### 5. `ebay_approval_decisions`

Decisiones por WhatsApp/humano.

Campos:

- `candidate_id uuid references ebay_winner_candidates(id)`
- `decision text not null` (`approve`, `reject`, `pause`, `request_data`)
- `decision_channel text not null default 'whatsapp'`
- `message_id text null`
- `decision_payload jsonb not null default '{}'::jsonb`
- `decided_by text null`
- `decided_at timestamptz not null default now()`
- `idempotency_key text not null unique`

### 6. `ebay_listing_drafts`

Borrador local de listing eBay, sin publicaciÃ³n real.

Campos:

- `candidate_id uuid references ebay_winner_candidates(id)`
- `draft_status text not null default 'created'`
- `title text not null`
- `description_html text null`
- `category_id text null`
- `condition_id text null`
- `price numeric(12,2) null`
- `quantity integer null`
- `sku text null`
- `gtin text null`
- `mpn text null`
- `brand text null`
- `aspects jsonb not null default '{}'::jsonb`
- `image_urls text[] not null default '{}'::text[]`
- `shipping_policy jsonb not null default '{}'::jsonb`
- `return_policy jsonb not null default '{}'::jsonb`
- `payment_policy jsonb not null default '{}'::jsonb`
- `ebay_draft_id text null` â€” reservado; debe permanecer null hasta conector real/sandbox.
- `created_at`, `updated_at`

### 7. `ebay_winner_audit_log`

BitÃ¡cora append-only.

Campos:

- `id uuid primary key default gen_random_uuid()`
- `candidate_id uuid null references ebay_winner_candidates(id)`
- `event_type text not null`
- `from_state text null`
- `to_state text null`
- `actor text not null default 'system'`
- `idempotency_key text null unique`
- `payload jsonb not null default '{}'::jsonb`
- `created_at timestamptz not null default now()`

## Migraciones propuestas â€” principios

- Crear tablas nuevas bajo prefijo `ebay_` o `ebay_winner_`.
- No alterar ni renombrar tablas Radar existentes.
- Referenciar Radar mediante FKs; no copiar todo salvo snapshot de draft necesario para auditorÃ­a.
- Usar constraints `check` para estados.
- Activar RLS y polÃ­ticas admin-only al inicio.
- Agregar Ã­ndices por `state`, `candidate_key`, `market_radar_product_id`, `created_at` y `winner_score`.
- DiseÃ±ar rollbacks con `drop table if exists` en orden inverso solo para tablas nuevas.

## MigraciÃ³n propuesta â€” esqueleto no ejecutado

> Nombre sugerido futuro: `supabase/migrations/YYYYMMDDHHMM_create_ebay_winner_pipeline.sql`. No se creÃ³ ni ejecutÃ³ esta migraciÃ³n en la auditorÃ­a para cumplir la regla de no implementar todavÃ­a.

```sql
create table if not exists public.ebay_winner_candidates (...);
create table if not exists public.ebay_product_validations (...);
create table if not exists public.ebay_compliance_checks (...);
create table if not exists public.ebay_profit_calculations (...);
create table if not exists public.ebay_approval_decisions (...);
create table if not exists public.ebay_listing_drafts (...);
create table if not exists public.ebay_winner_audit_log (...);
```

### Constraints mÃ­nimas recomendadas

- `ebay_winner_candidates.candidate_key unique` para evitar duplicados por rerun.
- `ebay_winner_candidates.state check` con los estados definidos en `PROPOSED_STATE_MACHINE.md`.
- `ebay_approval_decisions.idempotency_key unique` para no registrar dos veces la misma respuesta WhatsApp/admin.
- `ebay_listing_drafts.candidate_id unique` mientras exista un solo borrador activo por candidato.
- `ebay_winner_audit_log.idempotency_key unique nulls not distinct` si se requiere evitar eventos duplicados incluso con claves nulas; alternativamente, hacer `idempotency_key not null` para eventos de transiciÃ³n.
- Ãndices por `state`, `winner_score desc`, `created_at desc`, `market_radar_product_id` y `current_snapshot_id`.

## Tablas/columnas que no deben tocarse en fase 1

- No alterar `market_radar_products`, `market_radar_snapshots`, `market_radar_events` ni `market_radar_scores`.
- No escribir en `products`/`product_images` hasta que exista una decisiÃ³n formal de convertir un draft eBay a producto IMNOVA.
- No agregar columnas eBay a tablas Radar; usar FKs desde tablas nuevas para mantener reversibilidad.
- No almacenar tokens eBay o Meta en tablas nuevas; usar secretos server-side/secret manager.
