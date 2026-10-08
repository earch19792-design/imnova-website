-- Move every active Seller OS pg_cron dispatcher from Vercel to the
-- productive Cloudflare -> local Docker origin. Vault values remain encrypted;
-- application tables continue to store secret names only.

do $migrate_selfhost_endpoint$
declare
  v_endpoint_secret_id uuid;
  v_selfhost_origin constant text :=
    'https://selleros.sunshineecommerce-llc.com';
begin
  perform pg_advisory_xact_lock(
    hashtextextended('seller-os-selfhost-scheduler-origin-v1', 0)
  );

  select secret.id
    into v_endpoint_secret_id
  from vault.secrets as secret
  where secret.name = 'seller_os_same_day_preview_url_v1'
  order by secret.updated_at desc nulls last, secret.created_at desc
  limit 1;

  if v_endpoint_secret_id is null then
    raise exception 'SELLER_OS_SELFHOST_ENDPOINT_VAULT_SECRET_MISSING';
  end if;

  perform vault.update_secret(
    secret_id := v_endpoint_secret_id,
    new_secret := v_selfhost_origin
  );

  update public.ebay_monitoring_scheduler_config
  set vercel_bypass_secret_name = null,
      endpoint_reference_hash = encode(
        extensions.digest(v_selfhost_origin, 'sha256'), 'hex'
      ),
      updated_at = clock_timestamp()
  where singleton;

  update public.ebay_same_day_pilot_scheduler_config
  set vercel_bypass_secret_name = null,
      endpoint_reference_hash = encode(
        extensions.digest(v_selfhost_origin, 'sha256'), 'hex'
      ),
      updated_at = clock_timestamp()
  where singleton;

  update public.seller_os_post_runtime_scheduler_v1
  set vercel_bypass_secret_name = null,
      updated_at = clock_timestamp()
  where vercel_bypass_secret_name is not null;
end;
$migrate_selfhost_endpoint$;

-- The three dispatcher functions are mature and contain substantial gate and
-- receipt logic. Rewrite only their endpoint allowlist in place so all other
-- safeguards and grants remain byte-for-byte equivalent.
do $allow_selfhost_origin$
declare
  v_signature regprocedure;
  v_definition text;
  v_rewritten text;
begin
  foreach v_signature in array array[
    'public.dispatch_seller_os_post_runtime_v1(text,timestamp with time zone)'::regprocedure,
    'public.dispatch_same_day_pilot_staging_worker(text,timestamp with time zone)'::regprocedure,
    'public.dispatch_ebay_monitoring_staging_worker(text,timestamp with time zone)'::regprocedure
  ] loop
    select pg_get_functiondef(v_signature) into v_definition;

    v_rewritten := replace(
      replace(
        v_definition,
        $needle_brackets$v_endpoint_url !~* '^https://[A-Za-z0-9][A-Za-z0-9.-]*[.]vercel[.]app$'$needle_brackets$,
        $selfhost_check$v_endpoint_url <> 'https://selleros.sunshineecommerce-llc.com'$selfhost_check$
      ),
      $needle_escaped$v_endpoint_url !~* '^https://[A-Za-z0-9][A-Za-z0-9.-]*\.vercel\.app$'$needle_escaped$,
      $selfhost_check$v_endpoint_url <> 'https://selleros.sunshineecommerce-llc.com'$selfhost_check$
    );

    if v_rewritten = v_definition then
      raise exception 'SELLER_OS_SELFHOST_ALLOWLIST_REWRITE_NOT_APPLIED: %',
        v_signature::text;
    end if;

    execute v_rewritten;
  end loop;
end;
$allow_selfhost_origin$;

-- This lane embeds its pg_net request directly instead of calling a dispatcher.
-- Reschedule it without the obsolete Vercel protection-bypass header.
select cron.schedule(
  'seller-os-luna-catalog-snapshot-refresh-v1',
  '0 */6 * * *',
  $command$
    select net.http_post(
      url := (
        select rtrim(decrypted_secret, '/') ||
          '/api/cron/luna-catalog-snapshot'
        from vault.decrypted_secrets
        where name = 'seller_os_same_day_preview_url_v1'
        order by updated_at desc nulls last, created_at desc
        limit 1
      ),
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'seller_os_same_day_cron_secret_v1'
          order by updated_at desc nulls last, created_at desc
          limit 1
        ),
        'Content-Type', 'application/json',
        'User-Agent', 'seller-os-luna-catalog-snapshot-cron/1'
      ),
      body := jsonb_build_object(
        'triggerSource', 'SUPABASE_PG_CRON',
        'contractVersion', 'LUNA_CATALOG_SNAPSHOT_SCHEDULE_V1'
      ),
      timeout_milliseconds := 240000
    );
  $command$
);

comment on function public.dispatch_seller_os_post_runtime_v1(
  text, timestamptz
) is
  'Queues allowlisted POST-only Seller OS runtimes to the productive self-hosted origin; secret values are never returned.';

notify pgrst, 'reload schema';
