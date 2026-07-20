-- Fail-closed hardening for real eBay tracking and post-sale WhatsApp.
-- A POST that may have reached a remote provider is never retried blindly.

create or replace function public.block_fulfillment_real_unresolved_post_v1c(
  p_outbox_id uuid,
  p_worker_id text,
  p_code text
)
returns public.marketplace_fulfillment_submission_outbox
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_outbox public.marketplace_fulfillment_submission_outbox;
  v_task public.fulfillment_tasks;
  v_now timestamptz := clock_timestamp();
begin
  select * into strict v_outbox
  from public.marketplace_fulfillment_submission_outbox
  where id = p_outbox_id
    and adapter = 'ebay_real'
    and status = 'awaiting_reconciliation'
    and lease_owner = p_worker_id
  for update;

  update public.marketplace_fulfillment_submission_outbox
  set status = 'blocked',
      absence_confirmed_at = v_now,
      reconciled_at = v_now,
      terminal_failure_at = v_now,
      lease_owner = null,
      lease_expires_at = null,
      last_error_code = left(coalesce(nullif(p_code, ''),
        'EBAY_FULFILLMENT_OUTCOME_UNKNOWN_MANUAL_REVIEW'), 120),
      updated_at = v_now
  where id = v_outbox.id
  returning * into v_outbox;

  update public.marketplace_fulfillment_submission_attempts
  set outcome = 'absence_confirmed',
      response_code = 'EBAY_FULFILLMENT_OUTCOME_UNKNOWN_MANUAL_REVIEW',
      error_code = 'EBAY_FULFILLMENT_OUTCOME_UNKNOWN_MANUAL_REVIEW',
      reconciliation_required = false,
      raw_response_stored = false,
      completed_at = v_now
  where submission_outbox_id = v_outbox.id
    and attempt_number = v_outbox.attempts;

  for v_task in
    select task.*
    from public.fulfillment_tasks task
    join public.marketplace_fulfillment_shipment_items item
      on item.fulfillment_task_id = task.id
    where item.shipment_id = v_outbox.shipment_id
      and task.workflow_state = 'TRACKING_SUBMISSION_QUEUED'
    order by task.id
    for update of task
  loop
    perform public.apply_fulfillment_transition_v1b(
      v_task.id,
      'TRACKING_SUBMISSION_QUEUED',
      'MANUAL_REVIEW_REQUIRED',
      'ebay_reconciler',
      p_worker_id,
      v_outbox.id || ':' || v_task.id || ':outcome-unknown',
      jsonb_build_object(
        'errorCode', 'EBAY_FULFILLMENT_OUTCOME_UNKNOWN_MANUAL_REVIEW',
        'secondPost', false,
        'shippedConfirmed', false
      )
    );
  end loop;

  return v_outbox;
end;
$$;

revoke all on function public.block_fulfillment_real_unresolved_post_v1c(
  uuid, text, text
) from public, anon, authenticated;
grant execute on function public.block_fulfillment_real_unresolved_post_v1c(
  uuid, text, text
) to service_role;

create or replace function public.guard_whatsapp_delivery_unknown_outcome_v1c()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_code text := upper(coalesce(new.last_error_code, ''));
begin
  if old.channel = 'whatsapp'
     and old.status = 'leased'
     and new.status = 'failed'
     and (
       v_code in (
         'DELIVERY_LEASE_EXPIRED',
         'META_REQUEST_TIMEOUT',
         'META_REQUEST_FAILED'
       )
       or v_code ~ '^META_HTTP_5[0-9][0-9]$'
     ) then
    new.status := 'dead_letter';
    new.due_at := old.due_at;
    new.last_error_code := case
      when v_code = 'DELIVERY_LEASE_EXPIRED'
        then 'WHATSAPP_DELIVERY_LEASE_EXPIRED_OUTCOME_UNKNOWN'
      else 'META_DELIVERY_OUTCOME_UNKNOWN_MANUAL_REVIEW'
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_whatsapp_delivery_unknown_outcome_v1c
  on public.alert_delivery_outbox;
create trigger guard_whatsapp_delivery_unknown_outcome_v1c
before update on public.alert_delivery_outbox
for each row
execute function public.guard_whatsapp_delivery_unknown_outcome_v1c();

revoke all on function public.guard_whatsapp_delivery_unknown_outcome_v1c()
from public, anon, authenticated;
