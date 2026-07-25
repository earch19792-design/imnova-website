-- A retired draft-only execution is historical evidence, not an active eBay
-- operation. Permit the V3 Luna refresh only when every execution for the
-- package is a specifically retired pre-write attempt with no write or lease
-- evidence. Any ambiguous execution and every publication remain blocking.

do $migration$
declare
  v_signature regprocedure :=
    'public.record_ebay_v3_public_luna_preflight_v1(text,uuid,uuid,uuid,text,text,text,numeric,boolean,timestamptz,text)'::regprocedure;
  v_definition text;
  v_old text := $old$
  if exists (
    select 1
    from public.ebay_draft_only_execution_ledger execution
    where execution.listing_package_id = v_package.id
  ) or exists (
    select 1
    from public.ebay_authorized_listing_publications publication
    where publication.listing_package_id = v_package.id
  ) then
    raise exception 'EBAY_V3_PUBLIC_LUNA_PREFLIGHT_EXECUTION_EXISTS';
  end if;
$old$;
  v_new text := $new$
  if exists (
    select 1
    from public.ebay_draft_only_execution_ledger execution
    where execution.listing_package_id = v_package.id
      and not (
        execution.phase = 'terminal_failure'
        and execution.last_error_code in (
          'EBAY_SKU_NAMESPACE_MIGRATED_BEFORE_WRITE',
          'EBAY_SKU_PREFLIGHT_SUPERSEDED_BY_REAPPROVAL',
          'EBAY_PREFLIGHT_HEADER_CONTRACT_MIGRATED_BEFORE_WRITE'
        )
        and execution.inventory_http_status is null
        and execution.inventory_confirmed_at is null
        and execution.offer_create_started_at is null
        and execution.offer_http_status is null
        and execution.offer_id is null
        and execution.completed_at is null
        and execution.lease_token is null
        and execution.lease_expires_at is null
        and (
          (
            execution.last_error_code =
              'EBAY_SKU_NAMESPACE_MIGRATED_BEFORE_WRITE'
            and execution.sanitized_result
              #>> '{legacySkuRejectedBeforeWrite}' = 'true'
          )
          or (
            execution.last_error_code =
              'EBAY_SKU_PREFLIGHT_SUPERSEDED_BY_REAPPROVAL'
            and execution.sanitized_result
              #>> '{supersededPrewritePreflight}' = 'true'
          )
          or (
            execution.last_error_code =
              'EBAY_PREFLIGHT_HEADER_CONTRACT_MIGRATED_BEFORE_WRITE'
            and execution.sanitized_result
              #>> '{preflightHeaderContractMigrated}' = 'true'
            and execution.sanitized_result
              #>> '{inventoryHttpStatus}' = '400'
            and execution.sanitized_result
              #>> '{offersHttpStatus}' = '400'
            and execution.sanitized_result
              -> 'inventoryErrorIds' = '["25709"]'::jsonb
            and execution.sanitized_result
              -> 'offersErrorIds' = '["25709"]'::jsonb
            and execution.sanitized_result
              #>> '{collision}' = 'false'
            and execution.sanitized_result
              #>> '{inventoryOwnershipVerified}' = 'false'
          )
        )
      )
  ) or exists (
    select 1
    from public.ebay_authorized_listing_publications publication
    where publication.listing_package_id = v_package.id
  ) then
    raise exception 'EBAY_V3_PUBLIC_LUNA_PREFLIGHT_EXECUTION_EXISTS';
  end if;
$new$;
begin
  select pg_get_functiondef(v_signature)
  into strict v_definition;

  if strpos(v_definition, v_old) = 0 then
    raise exception 'EBAY_V3_PUBLIC_LUNA_PREFLIGHT_GUARD_REWRITE_NOT_APPLIED';
  end if;

  v_definition := replace(v_definition, v_old, v_new);
  execute v_definition;
end;
$migration$;

comment on function public.record_ebay_v3_public_luna_preflight_v1(
  text, uuid, uuid, uuid, text, text, text, numeric, boolean, timestamptz, text
) is 'Records an exact public Luna observation before V3 human authorization; permits only proven retired pre-write executions and performs zero eBay writes.';

notify pgrst, 'reload schema';
