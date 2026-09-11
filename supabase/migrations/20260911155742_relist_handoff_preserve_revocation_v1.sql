-- A revoked canonical decision outranks historical manual certification.
do $migration$
declare d text; anchor text := ' select d.actor_user_id,d.decision_id as reference into v_link';
begin
 select pg_get_functiondef('public.resolve_relist_supplier_handoff_v1(text,text,boolean)'::regprocedure) into d;
 if strpos(d,'PREDECESSOR_LINKAGE_REVOKED_OR_CONFLICTED')=0 then
  if strpos(d,anchor)=0 then raise exception 'RELIST_REVOCATION_PATCH_TARGET_MISSING'; end if;
  d:=replace(d,anchor,$guard$
 if exists(select 1 from (
  select decision from public.seller_os_luna_linkage_decisions
  where account_key=p_account_key and marketplace_id='EBAY_US' and ebay_item_id=v_old.ebay_item_id
  order by decision_version desc limit 1
 ) current_decision where decision is distinct from 'APPROVE_EXACT_LINKAGE') then
  return jsonb_build_object('status','REQUIRES_ATTENTION','reason','PREDECESSOR_LINKAGE_REVOKED_OR_CONFLICTED','ownerActionRequired',true);
 end if;
$guard$||anchor);
  execute d;
 end if;
end;
$migration$;
