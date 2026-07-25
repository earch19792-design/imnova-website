-- A same-day handoff can deliberately exclude every package measurement when
-- the verified flat shipping policy does not require them. Older workspace
-- drafts may still contain a partial supplier estimate (for example, weight
-- without dimensions). That partial value must not be sent to eBay and must
-- not prevent the approved package from opening.

do $migration$
declare
  v_definition text;
  v_updated_definition text;
  v_old text := $old$
    -- A flat verified shipping policy can make measurements optional.  The
    -- handoff explicitly excludes estimates, so preserve only an actually
    -- empty current measurement object and never manufacture dimensions.
    if jsonb_typeof(v_current_package_weight_and_size) <> 'object'
      or nullif(trim(coalesce(
        v_current_package_weight_and_size#>>'{dimensions,length}', ''
      )), '') is not null
      or nullif(trim(coalesce(
        v_current_package_weight_and_size#>>'{dimensions,width}', ''
      )), '') is not null
      or nullif(trim(coalesce(
        v_current_package_weight_and_size#>>'{dimensions,height}', ''
      )), '') is not null
      or nullif(trim(coalesce(
        v_current_package_weight_and_size#>>'{dimensions,unit}', ''
      )), '') is not null
      or nullif(trim(coalesce(
        v_current_package_weight_and_size#>>'{weight,value}', ''
      )), '') is not null
      or nullif(trim(coalesce(
        v_current_package_weight_and_size#>>'{weight,unit}', ''
      )), '') is not null then
      raise exception 'SAME_DAY_WORKSPACE_REFRESH_SHIPPING_INVALID';
    end if;
    v_package_weight_and_size := v_current_package_weight_and_size;
$old$;
  v_new text := $new$
    -- The handoff explicitly excludes every estimate. A prior workspace can
    -- contain an incomplete supplier placeholder, but it is neither confirmed
    -- nor safe for the Inventory API. Omit the entire measurement object; the
    -- verified flat policy remains authoritative and no value is invented.
    if jsonb_typeof(v_current_package_weight_and_size) <> 'object' then
      raise exception 'SAME_DAY_WORKSPACE_REFRESH_SHIPPING_INVALID';
    end if;
    v_package_weight_and_size := '{}'::jsonb;
$new$;
begin
  select pg_get_functiondef(
    'public.restore_ebay_same_day_authorized_listing_package_v1(uuid,text,uuid,uuid,text,jsonb,timestamptz,timestamptz)'::regprocedure
  ) into v_definition;

  if strpos(v_definition, v_old) = 0
    or strpos(
      substr(v_definition, strpos(v_definition, v_old) + length(v_old)),
      v_old
    ) > 0 then
    raise exception 'ESTIMATE_ONLY_SHIPPING_PATCH_TARGET_INVALID';
  end if;

  v_updated_definition := replace(v_definition, v_old, v_new);
  execute v_updated_definition;

  select pg_get_functiondef(
    'public.restore_ebay_same_day_authorized_listing_package_v1(uuid,text,uuid,uuid,text,jsonb,timestamptz,timestamptz)'::regprocedure
  ) into v_definition;

  if strpos(v_definition, v_new) = 0
    or strpos(v_definition, v_old) > 0
    or strpos(v_definition, 'ESTIMATE_ONLY_NOT_FOR_LISTING') = 0
    or strpos(v_definition, 'estimatedValuesExcluded') = 0
    or strpos(v_definition, 'operatorConfirmationRequired') = 0
    or strpos(v_definition, 'SAME_DAY_WORKSPACE_REFRESH_ALREADY_EXECUTED') = 0
    or strpos(v_definition, 'ebay_draft_only_execution_ledger') = 0
    or strpos(v_definition, 'ebay_authorized_listing_publications') = 0 then
    raise exception 'ESTIMATE_ONLY_SHIPPING_PATCH_VERIFY_FAILED';
  end if;
end;
$migration$;

comment on function public.restore_ebay_same_day_authorized_listing_package_v1(
  uuid, text, uuid, uuid, text, jsonb, timestamptz, timestamptz
) is 'Rebuilds one internal Seller OS workspace from its exact human-approved V6/text image control, current handoff and verified account profile; estimate-only shipping omits unconfirmed partial measurements, accepts no image URL and performs zero eBay/Production writes.';
