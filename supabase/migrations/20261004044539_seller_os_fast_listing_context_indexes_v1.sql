-- Cover restrict-FK checks without altering canonical records or permissions.
create index fast_listing_opportunity_v1 on public.seller_os_fast_listing_contexts_v1(opportunity_id);
create index fast_listing_owner_v1 on public.seller_os_fast_listing_contexts_v1(owner_user_id);
