-- Append-only Remote Operator review of an image set that Seller OS already
-- prepared. A review never publishes an image and never mutates an eBay
-- listing. The server validates the exact LIVE listing and all visual guards
-- before inserting one decision for the authenticated operator.

create table if not exists public.ebay_remote_operator_visual_review_events (
  id uuid primary key default gen_random_uuid(),
  marketplace_account_key text not null,
  operator_user_id uuid not null references auth.users(id) on delete restrict,
  proposal_revision_id uuid not null references
    public.ebay_same_day_pilot_image_revisions(id) on delete restrict,
  ebay_item_id text not null,
  decision text not null,
  exact_product_identity boolean not null,
  no_false_features boolean not null,
  no_unproven_accessories boolean not null,
  product_not_misrepresented boolean not null,
  marketplace_writes integer not null default 0,
  new_listing_publications integer not null default 0,
  listing_ends integer not null default 0,
  promotion_spend_writes integer not null default 0,
  reviewed_at timestamptz not null default now(),
  constraint ebay_remote_visual_review_account_check check (
    marketplace_account_key <> 'default'
    and marketplace_account_key ~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
  ),
  constraint ebay_remote_visual_review_item_check check (
    ebay_item_id ~ '^[0-9]{9,20}$'
  ),
  constraint ebay_remote_visual_review_decision_check check (
    decision in ('APPROVE', 'REJECT')
  ),
  constraint ebay_remote_visual_review_guards_check check (
    exact_product_identity
    and no_false_features
    and no_unproven_accessories
    and product_not_misrepresented
  ),
  constraint ebay_remote_visual_review_zero_write_check check (
    marketplace_writes = 0
    and new_listing_publications = 0
    and listing_ends = 0
    and promotion_spend_writes = 0
  ),
  constraint ebay_remote_visual_review_once unique (
    proposal_revision_id, operator_user_id
  )
);

create index if not exists ebay_remote_visual_review_account_time_idx
  on public.ebay_remote_operator_visual_review_events(
    marketplace_account_key, reviewed_at desc
  );

create or replace function public.reject_ebay_remote_visual_review_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'REMOTE_OPERATOR_VISUAL_REVIEW_APPEND_ONLY';
end;
$$;

drop trigger if exists reject_ebay_remote_visual_review_update
  on public.ebay_remote_operator_visual_review_events;
create trigger reject_ebay_remote_visual_review_update
before update on public.ebay_remote_operator_visual_review_events
for each row execute function public.reject_ebay_remote_visual_review_mutation();

drop trigger if exists reject_ebay_remote_visual_review_delete
  on public.ebay_remote_operator_visual_review_events;
create trigger reject_ebay_remote_visual_review_delete
before delete on public.ebay_remote_operator_visual_review_events
for each row execute function public.reject_ebay_remote_visual_review_mutation();

alter table public.ebay_remote_operator_visual_review_events enable row level security;
revoke all on table public.ebay_remote_operator_visual_review_events
  from anon, authenticated;
revoke all on table public.ebay_remote_operator_visual_review_events
  from public;
grant select, insert on table public.ebay_remote_operator_visual_review_events
  to service_role;

revoke all on function public.reject_ebay_remote_visual_review_mutation()
  from public, anon, authenticated, service_role;

comment on table public.ebay_remote_operator_visual_review_events is
  'Append-only human review of a prepared image proposal. Zero marketplace writes; owner authority and final LIVE canary remain unchanged.';
