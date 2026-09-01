-- Quick Pick already has an independently certified publication authority and
-- exact Luna linkage. After the active listing and manual linkage have both
-- been verified, do not require an unrelated Same-Day pilot candidate merely
-- to close the existing publication monitor ledger.

do $migration$
declare
  v_signature regprocedure :=
    'public.complete_ebay_authorized_listing_monitor_registration(uuid,uuid,text,uuid,uuid)'::regprocedure;
  v_definition text;
  v_old text := $old$
    if public.is_ebay_smart_stocking_authorized_publication_v1(
      v_publication.draft_approval_id,
      v_publication.listing_package_id,
      v_publication.opportunity_id,
      v_publication.actor_user_id,
      v_publication.marketplace_account_key
    ) then
      return next v_publication;
      return;
    end if;
    raise exception 'EBAY_AUTHORIZED_PUBLICATION_PILOT_CANDIDATE_REQUIRED';$old$;
  v_new text := $new$
    if public.is_ebay_smart_stocking_authorized_publication_v1(
      v_publication.draft_approval_id,
      v_publication.listing_package_id,
      v_publication.opportunity_id,
      v_publication.actor_user_id,
      v_publication.marketplace_account_key
    ) then
      return next v_publication;
      return;
    end if;
    if public.is_ebay_quick_pick_authorized_publication_v1(
      v_publication.draft_approval_id,
      v_publication.listing_package_id,
      v_publication.opportunity_id,
      v_publication.actor_user_id,
      v_publication.marketplace_account_key
    ) then
      return next v_publication;
      return;
    end if;
    raise exception 'EBAY_AUTHORIZED_PUBLICATION_PILOT_CANDIDATE_REQUIRED';$new$;
begin
  select pg_get_functiondef(v_signature) into strict v_definition;
  if strpos(v_definition, v_new) > 0 then
    return;
  end if;
  if strpos(v_definition, v_old) = 0
    or strpos(v_definition,
      'EBAY_AUTHORIZED_PUBLICATION_ACTIVE_EVIDENCE_REQUIRED') = 0 then
    raise exception 'EBAY_QUICK_PICK_MONITOR_PATCH_TARGET_MISSING';
  end if;
  execute replace(v_definition, v_old, v_new);
end;
$migration$;

do $assertion$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public.complete_ebay_authorized_listing_monitor_registration(uuid,uuid,text,uuid,uuid)'::regprocedure
  ) into strict v_definition;
  if strpos(v_definition,
      'is_ebay_smart_stocking_authorized_publication_v1') = 0
    or strpos(v_definition,
      'is_ebay_quick_pick_authorized_publication_v1') = 0
    or strpos(v_definition,
      'EBAY_AUTHORIZED_PUBLICATION_ACTIVE_EVIDENCE_REQUIRED') = 0
    or strpos(v_definition,
      'EBAY_AUTHORIZED_PUBLICATION_PILOT_CANDIDATE_REQUIRED') = 0 then
    raise exception 'EBAY_QUICK_PICK_MONITOR_ALIGNMENT_FAILED';
  end if;
end;
$assertion$;

notify pgrst, 'reload schema';
