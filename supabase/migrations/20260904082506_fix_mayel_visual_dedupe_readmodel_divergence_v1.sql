-- Restore the Phase A quarantine boundary and make dedupe task-durable.
-- Mayel outputs must not join the publishable package asset set before owner
-- review. Their account scope is derived from the exact task/package lineage.

create or replace function public.enforce_ebay_listing_image_account_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_package_account_key text;
  v_requested_account_key text;
  v_task_package_id uuid;
  v_task_candidate_key text;
  v_task_opportunity_id uuid;
begin
  if new.mayel_visual_task_id is not null then
    select task.marketplace_account_key, task.listing_package_id,
      task.candidate_key, task.opportunity_id
    into v_package_account_key, v_task_package_id,
      v_task_candidate_key, v_task_opportunity_id
    from public.ebay_mayel_visual_tasks_v1 task
    join public.ebay_listing_packages package_row
      on package_row.id = task.listing_package_id
      and package_row.account_key = task.marketplace_account_key
    where task.id = new.mayel_visual_task_id
    for key share of task, package_row;

    if v_package_account_key is null
      or v_package_account_key = 'default'
      or v_package_account_key !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
      or new.listing_package_id is not null
      or new.candidate_key is distinct from v_task_candidate_key
      or new.opportunity_id is distinct from v_task_opportunity_id then
      raise exception 'EBAY_IMAGE_MAYEL_TASK_SCOPE_MISMATCH';
    end if;
  else
    select package_row.account_key
    into v_package_account_key
    from public.ebay_listing_packages package_row
    where package_row.id = new.listing_package_id
    for key share;

    if v_package_account_key is null
      or v_package_account_key = 'default'
      or v_package_account_key !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$' then
      raise exception 'EBAY_IMAGE_PACKAGE_ACCOUNT_SCOPE_REQUIRED';
    end if;
  end if;

  v_requested_account_key := nullif(
    current_setting('app.ebay_seller_account_key', true),
    ''
  );
  new.account_key := coalesce(new.account_key, v_requested_account_key);

  if new.account_key is null
    or new.account_key = 'default'
    or new.account_key is distinct from v_package_account_key
    or (
      tg_op = 'UPDATE'
      and (
        new.account_key is distinct from old.account_key
        or new.listing_package_id is distinct from old.listing_package_id
        or new.mayel_visual_task_id is distinct from old.mayel_visual_task_id
        or new.candidate_key is distinct from old.candidate_key
        or new.opportunity_id is distinct from old.opportunity_id
      )
    ) then
    raise exception 'EBAY_IMAGE_ACCOUNT_SCOPE_MISMATCH';
  end if;

  return new;
end;
$$;

drop trigger if exists ebay_listing_image_account_scope_guard
  on public.ebay_listing_image_assets;
create trigger ebay_listing_image_account_scope_guard
before insert or update of account_key, listing_package_id,
  mayel_visual_task_id, candidate_key, opportunity_id
on public.ebay_listing_image_assets
for each row execute function public.enforce_ebay_listing_image_account_scope();

alter table public.ebay_listing_image_assets
  drop constraint if exists ebay_listing_image_assets_mayel_output_check;

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

drop index if exists public.ebay_listing_image_assets_unscoped_output_hash_uidx;
create unique index ebay_listing_image_assets_unscoped_output_hash_uidx
  on public.ebay_listing_image_assets(created_by, candidate_key, output_sha256)
  where listing_package_id is null
    and mayel_visual_task_id is null
    and status in ('pending_review', 'approved');

create unique index if not exists ebay_listing_image_assets_mayel_hash_uidx
  on public.ebay_listing_image_assets(mayel_visual_task_id, output_sha256)
  where mayel_visual_task_id is not null
    and status in ('pending_review', 'approved');

comment on column public.ebay_listing_image_assets.mayel_visual_task_id is
  'Binds a quarantined Mayel output to one exact visual task. The asset remains detached from the publishable listing package throughout Phase A.';
