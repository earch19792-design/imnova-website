begin;

alter table public.ebay_same_day_pilot_human_tasks
  drop constraint if exists ebay_same_day_pilot_human_tasks_gate_type_check;

alter table public.ebay_same_day_pilot_human_tasks
  add constraint ebay_same_day_pilot_human_tasks_gate_type_check
  check (
    gate_type = any (
      array[
        'PRODUCT_RESEARCH_CAPTURE_REQUIRED'::text,
        'LUNA_CONFIRMATION_REQUIRED'::text,
        'PRODUCT_APPROVAL_REQUIRED'::text,
        'IMAGE_APPROVAL_REQUIRED'::text,
        'MANUAL_PUBLICATION_REQUIRED'::text,
        'ITEM_ID_REQUIRED'::text,
        'CRITICAL_EXCEPTION_REQUIRED'::text,
        'IMAGE_SOURCE_OR_QUALITY_CORRECTION_REQUIRED'::text
      ]
    )
  );

notify pgrst, 'reload schema';

commit;
