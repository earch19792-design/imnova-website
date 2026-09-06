create index ebay_mayel_visual_delegation_revoked_by_idx
  on public.ebay_mayel_visual_delegation_authorities_v1(revoked_by)
  where revoked_by is not null;
