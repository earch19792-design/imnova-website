-- Reuse the existing controlled publication ledger for every candidate whose
-- current Smart Stocking package is bound to exact Product Truth and an
-- append-only profitability frontier. Historical entry/decision snapshots
-- remain immutable provenance; they do not replace the current package.

create or replace function public.is_ebay_smart_stocking_authorized_publication_v1(
  p_approval_id uuid,
  p_package_id uuid,
  p_opportunity_id uuid,
  p_actor uuid,
  p_account_key text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_approval public.ebay_draft_only_approvals%rowtype;
  v_package public.ebay_listing_packages%rowtype;
  v_opportunity public.ebay_luna_opportunity_queue%rowtype;
  v_decision public.marketplace_listing_decision_packages%rowtype;
  v_frontier public.seller_os_profitability_frontier_snapshots%rowtype;
  v_authorization jsonb;
  v_binding jsonb;
  v_marker jsonb;
  v_profile jsonb;
  v_product_truth jsonb;
  v_stock jsonb;
begin
  if p_approval_id is null or p_package_id is null
    or p_opportunity_id is null or p_actor is null
    or p_account_key !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$' then
    return false;
  end if;

  select * into v_approval from public.ebay_draft_only_approvals
  where id = p_approval_id and actor_user_id = p_actor;
  select * into v_package from public.ebay_listing_packages
  where id = p_package_id and created_by = p_actor
    and account_key = p_account_key;
  select * into v_opportunity from public.ebay_luna_opportunity_queue
  where id = p_opportunity_id;
  if v_approval.id is null or v_package.id is null or v_opportunity.id is null
    or v_approval.listing_package_id <> v_package.id
    or v_approval.opportunity_id <> v_opportunity.id
    or v_package.opportunity_id <> v_opportunity.id
    or v_approval.candidate_key <> v_package.candidate_key
    or v_package.candidate_key <> v_opportunity.candidate_key
    or v_approval.target <> 'PRODUCTION'
    or v_package.status <> 'approved'
    or v_opportunity.queue_status <> 'ready'
    or v_opportunity.decision <> 'LISTING_READY'
    or v_opportunity.supplier_available is distinct from true
    or v_opportunity.supplier_snapshot_at is null
    or v_opportunity.supplier_snapshot_at
      < clock_timestamp() - interval '6 hours'
  then return false;
  end if;

  v_authorization := v_approval.approved_payload
    #> '{compliance,smartStockingPublicationAuthorization}';
  v_binding := v_package.package_data #> '{pricing,evidenceBinding}';
  v_marker := v_opportunity.assessment->'smartStockingListingIntakeV1';
  v_product_truth := v_opportunity.assessment->'productTruth';
  v_stock := v_product_truth->'stock';
  if jsonb_typeof(v_authorization) is distinct from 'object'
    or jsonb_typeof(v_binding) is distinct from 'object'
    or jsonb_typeof(v_marker) is distinct from 'object'
    or jsonb_typeof(v_product_truth) is distinct from 'object'
    or jsonb_typeof(v_stock) is distinct from 'object'
    or v_authorization->>'version'
      is distinct from 'SELLER_OS_SMART_STOCKING_AUTHORIZED_PUBLICATION_V1'
    or v_authorization->>'validated' is distinct from 'true'
    or v_authorization->>'accountKey' is distinct from p_account_key
    or v_authorization->>'actorUserId' is distinct from p_actor::text
    or v_authorization->>'listingPackageId' is distinct from v_package.id::text
    or v_authorization->>'opportunityId'
      is distinct from v_opportunity.id::text
    or v_authorization->>'candidateKey'
      is distinct from v_package.candidate_key
    or coalesce(v_authorization->>'workspaceEvidenceAuthorityClass', '')
      !~ '^SELLER_OS_[A-Z0-9_]+_FINAL_WORKSPACE_EVIDENCE_V1$'
    or v_authorization->>'workspaceEvidenceAuthorityClass'
      is distinct from v_binding->>'authorityClass'
    or coalesce(v_authorization->>'decisionPackageId', '')
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(v_authorization->>'entrySnapshotHash', '')
      !~ '^sha256:[0-9a-f]{64}$'
    or coalesce(v_authorization->>'decisionSnapshotHash', '')
      !~ '^sha256:[0-9a-f]{64}$'
    or coalesce(v_authorization->>'authorizationDigest', '')
      !~ '^sha256:[0-9a-f]{64}$'
    or coalesce(v_authorization->>'productTruthDigest', '')
      !~ '^sha256:[0-9a-f]{64}$'
    or coalesce(v_authorization->>'frontierId', '')
      !~ '^profitability-frontier-v1:sha256:[0-9a-f]{64}$'
    or coalesce(v_authorization->>'frontierDigest', '')
      !~ '^sha256:[0-9a-f]{64}$'
    or coalesce(v_authorization->>'frontierSnapshotDigest', '')
      !~ '^sha256:[0-9a-f]{64}$'
    or v_authorization->>'finalEconomicsStatus' is distinct from 'PASS'
    or v_authorization->>'thresholdResult' is distinct from 'PASS'
    or v_authorization->>'launchTier' not in (
      'GOLD', 'STRONG_MARKET_BET', 'CONTROLLED_MERCHANDISING_BET',
      'EXPLORATORY_COMMERCIAL_BET'
    )
    or v_authorization->>'stockState'
      is distinct from 'IN_STOCK_SUPPLIER_STATED'
    or v_authorization->'supplierInventoryQuantity' is distinct from
      coalesce(to_jsonb(v_opportunity.supplier_inventory_quantity),
        'null'::jsonb)
    or v_authorization->'safeCapacity' is distinct from 'null'::jsonb
    or v_authorization->>'stockObservedAt'
      is distinct from v_stock->>'observedAt'
    or v_authorization->>'finalHumanAuthorizationRequired'
      is distinct from 'true'
    or v_authorization->>'unattendedPublicationAllowed'
      is distinct from 'false'
    or v_authorization->>'sourceRevalidationAuthority' is distinct from
      'SMART_STOCKING_EXACT_PRODUCT_TRUTH_DURABLE_REVALIDATION_V1'
    or v_authorization->>'lunaProductId'
      is distinct from v_opportunity.supplier_product_id
    or v_authorization->>'lunaVariantId'
      is distinct from v_opportunity.supplier_variant_id
    or v_authorization->>'supplierSku'
      is distinct from v_opportunity.supplier_sku
    or v_authorization->>'gtin' is distinct from v_opportunity.gtin
    or v_product_truth->>'candidateKey'
      is distinct from v_opportunity.candidate_key
    or v_product_truth->>'lunaProductId'
      is distinct from v_opportunity.supplier_product_id
    or v_product_truth->>'lunaVariantId'
      is distinct from v_opportunity.supplier_variant_id
    or v_product_truth->>'supplierSku'
      is distinct from v_opportunity.supplier_sku
    or v_product_truth->>'gtin' is distinct from v_opportunity.gtin
    or v_authorization->>'productTruthDigest'
      is distinct from v_product_truth->>'evidenceDigest'
    or v_stock->>'state' is distinct from 'IN_STOCK_SUPPLIER_STATED'
    or v_stock->>'freshness' is distinct from 'FRESH'
    or v_stock->>'exactIdentityVerified' is distinct from 'true'
    or v_stock->'supplierStatedQuantity' is distinct from
      coalesce(to_jsonb(v_opportunity.supplier_inventory_quantity),
        'null'::jsonb)
    or v_stock->'safeCapacity' is distinct from 'null'::jsonb
    or v_marker->>'contractVersion'
      is distinct from 'SELLER_OS_SMART_STOCKING_LISTING_INTAKE_V1'
    or coalesce(v_marker->>'candidateKey', v_opportunity.candidate_key)
      is distinct from v_opportunity.candidate_key
    or v_marker->>'decisionPackageId'
      is distinct from v_authorization->>'decisionPackageId'
    or coalesce(v_marker->>'supplierSku', v_opportunity.supplier_sku)
      is distinct from v_opportunity.supplier_sku
    or v_marker->>'finalDecision' is distinct from 'LISTING_READY'
    or v_marker->>'finalEconomicsStatus' is distinct from 'PASS'
    or v_marker->>'exactIdentityVerified' is distinct from 'true'
    or v_marker->>'currentSupplierAvailabilityVerified' is distinct from 'true'
    or (v_marker->>'finalPriceUsd')::numeric is distinct from
      (v_authorization->>'salePriceUsd')::numeric
    or coalesce(v_marker->>'frontierId', v_authorization->>'frontierId')
      is distinct from v_authorization->>'frontierId'
    or coalesce(v_marker->>'frontierDigest',
      v_authorization->>'frontierDigest')
      is distinct from v_authorization->>'frontierDigest'
    or coalesce(v_marker->>'frontierSnapshotDigest',
      v_authorization->>'frontierSnapshotDigest')
      is distinct from v_authorization->>'frontierSnapshotDigest'
  then return false;
  end if;

  select * into v_decision
  from public.marketplace_listing_decision_packages
  where id = (v_authorization->>'decisionPackageId')::uuid
    and marketplace_account_key = p_account_key
    and marketplace = 'EBAY_US'
    and supplier_sku = v_opportunity.supplier_sku
    and supplier_variant_id = v_opportunity.supplier_variant_id;
  if v_decision.id is null or v_decision.status <> 'GENERATED'
    or v_decision.smart_stocking_learning_profile is null then
    return false;
  end if;
  v_profile := v_decision.smart_stocking_learning_profile;
  if v_profile->>'profileVersion' is distinct from
      'SELLER_OS_SMART_STOCKING_LEARNING_PROFILE_V1'
    or v_profile->>'entrySnapshotHash'
      is distinct from v_authorization->>'entrySnapshotHash'
    or v_profile->>'decisionSnapshotHash'
      is distinct from v_authorization->>'decisionSnapshotHash'
    or v_binding->>'decisionPackageId'
      is distinct from v_authorization->>'decisionPackageId'
    or v_binding->>'entrySnapshotHash'
      is distinct from v_authorization->>'entrySnapshotHash'
    or v_binding->>'decisionSnapshotHash'
      is distinct from v_authorization->>'decisionSnapshotHash'
    or v_binding->>'frontierId'
      is distinct from v_authorization->>'frontierId'
    or v_binding->>'frontierDigest'
      is distinct from v_authorization->>'frontierDigest'
    or v_binding->>'snapshotDigest'
      is distinct from v_authorization->>'frontierSnapshotDigest'
    or v_binding#>>'{productTruth,evidenceDigest}'
      is distinct from v_authorization->>'productTruthDigest'
    or (v_binding->>'entryPotentialScore')::numeric is distinct from
      (v_authorization->>'entryPotentialScore')::numeric
    or v_binding->>'launchTier' is distinct from
      v_authorization->>'launchTier'
  then return false;
  end if;

  select * into v_frontier
  from public.seller_os_profitability_frontier_snapshots
  where frontier_id = v_authorization->>'frontierId'
    and account_key = p_account_key
    and marketplace_id = 'EBAY_US'
    and luna_product_id = v_opportunity.supplier_product_id
    and luna_variant_id = v_opportunity.supplier_variant_id
    and luna_sku = v_opportunity.supplier_sku;
  if v_frontier.frontier_id is null
    or v_frontier.frontier_digest
      is distinct from v_authorization->>'frontierDigest'
    or v_frontier.snapshot_digest
      is distinct from v_authorization->>'frontierSnapshotDigest'
    or v_frontier.product_fit not in ('STRONG', 'MEDIUM')
    or v_frontier.shipping_status <> 'SHIPPING_DURABLY_PERSISTED'
    or v_frontier.economic_classification <> 'ECONOMICALLY_PROMISING'
    or v_frontier.next_best_evidence <> 'NONE'
    or v_frontier.shipping_value is distinct from
      (v_authorization->>'supplierShippingUsd')::numeric
    or v_frontier.luna_cost is distinct from
      (v_authorization->>'supplierCostUsd')::numeric
    or v_frontier.market_price_median is distinct from
      (v_authorization->>'salePriceUsd')::numeric
    or v_frontier.contribution_profit_median is distinct from
      (v_authorization->>'contributionProfitUsd')::numeric
    or v_frontier.contribution_margin_median is distinct from
      (v_authorization->>'contributionMarginPercent')::numeric
  then return false;
  end if;

  if v_package.package_data#>>'{pricing,calculationSource}'
      is distinct from
        'SELLER_OS_SMART_STOCKING_FINAL_ECONOMICS_DURABLE_READBACK_V1'
    or v_package.package_data#>'{pricing,passesProfitGate}'
      is distinct from 'true'::jsonb
    or (v_package.package_data#>>'{pricing,targetPrice}')::numeric
      is distinct from (v_authorization->>'salePriceUsd')::numeric
    or (v_package.package_data#>>'{pricing,supplierCost}')::numeric
      is distinct from (v_authorization->>'supplierCostUsd')::numeric
    or (v_package.package_data#>>'{pricing,estimatedOutboundShipping}')::numeric
      is distinct from (v_authorization->>'supplierShippingUsd')::numeric
    or (v_package.package_data#>>'{pricing,estimatedEbayFees}')::numeric
      is distinct from (v_authorization->>'estimatedEbayFeesUsd')::numeric
    or (v_package.package_data#>>'{pricing,estimatedNetProfit}')::numeric
      is distinct from (v_authorization->>'contributionProfitUsd')::numeric
    or (v_package.package_data#>>'{pricing,estimatedNetMarginPercent}')::numeric
      is distinct from
        (v_authorization->>'contributionMarginPercent')::numeric
    or (v_package.package_data#>>'{pricing,estimatedRoiPercent}')::numeric
      is distinct from (v_authorization->>'roiPercent')::numeric
    or v_approval.approved_payload#>>'{sourceEvidence,opportunityId}'
      is distinct from v_opportunity.id::text
    or v_approval.approved_payload#>>'{sourceEvidence,candidateKey}'
      is distinct from v_opportunity.candidate_key
    or v_approval.approved_payload#>>'{sourceEvidence,supplierSku}'
      is distinct from v_opportunity.supplier_sku
    or v_approval.approved_payload#>>'{sourceEvidence,supplierVariantId}'
      is distinct from v_opportunity.supplier_variant_id
    or v_approval.approved_payload#>>'{sourceEvidence,gtin}'
      is distinct from v_opportunity.gtin
    or v_approval.approved_payload#>'{sourceEvidence,supplierInventoryQuantity}'
      is distinct from coalesce(to_jsonb(v_opportunity.supplier_inventory_quantity),
        'null'::jsonb)
    or v_approval.approved_payload#>>'{offerPayload,pricingSummary,price,value}'
      is distinct from to_char(
        (v_authorization->>'salePriceUsd')::numeric, 'FM999999990.00'
      )
  then return false;
  end if;
  return true;
exception when others then
  return false;
end;
$$;

revoke all on function public.is_ebay_smart_stocking_authorized_publication_v1(
  uuid, uuid, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.is_ebay_smart_stocking_authorized_publication_v1(
  uuid, uuid, uuid, uuid, text
) to service_role;

comment on function public.is_ebay_smart_stocking_authorized_publication_v1(
  uuid, uuid, uuid, uuid, text
) is 'Validates any exact Smart Stocking candidate against its current package, Product Truth, append-only Frontier, immutable learning hashes, and one-shot human authorization; no legacy opportunity blockers are inherited.';

notify pgrst, 'reload schema';
