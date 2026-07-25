-- The final monitor-registration RPC was created with search_path limited to
-- public and pg_temp but called pgcrypto.digest without its extensions schema.
-- The listing and commercial monitor can therefore be persisted successfully
-- while the one-shot publication ledger remains pending. Qualify that existing
-- call; this migration performs no eBay operation and changes no listing.

do $migration$
declare
  v_signature regprocedure :=
    'public.complete_ebay_authorized_listing_monitor_registration(uuid,uuid,text,uuid,uuid)'::regprocedure;
  v_definition text;
  v_old text := 'encode(digest(convert_to(concat(';
  v_new text := 'encode(extensions.digest(convert_to(concat(';
begin
  select pg_get_functiondef(v_signature)
  into strict v_definition;

  if position(v_new in v_definition) > 0 then
    return;
  end if;
  if position(v_old in v_definition) = 0 then
    raise exception 'EBAY_FINAL_MONITOR_DIGEST_REWRITE_NOT_APPLIED';
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
  )
  into strict v_definition;

  if position(
    'encode(extensions.digest(convert_to(concat('
    in v_definition
  ) = 0
    or position(
      'encode(digest(convert_to(concat('
      in v_definition
    ) > 0 then
    raise exception 'EBAY_FINAL_MONITOR_DIGEST_ASSERTION_FAILED';
  end if;
end;
$assertion$;

comment on function
  public.complete_ebay_authorized_listing_monitor_registration(
    uuid, uuid, text, uuid, uuid
  )
is
  'Closes an already-published listing with verified ACTIVE evidence and commercial-monitor linkage; uses schema-qualified pgcrypto and never calls eBay.';

notify pgrst, 'reload schema';
