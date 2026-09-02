-- Admit the existing exact Quick Pick authorization to the existing
-- post-publication Luna lineage handoff. This preserves every identity,
-- StockGuard, package, active-listing, and manual-link guard. It also extends
-- the existing one-shot compensated recovery to this exact attachment error.
-- No marketplace operation is performed by this migration.

do $patch_quick_pick_lineage_handoff$
declare
  v_signature regprocedure :=
    'public.handoff_ebay_authorized_publication_luna_linkage_v1(uuid,text,uuid,uuid)'
      ::regprocedure;
  v_definition text;
  v_declaration_old text := '  v_authorization jsonb;';
  v_declaration_new text := v_declaration_old || E'\n' ||
    '  v_quick_pick_authorization boolean := false;';
  v_authorization_old text := $old$
  v_authorization := v_approval.approved_payload
    #> '{compliance,smartStockingPublicationAuthorization}';$old$;
  v_authorization_new text := $new$
  v_quick_pick_authorization := jsonb_typeof(
    v_approval.approved_payload
      #> '{compliance,quickPickPublicationAuthorization}'
  ) = 'object';
  v_authorization := case when v_quick_pick_authorization then
    v_approval.approved_payload
      #> '{compliance,quickPickPublicationAuthorization}'
  else
    v_approval.approved_payload
      #> '{compliance,smartStockingPublicationAuthorization}'
  end;$new$;
  v_object_guard_old text :=
    '    or jsonb_typeof(v_authorization) is distinct from ''object''';
  v_object_guard_new text := $new$
    or (v_quick_pick_authorization and not
      public.is_ebay_quick_pick_authorized_publication_v1(
        v_approval.id, v_package.id, v_opportunity.id,
        v_publication.actor_user_id,
        v_publication.marketplace_account_key
      ))
    or jsonb_typeof(v_authorization) is distinct from 'object'$new$;
  v_version_old text := $old$
    or v_authorization ->> 'version' is distinct from
      'SELLER_OS_SMART_STOCKING_AUTHORIZED_PUBLICATION_V1'$old$;
  v_version_new text := $new$
    or (
      v_quick_pick_authorization
      and v_authorization ->> 'version' is distinct from
        'SELLER_OS_QUICK_PICK_CANONICAL_PUBLICATION_AUTHORIZATION_V1'
    )
    or (
      not v_quick_pick_authorization
      and v_authorization ->> 'version' is distinct from
        'SELLER_OS_SMART_STOCKING_AUTHORIZED_PUBLICATION_V1'
    )$new$;
  v_gtin_old text := $old$
    or v_authorization ->> 'gtin' is distinct from v_opportunity.gtin$old$;
  v_gtin_new text := $new$
    or (
      v_quick_pick_authorization
      and coalesce(v_authorization ->> 'gtin', '') is distinct from
        coalesce(v_opportunity.gtin, '')
    )
    or (
      not v_quick_pick_authorization
      and v_authorization ->> 'gtin' is distinct from v_opportunity.gtin
    )$new$;
  v_source_old text := $old$
    or v_authorization ->> 'sourceRevalidationAuthority' is distinct from
      'SMART_STOCKING_EXACT_PRODUCT_TRUTH_DURABLE_REVALIDATION_V1'$old$;
  v_source_new text := $new$
    or (
      v_quick_pick_authorization
      and v_authorization ->> 'sourceRevalidationAuthority' is distinct from
        'QUICK_PICK_DURABLE_GOLDEN_PATH_REVALIDATION_V1'
    )
    or (
      not v_quick_pick_authorization
      and v_authorization ->> 'sourceRevalidationAuthority' is distinct from
        'SMART_STOCKING_EXACT_PRODUCT_TRUTH_DURABLE_REVALIDATION_V1'
    )$new$;
begin
  select pg_get_functiondef(v_signature) into strict v_definition;
  if strpos(v_definition, v_declaration_new) = 0 then
    if strpos(v_definition, v_declaration_old) = 0
      or strpos(v_definition, v_authorization_old) = 0
      or strpos(v_definition, v_object_guard_old) = 0
      or strpos(v_definition, v_version_old) = 0
      or strpos(v_definition, v_gtin_old) = 0
      or strpos(v_definition, v_source_old) = 0 then
      raise exception 'QUICK_PICK_LINEAGE_HANDOFF_PATCH_TARGET_MISSING';
    end if;
    v_definition := replace(
      v_definition, v_declaration_old, v_declaration_new
    );
    v_definition := replace(
      v_definition, v_authorization_old, v_authorization_new
    );
    v_definition := replace(
      v_definition, v_object_guard_old, v_object_guard_new
    );
    v_definition := replace(v_definition, v_version_old, v_version_new);
    v_definition := replace(v_definition, v_gtin_old, v_gtin_new);
    v_definition := replace(v_definition, v_source_old, v_source_new);
    execute v_definition;
  end if;
end;
$patch_quick_pick_lineage_handoff$;

do $patch_compensated_recovery_error_allowlist$
declare
  v_signature regprocedure :=
    'public.rearm_ebay_authorized_listing_after_compensated_monitor_failure(uuid,uuid,text,text)'
      ::regprocedure;
  v_definition text;
  v_guard_old text := $old$
    or p_expected_error_code <>
      'EBAY_FINAL_PUBLICATION_MONITOR_PERSIST_FAILED' then$old$;
  v_guard_new text := $new$
    or p_expected_error_code not in (
      'EBAY_FINAL_PUBLICATION_MONITOR_PERSIST_FAILED',
      'EBAY_FINAL_PUBLICATION_LUNA_LINEAGE_HANDOFF_FAILED'
    ) then$new$;
begin
  select pg_get_functiondef(v_signature) into strict v_definition;
  if strpos(v_definition,
      '''EBAY_FINAL_PUBLICATION_LUNA_LINEAGE_HANDOFF_FAILED''') = 0 then
    if strpos(v_definition, v_guard_old) = 0 then
      raise exception 'QUICK_PICK_LINEAGE_RECOVERY_PATCH_TARGET_MISSING';
    end if;
    execute replace(v_definition, v_guard_old, v_guard_new);
  end if;
end;
$patch_compensated_recovery_error_allowlist$;

do $assert_quick_pick_lineage_reconciliation$
declare
  v_handoff text;
  v_rearm text;
begin
  select pg_get_functiondef(
    'public.handoff_ebay_authorized_publication_luna_linkage_v1(uuid,text,uuid,uuid)'
      ::regprocedure
  ) into strict v_handoff;
  select pg_get_functiondef(
    'public.rearm_ebay_authorized_listing_after_compensated_monitor_failure(uuid,uuid,text,text)'
      ::regprocedure
  ) into strict v_rearm;
  if strpos(v_handoff, 'v_quick_pick_authorization boolean := false') = 0
    or strpos(v_handoff,
      'is_ebay_quick_pick_authorized_publication_v1') = 0
    or strpos(v_handoff,
      'SELLER_OS_QUICK_PICK_CANONICAL_PUBLICATION_AUTHORIZATION_V1') = 0
    or strpos(v_handoff,
      'QUICK_PICK_DURABLE_GOLDEN_PATH_REVALIDATION_V1') = 0
    or strpos(v_handoff,
      'coalesce(v_authorization ->> ''gtin'', '''')') = 0
    or strpos(v_handoff,
      'SMART_STOCKING_EXACT_PRODUCT_TRUTH_DURABLE_REVALIDATION_V1') = 0
    or strpos(v_handoff, 'MANUAL_LIVE_SUCCESSOR') = 0
    or strpos(v_rearm,
      'EBAY_FINAL_PUBLICATION_LUNA_LINEAGE_HANDOFF_FAILED') = 0 then
    raise exception 'QUICK_PICK_LINEAGE_RECONCILIATION_INSTALLATION_FAILED';
  end if;
end;
$assert_quick_pick_lineage_reconciliation$;

comment on function
  public.handoff_ebay_authorized_publication_luna_linkage_v1(
    uuid, text, uuid, uuid
  ) is
  'Idempotently certifies exact Luna linkage from the already-authorized Smart Stocking or canonical Quick Pick package after controlled publication or verified manual LIVE succession. It retains exact identity and StockGuard guards and performs no marketplace write.';

comment on function
  public.rearm_ebay_authorized_listing_after_compensated_monitor_failure(
    uuid, uuid, text, text
  ) is
  'Rearms the same immutable package and Offer once after a fresh official GET proves that a compensated monitor or Luna-lineage attachment failure left no current LIVE listing. It performs no marketplace write.';

notify pgrst, 'reload schema';
