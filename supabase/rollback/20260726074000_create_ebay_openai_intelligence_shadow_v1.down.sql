begin;

drop view if exists public.ebay_openai_intelligence_metrics_v1;
drop function if exists public.complete_ebay_openai_shadow_invocation_v1(
  uuid, text, text, jsonb, bigint, bigint, bigint, bigint, bigint, text, text
);
drop function if exists public.reserve_ebay_openai_shadow_invocation_v1(
  text, text, text, text, text, text, text, text, jsonb, bigint, text, integer
);
drop table if exists public.ebay_openai_shadow_evaluations;
drop table if exists public.ebay_openai_circuit_breakers;
drop table if exists public.ebay_openai_budget_usage;
drop table if exists public.ebay_openai_invocations;
drop table if exists public.ebay_openai_use_case_configs;

commit;
