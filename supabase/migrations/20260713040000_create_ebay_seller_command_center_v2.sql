-- Seller Command Center V2
-- Internal, read-only eBay discovery orchestration. Nothing in this migration
-- creates an eBay Inventory Item, Offer, draft, or published listing.

create table if not exists public.ebay_seller_automation_runs (
  id uuid primary key default gen_random_uuid(),
  run_kind text not null,
  trigger_source text not null default 'schedule',
  status text not null default 'running',
  worker_id text null,
  scan_run_id uuid null references public.ebay_luna_scan_runs(id) on delete set null,
  lanes text[] not null default '{}'::text[],
  claimed_tasks integer not null default 0,
  successful_tasks integer not null default 0,
  failed_tasks integer not null default 0,
  dead_letter_tasks integer not null default 0,
  metrics jsonb not null default '{}'::jsonb,
  last_error_code text null,
  started_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  completed_at timestamptz null,
  constraint ebay_seller_automation_runs_kind_check check (
    run_kind in ('luna_sync', 'ebay_scan', 'risk_monitor', 'alert_delivery', 'manual_acceleration')
  ),
  constraint ebay_seller_automation_runs_trigger_check check (
    trigger_source in ('schedule', 'mobile', 'admin', 'event', 'recovery')
  ),
  constraint ebay_seller_automation_runs_status_check check (
    status in ('running', 'completed', 'partial', 'failed', 'cancelled')
  )
);

create table if not exists public.ebay_seller_scan_tasks (
  id uuid primary key default gen_random_uuid(),
  task_key text not null unique,
  task_kind text not null default 'opportunity_assessment',
  candidate_key text not null,
  market_radar_product_id uuid null references public.market_radar_products(id) on delete cascade,
  supplier_product_id text null,
  supplier_variant_id text null,
  supplier_sku text null,
  lane text not null default 'coverage',
  priority numeric(8,2) not null default 0,
  status text not null default 'queued',
  due_at timestamptz not null default now(),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  lease_owner text null,
  lease_expires_at timestamptz null,
  last_started_at timestamptz null,
  last_completed_at timestamptz null,
  last_error_code text null,
  last_error_detail text null,
  source_snapshot_id uuid null references public.market_radar_snapshots(id) on delete set null,
  source_observed_at timestamptz null,
  last_result jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ebay_seller_scan_tasks_kind_check check (
    task_kind in ('opportunity_assessment', 'active_listing_protection')
  ),
  constraint ebay_seller_scan_tasks_lane_check check (
    lane in ('protection', 'event', 'hot', 'baseline', 'coverage')
  ),
  constraint ebay_seller_scan_tasks_status_check check (
    status in ('queued', 'leased', 'retry', 'completed', 'dead_letter', 'cancelled')
  ),
  constraint ebay_seller_scan_tasks_attempts_check check (
    attempts >= 0 and max_attempts between 1 and 20
  ),
  constraint ebay_seller_scan_tasks_candidate_kind_unique unique (candidate_key, task_kind)
);

alter table public.ebay_luna_scan_runs
  add column if not exists automation_run_id uuid null
    references public.ebay_seller_automation_runs(id) on delete set null;

create table if not exists public.ebay_command_center_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  candidate_key text not null,
  opportunity_id uuid null references public.ebay_luna_opportunity_queue(id) on delete set null,
  status text not null default 'in_progress',
  current_step text not null default 'luna',
  form_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ebay_command_center_reviews_status_check check (
    status in ('in_progress', 'blocked', 'ready_for_package', 'completed', 'abandoned')
  ),
  constraint ebay_command_center_reviews_step_check check (
    current_step in ('luna', 'ebay', 'economics', 'listing', 'review')
  ),
  constraint ebay_command_center_reviews_user_candidate_unique unique (user_id, candidate_key)
);

create table if not exists public.ebay_listing_packages (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null unique references public.ebay_luna_opportunity_queue(id) on delete cascade,
  candidate_key text not null,
  status text not null default 'draft',
  package_data jsonb not null default '{}'::jsonb,
  readiness numeric(6,2) not null default 0,
  source_observed_at timestamptz null,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ebay_listing_packages_status_check check (
    status in ('draft', 'ready_for_review', 'approved', 'rejected', 'archived')
  ),
  constraint ebay_listing_packages_readiness_check check (
    readiness between 0 and 100
  )
);

create table if not exists public.ebay_seller_alert_outbox (
  id uuid primary key default gen_random_uuid(),
  alert_fingerprint text not null unique,
  alert_type text not null,
  priority text not null default 'medium',
  entity_type text not null,
  entity_id text not null,
  candidate_key text null,
  channel text not null default 'in_app',
  status text not null default 'pending',
  payload jsonb not null default '{}'::jsonb,
  due_at timestamptz not null default now(),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  lease_owner text null,
  lease_expires_at timestamptz null,
  delivered_at timestamptz null,
  last_error_code text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ebay_seller_alert_outbox_priority_check check (
    priority in ('critical', 'high', 'medium', 'low')
  ),
  constraint ebay_seller_alert_outbox_status_check check (
    status in ('pending', 'leased', 'delivered', 'failed', 'dead_letter', 'cancelled')
  ),
  constraint ebay_seller_alert_outbox_channel_check check (
    channel in ('in_app', 'whatsapp', 'email')
  )
);

create table if not exists public.ebay_seller_alert_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null references public.ebay_seller_alert_outbox(id) on delete cascade,
  attempt_number integer not null,
  channel text not null,
  status text not null,
  provider_message_id text null,
  response_code text null,
  error_code text null,
  attempted_at timestamptz not null default now(),
  completed_at timestamptz null,
  constraint ebay_seller_alert_delivery_attempts_channel_check check (
    channel in ('in_app', 'whatsapp', 'email')
  ),
  constraint ebay_seller_alert_delivery_attempts_status_check check (
    status in ('started', 'delivered', 'failed')
  ),
  constraint ebay_seller_alert_delivery_attempt_unique unique (alert_id, attempt_number, channel)
);

-- An eBay item can contain multiple offers/variations. Identity for read-only
-- reconciliation must therefore be account + source + offer/variant sync key,
-- never ebay_item_id alone.
alter table public.ebay_active_listings
  add column if not exists source text not null default 'manual',
  add column if not exists account_key text not null default 'default',
  add column if not exists sync_key text null,
  add column if not exists sync_run_id uuid null,
  add column if not exists supplier_cost_at_linking numeric(12,2) null;

alter table public.ebay_active_listings
  drop constraint if exists ebay_active_listings_item_unique;

create unique index if not exists ebay_active_listings_sync_key_uidx
  on public.ebay_active_listings(sync_key);

create index if not exists ebay_active_listings_source_account_status_idx
  on public.ebay_active_listings(source, account_key, listing_status, updated_at desc);

alter table public.ebay_active_listing_risk_events
  add column if not exists risk_fingerprint text null,
  add column if not exists first_detected_at timestamptz not null default now(),
  add column if not exists last_detected_at timestamptz not null default now(),
  add column if not exists occurrence_count integer not null default 1,
  add column if not exists evidence jsonb not null default '{}'::jsonb;

alter table public.ebay_active_listing_risk_events
  drop constraint if exists ebay_active_listing_risk_type_check;
alter table public.ebay_active_listing_risk_events
  add constraint ebay_active_listing_risk_type_check check (
    risk_type in (
      'out_of_stock', 'low_stock', 'stock_unknown', 'price_up', 'margin_review',
      'listing_stale', 'mapping_broken', 'demand_down', 'manual_review'
    )
  );

update public.ebay_active_listing_risk_events
set risk_fingerprint = concat('legacy:', id::text)
where risk_fingerprint is null;

alter table public.ebay_active_listing_risk_events
  alter column risk_fingerprint set not null;

create unique index if not exists ebay_active_listing_risk_fingerprint_uidx
  on public.ebay_active_listing_risk_events(risk_fingerprint);

create index if not exists ebay_seller_scan_tasks_claim_idx
  on public.ebay_seller_scan_tasks(status, due_at, priority desc)
  where status in ('queued', 'retry', 'leased');
create index if not exists ebay_seller_scan_tasks_lane_due_idx
  on public.ebay_seller_scan_tasks(lane, due_at, priority desc);
create index if not exists ebay_seller_scan_tasks_candidate_idx
  on public.ebay_seller_scan_tasks(candidate_key);
create index if not exists ebay_seller_automation_runs_time_idx
  on public.ebay_seller_automation_runs(run_kind, started_at desc);
create index if not exists ebay_command_center_reviews_activity_idx
  on public.ebay_command_center_reviews(user_id, updated_at desc);
create index if not exists ebay_listing_packages_status_idx
  on public.ebay_listing_packages(status, readiness desc, updated_at desc);
create index if not exists ebay_seller_alert_outbox_delivery_idx
  on public.ebay_seller_alert_outbox(status, due_at, priority)
  where status in ('pending', 'failed', 'leased');

create or replace function public.ebay_seller_candidate_task_key(
  p_supplier_product_id text,
  p_product_id uuid,
  p_supplier_variant_id text,
  p_supplier_sku text
)
returns text
language sql
immutable
parallel safe
as $$
  select concat(
    'opportunity_assessment:luna-portex:',
    coalesce(nullif(trim(p_supplier_product_id), ''), p_product_id::text),
    ':',
    coalesce(nullif(trim(p_supplier_variant_id), ''), nullif(trim(p_supplier_sku), ''), 'default')
  );
$$;

create or replace function public.reconcile_ebay_seller_scan_tasks(
  p_limit integer default 2000,
  p_force_due boolean default false
)
returns table(inserted_or_updated integer, due_now integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changed integer := 0;
  v_due integer := 0;
begin
  insert into public.ebay_seller_scan_tasks (
    task_key,
    task_kind,
    candidate_key,
    market_radar_product_id,
    supplier_product_id,
    supplier_variant_id,
    supplier_sku,
    lane,
    priority,
    status,
    due_at,
    source_snapshot_id,
    source_observed_at,
    metadata,
    updated_at
  )
  select
    public.ebay_seller_candidate_task_key(
      latest.supplier_product_id,
      latest.product_id,
      latest.supplier_variant_id,
      latest.sku
    ),
    'opportunity_assessment',
    replace(public.ebay_seller_candidate_task_key(
      latest.supplier_product_id,
      latest.product_id,
      latest.supplier_variant_id,
      latest.sku
    ), 'opportunity_assessment:', ''),
    latest.product_id,
    latest.supplier_product_id,
    latest.supplier_variant_id,
    latest.sku,
    case
      when exists (
        select 1 from public.ebay_active_listings listing
        where listing.listing_status = 'active'
          and listing.market_radar_product_id = latest.product_id
          and (listing.supplier_variant_id is null or listing.supplier_variant_id = latest.supplier_variant_id)
      ) then 'protection'
      when coalesce(latest.restock_count_7d, 0) > 0
        or coalesce(latest.price_change_count_7d, 0) > 0 then 'event'
      when coalesce(queue.queue_status, '') in ('ready', 'review')
        or coalesce(queue.opportunity_score, 0) >= 65 then 'hot'
      when coalesce(latest.seller_scan_priority_score, 0) >= 55 then 'baseline'
      else 'coverage'
    end,
    greatest(0, least(120,
      coalesce(latest.seller_scan_priority_score, 0) +
      case when queue.queue_status = 'ready' then 25 when queue.queue_status = 'review' then 15 else 0 end +
      case when latest.available is true then 5 else -20 end +
      case when exists (
        select 1 from public.ebay_active_listings listing
        where listing.listing_status = 'active'
          and listing.market_radar_product_id = latest.product_id
      ) then 30 else 0 end
    )),
    'queued',
    case when p_force_due then now() else coalesce(queue.next_scan_at, now()) end,
    latest.snapshot_id,
    latest.captured_at,
    jsonb_build_object(
      'sellerScanRiskHint', latest.seller_scan_risk_hint,
      'radarOpportunityScore', latest.radar_opportunity_score,
      'seededAt', now()
    ),
    now()
  from public.market_radar_latest_variants latest
  left join public.ebay_luna_opportunity_queue queue
    on queue.candidate_key = replace(public.ebay_seller_candidate_task_key(
      latest.supplier_product_id,
      latest.product_id,
      latest.supplier_variant_id,
      latest.sku
    ), 'opportunity_assessment:', '')
  left join public.ebay_seller_scan_tasks seeded_task
    on seeded_task.candidate_key = replace(public.ebay_seller_candidate_task_key(
      latest.supplier_product_id,
      latest.product_id,
      latest.supplier_variant_id,
      latest.sku
    ), 'opportunity_assessment:', '')
    and seeded_task.task_kind = 'opportunity_assessment'
  where latest.source_key = 'lunaportex'
  order by
    (seeded_task.id is null) desc,
    (seeded_task.source_snapshot_id is distinct from latest.snapshot_id) desc,
    latest.seller_scan_priority_score desc nulls last,
    latest.product_id,
    latest.supplier_variant_id
  limit greatest(1, least(coalesce(p_limit, 2000), 10000))
  on conflict (candidate_key, task_kind) do update set
    task_key = excluded.task_key,
    market_radar_product_id = excluded.market_radar_product_id,
    supplier_product_id = excluded.supplier_product_id,
    supplier_variant_id = excluded.supplier_variant_id,
    supplier_sku = excluded.supplier_sku,
    lane = excluded.lane,
    priority = excluded.priority,
    source_snapshot_id = excluded.source_snapshot_id,
    source_observed_at = excluded.source_observed_at,
    metadata = public.ebay_seller_scan_tasks.metadata || excluded.metadata,
    status = case
      when public.ebay_seller_scan_tasks.status = 'leased' then 'leased'
      when p_force_due then 'queued'
      when public.ebay_seller_scan_tasks.source_snapshot_id is distinct from excluded.source_snapshot_id
        and excluded.lane in ('protection', 'event', 'hot') then 'queued'
      when public.ebay_seller_scan_tasks.status = 'completed'
        and public.ebay_seller_scan_tasks.due_at <= now() then 'queued'
      else public.ebay_seller_scan_tasks.status
    end,
    due_at = case
      when public.ebay_seller_scan_tasks.status = 'leased' then public.ebay_seller_scan_tasks.due_at
      when p_force_due then now()
      when public.ebay_seller_scan_tasks.source_snapshot_id is distinct from excluded.source_snapshot_id
        and excluded.lane in ('protection', 'event', 'hot') then now()
      else public.ebay_seller_scan_tasks.due_at
    end,
    attempts = case
      when public.ebay_seller_scan_tasks.status <> 'leased' and p_force_due then 0
      when public.ebay_seller_scan_tasks.status <> 'leased'
        and public.ebay_seller_scan_tasks.source_snapshot_id is distinct from excluded.source_snapshot_id
        and excluded.lane in ('protection', 'event', 'hot') then 0
      else public.ebay_seller_scan_tasks.attempts
    end,
    last_error_code = case
      when public.ebay_seller_scan_tasks.status <> 'leased' and p_force_due then null
      else public.ebay_seller_scan_tasks.last_error_code
    end,
    updated_at = now()
  where p_force_due
    or public.ebay_seller_scan_tasks.source_snapshot_id is distinct from excluded.source_snapshot_id
    or public.ebay_seller_scan_tasks.lane is distinct from excluded.lane
    or public.ebay_seller_scan_tasks.priority is distinct from excluded.priority
    or public.ebay_seller_scan_tasks.supplier_sku is distinct from excluded.supplier_sku;

  get diagnostics v_changed = row_count;

  update public.ebay_seller_scan_tasks task
  set status = 'cancelled',
      last_error_code = 'CANDIDATE_NO_LONGER_CURRENT',
      updated_at = now()
  where task.task_kind = 'opportunity_assessment'
    and task.status in ('queued', 'retry', 'completed')
    and task.updated_at < now() - interval '24 hours'
    and not exists (
      select 1
      from public.market_radar_latest_variants latest
      where latest.source_key = 'lunaportex'
        and replace(public.ebay_seller_candidate_task_key(
          latest.supplier_product_id,
          latest.product_id,
          latest.supplier_variant_id,
          latest.sku
        ), 'opportunity_assessment:', '') = task.candidate_key
    );

  select count(*) into v_due
  from public.ebay_seller_scan_tasks
  where status in ('queued', 'retry') and due_at <= now();

  return query select v_changed, v_due;
end;
$$;

create or replace function public.claim_ebay_seller_scan_tasks(
  p_worker_id text,
  p_limit integer default 2,
  p_lease_seconds integer default 120,
  p_lanes text[] default null
)
returns setof public.ebay_seller_scan_tasks
language plpgsql
security definer
set search_path = public
as $$
begin
  if nullif(trim(p_worker_id), '') is null then
    raise exception 'WORKER_ID_REQUIRED';
  end if;

  update public.ebay_seller_scan_tasks
  set status = 'queued',
      updated_at = now()
  where status = 'completed' and due_at <= now();

  update public.ebay_seller_scan_tasks
  set status = case when attempts >= max_attempts then 'dead_letter' else 'retry' end,
      lease_owner = null,
      lease_expires_at = null,
      due_at = now(),
      last_error_code = coalesce(last_error_code, 'LEASE_EXPIRED'),
      updated_at = now()
  where status = 'leased' and lease_expires_at < now();

  return query
  with claimable as (
    select task.id
    from public.ebay_seller_scan_tasks task
    where task.status in ('queued', 'retry')
      and task.due_at <= now()
      and (p_lanes is null or task.lane = any(p_lanes))
    order by
      case when task.lane = 'protection' then 1 else 0 end desc,
      task.priority +
        case task.lane when 'event' then 30 when 'hot' then 20 when 'baseline' then 10 else 0 end +
        least(100, greatest(0, extract(epoch from (now() - task.due_at)) / 1800)) desc,
      task.due_at,
      task.task_key
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 2), 25))
  )
  update public.ebay_seller_scan_tasks task
  set status = 'leased',
      attempts = task.attempts + 1,
      lease_owner = trim(p_worker_id),
      lease_expires_at = now() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 120), 900))),
      last_started_at = now(),
      updated_at = now()
  from claimable
  where task.id = claimable.id
  returning task.*;
end;
$$;

create or replace function public.complete_ebay_seller_scan_task(
  p_task_id uuid,
  p_worker_id text,
  p_result jsonb default '{}'::jsonb
)
returns public.ebay_seller_scan_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.ebay_seller_scan_tasks;
begin
  update public.ebay_seller_scan_tasks task
  set status = 'completed',
      due_at = now() + case task.lane
        when 'protection' then interval '6 hours'
        when 'event' then interval '2 hours'
        when 'hot' then interval '4 hours'
        when 'baseline' then interval '12 hours'
        else interval '72 hours'
      end,
      lease_owner = null,
      lease_expires_at = null,
      last_completed_at = now(),
      attempts = 0,
      last_error_code = null,
      last_error_detail = null,
      last_result = coalesce(p_result, '{}'::jsonb),
      updated_at = now()
  where task.id = p_task_id
    and task.status = 'leased'
    and task.lease_owner = trim(p_worker_id)
  returning task.* into v_task;

  if v_task.id is null then raise exception 'TASK_LEASE_NOT_OWNED'; end if;
  return v_task;
end;
$$;

create or replace function public.fail_ebay_seller_scan_task(
  p_task_id uuid,
  p_worker_id text,
  p_error_code text,
  p_error_detail text default null
)
returns public.ebay_seller_scan_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.ebay_seller_scan_tasks;
begin
  update public.ebay_seller_scan_tasks task
  set status = case when task.attempts >= task.max_attempts then 'dead_letter' else 'retry' end,
      due_at = case
        when task.attempts >= task.max_attempts then task.due_at
        else now() + make_interval(mins => least(360, (5 * power(2, greatest(task.attempts - 1, 0)))::integer))
      end,
      lease_owner = null,
      lease_expires_at = null,
      last_error_code = left(coalesce(nullif(trim(p_error_code), ''), 'TASK_FAILED'), 120),
      last_error_detail = left(coalesce(p_error_detail, ''), 500),
      updated_at = now()
  where task.id = p_task_id
    and task.status = 'leased'
    and task.lease_owner = trim(p_worker_id)
  returning task.* into v_task;

  if v_task.id is null then raise exception 'TASK_LEASE_NOT_OWNED'; end if;
  return v_task;
end;
$$;

create or replace function public.upsert_ebay_active_listing_risk(
  p_active_listing_id uuid,
  p_risk_type text,
  p_risk_priority text,
  p_risk_summary text,
  p_recommended_action text,
  p_risk_fingerprint text,
  p_evidence jsonb default '{}'::jsonb
)
returns table(risk_id uuid, was_resolved boolean, occurrence_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_was_resolved boolean := false;
  v_risk_id uuid;
  v_occurrence_count integer;
begin
  select risk.resolved_at is not null
  into v_was_resolved
  from public.ebay_active_listing_risk_events risk
  where risk.risk_fingerprint = p_risk_fingerprint;

  insert into public.ebay_active_listing_risk_events (
    active_listing_id,
    risk_type,
    risk_priority,
    risk_summary,
    recommended_action,
    risk_fingerprint,
    evidence,
    resolved_at,
    last_detected_at,
    occurrence_count
  ) values (
    p_active_listing_id,
    p_risk_type,
    p_risk_priority,
    p_risk_summary,
    p_recommended_action,
    p_risk_fingerprint,
    coalesce(p_evidence, '{}'::jsonb),
    null,
    now(),
    1
  )
  on conflict (risk_fingerprint) do update set
    risk_type = excluded.risk_type,
    risk_priority = excluded.risk_priority,
    risk_summary = excluded.risk_summary,
    recommended_action = excluded.recommended_action,
    evidence = excluded.evidence,
    resolved_at = null,
    last_detected_at = now(),
    occurrence_count = public.ebay_active_listing_risk_events.occurrence_count + 1
  returning public.ebay_active_listing_risk_events.id,
    public.ebay_active_listing_risk_events.occurrence_count
  into v_risk_id, v_occurrence_count;

  return query select v_risk_id, coalesce(v_was_resolved, false), v_occurrence_count;
end;
$$;

alter table public.ebay_seller_automation_runs enable row level security;
alter table public.ebay_seller_scan_tasks enable row level security;
alter table public.ebay_command_center_reviews enable row level security;
alter table public.ebay_listing_packages enable row level security;
alter table public.ebay_seller_alert_outbox enable row level security;
alter table public.ebay_seller_alert_delivery_attempts enable row level security;

drop policy if exists "admin manage ebay seller automation runs" on public.ebay_seller_automation_runs;
create policy "admin manage ebay seller automation runs" on public.ebay_seller_automation_runs
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin manage ebay seller scan tasks" on public.ebay_seller_scan_tasks;
create policy "admin manage ebay seller scan tasks" on public.ebay_seller_scan_tasks
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin manage ebay command center reviews" on public.ebay_command_center_reviews;
create policy "admin manage ebay command center reviews" on public.ebay_command_center_reviews
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin manage ebay listing packages" on public.ebay_listing_packages;
create policy "admin manage ebay listing packages" on public.ebay_listing_packages
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin manage ebay seller alert outbox" on public.ebay_seller_alert_outbox;
create policy "admin manage ebay seller alert outbox" on public.ebay_seller_alert_outbox
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin manage ebay seller alert delivery attempts" on public.ebay_seller_alert_delivery_attempts;
create policy "admin manage ebay seller alert delivery attempts" on public.ebay_seller_alert_delivery_attempts
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on
  public.ebay_seller_automation_runs,
  public.ebay_seller_scan_tasks,
  public.ebay_command_center_reviews,
  public.ebay_listing_packages,
  public.ebay_seller_alert_outbox,
  public.ebay_seller_alert_delivery_attempts
to authenticated;

revoke all on function public.reconcile_ebay_seller_scan_tasks(integer, boolean) from public, anon, authenticated;
revoke all on function public.claim_ebay_seller_scan_tasks(text, integer, integer, text[]) from public, anon, authenticated;
revoke all on function public.complete_ebay_seller_scan_task(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.fail_ebay_seller_scan_task(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.upsert_ebay_active_listing_risk(uuid, text, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.reconcile_ebay_seller_scan_tasks(integer, boolean) to service_role;
grant execute on function public.claim_ebay_seller_scan_tasks(text, integer, integer, text[]) to service_role;
grant execute on function public.complete_ebay_seller_scan_task(uuid, text, jsonb) to service_role;
grant execute on function public.fail_ebay_seller_scan_task(uuid, text, text, text) to service_role;
grant execute on function public.upsert_ebay_active_listing_risk(uuid, text, text, text, text, text, jsonb) to service_role;

notify pgrst, 'reload schema';
