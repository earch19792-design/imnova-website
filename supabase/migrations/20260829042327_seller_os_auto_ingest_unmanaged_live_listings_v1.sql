-- Extend the existing manual LIVE intake with an explicit, service-only
-- deterministic authority. The same official GetItem, duplicate guard,
-- durable linkage, monitoring and StockGuard contracts remain authoritative.
-- No marketplace method is introduced or called here.

alter table public.seller_os_luna_linkage_decisions
  alter column actor_user_id drop not null;

alter table public.seller_os_luna_linkage_decisions
  drop constraint seller_os_luna_linkage_decision_provenance_check;

alter table public.seller_os_luna_linkage_decisions
  add constraint seller_os_luna_linkage_decision_provenance_check check (
    (
      actor_user_id is not null
      and provenance = jsonb_build_object(
        'authorityClass', 'HUMAN_DECISION',
        'identityEvidenceClass', 'SUPPLIER_CURRENT_IDENTITY',
        'stockEvidenceUsed', false,
        'identityEvidenceProvenance', identity_evidence_provenance
      )
    ) or (
      actor_user_id is null
      and decision = 'APPROVE_EXACT_LINKAGE'
      and classification = 'EXACT_UNIQUE_MATCH'
      and provenance = jsonb_build_object(
        'authorityClass', 'DETERMINISTIC_EXACT_IDENTITY',
        'identityEvidenceClass', 'SUPPLIER_CURRENT_IDENTITY',
        'stockEvidenceUsed', false,
        'identityEvidenceProvenance', identity_evidence_provenance
      )
    )
  );

comment on column public.seller_os_luna_linkage_decisions.actor_user_id is
  'Human actor for manual linkage decisions; null only for service-role deterministic exact identity auto-intake proven by the row provenance.';

do $extend_manual_live_bound_core_for_exact_auto_intake$
declare
  v_signature regprocedure :=
    'public.register_ebay_manual_listing_link_bound_core_v2(text,text,text,uuid,text,text,text,text,text,text,text,timestamptz,jsonb,uuid)'
      ::regprocedure;
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(v_signature) into strict v_definition;
  v_updated := replace(
    v_definition,
    '  v_bound_handoff_label boolean := false;',
    '  v_bound_handoff_label boolean := false;' || E'\n' ||
    '  v_automated_supplier_label boolean := false;'
  );
  v_updated := replace(
    v_updated,
    E'    if p_connector_ebay_sku is distinct from v_expected_ebay_sku then\n',
    E'    v_automated_supplier_label :=\n' ||
    E'      p_actor_user_id is null\n' ||
    E'      and p_verification_reason =\n' ||
    E'        ''OWNERSHIP_AND_DETERMINISTIC_IDENTITY_CONFIRMED_TRADING_READONLY''\n' ||
    E'      and p_supplier_sku ~ ''^[A-Za-z0-9][A-Za-z0-9._:-]{0,49}$''\n' ||
    E'      and p_connector_ebay_sku = p_supplier_sku;\n\n' ||
    E'    if p_connector_ebay_sku is distinct from v_expected_ebay_sku\n' ||
    E'      and not v_automated_supplier_label then\n'
  );
  v_updated := replace(
    v_updated,
    E'    else\n      v_core_connector_sku := p_connector_ebay_sku;\n    end if;\n',
    E'    elsif v_automated_supplier_label then\n' ||
    E'      v_core_connector_sku := v_expected_ebay_sku;\n' ||
    E'      v_reason :=\n' ||
    E'        ''OWNERSHIP_AND_DETERMINISTIC_IDENTITY_CONFIRMED_TRADING_READONLY'';\n' ||
    E'    else\n' ||
    E'      v_core_connector_sku := p_connector_ebay_sku;\n' ||
    E'    end if;\n'
  );
  v_updated := replace(
    v_updated,
    'if p_verification_status = ''verified'' and v_bound_handoff_label then',
    'if p_verification_status = ''verified'' and ' ||
      '(v_bound_handoff_label or v_automated_supplier_label) then'
  );
  v_updated := replace(
    v_updated,
    E'        ''productIdentityBinding'',\n          ''AUTHORITATIVE_MANUAL_HANDOFF_CUSTOM_LABEL''\n',
    E'        ''productIdentityBinding'',\n' ||
    E'          case when v_automated_supplier_label then\n' ||
    E'            ''DETERMINISTIC_EXACT_SUPPLIER_CUSTOM_LABEL''\n' ||
    E'          else ''AUTHORITATIVE_MANUAL_HANDOFF_CUSTOM_LABEL'' end\n'
  );
  if v_updated = v_definition
    or strpos(v_updated, 'v_automated_supplier_label boolean') = 0
    or strpos(v_updated,
      'DETERMINISTIC_EXACT_SUPPLIER_CUSTOM_LABEL') = 0 then
    raise exception 'UNMANAGED_LIVE_AUTO_INTAKE_BOUND_CORE_PATCH_FAILED';
  end if;
  execute v_updated;
end;
$extend_manual_live_bound_core_for_exact_auto_intake$;

do $skip_legacy_pilot_transition_for_auto_intake$
declare
  v_signature regprocedure :=
    'public.register_ebay_manual_listing_link(text,text,text,uuid,text,text,text,text,text,text,text,timestamptz,jsonb,uuid)'
      ::regprocedure;
  v_definition text;
  v_updated text;
  v_anchor text := E'  );\n\n  if p_verification_status <> ''verified'' then';
  v_replacement text := E'  );\n\n' ||
    E'  if p_actor_user_id is null and p_verification_reason =\n' ||
    E'      ''OWNERSHIP_AND_DETERMINISTIC_IDENTITY_CONFIRMED_TRADING_READONLY'' then\n' ||
    E'    return next v_link;\n' ||
    E'    return;\n' ||
    E'  end if;\n\n' ||
    E'  if p_verification_status <> ''verified'' then';
begin
  select pg_get_functiondef(v_signature) into strict v_definition;
  if strpos(v_definition, v_anchor) = 0 then
    raise exception 'UNMANAGED_LIVE_AUTO_INTAKE_OUTER_WRAPPER_TARGET_MISSING';
  end if;
  v_updated := replace(v_definition, v_anchor, v_replacement);
  execute v_updated;
end;
$skip_legacy_pilot_transition_for_auto_intake$;

do $extend_manual_live_certification_for_exact_auto_intake$
declare
  v_signature regprocedure :=
    'public.certify_ebay_manual_live_luna_linkage_v1(text,uuid,uuid,uuid)'
      ::regprocedure;
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(v_signature) into strict v_definition;
  v_updated := replace(
    v_definition,
    E'    or p_actor_user_id is null then\n',
    E'    then\n'
  );
  v_updated := replace(
    v_updated,
    E'      and v_active.raw_payload ->> ''canonicalPackageSku'' =\n        v_expected_package_sku\n    );',
    E'      and v_active.raw_payload ->> ''canonicalPackageSku'' =\n' ||
    E'        v_expected_package_sku\n' ||
    E'    ) or (\n' ||
    E'      p_actor_user_id is null\n' ||
    E'      and v_link.verification_reason =\n' ||
    E'        ''OWNERSHIP_AND_DETERMINISTIC_IDENTITY_CONFIRMED_TRADING_READONLY''\n' ||
    E'      and v_active.raw_payload ->> ''productIdentityBinding'' =\n' ||
    E'        ''DETERMINISTIC_EXACT_SUPPLIER_CUSTOM_LABEL''\n' ||
    E'      and v_active.raw_payload ->> ''observedEbaySku'' = v_active.ebay_sku\n' ||
    E'      and v_active.raw_payload ->> ''canonicalPackageSku'' =\n' ||
    E'        v_expected_package_sku\n' ||
    E'      and v_active.ebay_sku = v_opportunity.supplier_sku\n' ||
    E'    );'
  );
  v_updated := replace(
    v_updated,
    E'    or v_link.marketplace_id <> ''EBAY_US''\n',
    E'    or v_link.marketplace_id <> ''EBAY_US''\n' ||
    E'    or (p_actor_user_id is null and v_link.verification_reason <>\n' ||
    E'      ''OWNERSHIP_AND_DETERMINISTIC_IDENTITY_CONFIRMED_TRADING_READONLY'')\n'
  );
  v_updated := replace(
    v_updated,
    'where publication.actor_user_id = p_actor_user_id',
    'where (p_actor_user_id is null or ' ||
      'publication.actor_user_id = p_actor_user_id)'
  );
  v_updated := replace(
    v_updated,
    'and approval.actor_user_id = p_actor_user_id',
    'and (p_actor_user_id is null or approval.actor_user_id = p_actor_user_id)'
  );
  v_updated := replace(
    v_updated,
    E'        ''authorityClass'', ''HUMAN_DECISION'',\n',
    E'        ''authorityClass'', case when p_actor_user_id is null then\n' ||
    E'          ''DETERMINISTIC_EXACT_IDENTITY'' else ''HUMAN_DECISION'' end,\n'
  );
  if v_updated = v_definition
    or strpos(v_updated, 'DETERMINISTIC_EXACT_IDENTITY') = 0
    or strpos(v_updated,
      'DETERMINISTIC_EXACT_SUPPLIER_CUSTOM_LABEL') = 0 then
    raise exception 'UNMANAGED_LIVE_AUTO_INTAKE_CERTIFICATION_PATCH_FAILED';
  end if;
  execute v_updated;
end;
$extend_manual_live_certification_for_exact_auto_intake$;

comment on function public.register_ebay_manual_listing_link(
  text, text, text, uuid, text, text, text, text, text, text, text,
  timestamptz, jsonb, uuid
) is
  'Shared manual/automatic LIVE intake. Human registrations retain HUMAN_DECISION; service-role exact deterministic registrations require official ACTIVE ownership, exact Custom Label, Product Truth, current Luna identity and duplicate guards. No eBay write.';

notify pgrst, 'reload schema';
