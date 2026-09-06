create index ebay_mayel_visual_phase_b_delegation_authority_idx
  on public.ebay_mayel_visual_phase_b_executions_v1(
    delegation_authority_id
  ) where delegation_authority_id is not null;
