-- Accept an authenticated extension attestation that the official eBay Product
-- Research page visibly reported no sold results for the planned 90-day query.
-- No synthetic observation is inserted: the batch contains zero rows and can
-- support only the controlled no-recent-sales path.

alter table public.marketplace_product_research_capture_batches
  drop constraint if exists marketplace_product_research_capture_batches_counts_check;

alter table public.marketplace_product_research_capture_batches
  add constraint marketplace_product_research_capture_batches_counts_check check (
    source_row_count >= 0 and valid_count >= 0 and imported_count >= 0
    and duplicate_count >= 0 and rejected_count >= 0
    and exact_luna_match_count >= 0 and different_pack_count >= 0
    and different_size_count >= 0 and different_variant_count >= 0
    and ambiguous_count >= 0 and no_luna_match_count >= 0
    and candidates_enriched_count >= 0
    and source_row_count = valid_count + rejected_count
    and source_row_count = imported_count + duplicate_count + rejected_count
    and (
      source_row_count > 0 and (
        valid_count > 0 or (
          rejected_count = source_row_count
          and imported_count = 0
          and duplicate_count = 0
          and coalesce(
            (error_counts->>'LAST_SOLD_DATE_INVALID')::integer,
            0
          ) = source_row_count
        )
      )
      or source_row_count = 0
        and valid_count = 0
        and imported_count = 0
        and duplicate_count = 0
        and rejected_count = 0
        and exact_luna_match_count = 0
        and different_pack_count = 0
        and different_size_count = 0
        and different_variant_count = 0
        and ambiguous_count = 0
        and no_luna_match_count = 0
        and candidates_enriched_count = 0
        and coalesce(
          (error_counts->>'OFFICIAL_NO_SOLD_RESULTS')::integer,
          0
        ) = 1
    )
  );

comment on constraint marketplace_product_research_capture_batches_counts_check
  on public.marketplace_product_research_capture_batches is
  'Allows sold rows, all-invalid-date visible rows, or a zero-row official no-sold-results attestation; only valid sold observations affect demand.';

notify pgrst, 'reload schema';
