-- The Inventory API getInventoryItem and getOffers contracts require only the
-- Authorization header. Retire the exact 25709 preflight produced before the
-- client removed its unrelated marketplace header. No Inventory Item, Offer,
-- or publication was created by these executions. This migration performs no
-- external eBay operation.

do $$
begin
  if exists (
    select 1
    from public.ebay_draft_only_execution_ledger execution
    join public.ebay_draft_only_approvals approval
      on approval.id = execution.approval_id
    where approval.status = 'approved'
      and execution.phase = 'terminal_failure'
      and execution.last_error_code =
        'EBAY_SKU_PREFLIGHT_REQUEST_REJECTED'
      and (
        execution.inventory_http_status is not null
        or execution.inventory_confirmed_at is not null
        or execution.offer_create_started_at is not null
        or execution.offer_http_status is not null
        or execution.offer_id is not null
        or execution.completed_at is not null
        or execution.sanitized_result #>> '{inventoryHttpStatus}'
          is distinct from '400'
        or execution.sanitized_result #>> '{offersHttpStatus}'
          is distinct from '400'
        or execution.sanitized_result -> 'inventoryErrorIds'
          is distinct from '["25709"]'::jsonb
        or execution.sanitized_result -> 'offersErrorIds'
          is distinct from '["25709"]'::jsonb
        or execution.sanitized_result #>> '{collision}'
          is distinct from 'false'
        or execution.sanitized_result
          #>> '{inventoryOwnershipVerified}' is distinct from 'false'
      )
  ) then
    raise exception
      'EBAY_PREFLIGHT_HEADER_RECONCILIATION_WRITE_EVIDENCE_REQUIRED';
  end if;
end;
$$;

update public.ebay_draft_only_execution_ledger execution
set last_error_code =
      'EBAY_PREFLIGHT_HEADER_CONTRACT_MIGRATED_BEFORE_WRITE',
    sanitized_result = execution.sanitized_result || jsonb_build_object(
      'preflightHeaderContractMigrated', true,
      'migratedAt', now()
    ),
    updated_at = now()
from public.ebay_draft_only_approvals approval
where approval.id = execution.approval_id
  and approval.status = 'approved'
  and execution.phase = 'terminal_failure'
  and execution.last_error_code = 'EBAY_SKU_PREFLIGHT_REQUEST_REJECTED'
  and execution.inventory_http_status is null
  and execution.inventory_confirmed_at is null
  and execution.offer_create_started_at is null
  and execution.offer_http_status is null
  and execution.offer_id is null
  and execution.completed_at is null
  and execution.sanitized_result #>> '{inventoryHttpStatus}' = '400'
  and execution.sanitized_result #>> '{offersHttpStatus}' = '400'
  and execution.sanitized_result -> 'inventoryErrorIds'
    = '["25709"]'::jsonb
  and execution.sanitized_result -> 'offersErrorIds'
    = '["25709"]'::jsonb
  and execution.sanitized_result #>> '{collision}' = 'false'
  and execution.sanitized_result
    #>> '{inventoryOwnershipVerified}' = 'false';

update public.ebay_draft_only_approvals approval
set status = 'SUPERSEDED_BY_RECONCILIATION',
    revoked_at = coalesce(approval.revoked_at, now()),
    updated_at = now()
where approval.status = 'approved'
  and exists (
    select 1
    from public.ebay_draft_only_execution_ledger execution
    where execution.approval_id = approval.id
      and execution.phase = 'terminal_failure'
      and execution.last_error_code =
        'EBAY_PREFLIGHT_HEADER_CONTRACT_MIGRATED_BEFORE_WRITE'
      and execution.inventory_http_status is null
      and execution.inventory_confirmed_at is null
      and execution.offer_create_started_at is null
      and execution.offer_http_status is null
      and execution.offer_id is null
      and execution.completed_at is null
  );

notify pgrst, 'reload schema';
