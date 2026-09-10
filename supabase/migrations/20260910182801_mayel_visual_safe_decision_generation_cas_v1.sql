begin;
-- Keep the tested promotion contract and add compare-and-swap at both durable
-- boundaries. An overlapping review cannot overwrite another manifest.
do $$
declare definition text; needle text;
begin
 definition:=pg_get_functiondef('public.seller_os_record_visual_safe_decision_v1(text,uuid,uuid,uuid,jsonb)'::regprocedure);
 needle:='or p_decision->>''writeAuthority'' is distinct from ''false''';
 if position(needle in definition)=0 then raise exception 'VISUAL_DECISION_CAS_BASE_CONTRACT_CHANGED'; end if;
 execute replace(definition,needle,needle||E'\n or p_decision->>''baseManifestDigest'' is distinct from t.visual_manifest_digest');
 definition:=pg_get_functiondef('public.promote_ebay_mayel_visual_asset_v1(text,uuid,uuid,uuid,text,text,jsonb,jsonb,text)'::regprocedure);
 needle:='or p_qa_result->''transitionDecision'' is distinct from v_asset.qa_result->''transitionDecision''';
 if position(needle in definition)=0 then raise exception 'VISUAL_PROMOTION_CAS_BASE_CONTRACT_CHANGED'; end if;
 execute replace(definition,needle,needle||E'\n    or (v_asset.status=''pending_review'' and p_qa_result #>> ''{transitionDecision,baseManifestDigest}'' is distinct from v_task.visual_manifest_digest)');
end $$;
notify pgrst,'reload schema';
commit;
