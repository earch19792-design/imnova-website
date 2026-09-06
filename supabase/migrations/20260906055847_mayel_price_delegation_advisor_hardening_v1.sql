-- The revocation actor is an audited foreign key. Index it for bounded owner
-- authority investigations without making the ledger publicly readable.
create index ebay_mayel_price_delegation_revoked_by_idx
  on public.ebay_mayel_price_optimization_delegation_authorities_v1(
    revoked_by, revoked_at desc
  ) where revoked_by is not null;
