-- Reuse the append-only listing case history for explicit OWNER review actions.
alter table public.seller_os_listing_case_events_v1
  drop constraint seller_os_listing_case_events_v1_event_type_check;

alter table public.seller_os_listing_case_events_v1
  add constraint seller_os_listing_case_events_v1_event_type_check
  check (event_type in ('CREATED', 'RECONCILED', 'OWNER_REVIEW_ACTION'));

alter table public.seller_os_listing_case_events_v1
  add constraint seller_os_listing_case_owner_action_v1_check
  check (event_type <> 'OWNER_REVIEW_ACTION' or (
    previous_state is null
    and current_state->>'action' in
      ('CONFIRM_EXACT_LINK', 'REJECT_CANDIDATE', 'KEEP_MANUAL_NO_LUNA', 'REVIEW_CONFLICT')
    and current_state->>'marketplaceId' = 'EBAY_US'
    and current_state->>'ebayItemId' ~ '^[0-9]{9,20}$'
    and length(current_state->>'actorUserId') > 0
    and current_state->>'reviewSweepId' ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and (current_state->>'action' not in ('CONFIRM_EXACT_LINK', 'REJECT_CANDIDATE')
      or (current_state->>'candidateProductId' ~ '^[0-9]{1,30}$'
        and current_state->>'candidateVariantId' ~ '^[0-9]{1,30}$'
        and length(current_state->>'candidateSku') between 1 and 120))
  ));
