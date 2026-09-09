-- Operator-triggered bounded receipts; no scheduler, worker or marketplace writes.
create table public.seller_os_assistant_treatment_receipts_v1 (
  receipt_id text primary key check (receipt_id ~ '^sha256:[0-9a-f]{64}$'),
  marketplace_account_key text not null,
  ebay_item_id text not null check (ebay_item_id ~ '^[0-9]{9,19}$'),
  contract_version text not null check (contract_version = 'SELLER_OS_ASSISTANT_TREATMENT_RECEIPT_V1'),
  input_digest text not null,
  treatment text not null check (treatment in ('SCALE','OPTIMIZE','TEST','RESTOCK','HOLD','PROFIT_PROTECT')),
  receipt_kind text not null check (receipt_kind in ('SIMULATION','OPTIMIZATION','PROMOTION','IMAGE_REQUEST')),
  policy jsonb not null,
  before_evidence jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
create index seller_os_assistant_treatment_receipts_item_v1_idx
  on public.seller_os_assistant_treatment_receipts_v1 (marketplace_account_key, ebay_item_id, created_at desc);
alter table public.seller_os_assistant_treatment_receipts_v1 enable row level security;
alter table public.seller_os_assistant_treatment_receipts_v1 force row level security;
revoke all on public.seller_os_assistant_treatment_receipts_v1 from public, anon, authenticated;
grant select, insert on public.seller_os_assistant_treatment_receipts_v1 to service_role;
comment on table public.seller_os_assistant_treatment_receipts_v1 is
  'Append-only treatment baseline. Simulation is never represented as an applied marketplace action. Read on demand by exact account and Item ID.';
