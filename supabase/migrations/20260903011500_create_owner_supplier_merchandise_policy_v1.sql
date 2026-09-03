-- Durable, account-scoped owner supplier policy. This is not Product Truth and
-- cannot authorize an eBay write; it only supplies Condition after exact Luna
-- product + variant + SKU lineage has been independently certified.

create table if not exists public.seller_os_owner_supplier_policies_v1 (
  id uuid primary key default gen_random_uuid(),
  marketplace_account_key text not null,
  marketplace text not null,
  supplier_code text not null,
  policy_code text not null,
  policy_version text not null,
  decision text not null,
  policy_payload jsonb not null,
  evidence_digest text not null,
  authorization_reference_digest text not null,
  certification_actor_class text not null,
  certification_source text not null,
  certified_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint seller_os_owner_supplier_policy_marketplace_check
    check (marketplace = 'EBAY_US'),
  constraint seller_os_owner_supplier_policy_decision_check
    check (decision = 'CERTIFIED'),
  constraint seller_os_owner_supplier_policy_actor_check
    check (certification_actor_class = 'OWNER'),
  constraint seller_os_owner_supplier_policy_digest_check
    check (evidence_digest ~ '^sha256:[0-9a-f]{64}$'
      and authorization_reference_digest ~ '^sha256:[0-9a-f]{64}$'),
  constraint seller_os_owner_supplier_policy_payload_check check (
    jsonb_typeof(policy_payload) = 'object'
    and policy_payload ? 'statement'
    and policy_payload ? 'conditionLabel'
    and policy_payload ? 'exactSupplierLineageRequired'
    and policy_payload ? 'productIdentityExactRequired'
  ),
  unique (
    marketplace_account_key, marketplace, supplier_code, policy_code,
    policy_version, evidence_digest
  )
);

create unique index if not exists
  seller_os_owner_supplier_policy_one_active_version_v1
on public.seller_os_owner_supplier_policies_v1 (
  marketplace_account_key, marketplace, supplier_code, policy_code
)
where revoked_at is null;

create or replace function public.enforce_owner_supplier_policy_immutable_v1()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE'
    and old.revoked_at is null
    and new.revoked_at is not null
    and new.revoked_at >= old.certified_at
    and (to_jsonb(new) - 'revoked_at') = (to_jsonb(old) - 'revoked_at')
  then
    return new;
  end if;
  raise exception 'OWNER_SUPPLIER_POLICY_APPEND_ONLY';
end;
$$;

drop trigger if exists seller_os_owner_supplier_policy_immutable_v1
  on public.seller_os_owner_supplier_policies_v1;
create trigger seller_os_owner_supplier_policy_immutable_v1
before update or delete on public.seller_os_owner_supplier_policies_v1
for each row execute function public.enforce_owner_supplier_policy_immutable_v1();

alter table public.seller_os_owner_supplier_policies_v1 enable row level security;
revoke all on table public.seller_os_owner_supplier_policies_v1
  from anon, authenticated;
revoke all on table public.seller_os_owner_supplier_policies_v1
  from service_role;
grant select, insert, update on table public.seller_os_owner_supplier_policies_v1
  to service_role;

comment on table public.seller_os_owner_supplier_policies_v1 is
  'Immutable owner certification scoped by account and supplier; only a one-way revocation timestamp is mutable. Never Product Truth and never marketplace-write authority.';
