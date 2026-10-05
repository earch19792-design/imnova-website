-- Cover the three foreign-key access paths added by commercial memory.
-- This is a non-destructive follow-up to the already-applied V1 migration.

create index if not exists ebay_luna_queue_commercial_receipt_idx
  on public.ebay_luna_opportunity_queue(
    commercial_evaluation_receipt_id
  ) where commercial_evaluation_receipt_id is not null;

create index if not exists ebay_luna_queue_market_family_case_idx
  on public.ebay_luna_opportunity_queue(
    market_family_id, market_opportunity_case_id
  ) where market_family_id is not null;

create index if not exists ebay_luna_queue_market_case_idx
  on public.ebay_luna_opportunity_queue(
    market_opportunity_case_id
  ) where market_opportunity_case_id is not null;
