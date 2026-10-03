-- The exact GetItem observation is current at OWNER confirmation time. A
-- previously imported ebay_active_listings row is only a durable item anchor.
-- OWNER-selected exact Luna tuples may resolve semantic family parsing gaps;
-- source identity blocks and contradictory tuples remain rejected.
alter table public.seller_os_listing_product_link_authorities_v1
  drop constraint seller_os_listing_link_preflight_check;
alter table public.seller_os_listing_product_link_authorities_v1
  add constraint seller_os_listing_link_preflight_check check (
    identity_preflight_status in (
      'PREFLIGHT_PASS', 'HISTORICAL_CERTIFIED_EXACT',
      'OWNER_CONFIRMED_EXACT'));

do $migration$
declare
  v_function text;
  v_old text;
  v_new text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.confirm_seller_os_listing_manual_identity_v1(text,text,uuid,text,text,text,timestamptz,text,text,integer,numeric,text,uuid)'::pg_catalog.regprocedure)
    into v_function;
  v_old := $old$if not found or v_sweep.official_observed_at < v_now - interval '20 minutes'$old$;
  v_new := $new$if not found or v_sweep.official_observed_at is null$new$;
  if (pg_catalog.length(v_function) - pg_catalog.length(
      pg_catalog.replace(v_function,v_old,''))) <> pg_catalog.length(v_old) then
    raise exception 'MANUAL_IDENTITY_SWEEP_GUARD_ANCHOR_MISMATCH';
  end if;
  v_function := pg_catalog.replace(v_function,v_old,v_new);

  v_old := $old$or v_active.last_ebay_sync_at < v_now - interval '36 hours'$old$;
  if (pg_catalog.length(v_function) - pg_catalog.length(
      pg_catalog.replace(v_function,v_old,''))) <> pg_catalog.length(v_old) then
    raise exception 'MANUAL_IDENTITY_STALE_CACHE_GUARD_ANCHOR_MISMATCH';
  end if;
  v_function := pg_catalog.replace(v_function,v_old,'');

  v_old := $old$v_snapshot.preflight_status<>'PREFLIGHT_PASS'$old$;
  v_new := $new$(v_snapshot.preflight_status is null or
      v_snapshot.preflight_status not in
        ('PREFLIGHT_PASS','SEMANTIC_IDENTITY_INCOMPLETE'))$new$;
  if (pg_catalog.length(v_function) - pg_catalog.length(
      pg_catalog.replace(v_function,v_old,''))) <> pg_catalog.length(v_old) then
    raise exception 'MANUAL_IDENTITY_SOURCE_STATUS_GUARD_ANCHOR_MISMATCH';
  end if;
  execute pg_catalog.replace(v_function,v_old,v_new);

  select pg_catalog.pg_get_functiondef(
    'public.transition_seller_os_listing_product_link_authority_v1(text,text,text,text,text,text,text,text)'::pg_catalog.regprocedure)
    into v_function;
  v_old := $old$if not found or v_snapshot.preflight_status is distinct from 'PREFLIGHT_PASS' then
    raise exception 'LISTING_LINK_AUTHORITY_PREFLIGHT_PASS_REQUIRED';
  end if;$old$;
  v_new := $new$if not found then
    raise exception 'LISTING_LINK_AUTHORITY_PREFLIGHT_SOURCE_UNAVAILABLE';
  end if;
  if v_snapshot.preflight_status = 'PREFLIGHT_PASS' then
    v_preflight := 'PREFLIGHT_PASS';
  elsif v_snapshot.preflight_status = 'SEMANTIC_IDENTITY_INCOMPLETE'
    and p_actor_type = 'OWNER'
    and v_decision.actor_user_id is not null
    and p_actor_reference = 'OWNER:' || v_decision.actor_user_id::text
    and v_decision.provenance#>>'{identityEvidenceProvenance,acquisitionMethod}' =
      'OWNER_SELECTED_CURRENT_LUNA_IDENTITY'
    and v_decision.provenance#>>'{identityEvidenceProvenance,sourceStatus}' =
      'AVAILABLE'
    and v_decision.provenance->>'customLabelUsedAsIdentity' = 'false' then
    v_preflight := 'OWNER_CONFIRMED_EXACT';
  else
    raise exception 'LISTING_LINK_AUTHORITY_PREFLIGHT_PASS_REQUIRED';
  end if;$new$;
  if (pg_catalog.length(v_function) - pg_catalog.length(
      pg_catalog.replace(v_function,v_old,''))) <> pg_catalog.length(v_old) then
    raise exception 'MANUAL_IDENTITY_AUTHORITY_GUARD_ANCHOR_MISMATCH';
  end if;
  v_function := pg_catalog.replace(v_function,v_old,v_new);
  v_old := $old$'PREFLIGHT_PASS',v_snapshot.source_fingerprint$old$;
  v_new := $new$v_preflight,v_snapshot.source_fingerprint$new$;
  if (pg_catalog.length(v_function) - pg_catalog.length(
      pg_catalog.replace(v_function,v_old,''))) <> pg_catalog.length(v_old) then
    raise exception 'MANUAL_IDENTITY_AUTHORITY_RECEIPT_ANCHOR_MISMATCH';
  end if;
  execute pg_catalog.replace(v_function,v_old,v_new);
end;
$migration$;
