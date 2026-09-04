-- A Mayel Phase A asset is quarantined, but it still belongs to the exact
-- listing package that supplies the canonical seller account scope. The
-- previous Phase A constraint required the package id to be null, which was
-- incompatible with the existing account-scope trigger and made every durable
-- asset insert fail after the private Storage writes succeeded.

alter table public.ebay_listing_image_assets
  drop constraint if exists ebay_listing_image_assets_mayel_output_check;

alter table public.ebay_listing_image_assets
  add constraint ebay_listing_image_assets_mayel_output_check check (
    mayel_visual_task_id is null or (
      listing_package_id is not null
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

comment on column public.ebay_listing_image_assets.mayel_visual_task_id is
  'Binds a quarantined Mayel output to one exact visual task and its account-scoped listing package. Phase A cannot publish or mutate the listing.';
