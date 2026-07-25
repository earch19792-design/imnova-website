-- A structurally valid official Product Research table can have no row whose
-- sold date is safe to use. Store that negative result as an audited batch;
-- rejected rows remain absent from marketplace sold observations and cannot
-- influence commercial decisions.

alter table public.marketplace_product_research_capture_batches
  drop constraint if exists marketplace_product_research_capture_batches_counts_check;

alter table public.marketplace_product_research_capture_batches
  add constraint marketplace_product_research_capture_batches_counts_check check (
    source_row_count > 0 and valid_count >= 0 and imported_count >= 0
    and duplicate_count >= 0 and rejected_count >= 0
    and exact_luna_match_count >= 0 and different_pack_count >= 0
    and different_size_count >= 0 and different_variant_count >= 0
    and ambiguous_count >= 0 and no_luna_match_count >= 0
    and candidates_enriched_count >= 0
    and source_row_count = valid_count + rejected_count
    and source_row_count = imported_count + duplicate_count + rejected_count
    and (valid_count > 0 or (
      rejected_count = source_row_count
      and imported_count = 0
      and duplicate_count = 0
      and coalesce((error_counts->>'LAST_SOLD_DATE_INVALID')::integer, 0) = source_row_count
    ))
  );
