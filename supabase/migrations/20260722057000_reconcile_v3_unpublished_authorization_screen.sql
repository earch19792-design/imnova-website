-- Reconciliation is append-only: old prepared authorizations remain evidence
-- and are invalidated by separate events. No eBay operation occurs here.

alter table public.ebay_v3_unpublished_offer_authorization_previews
  add column if not exists exact_preview_hash text null
    check (exact_preview_hash is null or exact_preview_hash ~ '^[0-9a-f]{64}$'),
  add column if not exists account_identity jsonb not null default '{}'::jsonb,
  add column if not exists authority_snapshot jsonb not null default '{}'::jsonb;

create table if not exists
  public.ebay_v3_unpublished_offer_authorization_invalidations (
    id uuid primary key default gen_random_uuid(),
    authorization_preview_id uuid not null references
      public.ebay_v3_unpublished_offer_authorization_previews(id),
    attempt_id uuid not null,
    old_exact_preview_hash text null,
    old_payload_hash text not null check (old_payload_hash ~ '^[0-9a-f]{64}$'),
    successor_authorization_preview_id uuid not null references
      public.ebay_v3_unpublished_offer_authorization_previews(id),
    successor_exact_preview_hash text not null
      check (successor_exact_preview_hash ~ '^[0-9a-f]{64}$'),
    successor_payload_hash text not null
      check (successor_payload_hash ~ '^[0-9a-f]{64}$'),
    reason text not null check (
      reason = 'SCREEN_AND_PAYLOAD_AUTHORITY_RECONCILIATION'
    ),
    created_by uuid not null,
    created_at timestamptz not null default now(),
    unique (authorization_preview_id)
  );

alter table public.ebay_v3_unpublished_offer_authorization_invalidations
  enable row level security;
alter table public.ebay_v3_unpublished_offer_authorization_invalidations
  force row level security;

revoke all on
  public.ebay_v3_unpublished_offer_authorization_invalidations
from public, anon, authenticated, service_role;
grant select, insert on
  public.ebay_v3_unpublished_offer_authorization_invalidations
to service_role;

drop trigger if exists
  ebay_v3_unpublished_offer_authorization_invalidations_append_only
on public.ebay_v3_unpublished_offer_authorization_invalidations;
create trigger
  ebay_v3_unpublished_offer_authorization_invalidations_append_only
before update or delete
on public.ebay_v3_unpublished_offer_authorization_invalidations
for each row execute function
  public.reject_v3_unpublished_authorization_mutation();
