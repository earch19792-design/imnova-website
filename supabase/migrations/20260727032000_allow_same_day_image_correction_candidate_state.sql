begin;

alter table public.ebay_same_day_pilot_candidates
  drop constraint if exists ebay_same_day_pilot_candidates_state_check;

alter table public.ebay_same_day_pilot_candidates
  add constraint ebay_same_day_pilot_candidates_state_check
  check (
    state = any (
      array[
        'READY_TO_VALIDATE_TODAY'::text,
        'NEEDS_PRODUCT_RESEARCH_CAPTURE'::text,
        'NEEDS_LUNA_CONFIRMATION'::text,
        'NEEDS_ONE_CRITICAL_FACT'::text,
        'READY_FOR_CONTENT'::text,
        'NEEDS_IMAGE_CORRECTION'::text,
        'READY_FOR_IMAGE_REVIEW'::text,
        'READY_FOR_MANUAL_PUBLICATION'::text,
        'PUBLISHED_PENDING_VERIFICATION'::text,
        'VERIFIED_ACTIVE'::text,
        'REJECTED_TODAY'::text
      ]
    )
  );

notify pgrst, 'reload schema';

commit;
