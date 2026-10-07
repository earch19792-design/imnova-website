-- Keep this internal authority service-only and least-privileged.
revoke all on public.seller_os_amazon_contributor_sku_attribution_v1
  from public, anon, authenticated, service_role;
grant select, insert, update on
  public.seller_os_amazon_contributor_sku_attribution_v1 to service_role;

notify pgrst, 'reload schema';
