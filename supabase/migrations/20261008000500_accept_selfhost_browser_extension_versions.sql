-- Accept the first browser-extension builds bound exclusively to the
-- self-hosted Seller OS origin. Marketplace writes remain forbidden here.

create or replace function public.complete_seller_os_commercial_trace_pricing_enrichment_v1(
  p_job_id uuid,
  p_marketplace_account_key text,
  p_owner_user_id uuid,
  p_worker_id text,
  p_receipt jsonb,
  p_receipt_digest text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_job public.seller_os_commercial_trace_pricing_enrichment_jobs_v1%rowtype;
begin
  if not public.is_seller_os_service_role_request_v1()
      or p_job_id is null or p_owner_user_id is null
      or p_receipt_digest !~ '^sha256:[0-9a-f]{64}$'
      or jsonb_typeof(p_receipt) <> 'object'
      or p_receipt->>'contractVersion' <>
        'SELLER_OS_COMMERCIAL_TRACE_PRICING_ENRICHMENT_RECEIPT_V1'
      or p_receipt->>'jobId' <> p_job_id::text
      or coalesce((p_receipt->>'marketplaceWrites')::integer, -1) <> 0
      or jsonb_typeof(p_receipt->'rows') <> 'array'
      or jsonb_array_length(p_receipt->'rows') > 60 then
    raise exception 'COMMERCIAL_TRACE_PRICING_ENRICHMENT_RECEIPT_INVALID';
  end if;

  select job.* into strict v_job
  from public.seller_os_commercial_trace_pricing_enrichment_jobs_v1 job
  where job.job_id = p_job_id
    and job.marketplace_account_key = p_marketplace_account_key
    and job.owner_user_id = p_owner_user_id
  for update;

  if v_job.state = 'COMPLETED' then
    if v_job.receipt_digest is distinct from p_receipt_digest
        or v_job.receipt is distinct from p_receipt then
      raise exception 'COMMERCIAL_TRACE_PRICING_ENRICHMENT_RECEIPT_CONFLICT';
    end if;
    return jsonb_build_object(
      'completed', true,
      'jobId', v_job.job_id,
      'traceId', v_job.trace_id,
      'idempotent', true,
      'marketplaceWrites', 0
    );
  end if;

  if v_job.state <> 'CLAIMED'
      or v_job.lease_owner is distinct from p_worker_id
      or v_job.lease_expires_at <= clock_timestamp()
      or p_receipt->>'traceId' <> v_job.trace_id::text
      or p_receipt->>'lunaProductId' <> v_job.luna_product_id
      or p_receipt->>'lunaVariantId' <> v_job.luna_variant_id
      or p_receipt->>'supplierSku' <> v_job.supplier_sku
      or p_receipt->>'sourceFingerprint' <> v_job.source_fingerprint
      or p_receipt->>'taskSpecDigest' <> v_job.task_spec_digest
      or p_receipt->>'mechanismVersion' <> v_job.mechanism_version
      or p_receipt->>'extensionVersion' <> '1.2.41'
      or p_receipt->>'extensionId' <> 'llngdlffmjbnbmbffkfbknkkddjoknka'
      or coalesce((p_receipt->>'generation')::integer, -1) <> v_job.generation
      or (p_receipt->>'predecessorJobId') is distinct from
        v_job.predecessor_job_id::text
      or (p_receipt->>'predecessorReceiptDigest') is distinct from
        v_job.predecessor_receipt_digest then
    raise exception 'COMMERCIAL_TRACE_PRICING_ENRICHMENT_RECEIPT_BINDING_INVALID';
  end if;

  update public.seller_os_commercial_trace_pricing_enrichment_jobs_v1 job
  set state = 'COMPLETED',
      receipt = p_receipt,
      receipt_digest = p_receipt_digest,
      lease_owner = null,
      lease_expires_at = null,
      completed_at = clock_timestamp(),
      updated_at = clock_timestamp(),
      last_error_code = null
  where job.job_id = v_job.job_id
  returning * into v_job;

  return jsonb_build_object(
    'completed', true,
    'jobId', v_job.job_id,
    'traceId', v_job.trace_id,
    'idempotent', false,
    'marketplaceWrites', 0
  );
end
$function$;

revoke all on function public.complete_seller_os_commercial_trace_pricing_enrichment_v1(
  uuid, text, uuid, text, jsonb, text
) from public, anon, authenticated;

grant execute on function public.complete_seller_os_commercial_trace_pricing_enrichment_v1(
  uuid, text, uuid, text, jsonb, text
) to service_role;

comment on function public.complete_seller_os_commercial_trace_pricing_enrichment_v1(
  uuid, text, uuid, text, jsonb, text
) is
  'Completes one bounded pricing-enrichment job using the self-hosted extension v1.2.41; fail-closed and zero marketplace writes.';
