-- Preserve sanitized eBay publish errors and permit one explicitly authorized
-- recovery only for a known HTTP 400 rejection that created no listing.

alter table public.ebay_authorized_listing_publications
  add column if not exists publish_recovery_count integer not null default 0
    check (publish_recovery_count between 0 and 1);

create or replace function public.fail_ebay_authorized_listing_publication(
  p_publication_id uuid,
  p_actor_user_id uuid,
  p_claim_token uuid,
  p_http_status integer,
  p_error_code text,
  p_outcome_unknown boolean,
  p_error_details jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(p_error_code, '') !~ '^[A-Z0-9_]{3,120}$'
    or jsonb_typeof(coalesce(p_error_details, '{}'::jsonb)) <> 'object' then
    raise exception 'EBAY_AUTHORIZED_PUBLICATION_ERROR_INVALID';
  end if;
  update public.ebay_authorized_listing_publications
  set phase = case
        when p_outcome_unknown then 'outcome_unknown'
        else 'terminal_failure'
      end,
      publish_http_status = p_http_status,
      last_error_code = p_error_code,
      sanitized_result = jsonb_build_object(
        'httpStatus', p_http_status,
        'errorCode', p_error_code,
        'details', coalesce(p_error_details, '{}'::jsonb)
      ),
      claim_token = null,
      lease_expires_at = null,
      updated_at = clock_timestamp()
  where id = p_publication_id
    and actor_user_id = p_actor_user_id
    and phase = 'publish_in_flight'
    and claim_token = p_claim_token;
  return found;
end;
$$;

create or replace function
  public.rearm_ebay_authorized_listing_publication_once(
    p_publication_id uuid,
    p_actor_user_id uuid,
    p_confirm_publish text,
    p_expected_error_code text
  )
returns setof public.ebay_authorized_listing_publications
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_publication public.ebay_authorized_listing_publications%rowtype;
begin
  if p_actor_user_id is null
    or p_confirm_publish <> 'PUBLICAR LISTING EN EBAY'
    or p_expected_error_code <> 'EBAY_PUBLISH_WRITE_REJECTED' then
    raise exception 'EBAY_AUTHORIZED_PUBLICATION_RECOVERY_INVALID';
  end if;

  select * into v_publication
  from public.ebay_authorized_listing_publications
  where id = p_publication_id
  for update;
  if not found
    or v_publication.actor_user_id is distinct from p_actor_user_id
    or v_publication.phase <> 'terminal_failure'
    or v_publication.publish_http_status <> 400
    or v_publication.last_error_code is distinct from p_expected_error_code
    or v_publication.listing_id is not null
    or v_publication.publish_attempt_count <> 1
    or v_publication.publish_recovery_count <> 0 then
    raise exception 'EBAY_AUTHORIZED_PUBLICATION_RECOVERY_NOT_ELIGIBLE';
  end if;

  update public.ebay_authorized_listing_publications
  set phase = 'preview_ready',
      publication_idempotency_key = null,
      publish_attempt_count = 0,
      publish_recovery_count = 1,
      publish_started_at = null,
      preview_prepared_at = clock_timestamp(),
      claim_token = null,
      lease_expires_at = null,
      sanitized_result = sanitized_result || jsonb_build_object(
        'recoveryAuthorizedAt', clock_timestamp(),
        'recoveryReason', p_expected_error_code
      ),
      updated_at = clock_timestamp()
  where id = p_publication_id
  returning * into v_publication;
  return next v_publication;
end;
$$;

revoke all on function public.fail_ebay_authorized_listing_publication(
  uuid, uuid, uuid, integer, text, boolean, jsonb
) from public, anon, authenticated;
grant execute on function public.fail_ebay_authorized_listing_publication(
  uuid, uuid, uuid, integer, text, boolean, jsonb
) to service_role;

revoke all on function
  public.rearm_ebay_authorized_listing_publication_once(
    uuid, uuid, text, text
  )
from public, anon, authenticated;
grant execute on function
  public.rearm_ebay_authorized_listing_publication_once(
    uuid, uuid, text, text
  )
to service_role;

comment on function
  public.rearm_ebay_authorized_listing_publication_once(
    uuid, uuid, text, text
  )
is
  'Rearms one exact preview after a known HTTP 400 publish rejection, only once and only when no listing ID exists.';

notify pgrst, 'reload schema';
