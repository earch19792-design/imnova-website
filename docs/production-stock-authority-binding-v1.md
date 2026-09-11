# Production stock authority binding

`PRODUCTION_CORE -> /api/runtime/stockguard-read -> dedicated canonical stock
read service -> imnova-core`, account `imnova-ebay-us-primary` only.

The read service is co-deployed as an isolated Node function in the existing
production project. It reuses the certified repository/stock projection, not
the PREPROD relay. No new worker, scheduler, project, or shared secret is needed.

The production architecture assigns Core to `qsefoxmmypmdtwrrtnry` (see
`supabase-production/MIGRATION_HISTORY_STATUS.md` and
`ebay-pro-isolation/EBAY_PRO_PRODUCTION_ISOLATION_FAST_V1.md`). No intentional
pause contract was found. Restoration of that existing required backend was
authorized conditionally by this workstream. Restoring it does not provision
Seller OS schema/data or authorize copying PREPROD credentials.

Vercel workload identity is already enabled for the production project with
team issuer mode. Requests carry a short-lived signed service assertion in
`x-seller-os-service-assertion`; it is not an eBay/database access token. The
verifier pins issuer, audience, subject, team ID, project ID/name, production
environment, algorithm and lifetime. Signing keys remain at Vercel. The caller
cannot choose the account, database, target, capability outside the five-read
allowlist, or downstream credentials. Bearer credentials are rejected. The
database credential is used only inside its original production runtime.

The account scope is pinned to the separately certified canonical fingerprint
recorded in `owner-variable-cost-policy-v1.json` and
`ebay-fee-automation-closeout-evidence-v1.json`; caller input cannot override it.
Binding/authentication is distinct from availability of the stock repository.
Missing tables must return a structured error, never a successful empty cohort.
The transport permits at most five exact-account GETs against the five existing
stock authority tables on Core. No RPC or marketplace endpoint is reachable.

Sources: https://vercel.com/docs/oidc/api and
https://vercel.com/docs/oidc/reference. This is platform workload federation,
not an eBay OAuth consent change. PREPROD project tokens fail even when that
project's deployment target is named `production`.

One-shot physical verification uses `tools/production-stock-service-certify.mjs`
from a production build with its own platform assertion, against the production
alias after deployment. Assertions are never saved or logged. A shared schema
failure ends the check without repeated cohort queries. This proves service
authentication separately from stock freshness; only current exact durable
stock rows may produce the final operational PASS.
