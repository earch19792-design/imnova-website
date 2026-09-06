-- Extends the existing Mayel visual control plane. Current LIVE listings may
-- enter visual work from official eBay identity even when legacy Luna/Quick
-- Pick lineage is absent. Missing product facts remain explicitly restricted;
-- they do not make the listing visually ineligible.

alter table public.ebay_mayel_visual_tasks_v1
  alter column active_listing_id drop not null,
  alter column manual_listing_link_id drop not null,
  alter column opportunity_id drop not null,
  alter column listing_package_id drop not null;

alter table public.ebay_mayel_visual_tasks_v1
  drop constraint if exists ebay_mayel_visual_tasks_selection_check;

alter table public.ebay_mayel_visual_tasks_v1
  add constraint ebay_mayel_visual_tasks_selection_check check (
    selection_authority in (
      'EBAY_LISTING_QUALITY_VISUAL_SIGNAL',
      'SELLER_OS_LIVE_VISUAL_QUALITY_SIGNAL',
      'LOW_CTR_SUFFICIENT_IMPRESSIONS',
      'SELLER_OS_AUTHORITATIVE_LIVE_VISUAL_PORTFOLIO'
    )
    and jsonb_typeof(selection_signal) = 'object'
  );

comment on constraint ebay_mayel_visual_tasks_selection_check
  on public.ebay_mayel_visual_tasks_v1 is
  'Visual eligibility may originate from the authoritative current LIVE portfolio. Performance and market evidence determine priority, not eligibility.';

comment on column public.ebay_mayel_visual_tasks_v1.visual_manifest is
  'Durable Mayel-selected ordered gallery intent. V2 may select the hero, retain/remove official images, and include/exclude approved assets; order is material.';

notify pgrst, 'reload schema';
