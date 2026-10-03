-- One protected supplier cart is a shared mutable resource across runtime instances.
-- Expired/crashed acquisition never silently releases an uncertain cart.
create index golden_managed_package_receipt_fk_v1 on public.seller_os_golden_managed_listings_v1(package_receipt_id);
create index golden_managed_reconciliation_receipt_fk_v1 on public.seller_os_golden_managed_listings_v1(reconciliation_receipt_id);
create index golden_managed_case_fk_v1 on public.seller_os_golden_managed_listings_v1(case_id);
create index golden_managed_authority_fk_v1 on public.seller_os_golden_managed_listings_v1(authority_id);
create table public.seller_os_golden_shipping_cart_leases_v1(
 resource_key text primary key check(resource_key='LUNA_PROTECTED_HTTP_QUOTE_CART_V1'),
 lease_id uuid,
 state text not null check(state in ('AVAILABLE','HELD','UNPROVEN')),
 acquired_at timestamptz,
 expires_at timestamptz,
 updated_at timestamptz not null default now(),
 check((state='HELD' and lease_id is not null and expires_at is not null) or state<>'HELD')
);
alter table public.seller_os_golden_shipping_cart_leases_v1 enable row level security;
alter table public.seller_os_golden_shipping_cart_leases_v1 force row level security;
revoke all on public.seller_os_golden_shipping_cart_leases_v1 from public,anon,authenticated;
grant select,insert,update on public.seller_os_golden_shipping_cart_leases_v1 to service_role;
create policy golden_cart_service_select on public.seller_os_golden_shipping_cart_leases_v1 for select to service_role using(true);
create policy golden_cart_service_insert on public.seller_os_golden_shipping_cart_leases_v1 for insert to service_role with check(true);
create policy golden_cart_service_update on public.seller_os_golden_shipping_cart_leases_v1 for update to service_role using(true) with check(true);
create function public.seller_os_claim_golden_shipping_cart_v1(p_lease_id uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare v public.seller_os_golden_shipping_cart_leases_v1%rowtype;
begin
 if p_lease_id is null then return false; end if;
 insert into public.seller_os_golden_shipping_cart_leases_v1(resource_key,state) values('LUNA_PROTECTED_HTTP_QUOTE_CART_V1','AVAILABLE') on conflict do nothing;
 select * into v from public.seller_os_golden_shipping_cart_leases_v1 where resource_key='LUNA_PROTECTED_HTTP_QUOTE_CART_V1' for update;
 if v.state='HELD' and v.expires_at<=now() then
  update public.seller_os_golden_shipping_cart_leases_v1 set state='UNPROVEN',updated_at=now() where resource_key=v.resource_key;
  return false;
 end if;
 if v.state<>'AVAILABLE' then return false; end if;
 update public.seller_os_golden_shipping_cart_leases_v1 set state='HELD',lease_id=p_lease_id,acquired_at=now(),expires_at=now()+interval '4 minutes',updated_at=now() where resource_key=v.resource_key;
 return true;
end; $$;
create function public.seller_os_release_golden_shipping_cart_v1(p_lease_id uuid,p_restore_proven boolean)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
 update public.seller_os_golden_shipping_cart_leases_v1 set state=case when p_restore_proven is true then 'AVAILABLE' else 'UNPROVEN' end,lease_id=null,expires_at=null,updated_at=now()
 where resource_key='LUNA_PROTECTED_HTTP_QUOTE_CART_V1' and state='HELD' and lease_id=p_lease_id;
 return found;
end; $$;
revoke all on function public.seller_os_claim_golden_shipping_cart_v1(uuid) from public,anon,authenticated;
revoke all on function public.seller_os_release_golden_shipping_cart_v1(uuid,boolean) from public,anon,authenticated;
grant execute on function public.seller_os_claim_golden_shipping_cart_v1(uuid) to service_role;
grant execute on function public.seller_os_release_golden_shipping_cart_v1(uuid,boolean) to service_role;
notify pgrst,'reload schema';
