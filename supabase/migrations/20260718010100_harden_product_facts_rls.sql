-- Defense in depth for the Loop 2 fact ledger: service-role is the only actor
-- with select/insert grants and even a table owner must obey RLS.

alter table public.marketplace_product_fact_conflicts force row level security;
alter table public.marketplace_product_fact_requirements force row level security;
alter table public.marketplace_offer_pack_fact_profiles force row level security;
alter table public.marketplace_shipping_package_profiles force row level security;

notify pgrst, 'reload schema';
