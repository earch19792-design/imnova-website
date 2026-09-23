# Pre-Research runtime hardening canary gate

The browser worker's hardened Pre-Research lane is default-off. Set
`PRE_RESEARCH_HARDENING_CANARY_ENABLED=true` and
`PRE_RESEARCH_HARDENING_CANARY_BATCH_IDS` to a comma-separated, nonempty list
of at most 20 distinct batch UUIDs to enable it. Invalid or empty input
selects no Pre-Research work. `false` or an unset enabled flag keeps that
lane off; it does not alter batch state. In canary or invalid mode the worker
does not fall through to unrelated keyword research.

The prepare and next-plan route responses expose only `canaryGate.state` and
`canaryGate.allowedBatchCount`, not credentials or session material. The
canary SQL functions require the allowlist for every batch selection and
lease recovery. Plans shared with a non-allowlisted batch are ineligible
because their reconciliation trigger would also update that batch. Explicit
plan claims check every attached batch before the lease claim. The old
one-argument selector and preparer are inert after this migration, protecting
the backlog if the migration arrives before the application revision.

The pending migration is
`20260923133000_pre_research_runtime_hardening_v1.sql`, version
`20260923133000`. Do not deploy from a host without working PostgreSQL
transport. Before any canary rollout, verify the exact-version migration
path and ledger, set the application gate to the intended allowlist, and
quiesce older browser workers that might hold an already selected plan.
The migration and application must both be deployed and verified before
authorizing the canary. Removing or disabling the gate does not mutate
existing batches, but the hardened Pre-Research lane remains off until a
separately reviewed global-activation change is made.
