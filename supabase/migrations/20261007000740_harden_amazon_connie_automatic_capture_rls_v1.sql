-- Explicit browser deny policies complement revoked grants. The server-side
-- service role remains the only runtime authority and bypasses RLS by design.

drop policy if exists "deny browser amazon contributor sync state"
  on public.seller_os_amazon_contributor_sync_state_v1;
create policy "deny browser amazon contributor sync state"
  on public.seller_os_amazon_contributor_sync_state_v1
  as restrictive for all to anon, authenticated
  using (false) with check (false);

drop policy if exists "deny browser amazon contributor sku attribution"
  on public.seller_os_amazon_contributor_sku_attribution_v1;
create policy "deny browser amazon contributor sku attribution"
  on public.seller_os_amazon_contributor_sku_attribution_v1
  as restrictive for all to anon, authenticated
  using (false) with check (false);

notify pgrst, 'reload schema';
