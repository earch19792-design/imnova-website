-- Preserve V1A simulated approval after V1B widens outbox deduplication by adapter.
-- Function-only migration; no table, constraint, or row is removed.

create or replace function public.approve_fulfillment_tracking_v1a(
  p_task_id uuid,
  p_expected_lock_version bigint,
  p_payload_hash text,
  p_actor_id text,
  p_idempotency_key text,
  p_simulation_scenario text default 'success'
)
returns public.marketplace_fulfillment_submission_outbox
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_primary public.fulfillment_tasks;
  v_task public.fulfillment_tasks;
  v_shipment public.marketplace_fulfillment_shipments;
  v_outbox public.marketplace_fulfillment_submission_outbox;
  v_guard text := 'clear';
begin
  select * into strict v_primary from public.fulfillment_tasks where id = p_task_id for update;
  if v_primary.lock_version <> p_expected_lock_version then raise exception 'FULFILLMENT_LOCK_VERSION_CONFLICT'; end if;
  if v_primary.workflow_state <> 'TRACKING_READY_FOR_SUBMISSION' or
    v_primary.tracking_payload_hash <> p_payload_hash then
    raise exception 'FULFILLMENT_APPROVAL_PAYLOAD_MISMATCH';
  end if;
  select * into strict v_shipment from public.marketplace_fulfillment_shipments
  where id = v_primary.current_shipment_id and payload_hash = p_payload_hash
    and approval_status = 'pending' and superseded_at is null;

  select case
    when lower(coalesce(payment_status,'')) like '%refund%' then 'refunded'
    when lower(coalesce(fulfillment_status,'')) in ('fulfilled','shipped') then 'already_fulfilled'
    when lower(coalesce(fulfillment_status,'')) like '%cancel%' then 'cancelled'
    else 'clear' end into v_guard
  from public.marketplace_order_snapshots
  where marketplace_account_key = v_primary.marketplace_account_key
    and marketplace = v_primary.marketplace
    and marketplace_order_id = v_primary.marketplace_order_id;
  v_guard := coalesce(v_guard, 'clear');
  if v_guard <> 'clear' then raise exception 'FULFILLMENT_ORDER_GUARD_BLOCKED'; end if;

  insert into public.marketplace_fulfillment_submission_outbox (
    fulfillment_task_id, shipment_id, marketplace_account_key, marketplace,
    marketplace_order_id, payload_hash, idempotency_key, adapter,
    simulation_scenario, order_guard_status
  ) values (
    v_primary.id, v_shipment.id, v_primary.marketplace_account_key,
    v_primary.marketplace, v_primary.marketplace_order_id, p_payload_hash,
    left(p_idempotency_key,240), 'simulated', p_simulation_scenario, v_guard
  ) on conflict (
    marketplace_account_key, marketplace, marketplace_order_id,
    payload_hash, adapter
  ) do update set updated_at = excluded.updated_at
  returning * into v_outbox;

  update public.marketplace_fulfillment_shipments
  set approval_status = 'approved', approved_at = clock_timestamp(),
      approved_by = nullif(left(coalesce(p_actor_id,''),160),''), updated_at = clock_timestamp()
  where id = v_shipment.id;

  for v_task in
    select task.* from public.fulfillment_tasks task
    join public.marketplace_fulfillment_shipment_items item on item.fulfillment_task_id = task.id
    where item.shipment_id = v_shipment.id order by task.id for update of task
  loop
    if v_task.workflow_state <> 'TRACKING_READY_FOR_SUBMISSION' or
      v_task.tracking_payload_hash <> p_payload_hash then
      raise exception 'FULFILLMENT_APPROVAL_ITEM_MISMATCH';
    end if;
    perform public.apply_fulfillment_transition_v1a(
      v_task.id, 'TRACKING_READY_FOR_SUBMISSION', 'TRACKING_SUBMISSION_QUEUED',
      'admin', p_actor_id, p_idempotency_key || ':' || v_task.id || ':queued',
      jsonb_build_object('payloadHash',p_payload_hash,'submissionId',v_outbox.id)
    );
    update public.fulfillment_tasks
    set tracking_approved_at = clock_timestamp(),
        tracking_submission_mode = 'simulated',
        updated_at = clock_timestamp()
    where id = v_task.id;
  end loop;
  return v_outbox;
end;
$$;

revoke all on function public.approve_fulfillment_tracking_v1a(uuid,bigint,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.approve_fulfillment_tracking_v1a(uuid,bigint,text,text,text,text)
  to service_role;

notify pgrst, 'reload schema';
