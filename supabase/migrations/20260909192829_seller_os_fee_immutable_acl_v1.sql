-- Supabase projects may grant all table privileges to service_role by default.
-- Explicitly remove mutation privileges from immutable evidence, including TRUNCATE.
revoke update,delete,truncate,references,trigger on public.seller_os_ebay_fee_authorities_v1,public.seller_os_ebay_fee_reconciliation_receipts_v1 from service_role;
revoke delete,truncate,references,trigger on public.seller_os_ebay_fee_bindings_v1 from service_role;
