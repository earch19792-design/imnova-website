begin;

update public.ebay_luna_selector_policies_v2
set policy = jsonb_set(
      coalesce(policy, '{}'::jsonb),
      '{bootstrapCanaryEnabled}',
      'false'::jsonb,
      true
    ),
    shadow_mode = true,
    updated_at = now()
where marketplace = 'EBAY_US';

-- Additive audit columns and immutable snapshots are intentionally retained.
-- Disabling the policy is the safe rollback.

commit;
