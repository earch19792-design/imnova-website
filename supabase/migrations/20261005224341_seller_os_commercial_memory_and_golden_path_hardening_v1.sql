-- SELLER_OS_COMMERCIAL_MEMORY_AND_GOLDEN_PATH_HARDENING_V1
--
-- The existing Luna opportunity queue remains the exact-candidate current
-- projection and its existing events table remains the append-only history.
-- Family opportunity cases, Golden Path receipts and all upstream authorities
-- remain authoritative; this migration stores references and a bounded
-- decision projection only. No marketplace capability is introduced.

alter table public.ebay_luna_opportunity_queue
  add column if not exists commercial_account_key text null,
  add column if not exists commercial_owner_user_id uuid null,
  add column if not exists market_opportunity_case_id text null references
    public.seller_os_market_opportunity_cases(opportunity_case_id)
    on delete restrict,
  add column if not exists market_family_id text null references
    public.seller_os_market_opportunity_cases(family_id)
    on delete restrict,
  add column if not exists commercial_lifecycle_stage text null,
  add column if not exists commercial_decision text null,
  add column if not exists commercial_next_best_evidence text null,
  add column if not exists commercial_evidence_freshness text null,
  add column if not exists commercial_blockers text[] not null
    default '{}'::text[],
  add column if not exists commercial_evaluation_receipt_id uuid null
    references public.seller_os_golden_path_receipts_v1(receipt_id)
    on delete restrict,
  add column if not exists commercial_memory_digest text null,
  add column if not exists commercial_memory jsonb null,
  add column if not exists commercial_observed_at timestamptz null,
  add column if not exists commercial_updated_at timestamptz null;

alter table public.ebay_luna_opportunity_queue
  drop constraint if exists ebay_luna_queue_commercial_account_check,
  add constraint ebay_luna_queue_commercial_account_check check (
    commercial_account_key is null or
    length(commercial_account_key) between 8 and 240
  ),
  drop constraint if exists ebay_luna_queue_commercial_lifecycle_check,
  add constraint ebay_luna_queue_commercial_lifecycle_check check (
    commercial_lifecycle_stage is null or commercial_lifecycle_stage in (
      'DISCOVERED','DEMAND_SUPPORTED','DEMAND_PROVEN','PRODUCT_FIT',
      'SHIPPING','ECONOMICS','DUPLICATE_GATE','GO','HOLD','REJECT',
      'LISTING_READY','PUBLISHED','RESULT'
    )
  ),
  drop constraint if exists ebay_luna_queue_commercial_decision_check,
  add constraint ebay_luna_queue_commercial_decision_check check (
    commercial_decision is null or
    commercial_decision in ('GO','HOLD','REJECT','UNPROVEN')
  ),
  drop constraint if exists ebay_luna_queue_commercial_next_evidence_check,
  add constraint ebay_luna_queue_commercial_next_evidence_check check (
    commercial_next_best_evidence is null or
    commercial_next_best_evidence in (
      'GET_EXACT_SOLD','VERIFY_PRODUCT_FIT','CAPTURE_QTY1_SHIPPING',
      'CAPTURE_BUYER_FULFILLMENT','COMPLETE_FEE','RESOLVE_DUPLICATE',
      'COMPLETE_COMPLIANCE','COMPLETE_ECONOMICS','WAIT_UPSTREAM',
      'PREPARE_LISTING_PACKAGE','OWNER_PUBLISH_MANUALLY','MEASURE_RESULT',
      'REVIEW_REJECTION','RESOLVE_BLOCKER','NONE'
    )
  ),
  drop constraint if exists ebay_luna_queue_commercial_freshness_check,
  add constraint ebay_luna_queue_commercial_freshness_check check (
    commercial_evidence_freshness is null or
    commercial_evidence_freshness in ('FRESH','STALE','UNPROVEN')
  ),
  drop constraint if exists ebay_luna_queue_commercial_memory_check,
  add constraint ebay_luna_queue_commercial_memory_check check (
    (commercial_memory is null and commercial_memory_digest is null and
      commercial_evaluation_receipt_id is null)
    or (
      jsonb_typeof(commercial_memory) = 'object'
      and octet_length(commercial_memory::text) <= 500000
      and commercial_memory ->> 'contractVersion' =
        'SELLER_OS_COMMERCIAL_OPPORTUNITY_MEMORY_V1'
      and commercial_memory ->> 'canonicalResultVersion' =
        'CANONICAL_OPPORTUNITY_RESULT_V2_2026_08_12'
      and commercial_memory_digest ~ '^sha256:[0-9a-f]{64}$'
      and commercial_memory ->> 'memoryDigest' = commercial_memory_digest
      and commercial_evaluation_receipt_id is not null
      and commercial_account_key is not null
      and commercial_owner_user_id is not null
      and commercial_observed_at is not null
      and commercial_updated_at is not null
    )
  ),
  drop constraint if exists ebay_luna_queue_commercial_case_pair_check,
  add constraint ebay_luna_queue_commercial_case_pair_check check (
    (market_opportunity_case_id is null and market_family_id is null)
    or (market_opportunity_case_id is not null and market_family_id is not null)
  );

alter table public.ebay_luna_opportunity_queue
  drop constraint if exists ebay_luna_queue_commercial_case_pair_fk;
alter table public.ebay_luna_opportunity_queue
  add constraint ebay_luna_queue_commercial_case_pair_fk foreign key (
    market_family_id, market_opportunity_case_id
  ) references public.seller_os_market_opportunity_cases(
    family_id, opportunity_case_id
  ) on delete restrict;

alter table public.ebay_luna_opportunity_queue_events
  drop constraint if exists ebay_luna_opportunity_queue_event_type_check;
alter table public.ebay_luna_opportunity_queue_events
  add constraint ebay_luna_opportunity_queue_event_type_check check (
    event_type in (
      'discovered','rescored','price_up','price_down','out_of_stock',
      'restocked','stock_changed','listed','status_changed',
      'commercial_memory_changed'
    )
  );

create index if not exists ebay_luna_queue_commercial_cockpit_idx
  on public.ebay_luna_opportunity_queue(
    commercial_next_best_evidence, commercial_evidence_freshness,
    commercial_updated_at desc
  ) where commercial_memory is not null;
create index if not exists ebay_luna_queue_commercial_identity_idx
  on public.ebay_luna_opportunity_queue(
    commercial_account_key, supplier_product_id,
    supplier_variant_id, supplier_sku
  ) where commercial_memory is not null;

create or replace function public.prevent_commercial_memory_event_mutation_v1()
returns trigger
language plpgsql security invoker
set search_path = ''
as $function$
begin
  if old.event_type = 'commercial_memory_changed' then
    raise exception 'SELLER_OS_COMMERCIAL_MEMORY_EVENT_IMMUTABLE';
  end if;
  return old;
end;
$function$;

drop trigger if exists ebay_luna_commercial_memory_event_immutable
  on public.ebay_luna_opportunity_queue_events;
create trigger ebay_luna_commercial_memory_event_immutable
before update or delete on public.ebay_luna_opportunity_queue_events
for each row execute function
  public.prevent_commercial_memory_event_mutation_v1();

create or replace function public.put_seller_os_commercial_opportunity_memory_v1(
  p_account_key text,
  p_owner_user_id uuid,
  p_memory jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql security invoker
set search_path = ''
as $function$
declare
  v_candidate jsonb;
  v_product_id text;
  v_variant_id text;
  v_supplier_sku text;
  v_title text;
  v_candidate_key text;
  v_memory_digest text;
  v_receipt_id uuid;
  v_stage text;
  v_decision text;
  v_next_evidence text;
  v_freshness text;
  v_observed_at timestamptz;
  v_existing public.ebay_luna_opportunity_queue%rowtype;
  v_exact_count integer;
  v_opportunity_id uuid;
  v_case_id text;
  v_family_id text;
  v_queue_status text;
begin
  if p_account_key is null or length(p_account_key) not between 8 and 240
    or p_owner_user_id is null
    or jsonb_typeof(p_memory) <> 'object'
    or octet_length(p_memory::text) > 500000
    or p_memory ->> 'contractVersion' <>
      'SELLER_OS_COMMERCIAL_OPPORTUNITY_MEMORY_V1'
    or p_memory ->> 'canonicalResultVersion' <>
      'CANONICAL_OPPORTUNITY_RESULT_V2_2026_08_12'
    or jsonb_typeof(p_memory -> 'candidate') <> 'object'
    or jsonb_typeof(p_memory -> 'decisionProvenance') <> 'object'
    or jsonb_typeof(p_memory -> 'nextBestEvidence') <> 'object'
    or jsonb_typeof(p_memory -> 'safety') <> 'object'
    or coalesce((p_memory #>> '{safety,marketplaceWrites}')::integer, -1) <> 0
    or coalesce((p_memory #>> '{safety,publications}')::integer, -1) <> 0
    or coalesce((p_memory #>> '{safety,repricing}')::integer, -1) <> 0
    or coalesce((p_memory #>> '{safety,ebayMutationAllowed}')::boolean, true)
  then
    raise exception 'SELLER_OS_COMMERCIAL_MEMORY_INPUT_INVALID';
  end if;

  v_candidate := p_memory -> 'candidate';
  v_product_id := v_candidate ->> 'productId';
  v_variant_id := v_candidate ->> 'variantId';
  v_supplier_sku := v_candidate ->> 'supplierSku';
  v_title := v_candidate ->> 'title';
  v_memory_digest := p_memory ->> 'memoryDigest';
  v_stage := p_memory ->> 'lifecycleStage';
  v_decision := p_memory ->> 'decision';
  v_next_evidence := p_memory #>> '{nextBestEvidence,action}';
  v_freshness := p_memory ->> 'evidenceFreshness';
  v_observed_at := (p_memory ->> 'observedAt')::timestamptz;
  v_receipt_id := (p_memory #>>
    '{decisionProvenance,evaluationReceiptId}')::uuid;

  if coalesce(v_product_id, '') !~ '^[A-Za-z0-9._:-]{1,100}$'
    or coalesce(v_variant_id, '') !~ '^[A-Za-z0-9._:-]{1,100}$'
    or length(coalesce(v_supplier_sku, '')) not between 1 and 160
    or v_supplier_sku ~ '[[:cntrl:]]'
    or length(coalesce(v_title, '')) not between 1 and 500
    or v_title ~ '[[:cntrl:]]'
    or coalesce((v_candidate ->> 'supplierQuantity')::integer, 0)
      not between 1 and 100
    or coalesce(v_memory_digest, '') !~ '^sha256:[0-9a-f]{64}$'
    or p_idempotency_key <> 'commercial-memory:' || v_memory_digest
    or v_stage not in (
      'DISCOVERED','DEMAND_SUPPORTED','DEMAND_PROVEN','PRODUCT_FIT',
      'SHIPPING','ECONOMICS','DUPLICATE_GATE','GO','HOLD','REJECT',
      'LISTING_READY','PUBLISHED','RESULT'
    )
    or v_decision not in ('GO','HOLD','REJECT','UNPROVEN')
    or v_next_evidence not in (
      'GET_EXACT_SOLD','VERIFY_PRODUCT_FIT','CAPTURE_QTY1_SHIPPING',
      'CAPTURE_BUYER_FULFILLMENT','COMPLETE_FEE','RESOLVE_DUPLICATE',
      'COMPLETE_COMPLIANCE','COMPLETE_ECONOMICS','WAIT_UPSTREAM',
      'PREPARE_LISTING_PACKAGE','OWNER_PUBLISH_MANUALLY','MEASURE_RESULT',
      'REVIEW_REJECTION','RESOLVE_BLOCKER','NONE'
    )
    or v_freshness not in ('FRESH','STALE','UNPROVEN')
    or v_observed_at is null
    or v_observed_at > pg_catalog.now() + interval '5 minutes'
    or not exists (
      select 1 from public.seller_os_golden_path_receipts_v1 receipt
      where receipt.receipt_id = v_receipt_id
        and receipt.account_key = p_account_key
        and receipt.owner_user_id = p_owner_user_id
        and receipt.kind = 'EVALUATION'
        and receipt.evidence_digest = p_memory #>>
          '{decisionProvenance,evaluationEvidenceDigest}'
    )
  then
    raise exception 'SELLER_OS_COMMERCIAL_MEMORY_AUTHORITY_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_account_key || ':' || v_product_id || ':' || v_variant_id || ':' ||
      v_supplier_sku, 0
  ));

  select count(*)::integer into v_exact_count
  from public.ebay_luna_opportunity_queue queue
  where queue.supplier_product_id = v_product_id
    and queue.supplier_variant_id = v_variant_id
    and queue.supplier_sku = v_supplier_sku;
  if v_exact_count > 1 then
    raise exception 'SELLER_OS_COMMERCIAL_MEMORY_IDENTITY_AMBIGUOUS';
  end if;

  if v_exact_count = 1 then
    select * into v_existing
    from public.ebay_luna_opportunity_queue queue
    where queue.supplier_product_id = v_product_id
      and queue.supplier_variant_id = v_variant_id
      and queue.supplier_sku = v_supplier_sku
    for update;
    v_candidate_key := v_existing.candidate_key;
  else
    v_candidate_key := 'luna-portex:' || v_product_id || ':' || v_variant_id;
    select * into v_existing
    from public.ebay_luna_opportunity_queue queue
    where queue.candidate_key = v_candidate_key
    for update;
    if found and (
      v_existing.supplier_product_id is distinct from v_product_id
      or v_existing.supplier_variant_id is distinct from v_variant_id
      or v_existing.supplier_sku is distinct from v_supplier_sku
    ) then
      raise exception 'SELLER_OS_COMMERCIAL_MEMORY_CANDIDATE_KEY_CONFLICT';
    end if;
  end if;

  if v_existing.commercial_memory_digest = v_memory_digest then
    return pg_catalog.jsonb_build_object(
      'status', 'IDEMPOTENT_SUCCESS', 'replay', true,
      'opportunityId', v_existing.id,
      'memoryDigest', v_existing.commercial_memory_digest
    );
  end if;

  v_family_id := coalesce(
    nullif(p_memory #>> '{marketOpportunityCase,familyId}', ''),
    v_existing.dashboard_radar_family_id
  );
  if v_family_id is not null then
    select opportunity_case_id, family_id into v_case_id, v_family_id
    from public.seller_os_market_opportunity_cases
    where family_id = v_family_id;
  end if;

  v_queue_status := case
    when v_existing.queue_status in ('listed','archived')
      then v_existing.queue_status
    when v_stage = 'PUBLISHED' then 'listed'
    when v_stage = 'LISTING_READY' then 'ready'
    when v_decision = 'REJECT' then 'rejected'
    when v_decision = 'GO' then 'review'
    else 'hold'
  end;

  insert into public.ebay_luna_opportunity_queue (
    candidate_key, supplier_product_id, supplier_variant_id, supplier_sku,
    product_title, queue_status, decision, commercial_account_key,
    commercial_owner_user_id, market_opportunity_case_id, market_family_id,
    commercial_lifecycle_stage, commercial_decision,
    commercial_next_best_evidence, commercial_evidence_freshness,
    commercial_blockers, commercial_evaluation_receipt_id,
    commercial_memory_digest, commercial_memory, commercial_observed_at,
    commercial_updated_at
  ) values (
    v_candidate_key, v_product_id, v_variant_id, v_supplier_sku, v_title,
    v_queue_status, 'COMMERCIAL_MEMORY_' || v_decision, p_account_key,
    p_owner_user_id, v_case_id, v_family_id, v_stage, v_decision,
    v_next_evidence, v_freshness,
    case when jsonb_typeof(p_memory -> 'blockers') = 'array'
      then array(select jsonb_array_elements_text(p_memory -> 'blockers'))
      else '{}'::text[] end,
    v_receipt_id, v_memory_digest, p_memory, v_observed_at, pg_catalog.now()
  )
  on conflict (candidate_key) do update set
    queue_status = case
      when public.ebay_luna_opportunity_queue.queue_status in
        ('listed','archived')
      then public.ebay_luna_opportunity_queue.queue_status
      else excluded.queue_status end,
    commercial_account_key = excluded.commercial_account_key,
    commercial_owner_user_id = excluded.commercial_owner_user_id,
    market_opportunity_case_id = coalesce(
      excluded.market_opportunity_case_id,
      public.ebay_luna_opportunity_queue.market_opportunity_case_id),
    market_family_id = coalesce(excluded.market_family_id,
      public.ebay_luna_opportunity_queue.market_family_id),
    commercial_lifecycle_stage = excluded.commercial_lifecycle_stage,
    commercial_decision = excluded.commercial_decision,
    commercial_next_best_evidence = excluded.commercial_next_best_evidence,
    commercial_evidence_freshness = excluded.commercial_evidence_freshness,
    commercial_blockers = excluded.commercial_blockers,
    commercial_evaluation_receipt_id =
      excluded.commercial_evaluation_receipt_id,
    commercial_memory_digest = excluded.commercial_memory_digest,
    commercial_memory = excluded.commercial_memory,
    commercial_observed_at = excluded.commercial_observed_at,
    commercial_updated_at = excluded.commercial_updated_at
  returning id into v_opportunity_id;

  insert into public.ebay_luna_opportunity_queue_events (
    opportunity_id, event_type, old_value, new_value, idempotency_key
  ) values (
    v_opportunity_id, 'commercial_memory_changed',
    case when v_existing.commercial_memory is null then null else
      pg_catalog.jsonb_build_object(
        'memoryDigest', v_existing.commercial_memory_digest,
        'lifecycleStage', v_existing.commercial_lifecycle_stage,
        'decision', v_existing.commercial_decision,
        'nextBestEvidence', v_existing.commercial_next_best_evidence,
        'observedAt', v_existing.commercial_observed_at
      ) end,
    pg_catalog.jsonb_build_object(
      'memoryDigest', v_memory_digest,
      'lifecycleStage', v_stage,
      'decision', v_decision,
      'nextBestEvidence', v_next_evidence,
      'evidenceFreshness', v_freshness,
      'evaluationReceiptId', v_receipt_id,
      'observedAt', v_observed_at
    ),
    p_idempotency_key
  );

  return pg_catalog.jsonb_build_object(
    'status', 'STORED', 'replay', false,
    'opportunityId', v_opportunity_id, 'memoryDigest', v_memory_digest,
    'evaluationReceiptId', v_receipt_id
  );
end;
$function$;

revoke all on function public.put_seller_os_commercial_opportunity_memory_v1(
  text, uuid, jsonb, text
) from public, anon, authenticated;
grant execute on function
  public.put_seller_os_commercial_opportunity_memory_v1(
    text, uuid, jsonb, text
  ) to service_role;

revoke all on function
  public.prevent_commercial_memory_event_mutation_v1()
from public, anon, authenticated;

grant select, insert, update, delete on
  public.ebay_luna_opportunity_queue,
  public.ebay_luna_opportunity_queue_events
to service_role;
revoke insert, update, delete, truncate, references, trigger on
  public.ebay_luna_opportunity_queue,
  public.ebay_luna_opportunity_queue_events
from anon, authenticated;

comment on function public.put_seller_os_commercial_opportunity_memory_v1(
  text, uuid, jsonb, text
) is 'Internal-only, idempotent Seller OS commercial opportunity memory write. No marketplace side effect.';

notify pgrst, 'reload schema';
