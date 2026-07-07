SELECT
  table_name,
  column_name,
  data_type,
  is_nullable,
  ordinal_position
FROM information_schema.columns
WHERE table_name IN (
  'ebay_product_candidates',
  'ebay_candidate_scores',
  'ebay_candidate_validations',
  'ebay_profit_scenarios'
)
ORDER BY
  table_name,
  ordinal_position;
