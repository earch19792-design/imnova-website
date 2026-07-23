-- eBay Inventory API accepts an alphanumeric SKU of at most 50 characters.
-- The former canonical value used "IMNOVA-" and was rejected before any
-- Inventory Item or Offer write. Migrate the internal authority to the
-- alphanumeric "IMNOVA" namespace without mutating historical approvals.
-- This migration performs no external eBay operation.

do $$
begin
  if exists (
    select 1
    from public.ebay_draft_only_approvals approval
    left join public.ebay_draft_only_execution_ledger execution
      on execution.approval_id = approval.id
    where approval.status = 'approved'
      and approval.approved_payload #>> '{sku}'
        ~ '^IMNOVA-[A-Z0-9]{16,32}$'
      and (
        execution.id is not null
        and (
          execution.phase not in ('claimed', 'terminal_failure')
          or execution.inventory_http_status is not null
          or execution.inventory_confirmed_at is not null
          or execution.offer_create_started_at is not null
          or execution.offer_http_status is not null
          or execution.offer_id is not null
          or execution.completed_at is not null
          or (
            execution.lease_expires_at is not null
            and execution.lease_expires_at > now()
          )
        )
      )
  ) then
    raise exception 'EBAY_LEGACY_SKU_WRITE_EVIDENCE_RECONCILIATION_REQUIRED';
  end if;
end;
$$;

update public.ebay_draft_only_execution_ledger execution
set phase = 'terminal_failure',
    last_error_code = 'EBAY_SKU_NAMESPACE_MIGRATED_BEFORE_WRITE',
    sanitized_result = coalesce(execution.sanitized_result, '{}'::jsonb)
      || jsonb_build_object(
        'legacySkuRejectedBeforeWrite', true,
        'replacementNamespace', 'IMNOVA_ALPHANUMERIC',
        'migratedAt', now()
      ),
    lease_token = null,
    lease_expires_at = null,
    updated_at = now()
where execution.sku ~ '^IMNOVA-[A-Z0-9]{16,32}$'
  and execution.phase = 'claimed'
  and execution.inventory_http_status is null
  and execution.inventory_confirmed_at is null
  and execution.offer_create_started_at is null
  and execution.offer_http_status is null
  and execution.offer_id is null
  and execution.completed_at is null
  and (
    execution.lease_expires_at is null
    or execution.lease_expires_at <= now()
  );

update public.ebay_draft_only_approvals approval
set status = 'SUPERSEDED_BY_RECONCILIATION',
    revoked_at = coalesce(approval.revoked_at, now()),
    updated_at = now()
where approval.status = 'approved'
  and approval.approved_payload #>> '{sku}'
    ~ '^IMNOVA-[A-Z0-9]{16,32}$';

update public.ebay_listing_packages package
set package_data = jsonb_set(
      jsonb_set(
        package.package_data,
        '{draftConfiguration,sku}',
        to_jsonb(
          concat(
            'IMNOVA',
            upper(replace(package.id::text, '-', ''))
          )
        ),
        true
      ),
      '{draftConfiguration,skuCollisionCheck}',
      coalesce(
        package.package_data
          #> '{draftConfiguration,skuCollisionCheck}',
        '{}'::jsonb
      ) || jsonb_build_object(
        'sku',
        concat(
          'IMNOVA',
          upper(replace(package.id::text, '-', ''))
        )
      ),
      true
    ),
    updated_at = now()
where package.package_data #>> '{draftConfiguration,sku}'
  = concat(
    'IMNOVA-',
    upper(replace(package.id::text, '-', ''))
  );

do $$
declare
  v_signature regprocedure;
  v_definition text;
  v_updated text;
begin
  foreach v_signature in array array[
    'public.approve_ebay_draft_only_package(uuid,uuid,text,uuid,text,jsonb,text,timestamptz,text,text)'::regprocedure,
    'public.claim_ebay_draft_only_execution(uuid,uuid,text,text,text,uuid,text,text)'::regprocedure
  ]
  loop
    select pg_get_functiondef(v_signature)
    into strict v_definition;
    v_updated := replace(
      v_definition,
      '^IMNOVA-[A-Z0-9]{16,32}$',
      '^IMNOVA[A-Z0-9]{16,32}$'
    );
    if v_updated = v_definition then
      raise exception 'EBAY_DRAFT_ONLY_SKU_CONTRACT_REWRITE_NOT_APPLIED';
    end if;
    execute v_updated;
  end loop;
end;
$$;

do $$
declare
  v_signature regprocedure;
  v_definition text;
  v_updated text;
begin
  foreach v_signature in array array[
    'public.register_ebay_manual_listing_link_canonical_core_v1(text,text,text,uuid,text,text,text,text,text,text,text,timestamptz,jsonb,uuid)'::regprocedure,
    'public.register_ebay_manual_listing_link_bound_core_v2(text,text,text,uuid,text,text,text,text,text,text,text,timestamptz,jsonb,uuid)'::regprocedure,
    'public.register_ebay_manual_listing_link(text,text,text,uuid,text,text,text,text,text,text,text,timestamptz,jsonb,uuid)'::regprocedure
  ]
  loop
    select pg_get_functiondef(v_signature)
    into strict v_definition;
    v_updated := replace(v_definition, 'IMNOVA-', 'IMNOVA');
    if v_updated = v_definition then
      raise exception 'EBAY_MANUAL_LISTING_SKU_CONTRACT_REWRITE_NOT_APPLIED';
    end if;
    execute v_updated;
  end loop;
end;
$$;

alter table public.ebay_authorized_listing_publications
  drop constraint if exists ebay_authorized_publication_sku_check;
alter table public.ebay_authorized_listing_publications
  add constraint ebay_authorized_publication_sku_check check (
    sku ~ '^(IMNOVA[A-Z0-9]{16,32}|IMNOVA-[A-Z0-9]{16,32})$'
  );

comment on constraint ebay_authorized_publication_sku_check
on public.ebay_authorized_listing_publications
is 'Accepts current alphanumeric Inventory API SKUs and preserves historical pre-write evidence using the former namespace.';

notify pgrst, 'reload schema';
