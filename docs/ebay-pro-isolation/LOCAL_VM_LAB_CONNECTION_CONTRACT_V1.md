# Local VM Lab Connection Contract V1

## Production status

Production remains IMNOVA Core-only, cleaned, and off-limits for eBay Pro execution. The eBay Pro / Market Radar cleanup was final verified, and the exact count record documents that all 16 target Production tables are at zero rows.

Production must never connect to the VM/Lab, run heavy scans, run eBay Pro workers, receive raw scan batches, receive benchmark raw data, create real listing drafts, or publish listings.

## Staging status

Staging remains the controlled eBay Pro environment. It is the control plane for the eBay Professional Seller Suite, first real Luna Portex scan planning, candidate review, seller action status, and dry-run seller alerts.

Staging should coordinate scan control and summaries. Heavy raw processing should move to VM/Lab once the future connection plan is explicitly approved.

## VM/Lab role

The Local VM/Lab is planned for heavy scans, workers, raw scan simulations, benchmark experiments, large fixtures, price intelligence working data, and Luna Portex scan simulations.

This loop does not connect the VM/Lab. It only defines the future connection contract and adds a dry-run harness that prints simulated readiness status.

## Connection rules

- `LOCAL_VM_LAB_ENABLED` defaults to `false`.
- `LOCAL_VM_LAB_DRY_RUN` defaults to `true`.
- `EBAY_PRO_RUNTIME` remains staging/lab-only.
- Production must not use the VM/Lab.
- Do not commit a real host, password, token, database locator, private network address, or database URL.
- Do not connect before a dedicated lab database, scoped credentials, operator approval, and rollback/reset procedure exist.
- First future worker command must run in dry-run mode before any real lab execution.

## Future environment variables

These names are documented for a future implementation only. No real values are committed in this loop.

- `LOCAL_VM_LAB_ENABLED`
- `LOCAL_VM_LAB_HOST`
- `LOCAL_VM_LAB_PORT`
- `LOCAL_VM_LAB_DB_NAME`
- `LOCAL_VM_LAB_DB_USER`
- `LOCAL_VM_LAB_DB_SSLMODE`
- `LOCAL_VM_LAB_DRY_RUN`
- `EBAY_PRO_RUNTIME`
- `LUNA_PORTEX_SCAN_MODE`

## What must never be committed

- Real VM hostnames or private addresses.
- Database passwords.
- Marketplace tokens.
- Database locators.
- Remote backend credentials.
- Dump or backup files.
- Customer data, row exports, or raw scan outputs.

## What must never run in Production

- VM/Lab database connections.
- Heavy eBay Pro scan batches.
- Raw benchmark jobs.
- Worker scratch output.
- Lab-only fixtures.
- Marketplace authorization flows.
- Real listing drafts.
- Publication actions.

## First real Luna Portex scan preparation

The first real Luna Portex scan remains pending. Staging should stay the control plane, and VM/Lab should become the heavy-processing location only after the future connection plan is approved. Demo and pre-baseline data must remain separate from the first real scan.

## WhatsApp dry-run rule

WhatsApp remains a shared controlled channel. eBay Pro seller alerts stay dry-run by default for staging/lab planning, with no real messaging in this loop.

## Security checklist

- Confirm Production remains Core-only and clean.
- Confirm Staging remains the eBay Pro control plane.
- Confirm VM/Lab dry-run mode is enabled by default.
- Confirm no real host or database locator is committed.
- Confirm no `.env`, `.env.local`, or production environment file is created.
- Confirm no dump or backup file is present in the repo.
- Confirm no network, database, remote backend, marketplace, AI, image, upload, scraper, or messaging call is added.

## Next implementation steps

1. Approve a dedicated lab database and reset/rollback procedure.
2. Define scoped lab-only credentials outside the repo.
3. Add an operator-approved connection check in dry-run mode.
4. Add a worker dry-run for Luna Portex scan simulation.
5. Promote only sanitized summaries back to Staging after review.
