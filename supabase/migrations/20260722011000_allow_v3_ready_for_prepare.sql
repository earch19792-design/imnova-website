alter table public.ebay_same_day_pilot_image_revisions
  drop constraint if exists ebay_same_day_image_revision_status_check;
alter table public.ebay_same_day_pilot_image_revisions
  add constraint ebay_same_day_image_revision_status_check check (
    status in ('CLAIMED','READY_FOR_PREPARE','FAILED_RETRYABLE','FAILED_FINAL','PENDING_REVIEW','APPROVED','REJECTED')
  );
