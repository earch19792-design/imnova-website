-- A no-op UPDATE ... RETURNING clears a PL/pgSQL row variable. Preserve the
-- already certified slot on replay and verify that its persisted binding still
-- matches the single exact durable receipt.
create or replace function public.get_autonomous_stocking_batch_shipping_slot_readback_v1(
  p_account_key text,
  p_batch_id uuid default null
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare
  v_now timestamptz:=clock_timestamp();
  v_slot public.seller_os_autonomous_stocking_batch_shipping_slots_v1%rowtype;
  v_claim public.seller_os_luna_shipping_job_claims%rowtype;
  v_exact_count integer:=0;
  v_mismatch_count integer:=0;
  v_capture_count integer:=0;
  v_frontier_id text;
  v_shipping_amount numeric;
  v_active_count integer:=0;
begin
  if not public.is_seller_os_service_role_request_v1() then
    raise exception 'AUTONOMOUS_STOCKING_SHIPPING_SLOT_SERVICE_ROLE_REQUIRED';
  end if;
  select slot.* into v_slot
  from public.seller_os_autonomous_stocking_batch_shipping_slots_v1 slot
  join public.seller_os_autonomous_stocking_batches_v1 batch
    on batch.id=slot.batch_id
  join public.seller_os_autonomous_stocking_batch_children_v1 child
    on child.id=slot.child_id and child.batch_id=slot.batch_id
  where slot.account_key=p_account_key
    and (p_batch_id is null or slot.batch_id=p_batch_id)
    and batch.status in ('ACTIVE','BLOCKED')
    and child.status='SELECTING'
  order by batch.started_at,slot.sequence_no limit 1;
  if not found then return jsonb_build_object('slotPresent',false); end if;
  if v_slot.canonical_candidate_id is distinct from
      public.seller_os_current_commercial_candidate_id_v1(
        v_slot.account_key,'EBAY_US','LUNAPORTEX',v_slot.product_id,
        v_slot.variant_id,v_slot.supplier_sku) then
    raise exception 'AUTONOMOUS_STOCKING_SHIPPING_SLOT_DERIVATION_CONTRADICTION';
  end if;
  select count(*)::integer into v_active_count
  from public.seller_os_luna_shipping_job_claims claim
  where claim.account_key=v_slot.account_key
    and claim.candidate_id=v_slot.canonical_candidate_id
    and claim.status='CLAIMED' and claim.lease_expires_at>v_now;
  if v_active_count>1 then
    raise exception 'AUTONOMOUS_STOCKING_SHIPPING_SLOT_ACTIVE_CAPTURE_AMBIGUOUS';
  end if;
  select * into v_claim
  from public.seller_os_luna_shipping_job_claims claim
  where claim.account_key=v_slot.account_key
    and claim.candidate_id=v_slot.canonical_candidate_id;
  if found and v_claim.status='COMPLETED' then
    select count(*)::integer,max(snapshot.frontier_id),
      max(snapshot.shipping_value)
    into v_exact_count,v_frontier_id,v_shipping_amount
    from public.seller_os_profitability_frontier_snapshots snapshot
    where snapshot.account_key=v_slot.account_key
      and snapshot.shipping_status='SHIPPING_DURABLY_PERSISTED'
      and snapshot.frontier_payload#>>'{shippingCaptureEvidence,candidateId}'=
        v_slot.canonical_candidate_id
      and snapshot.frontier_payload#>>'{shippingCaptureEvidence,captureSessionId}'=
        v_claim.capture_session_id::text
      and snapshot.luna_product_id=v_slot.product_id
      and snapshot.luna_variant_id=v_slot.variant_id
      and snapshot.luna_sku=v_slot.supplier_sku;
    select count(distinct
      snapshot.frontier_payload#>>'{shippingCaptureEvidence,captureSessionId}')::integer
    into v_capture_count
    from public.seller_os_profitability_frontier_snapshots snapshot
    where snapshot.account_key=v_slot.account_key
      and snapshot.shipping_status='SHIPPING_DURABLY_PERSISTED'
      and snapshot.frontier_payload#>>'{shippingCaptureEvidence,candidateId}'=
        v_slot.canonical_candidate_id
      and snapshot.luna_product_id=v_slot.product_id
      and snapshot.luna_variant_id=v_slot.variant_id
      and snapshot.luna_sku=v_slot.supplier_sku;
    select count(*)::integer into v_mismatch_count
    from public.seller_os_profitability_frontier_snapshots snapshot
    where snapshot.account_key=v_slot.account_key
      and snapshot.shipping_status='SHIPPING_DURABLY_PERSISTED'
      and snapshot.frontier_payload#>>'{shippingCaptureEvidence,candidateId}'=
        v_slot.canonical_candidate_id
      and snapshot.frontier_payload#>>'{shippingCaptureEvidence,captureSessionId}'=
        v_claim.capture_session_id::text
      and (snapshot.luna_product_id is distinct from v_slot.product_id
        or snapshot.luna_variant_id is distinct from v_slot.variant_id
        or snapshot.luna_sku is distinct from v_slot.supplier_sku);
    if v_mismatch_count>0 or v_exact_count>1 then
      raise exception 'AUTONOMOUS_STOCKING_SHIPPING_SLOT_RECEIPT_AMBIGUOUS';
    end if;
    if v_exact_count=1 and v_slot.status='SHIPPING_READY' and (
        v_slot.capture_session_id is distinct from v_claim.capture_session_id
        or v_slot.frontier_id is distinct from v_frontier_id
        or v_slot.shipping_amount is distinct from v_shipping_amount
        or v_slot.exact_durable_result_count<>1) then
      raise exception 'AUTONOMOUS_STOCKING_SHIPPING_SLOT_READY_REPLAY_CONTRADICTION';
    end if;
    if v_exact_count=1 and v_slot.status<>'SHIPPING_READY' then
      update public.seller_os_autonomous_stocking_batch_shipping_slots_v1 set
        status='SHIPPING_READY',capture_session_id=v_claim.capture_session_id,
        frontier_id=v_frontier_id,shipping_amount=v_shipping_amount,
        exact_durable_result_count=1,updated_at=v_now
      where child_id=v_slot.child_id and status<>'SHIPPING_READY'
      returning * into v_slot;
    end if;
  end if;
  if v_slot.status<>'SHIPPING_READY' then
    update public.seller_os_autonomous_stocking_batch_shipping_slots_v1 set
      status=case when v_active_count=1 then 'CAPTURE_ACTIVE'
        else 'WAITING_CAPTURE' end,updated_at=v_now
    where child_id=v_slot.child_id and status<>'SHIPPING_READY'
    returning * into v_slot;
  end if;
  return jsonb_build_object(
    'slotPresent',true,'batchId',v_slot.batch_id,'childId',v_slot.child_id,
    'sequenceNo',v_slot.sequence_no,
    'canonicalCandidateId',v_slot.canonical_candidate_id,
    'productId',v_slot.product_id,'variantId',v_slot.variant_id,
    'supplierSku',v_slot.supplier_sku,'status',v_slot.status,
    'targetActiveCaptureCount',v_active_count,
    'targetCurrentShippingCaptureExecuted',v_slot.status='SHIPPING_READY',
    'currentExactBoundQuote',v_slot.status='SHIPPING_READY',
    'captureResultDurable',v_slot.status='SHIPPING_READY',
    'durableReadbackMatch',v_slot.status='SHIPPING_READY',
    'shippingReceiptCommercialIdentityMatch',v_slot.status='SHIPPING_READY',
    'shippingDuplicateCaptureCount',case when v_slot.status='SHIPPING_READY'
      then greatest(v_capture_count-1,0) else 0 end,
    'shippingReady',v_slot.status='SHIPPING_READY',
    'shippingAmount',v_slot.shipping_amount,
    'captureSessionId',v_slot.capture_session_id,
    'frontierId',v_slot.frontier_id,
    'exactDurableResultCount',v_slot.exact_durable_result_count,
    'foreignReceiptAdopted',false,'manualIdentityRebind',false,
    'codexRuntimeDependency',false);
end; $$;

revoke all on function public.get_autonomous_stocking_batch_shipping_slot_readback_v1(
  text,uuid) from public,anon,authenticated;
grant execute on function public.get_autonomous_stocking_batch_shipping_slot_readback_v1(
  text,uuid) to service_role;

comment on function public.get_autonomous_stocking_batch_shipping_slot_readback_v1(
  text,uuid) is
  'Fail-closed exact CURRENT batch Shipping readback. Ready replay preserves and revalidates the single durable slot receipt.';

notify pgrst,'reload schema';
