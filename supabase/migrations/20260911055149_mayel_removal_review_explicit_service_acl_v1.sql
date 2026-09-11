begin;
-- Supabase project defaults may grant ALL to service_role on a new table.
-- This receipt authority supports append and revocation, never delete/truncate.
revoke all on public.seller_os_mayel_removal_reviews_v1 from service_role;
grant select,insert on public.seller_os_mayel_removal_reviews_v1 to service_role;
grant update(revoked_at) on public.seller_os_mayel_removal_reviews_v1 to service_role;
commit;
