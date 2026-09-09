-- Supabase default privileges can grant service_role UPDATE on new tables.
-- Receipts only permit insertion and scoped readback.
revoke all on public.seller_os_assistant_treatment_receipts_v1 from service_role;
grant select, insert on public.seller_os_assistant_treatment_receipts_v1 to service_role;
create trigger seller_os_assistant_treatment_receipt_append_only_v1
before update or delete on public.seller_os_assistant_treatment_receipts_v1
for each row execute function public.reject_seller_os_economic_receipt_mutation_v1();
