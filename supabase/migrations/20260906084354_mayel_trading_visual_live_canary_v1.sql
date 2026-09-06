-- The account-wide Mayel delegation is reusable. The original Phase B ledger
-- inherited a per-listing owner approval uniqueness constraint; keeping it
-- would make the first delegated Trading execution consume the global
-- authority forever. Exact task + manifest and exact write binding indexes
-- remain the idempotency authorities.

alter table public.ebay_mayel_visual_phase_b_executions_v1
  drop constraint
    ebay_mayel_visual_phase_b_executions_v1_owner_approval_id_key;

-- Media preparation may be reused from a durable, unexpired receipt. In that
-- case this execution performs zero Media writes but must still bind the exact
-- image ID, EPS URL and receipt used by the listing revision.
alter table public.ebay_mayel_visual_phase_b_executions_v1
  drop constraint ebay_mayel_visual_phase_b_media_check;

alter table public.ebay_mayel_visual_phase_b_executions_v1
  add constraint ebay_mayel_visual_phase_b_media_check check (
    media_preparation_write_count between 0 and 1
    and (
      (management_model = 'INVENTORY_API_MANAGED'
        and media_preparation_write_count = 0
        and media_preparation_route is null
        and media_image_id is null
        and media_eps_url is null
        and media_receipt_digest is null)
      or
      (management_model = 'TRADING_MANAGED'
        and media_preparation_route =
          'EBAY_MEDIA_CREATE_IMAGE_FROM_URL_GET_IMAGE_EPS_V1'
        and media_image_id ~ '^[A-Za-z0-9_-]{1,200}$'
        and media_eps_url ~ '^https://([A-Za-z0-9-]+\.)*ebayimg\.com/'
        and media_receipt_digest ~ '^sha256:[0-9a-f]{64}$')
    )
  );

-- An ambiguous Revise response is never retried. A later official GetItem may
-- nevertheless prove that the one attempted write was applied. Permit that
-- durable, fail-closed outcome without weakening any image/protected-field
-- invariant.
alter table public.ebay_mayel_visual_phase_b_executions_v1
  drop constraint ebay_mayel_visual_phase_b_verified_check;

alter table public.ebay_mayel_visual_phase_b_executions_v1
  add constraint ebay_mayel_visual_phase_b_verified_check check (
    phase <> 'APPLIED_AND_OFFICIALLY_VERIFIED' or (
      final_state = 'APPLIED_AND_OFFICIALLY_VERIFIED'
      and marketplace_write_count = 1
      and ebay_response_class in (
        'EBAY_WRITE_ACCEPTED',
        'EBAY_WRITE_CONFIRMED_BY_OFFICIAL_READBACK'
      )
      and postwrite_snapshot is not null
      and postwrite_snapshot ->> 'officialOrderedImageSetMatch' = 'true'
      and postwrite_snapshot ->> 'nonAuthorizedFieldsUnchanged' = 'true'
      and (
        (management_model = 'INVENTORY_API_MANAGED'
          and postwrite_snapshot ->> 'inventoryImagesMatch' = 'true')
        or
        (management_model = 'TRADING_MANAGED'
          and postwrite_snapshot ->> 'listingActive' = 'true'
          and postwrite_snapshot ->> 'mainImageUnchanged' = 'true'
          and postwrite_snapshot ->> 'mayelAssetPresent' = 'true'
          and postwrite_snapshot ->> 'afterImageCount' = '2'
          and postwrite_snapshot ->> 'unauthorizedFieldDiffCount' = '0')
      )
      and applied_verified_at is not null
    )
  );

notify pgrst, 'reload schema';
