# Local VM Lab First Scan Readiness V1

## Production final status

IMNOVA Production remains Core-only. The production isolation gate blocks eBay Pro routes, and the Production eBay Pro / Market Radar cleanup has been final verified. The 16 Production target tables are documented with exact rows of 0, while schema, tables, and views remain preserved for compatibility.

Production is off-limits for the first real Luna Portex scan. It must not receive eBay Pro scan batches, Market Radar heavy snapshots, scanner outputs, benchmark raw data, external authorization material, real listing drafts, or publication actions.

## Staging role

Staging is the controlled eBay Pro environment. It can host the eBay Professional Seller Suite hub, first scan control state, candidate review state, seller action status, safe product facts shared from Core, and dry-run WhatsApp Seller Alert previews.

Staging should coordinate the first real Luna Portex scan, but it should not become the long-term home for large raw batches or high-volume worker output.

## Local VM/Lab role

The Local VM/Lab is reserved for heavy processing in a future implementation loop. It is planned for heavy scan batches, raw benchmark samples, large Market Radar snapshots, price intelligence working data, lab worker logs, and future image workflow experiments.

This loop documents the VM/Lab role only. It does not connect to a VM, does not connect to a lab database, does not run workers, and does not move data.

## First real Luna Portex scan readiness checklist

- Confirm Production remains IMNOVA Core-only.
- Confirm Production eBay Pro target tables remain exactRows zero.
- Confirm Staging is the controlled eBay Pro execution environment.
- Confirm Local VM/Lab is reserved for heavy scan processing.
- Keep WhatsApp Seller Alerts in dry-run mode.
- Keep marketplace API access, authorization flows, listing drafts, and publication disabled.
- Prepare a fresh Luna Portex first-scan baseline in Staging/Lab.
- Do not mix demo or pre-baseline data with the first real scan result.

## What data can go to VM

The VM/Lab can receive future heavy scan batches, raw benchmark samples, large Market Radar snapshots, price intelligence working data, lab worker logs, and future image workflow experiments after a dedicated lab database and scoped credentials are approved.

## What data can go to Staging

Staging can receive eBay Pro summaries, first real Luna Portex scan control state, candidate review state, seller action status, safe product facts shared from Core, and dry-run WhatsApp Seller Alert previews.

## What must never go to Production

Production must not receive eBay Pro scan batches, Market Radar heavy snapshots, benchmark raw data, scanner outputs, lab worker logs, external marketplace authorization material, real listing drafts, or publication actions.

## WhatsApp dryRun rule

WhatsApp remains a shared controlled communication channel. IMNOVA Core WhatsApp remains available for Core use, while eBay Pro Seller Alerts stay staging/lab-only and dry-run by default. This loop performs no real messaging and does not change Meta templates.

## Safety rules

- No Production writes.
- No Staging database writes.
- No database connections in this loop.
- No VM connection in this loop.
- No SQL or migrations.
- No marketplace API access, authorization flows, real drafts, or publication.
- No OpenAI, image generation, uploads, scraper, or downloads.
- No secrets, dumps, or backup files are committed.

## Next implementation steps

1. Create a dedicated Local VM/Lab database plan with scoped lab-only credentials.
2. Define the first Luna Portex scan job contract: inputs, summaries, and output boundaries.
3. Keep Staging as the eBay Pro control plane and move heavy raw output to VM/Lab.
4. Add dry-run worker commands after the VM/Lab connection plan is approved.
5. Run the first real Luna Portex scan only after operator approval and readiness checks pass.
