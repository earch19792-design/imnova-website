alter function public.prepare_ebay_active_listing_image_revision(
  uuid, uuid, uuid, text, text, text
) set search_path = public, extensions, pg_temp;

comment on function public.prepare_ebay_active_listing_image_revision(
  uuid, uuid, uuid, text, text, text
) is 'Prepares one approved ACTIVE-listing image revision with pgcrypto available for the immutable request hash.';
