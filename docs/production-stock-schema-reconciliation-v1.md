# Production stock authority schema reconciliation

Base: `ba1af1b61e446bfc12a6995d32c939d0d65f1a73`. Target: `qsefoxmmypmdtwrrtnry`.
Service: `SELLER_OS_PRODUCTION_STOCK_READ_V1`.

The exact table/column inventory, physical pre-migration inventory, ledger counts
and targeted set are in `production-stock-schema-attestation-v1.json`.
Required columns include SELECT, filter and ordering columns. They are extracted
from the four stock repository functions and `readCurrentLiveAuthorityV1`;
the migration does not broaden the five-query production transport allowlist.

## Historical sources and material dependencies

| Source migration | Required contribution | Why not replay the whole migration |
| --- | --- | --- |
| `202606280002` | Existing `ebay_active_listings` base columns | Already applied. Its risk-event table and admin policy remain unchanged. |
| `20260713040000` | `account_key`, `source`, `sync_key`, `supplier_cost_at_linking` | Also creates automation/package/review/alert tables, alters risk events, drops constraints and rewrites risk fingerprints. Requires `ebay_luna_scan_runs` and `ebay_luna_opportunity_queue` from `20260712235500`, plus Market Radar tables. Its `account_key DEFAULT 'default'` is not an authoritative account assignment. |
| `20260713074000` | `sync_generation`; account-scoped sync-state table | Also installs begin/commit generation writer RPCs requiring the command-center registry shape, including `sync_run_id`. None of these RPCs is used by the read service. |
| `20260821193830` | Stock jobs and observations | Creates scheduling/claim/complete RPCs in addition to storage. The only inter-table storage dependency required here is the observation-to-job composite identity FK. No scheduler or claim function is installed. |
| `20260822150720` | Linkage decisions | Full producer schema depends on the review-candidate table, identity/provenance validators and `auth.users`, plus human-approval control-plane RPCs. Those are not dependencies of this read service and must not be partially replayed to manufacture linkage. |
| `20260906224852` | Ten CURRENT LIVE state/evidence fields | Also replaces recovery/recording writer functions requiring the generation writer schema. Only the read evidence shape and valid LIVE snapshot constraints are required. |

`20260908232657` corrects a CURRENT LIVE writer function; it introduces no column
used by this read service. Relist handoff migrations from `20260911155055` onward
write the established linkage contract; they introduce no reader schema columns.
Neither group is replayed.

The targeted reconciliation has **no transitive historical migration requirement**:
the existing registry and standard roles are present; the four missing read
authorities are created in dependency order in this one migration. Source migration
IDs identify provenance, not entries to mark applied. The original production
ledger's 17 entries are preserved. Of 400 local versions absent from that ledger,
five are historical schema sources and 395 are outside the targeted source set.

## Deliberate limits

This creates the **read-consumed storage subset**, not the entire historical
producer/control-plane schema. New tables grant service SELECT only; anon and
authenticated have no access. They have enabled/forced RLS. No INSERT/UPDATE/DELETE
grant or producer function is created. Existing tables, policies, ACLs and extra
columns are preserved on replay. A future producer integration must attest its
complete schema and provenance dependencies separately; these empty tables do not
authorize fabricated authority records or make historical writer migrations safe
to replay wholesale.

The service credential is server-owned and account selection is fixed by verified
production identity. The existing transport enforces an exact `account_key` filter
on every read and denies caller-controlled account, target, credentials and writes.
RLS is not used to claim that a privileged service role itself is account-limited.
Observation/job foreign keys also include account, linkage and Item ID.

## Account attribution and data preservation

The physical registry was empty at audit. No backfill is performed. Added registry
columns are nullable, without defaults. In particular, `account_key` is not derived
from title, SKU or a global account default. No NOT NULL or unique account-dependent
constraint is added to the old registry. Unattributed rows remain invisible to the
exact-account reader. Existing row values and the existing admin policy/grants are
unchanged. No destructive DDL, data rewrite, deletion, truncation or ledger repair.

Schema readiness is independent of **data readiness**. This migration imports no
LIVE snapshot, linkage decision, job or stock observation. If production lacks those
records after reconciliation, authenticated reads must return unproven/empty rather
than certifying the requested Item IDs from a historical PREPROD result.

## Validation and application

The PGlite regression suite executes this SQL on the old physical schema, reapplies
it, checks schema/ACL/row preservation, denies unauthorized access, verifies account
isolation and executes the actual five repository reads against PostgreSQL. Fresh
fixture observations demonstrate the read path without inventing numeric supplier
stock; missing authority rows demonstrate fail-closed behavior. Existing production
boundary/service/authentication suites continue to cover all marketplace write bans.

Apply only the SQL content of `20260911170910_production_stock_authority_schema_reconciliation_v1.sql`
using the production migration API after attestation and tests. Do not run `db push`,
`migration repair`, or replay pending history. The management API assigns its own
ledger version: record that exact version plus SQL digest, without rewriting it.
Read back columns, grants, policies, unchanged registry data and the single ledger
addition. Then use the existing production workload certification hook to exercise
both requested Item IDs and the LIVE cohort from PRODUCTION_CORE.
