-- SELLER_OS_AMAZON_CONNIE_PROPOSAL_INBOX_AND_BUY_BOX_V1
-- Reuse the existing SKU attribution authority to hold newly discovered
-- listings for owner review. A candidate is not attributed to Connie until the
-- owner confirms it while recording cost and supplier availability.

alter table public.seller_os_amazon_contributor_sku_attribution_v1
  drop constraint if exists seller_os_amazon_attribution_basis_check;
alter table public.seller_os_amazon_contributor_sku_attribution_v1
  add constraint seller_os_amazon_attribution_basis_check check (
    attribution_basis in (
      'SKU_PREFIX', 'OWNER_CONFIRMED', 'RECENT_LISTING_CANDIDATE'
    )
  );

alter table public.seller_os_amazon_contributor_sku_attribution_v1
  drop constraint if exists seller_os_amazon_attribution_status_check;
alter table public.seller_os_amazon_contributor_sku_attribution_v1
  add constraint seller_os_amazon_attribution_status_check check (
    status in ('ACTIVE', 'PENDING_REVIEW', 'IGNORED')
  );

update public.seller_os_sourcing_collaborators_v1
set evidence_policy = evidence_policy || jsonb_build_object(
  'recentListingProposalInbox', true,
  'recentListingLookbackDays', 14,
  'pendingCandidateIsConnieAttribution', false,
  'ownerCostQuantityConfirmsAttribution', true,
  'buyBoxAuthority', 'AMAZON_PRODUCT_PRICING_API_READ_ONLY',
  'feeEstimateAuthority', 'AMAZON_PRODUCT_FEES_API_READ_ONLY',
  'salesRankIsDemandSupportNotExactUnits', true
), updated_at = now()
where collaborator_key = 'connie-g-yape';

comment on table public.seller_os_amazon_contributor_sku_attribution_v1 is
  'Durable Amazon SKU attribution and owner-only proposal inbox. PENDING_REVIEW rows are candidates only and are not evidence that Connie created the listing.';

notify pgrst, 'reload schema';
