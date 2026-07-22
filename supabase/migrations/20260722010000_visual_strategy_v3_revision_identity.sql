alter table public.ebay_same_day_pilot_image_revisions
  add column if not exists parent_revision_id uuid references public.ebay_same_day_pilot_image_revisions(id) on delete restrict,
  add column if not exists revision_fingerprint text,
  add column if not exists source_pack_version text,
  add column if not exists main_source_id text,
  add column if not exists main_source_hash text,
  add column if not exists side_source_id text,
  add column if not exists side_source_hash text,
  add column if not exists product_dossier_hash text,
  add column if not exists market_visual_brief_hash text;

alter table public.ebay_same_day_pilot_image_revisions
  add constraint ebay_same_day_image_revision_fingerprint_unique unique (revision_fingerprint);
