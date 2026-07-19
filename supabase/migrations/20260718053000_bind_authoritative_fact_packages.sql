-- Bind every positive OPENAI_INPUT_READY event to the exact decision package
-- and to a short-lived, authority-filtered fact payload. Existing legacy
-- events deliberately remain unbound and therefore cannot authorize content.

alter table public.marketplace_product_fact_readiness_events
  add column if not exists decision_package_id uuid null
    references public.marketplace_listing_decision_packages(id) on delete restrict,
  add column if not exists decision_package_hash text null,
  add column if not exists authoritative_facts_package jsonb null,
  add column if not exists authoritative_facts_package_hash text null,
  add column if not exists authoritative_facts_expires_at timestamptz null;

alter table public.marketplace_product_fact_readiness_events
  add constraint marketplace_product_fact_readiness_decision_hash_check
    check (decision_package_hash is null or decision_package_hash ~ '^sha256:[0-9a-f]{64}$') not valid,
  add constraint marketplace_product_fact_readiness_authoritative_hash_check
    check (authoritative_facts_package_hash is null or authoritative_facts_package_hash ~ '^sha256:[0-9a-f]{64}$') not valid,
  add constraint marketplace_product_fact_readiness_authoritative_payload_check
    check (authoritative_facts_package is null or jsonb_typeof(authoritative_facts_package) = 'object') not valid,
  add constraint marketplace_product_fact_readiness_openai_binding_check
    check (gate_name <> 'OPENAI_INPUT_READY' or ready = false or (
      decision_package_id is not null
      and decision_package_hash is not null
      and authoritative_facts_package is not null
      and authoritative_facts_package_hash is not null
      and authoritative_facts_expires_at is not null
      and authoritative_facts_expires_at > observed_at
      and authoritative_facts_package -> 'ready' = 'true'::jsonb
      and authoritative_facts_package -> 'openAiCalls' = '0'::jsonb
    )) not valid;

create index if not exists marketplace_product_fact_readiness_bound_package_idx
  on public.marketplace_product_fact_readiness_events (
    marketplace_account_key, marketplace, queue_item_id,
    decision_package_id, decision_package_hash, observed_at desc
  ) where gate_name = 'OPENAI_INPUT_READY' and ready = true;

comment on column public.marketplace_product_fact_readiness_events.authoritative_facts_package is
  'Structured facts filtered by field authority; excludes raw pages, competitor-only facts, URLs, images, PII and secrets.';

notify pgrst, 'reload schema';
