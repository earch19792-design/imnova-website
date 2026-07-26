begin;

update public.ebay_demand_evidence_policy_configs
set
  enabled = false,
  shadow_mode = true,
  updated_at = now()
where
  enabled is distinct from false
  or shadow_mode is distinct from true;

comment on table public.ebay_demand_evidence_policy_configs is
  'Compensating rollback applied: policy disabled and retained in shadow mode; audit history preserved.';

notify pgrst, 'reload schema';

commit;
