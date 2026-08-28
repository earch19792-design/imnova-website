-- Preserve the existing authorized publication contract while replacing its
-- legacy "unknown quantity means zero" gate. A NULL supplier quantity is
-- eligible only when the existing durable Smart Stocking authority proves a
-- fresh, exact, supplier-stated in-stock state. Explicit numeric quantities
-- remain authoritative and values below one remain blocked.

do $migration$
declare
  v_signature regprocedure :=
    'public.prepare_ebay_authorized_listing_publication(uuid,uuid,text,text,jsonb,text,text)'::regprocedure;
  v_definition text;
  v_legacy_gate text := $old$
    or coalesce(v_opportunity.supplier_inventory_quantity, 0) < 1
$old$;
  v_canonical_gate text := $new$
    or (
      v_opportunity.supplier_inventory_quantity is null
      and not public.is_ebay_smart_stocking_authorized_publication_v1(
        v_approval.id, v_package.id, v_opportunity.id,
        p_actor_user_id, p_marketplace_account_key
      )
    )
    or (
      v_opportunity.supplier_inventory_quantity is not null
      and v_opportunity.supplier_inventory_quantity < 1
    )
$new$;
begin
  select pg_get_functiondef(v_signature) into strict v_definition;

  if strpos(v_definition, v_canonical_gate) > 0 then
    return;
  end if;
  if strpos(v_definition, v_legacy_gate) = 0
    or strpos(lower(v_definition),
      'create or replace function public.prepare_ebay_authorized_listing_publication') = 0
    or strpos(v_definition,
      'public.is_ebay_smart_stocking_authorized_publication_v1') = 0 then
    raise exception 'EBAY_CANONICAL_STOCK_QUANTITY_GATE_PATCH_TARGET_MISSING';
  end if;

  -- pg_get_functiondef returns the full CREATE OR REPLACE contract. Executing
  -- the exact definition with this one bounded replacement preserves the
  -- signature, security mode, privileges, ledgers and one-shot semantics.
  execute replace(v_definition, v_legacy_gate, v_canonical_gate);
end;
$migration$;

do $assertion$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public.prepare_ebay_authorized_listing_publication(uuid,uuid,text,text,jsonb,text,text)'::regprocedure
  ) into strict v_definition;

  if strpos(v_definition,
      'v_opportunity.supplier_inventory_quantity is null') = 0
    or strpos(v_definition,
      'is_ebay_smart_stocking_authorized_publication_v1') = 0
    or strpos(v_definition,
      'v_opportunity.supplier_inventory_quantity is not null') = 0
    or strpos(v_definition,
      'v_opportunity.supplier_inventory_quantity < 1') = 0
    or strpos(v_definition,
      'coalesce(v_opportunity.supplier_inventory_quantity, 0) < 1') > 0 then
    raise exception 'EBAY_CANONICAL_STOCK_QUANTITY_GATE_ALIGNMENT_FAILED';
  end if;
end;
$assertion$;

comment on function public.prepare_ebay_authorized_listing_publication(
  uuid, uuid, text, text, jsonb, text, text
) is
  'Prepares the existing one-shot publication from its consumed exact approval. Unknown supplier quantity is accepted only through fresh durable Smart Stocking stock authority; explicit zero and non-current stock remain blocked.';

notify pgrst, 'reload schema';
