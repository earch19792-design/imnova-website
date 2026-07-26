begin;

alter function public.initialize_ebay_listing_factory_run_v1(
  uuid,text,uuid
) set search_path = public, pg_temp;

alter function public.claim_ebay_listing_factory_candidate_v1(
  uuid,text,timestamptz,integer
) set search_path = public, pg_temp;

alter function public.claim_ebay_listing_factory_candidate_by_id_v1(
  uuid,uuid,text,timestamptz,integer
) set search_path = public, pg_temp;

alter function public.transition_ebay_listing_factory_candidate_v1(
  uuid,text,text,text,integer,text,jsonb,text,text,uuid,text,text,uuid,text
) set search_path = public, pg_temp;

alter function public.resolve_ebay_listing_factory_circuit_probe_v1(
  text,text,text,text,boolean,text,text,timestamptz,timestamptz
) set search_path = public, pg_temp;

commit;
