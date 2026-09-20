create or replace function public.get_seller_os_control_oauth_resource_v1(
  p_authorization_id text,
  p_owner_user_id uuid,
  p_client_id uuid,
  p_redirect_uri text
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select oauth_authorization.resource
  from auth.oauth_authorizations as oauth_authorization
  where (select auth.jwt() ->> 'role') = 'service_role'
    and char_length(p_authorization_id) between 1 and 512
    and oauth_authorization.authorization_id = p_authorization_id
    and oauth_authorization.user_id = p_owner_user_id
    and oauth_authorization.client_id = p_client_id
    and oauth_authorization.redirect_uri = p_redirect_uri
    and oauth_authorization.status::text = 'pending'
    and oauth_authorization.approved_at is null
    and oauth_authorization.authorization_code is null
    and oauth_authorization.expires_at > now()
    and oauth_authorization.resource is not null
    and oauth_authorization.resource <> ''
  limit 1;
$$;

revoke all on function public.get_seller_os_control_oauth_resource_v1(
  text, uuid, uuid, text
) from public, anon, authenticated;

grant execute on function public.get_seller_os_control_oauth_resource_v1(
  text, uuid, uuid, text
) to service_role;

comment on function public.get_seller_os_control_oauth_resource_v1(
  text, uuid, uuid, text
) is
  'Service-role-only fail-closed lookup of the RFC 8707 resource stored by Supabase Auth for one pending, unexpired OWNER-bound Control OAuth authorization. Performs no mutation.';
