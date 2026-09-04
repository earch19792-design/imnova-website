-- Mayel ChatGPT subscription visual workstation, Phase A.
-- This is a control plane over the existing Seller OS image asset pipeline.
-- It has no eBay mutation primitive and cannot attach assets to a listing
-- package. ChatGPT credentials, conversations, cookies, and sessions are never
-- stored.

create table if not exists public.ebay_mayel_visual_tasks_v1 (
  id uuid primary key default gen_random_uuid(),
  marketplace_account_key text not null,
  ebay_item_id text not null,
  active_listing_id uuid not null references
    public.ebay_active_listings(id) on delete restrict,
  manual_listing_link_id uuid not null references
    public.ebay_manual_listing_links(id) on delete restrict,
  opportunity_id uuid not null references
    public.ebay_luna_opportunity_queue(id) on delete restrict,
  listing_package_id uuid not null references
    public.ebay_listing_packages(id) on delete restrict,
  candidate_key text not null,
  assigned_operator_user_id uuid not null references auth.users(id)
    on delete restrict,
  selection_authority text not null,
  selection_signal jsonb not null,
  evidence_pack_version text not null,
  evidence_pack jsonb not null,
  product_truth_version text not null,
  product_truth_digest text not null,
  source_image_references jsonb not null,
  source_image_set_digest text not null,
  current_image_set jsonb not null,
  prompt_contract_version text not null,
  prompt_text text not null,
  prompt_digest text not null,
  status text not null default 'PROMPT_READY',
  visual_manifest jsonb null,
  visual_manifest_digest text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ebay_mayel_visual_tasks_account_check check (
    marketplace_account_key <> 'default'
    and marketplace_account_key ~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
  ),
  constraint ebay_mayel_visual_tasks_item_check check (
    ebay_item_id ~ '^[0-9]{9,20}$'
  ),
  constraint ebay_mayel_visual_tasks_candidate_check check (
    char_length(candidate_key) between 8 and 300
    and candidate_key !~ '[[:cntrl:]]'
  ),
  constraint ebay_mayel_visual_tasks_selection_check check (
    selection_authority in (
      'EBAY_LISTING_QUALITY_VISUAL_SIGNAL',
      'SELLER_OS_LIVE_VISUAL_QUALITY_SIGNAL',
      'LOW_CTR_SUFFICIENT_IMPRESSIONS'
    )
    and jsonb_typeof(selection_signal) = 'object'
  ),
  constraint ebay_mayel_visual_tasks_evidence_check check (
    evidence_pack_version = 'MAYEL_PRODUCT_EVIDENCE_PACK_V1'
    and jsonb_typeof(evidence_pack) = 'object'
    and product_truth_version <> ''
    and product_truth_digest ~ '^sha256:[0-9a-f]{64}$'
    and jsonb_typeof(source_image_references) = 'array'
    and jsonb_array_length(source_image_references) between 1 and 24
    and source_image_set_digest ~ '^sha256:[0-9a-f]{64}$'
    and jsonb_typeof(current_image_set) = 'array'
    and jsonb_array_length(current_image_set) between 1 and 24
  ),
  constraint ebay_mayel_visual_tasks_prompt_check check (
    prompt_contract_version = 'MAYEL_CHATGPT_VISUAL_PROMPT_V1'
    and char_length(prompt_text) between 500 and 30000
    and prompt_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  constraint ebay_mayel_visual_tasks_status_check check (
    status in (
      'PROMPT_READY',
      'OUTPUTS_UPLOADED',
      'MAYEL_REVIEW_PENDING',
      'OWNER_PREVIEW_READY',
      'CANCELLED'
    )
  ),
  constraint ebay_mayel_visual_tasks_manifest_check check (
    (visual_manifest is null and visual_manifest_digest is null)
    or (
      jsonb_typeof(visual_manifest) = 'object'
      and visual_manifest_digest ~ '^sha256:[0-9a-f]{64}$'
    )
  )
);

create unique index if not exists ebay_mayel_visual_tasks_open_item_uidx
  on public.ebay_mayel_visual_tasks_v1(
    marketplace_account_key, ebay_item_id
  ) where status <> 'CANCELLED';

create index if not exists ebay_mayel_visual_tasks_operator_idx
  on public.ebay_mayel_visual_tasks_v1(
    assigned_operator_user_id, status, created_at desc
  );

alter table public.ebay_listing_image_assets
  add column if not exists mayel_visual_task_id uuid null references
    public.ebay_mayel_visual_tasks_v1(id) on delete restrict,
  add column if not exists uploaded_by uuid null references auth.users(id)
    on delete restrict,
  add column if not exists source_type text null,
  add column if not exists mayel_output_role text null,
  add column if not exists declared_mime_type text null,
  add column if not exists actual_mime_type text null,
  add column if not exists source_image_references jsonb null,
  add column if not exists source_image_set_digest text null,
  add column if not exists product_truth_version text null,
  add column if not exists product_truth_digest text null,
  add column if not exists prompt_contract_version text null,
  add column if not exists mayel_approval_status text null,
  add column if not exists owner_approval_status text null,
  add column if not exists provenance jsonb null;

alter table public.ebay_listing_image_assets
  add constraint ebay_listing_image_assets_mayel_output_check check (
    mayel_visual_task_id is null or (
      listing_package_id is null
      and source_kind = 'owned_upload'
      and source_type = 'CHATGPT_SUBSCRIPTION_MAYEL'
      and uploaded_by is not null
      and mayel_output_role in (
        'DETAIL', 'PACKAGE_CONTENTS', 'DIMENSIONS',
        'PRIMARY_BENEFIT', 'LIFESTYLE', 'HUMAN_USE'
      )
      and declared_mime_type in ('image/jpeg', 'image/png', 'image/webp')
      and actual_mime_type in ('image/jpeg', 'image/png', 'image/webp')
      and jsonb_typeof(source_image_references) = 'array'
      and jsonb_array_length(source_image_references) between 1 and 24
      and source_image_set_digest ~ '^sha256:[0-9a-f]{64}$'
      and product_truth_version <> ''
      and product_truth_digest ~ '^sha256:[0-9a-f]{64}$'
      and prompt_contract_version = 'MAYEL_CHATGPT_VISUAL_PROMPT_V1'
      and mayel_approval_status in ('PENDING', 'APPROVED', 'REJECTED')
      and owner_approval_status = 'PENDING'
      and jsonb_typeof(provenance) = 'object'
    )
  ) not valid;

alter table public.ebay_listing_image_assets
  validate constraint ebay_listing_image_assets_mayel_output_check;

create unique index if not exists ebay_listing_image_assets_mayel_role_uidx
  on public.ebay_listing_image_assets(mayel_visual_task_id, mayel_output_role)
  where mayel_visual_task_id is not null
    and status in ('pending_review', 'approved');

alter table public.ebay_mayel_visual_tasks_v1 enable row level security;
alter table public.ebay_mayel_visual_tasks_v1 force row level security;
revoke all on table public.ebay_mayel_visual_tasks_v1
  from anon, authenticated;
revoke all on table public.ebay_mayel_visual_tasks_v1 from public;
grant select, insert, update on table public.ebay_mayel_visual_tasks_v1
  to service_role;

-- New provenance columns are server-side only. Existing access to the asset
-- table is not broadened.
revoke all on table public.ebay_listing_image_assets from anon, authenticated;
grant select, insert, update on table public.ebay_listing_image_assets
  to service_role;

comment on table public.ebay_mayel_visual_tasks_v1 is
  'Phase A, owner-safe visual task control plane. Manual ChatGPT subscription use by Mayel; no ChatGPT credentials, no OpenAI image API, no eBay writes.';
comment on column public.ebay_listing_image_assets.mayel_visual_task_id is
  'Binds a quarantined Mayel output to one exact visual task. The asset remains detached from the publishable listing package in Phase A.';
comment on column public.ebay_listing_image_assets.provenance is
  'Bounded visual provenance only; never Product Truth and never ChatGPT session/conversation data.';

notify pgrst, 'reload schema';
