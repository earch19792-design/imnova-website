-- Keep the durable Same-Day scheduler on the stable staging alias. A unique
-- Vercel preview URL stops receiving new commits and silently leaves pg_cron
-- executing an obsolete worker after the next deployment.
do $migration$
declare
  v_endpoint constant text :=
    'https://imnova-ebay-mobile-preprod.vercel.app';
  v_secret_name constant text := 'seller_os_same_day_preview_url_v1';
  v_secret_id uuid;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('seller-os-same-day-pilot-staging-v1:endpoint', 0)
  );

  if not exists (
    select 1
    from public.ebay_same_day_pilot_scheduler_config config
    where config.singleton = true
      and config.environment = 'STAGING'
      and config.deployment_scope = 'PREVIEW'
      and config.supabase_project_ref = 'vsfthqydfrdzulldbfbe'
      and config.endpoint_url_secret_name = v_secret_name
  ) then
    raise exception 'SAME_DAY_PILOT_STAGING_ENDPOINT_CONFIG_REQUIRED';
  end if;

  select secret.id
    into v_secret_id
  from vault.decrypted_secrets secret
  where secret.name = v_secret_name
  order by secret.updated_at desc nulls last, secret.created_at desc
  limit 1;

  if v_secret_id is null then
    raise exception 'SAME_DAY_PILOT_STAGING_ENDPOINT_SECRET_REQUIRED';
  end if;

  perform vault.update_secret(
    v_secret_id,
    v_endpoint,
    v_secret_name,
    'Stable Vercel staging alias for the Seller OS Same-Day pilot scheduler'
  );

  update public.ebay_same_day_pilot_scheduler_config
  set endpoint_reference_hash = encode(
        extensions.digest(v_endpoint, 'sha256'),
        'hex'
      ),
      updated_at = clock_timestamp()
  where singleton = true
    and environment = 'STAGING'
    and deployment_scope = 'PREVIEW'
    and supabase_project_ref = 'vsfthqydfrdzulldbfbe'
    and endpoint_url_secret_name = v_secret_name;

  if not found then
    raise exception 'SAME_DAY_PILOT_STAGING_ENDPOINT_UPDATE_FAILED';
  end if;
end;
$migration$;

-- Preview aliases can carry a different environment copy of the worker
-- secret. Authenticate the durable scheduler against the canonical staging
-- Vault value as a fallback, using only SHA-256 digests across the RPC
-- boundary. The raw secret never leaves Vault or appears in PostgREST args.
create or replace function public.verify_same_day_pilot_staging_worker_authorization(
  p_authorization_sha256_values text[]
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
begin
  if coalesce(cardinality(p_authorization_sha256_values), 0) not between 1 and 2
    or exists (
      select 1
      from unnest(p_authorization_sha256_values) value
      where value !~ '^[0-9a-f]{64}$'
    ) then
    return false;
  end if;

  return exists (
    select 1
    from public.ebay_same_day_pilot_scheduler_config config
    join vault.decrypted_secrets secret
      on secret.name = config.authorization_secret_name
    where config.singleton = true
      and config.enabled = true
      and config.environment = 'STAGING'
      and config.deployment_scope = 'PREVIEW'
      and config.supabase_project_ref = 'vsfthqydfrdzulldbfbe'
      and encode(
        extensions.digest(
          'Bearer ' || trim(secret.decrypted_secret),
          'sha256'
        ),
        'hex'
      ) = any (p_authorization_sha256_values)
  );
end;
$function$;

revoke all on function
  public.verify_same_day_pilot_staging_worker_authorization(text[])
from public, anon, authenticated;

grant execute on function
  public.verify_same_day_pilot_staging_worker_authorization(text[])
to service_role;
