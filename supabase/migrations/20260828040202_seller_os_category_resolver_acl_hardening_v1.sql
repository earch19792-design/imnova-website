-- Forward-only least-privilege correction for CATEGORY_RESOLVER_V1.
-- Managed Supabase default privileges give service_role broader table DML
-- than this authority needs. Category learning is append/update/read only.

revoke all on table public.ebay_category_resolution_learning_v1
  from service_role;
grant select, insert, update on table
  public.ebay_category_resolution_learning_v1 to service_role;

comment on table public.ebay_category_resolution_learning_v1 is
  'CATEGORY_RESOLVER_V1 mappings proven by official eBay Taxonomy. Reusable mapping data is family/type scoped; candidate-specific aspect values remain in exact listing packages. DELETE is intentionally unavailable to service_role.';
