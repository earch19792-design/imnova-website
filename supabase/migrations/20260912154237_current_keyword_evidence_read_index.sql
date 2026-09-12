-- The CURRENT keyword reader validates the exact evidence manifest. Its
-- lateral read is keyed by capture batch, account and item, then chooses the
-- newest observation. Without this composite index PostgreSQL scans every
-- account observation once per canonical item and can cross the 4s
-- fail-closed Product Case budget.
create index if not exists
  marketplace_product_research_capture_current_keyword_read_idx
on public.marketplace_product_research_capture_observations(
  capture_batch_id,
  marketplace_account_key,
  source_listing_id,
  created_at desc,
  id
);

comment on index
  public.marketplace_product_research_capture_current_keyword_read_idx is
  'Bounded CURRENT Keyword V2.1 evidence-manifest readback by exact capture/account/item; no authority semantics are relaxed.';
