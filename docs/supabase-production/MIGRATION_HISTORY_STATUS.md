# Production Migration History Status

Closed on: 2026-06-28

## Projects

Production:

- Project: `imnova-core`
- Ref: `qsefoxmmypmdtwrrtnry`

Staging:

- Project: `imnova-staging`
- Ref: `vsfthqydfrdzulldbfbe`

## Resolved Production State

The production database had schema objects that were partially ahead of Supabase migration history. Several fixes were applied manually after staging validation, without using `supabase db push`.

Resolved items:

- Active Listing Risk schema cache error was corrected.
- `public.ebay_active_listings` exists in production.
- `public.ebay_active_listing_risk_events` exists in production.
- `public.product_images` exists as schema only.
- `product_images` visual seeds/upserts were intentionally omitted.
- The 7 Market Radar/eBay indexes from `202606280001` were applied.
- Partial migration history repair was executed only for migrations with strong evidence.

## Repaired Migrations

The following production migration versions were marked as applied after audit:

- `202606090001`
- `202606100001`
- `202606100002`
- `202606100003`
- `202606140002`
- `202606140003`
- `202606140004`
- `202606140005`
- `202606140006`
- `202606180001`
- `202606180002`
- `202606180004`
- `202606200001`
- `202606210001`
- `202606220001`
- `202606280001`
- `202606280002`

Special deviation:

- `202606100002` was repaired with a documented deviation: `public.product_images` exists as structure, but visual seeds/upserts were intentionally omitted because production already uses product image fields and the original migration mixed schema with visual content.
- `202606180001` was repaired with a documented deviation: production already contains community objects and `community_levels`, but part of the current state comes from later reconciliation work.
- `202606180004` was repaired with a documented deviation: `subscriber_interests` and its structure exist, but the current state may include effects from later reconciliation work.

## Blocked Migrations

These migrations remain pending and must not be repaired or applied without a separate audit loop.

### `202606110001`

Status: `block_do_not_touch`

Reason:

- Contains `UPDATE` statements for active product records.
- Changes visible product copy and marketing content.
- Uses columns that do not exist in production: `commercial_category`, `target_customer`.
- Uses niche/subniche references that do not match the current production schema.

Future path:

- Only revisit with explicit business/copy review.
- If accepted, prepare SQL adapted to the real production schema.
- Do not apply the original migration directly.

### `202606180003`

Status: `leave_pending_documented_debt`

Reason:

- Broad community growth reconciliation migration.
- Overlaps with migrations already repaired and later production reconciliation work.
- Contains schema reconciliation plus `community_levels` upsert.
- Current production objects already exist, so applying or repairing blindly could hide historical divergence.

Future path:

- Keep as documented debt, or audit line-by-line in a separate loop if the team wants to close the history gap.

### `202606180005`

Status: `needs_more_evidence`

Reason:

- Broad production reconciliation migration.
- Contains backfills/data writes for community member status, referral codes, and points ledger.
- Contains function, trigger, RLS, policy, grant, and schema reconciliation work.
- Many objects exist, but the data effects need a separate audit before any repair decision.

Future path:

- Audit backfills and data effects in a dedicated loop before deciding whether to repair, skip, or replace with smaller SQL.

## Operational Rules

- Do not run `supabase db push` directly against production.
- Do not run additional `supabase migration repair` commands without a dedicated audit and authorization loop.
- Do not apply SQL of any kind to production without explicit authorization for the exact loop.
- Do not run data writes in production unless the loop explicitly authorizes them.
- Keep the Supabase CLI linked to staging by default after any production inspection.

## Future Production Migration Checklist

Before any future production migration:

1. Confirm the CLI starts linked to staging.
2. Link production only when the loop explicitly requires it.
3. Confirm production project `imnova-core` and ref `qsefoxmmypmdtwrrtnry`.
4. Run `npx supabase@latest migration list` for production.
5. Confirm the pending migration set does not include blocked migrations.
6. Audit local migration SQL for data writes and destructive operations.
7. Prefer staging validation before production.
8. Return the CLI link to staging after inspection or application.

Direct `supabase db push` remains prohibited until the remaining blocked migrations are resolved or formally documented as intentionally skipped in a future approved process.

## P2-I01B Targeted Artifact — 2026-08-22

Artifact:

- `20260822150720_create_seller_os_luna_linkage_approval_control_plane.sql`
- Status: `TARGETED_MIGRATION_REQUIRED / NOT_APPLIED`.
- Apply authorization: not granted by P2-I01B.

Purpose:

- Add the canonical, append-only human-review candidate and linkage-decision
  grain for exact external Luna product/variant identities.
- Preserve single-component, supplier multiplier and multi-component BOM
  semantics without writing the legacy active-listing payload.
- Provide atomic, idempotent service-role RPCs for replacing a bounded
  server-generated review set and recording a human decision.

Data API and security boundary:

- Both tables enable and force RLS.
- `public`, `anon` and `authenticated` receive no table or function access.
- The backend service role receives read access and execute access only to the
  fixed RPCs; direct decision DML remains revoked.
- The decision RPC accepts only review/cohort/item/evidence/decision bindings.
  It does not accept Luna IDs, components, URLs, SQL or credentials from the
  caller.
- The artifact performs no backfill, approval, Luna read, stock observation,
  scheduler activation or eBay mutation.

Until a separate Teo authorization applies and certifies this exact artifact,
the Admin writer must fail closed and existing linkage counts remain unchanged.
