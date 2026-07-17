-- Loop 2 only: sanitized, append-only visual pattern metadata derived locally
-- from operator-visible Product Research thumbnails. No images, URLs, bytes,
-- screenshots, blobs, base64, raw HTML, credentials, PII, OpenAI, or eBay writes.

create table if not exists public.marketplace_product_research_visual_pattern_observations (
  id uuid primary key default gen_random_uuid(),
  sold_observation_id uuid not null references public.marketplace_product_research_capture_observations(id) on delete restrict,
  capture_batch_id uuid not null references public.marketplace_product_research_capture_batches(id) on delete restrict,
  capture_run_id uuid null references public.marketplace_listing_approval_queue_runs(id) on delete restrict,
  marketplace_account_key text not null,
  marketplace text not null default 'EBAY_US',
  query_context_hash text not null,
  visual_pattern_schema_version text not null,
  algorithm_version text not null,
  structured_features jsonb not null,
  analysis_status text not null,
  confidence text not null,
  observed_at timestamptz not null,
  analyzed_at timestamptz not null,
  raw_image_bytes_stored boolean not null default false,
  image_urls_stored boolean not null default false,
  screenshots_stored boolean not null default false,
  base64_stored boolean not null default false,
  blobs_stored boolean not null default false,
  raw_html_stored boolean not null default false,
  pii_stored boolean not null default false,
  openai_calls integer not null default 0,
  ebay_writes integer not null default 0,
  created_at timestamptz not null default clock_timestamp(),
  constraint marketplace_product_research_visual_pattern_observations_marketplace_check
    check (marketplace = 'EBAY_US'),
  constraint marketplace_product_research_visual_pattern_observations_hash_check
    check (query_context_hash ~ '^sha256:[0-9a-f]{64}$'),
  constraint marketplace_product_research_visual_pattern_observations_version_check
    check (length(visual_pattern_schema_version) between 8 and 120
      and visual_pattern_schema_version !~ '[[:cntrl:]]'
      and algorithm_version ~ '^[A-Z0-9._-]{3,100}$'),
  constraint marketplace_product_research_visual_pattern_observations_feature_check
    check (jsonb_typeof(structured_features) = 'object'
      and lower(structured_features::text) !~ '(imageurl|thumbnailurl|base64|blob|screenshot|imagebytes|rawhtml|data:image|https?://|"src")'),
  constraint marketplace_product_research_visual_pattern_observations_status_check
    check (analysis_status in ('ANALYZED','PARTIAL','UNAVAILABLE','REJECTED')
      and confidence in ('HIGH','MEDIUM','LOW','UNKNOWN')),
  constraint marketplace_product_research_visual_pattern_observations_safety_check
    check (raw_image_bytes_stored = false and image_urls_stored = false
      and screenshots_stored = false and base64_stored = false and blobs_stored = false
      and raw_html_stored = false and pii_stored = false
      and openai_calls = 0 and ebay_writes = 0),
  constraint marketplace_product_research_visual_pattern_observations_unique
    unique (marketplace_account_key, marketplace, sold_observation_id,
      visual_pattern_schema_version, algorithm_version)
);

create table if not exists public.marketplace_product_research_visual_market_briefs (
  id uuid primary key default gen_random_uuid(),
  marketplace_account_key text not null,
  marketplace text not null default 'EBAY_US',
  capture_batch_id uuid not null references public.marketplace_product_research_capture_batches(id) on delete restrict,
  capture_run_id uuid null references public.marketplace_listing_approval_queue_runs(id) on delete restrict,
  query_context_hash text not null,
  product_family_fingerprint text not null,
  category_id text null,
  visual_market_brief_version text not null,
  brief jsonb not null,
  confidence text not null,
  sample_size integer not null,
  raw_image_bytes_stored boolean not null default false,
  image_urls_stored boolean not null default false,
  openai_calls integer not null default 0,
  ebay_writes integer not null default 0,
  created_at timestamptz not null default clock_timestamp(),
  constraint marketplace_product_research_visual_market_briefs_marketplace_check
    check (marketplace = 'EBAY_US'),
  constraint marketplace_product_research_visual_market_briefs_hashes_check
    check (query_context_hash ~ '^sha256:[0-9a-f]{64}$'
      and product_family_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  constraint marketplace_product_research_visual_market_briefs_category_check
    check (category_id is null or category_id ~ '^[0-9]+$'),
  constraint marketplace_product_research_visual_market_briefs_content_check
    check (jsonb_typeof(brief) = 'object'
      and lower(brief::text) !~ '(imageurl|thumbnailurl|base64|blob|screenshot|imagebytes|rawhtml|data:image|https?://|"src")'),
  constraint marketplace_product_research_visual_market_briefs_counts_check
    check (sample_size > 0 and confidence in ('HIGH','MEDIUM','LOW','UNKNOWN')),
  constraint marketplace_product_research_visual_market_briefs_safety_check
    check (raw_image_bytes_stored = false and image_urls_stored = false
      and openai_calls = 0 and ebay_writes = 0),
  constraint marketplace_product_research_visual_market_briefs_unique
    unique (marketplace_account_key, marketplace, capture_batch_id,
      product_family_fingerprint, visual_market_brief_version)
);

create index if not exists marketplace_product_research_visual_observation_account_idx
  on public.marketplace_product_research_visual_pattern_observations(
    marketplace_account_key, marketplace, created_at desc
  );
create index if not exists marketplace_product_research_visual_observation_sold_idx
  on public.marketplace_product_research_visual_pattern_observations(sold_observation_id);
create index if not exists marketplace_product_research_visual_brief_account_idx
  on public.marketplace_product_research_visual_market_briefs(
    marketplace_account_key, marketplace, created_at desc
  );

alter table public.marketplace_product_research_visual_pattern_observations enable row level security;
alter table public.marketplace_product_research_visual_pattern_observations force row level security;
alter table public.marketplace_product_research_visual_market_briefs enable row level security;
alter table public.marketplace_product_research_visual_market_briefs force row level security;

revoke all on table public.marketplace_product_research_visual_pattern_observations
  from public, anon, authenticated, service_role;
revoke all on table public.marketplace_product_research_visual_market_briefs
  from public, anon, authenticated, service_role;
grant select, insert on table public.marketplace_product_research_visual_pattern_observations to service_role;
grant select, insert on table public.marketplace_product_research_visual_market_briefs to service_role;

create or replace function public.reject_product_research_visual_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'PRODUCT_RESEARCH_VISUAL_APPEND_ONLY';
end;
$$;

create trigger marketplace_product_research_visual_pattern_append_only
  before update or delete on public.marketplace_product_research_visual_pattern_observations
  for each row execute function public.reject_product_research_visual_mutation();

create trigger marketplace_product_research_visual_brief_append_only
  before update or delete on public.marketplace_product_research_visual_market_briefs
  for each row execute function public.reject_product_research_visual_mutation();

comment on table public.marketplace_product_research_visual_pattern_observations is
  'Append-only, non-reconstructive visual metadata from local analysis of visible eBay Product Research thumbnails; no competitor images or image references are stored.';
comment on table public.marketplace_product_research_visual_market_briefs is
  'Structured aggregate visual correlation briefs for later authorized use; never contains competitor image content or causal claims.';

notify pgrst, 'reload schema';
