begin;

-- Compensating rollback:
-- 1. Deploy the previous application version or set
--    EBAY_PUBLISHED_ACQUISITION_EXCLUSION_MODE=SHADOW.
-- 2. Remove the service-role mutation capability below.
-- 3. Identity, exclusion, transition, event, task and job audit history is
--    intentionally retained. Previously superseded candidates are not revived.
-- 4. Source synchronization remains read-only and useful for later audit.

revoke execute on function
  public.supersede_published_acquisition_candidate_v1(
    uuid, text, text, text, jsonb, text, timestamptz
  )
  from service_role;

comment on table public.ebay_published_acquisition_exclusions is
  'Compensating rollback applied: audit history is intentionally retained; no candidate, task, job, transition or event was reversed.';

commit;
