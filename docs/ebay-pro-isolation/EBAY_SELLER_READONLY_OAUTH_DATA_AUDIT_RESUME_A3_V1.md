# EBAY-RESUME-A3 - Seller Account Read-Only OAuth Data Audit

## Why

IMNOVA OS is returning to the eBay route because the seller account now exists and Amazon 149G is paused. Before building drafts or listing packages, the system needs a controlled way to verify what the eBay Developer app can read from the personal seller account.

This loop prepares that read-only audit without creating drafts, listings, publications, files, tokens, or database writes.

## Current state

- EBAY-RESUME-A is integrated in PRE/Staging.
- EBAY-RESUME-A2 is integrated in PRE/Staging.
- `main` remains frozen.
- Production remains frozen.
- Amazon 149G remains paused and is not included.
- Old local eBay LOOP 149 remains excluded.
- The current seller account is personal.
- Business conversion is planned in about 15 days.

## Human confirmations received

- Developer Account created: yes.
- eBay app created: yes.
- Sandbox keys available: yes.
- Production keys available: yes.
- Redirect URI configured: yes.
- Personal seller account created: yes.
- Authorization for read-only OAuth audit: yes.
- Seller Hub accessible: yes.

## What Read-Only OAuth Means

Read-only OAuth means the seller grants the app limited permission to look at allowed account data. It is not permission to create a listing, publish an item, modify inventory, update policies, or change account settings.

The runner in this loop is gated. By default it does nothing real. A real audit requires an explicit CLI flag, exact environment approval, required local variables, and a second typed confirmation in the terminal.

## Reading Data vs Writing Data

Reading data means checking whether policies or inventory locations exist and counting them. Writing data means creating or changing drafts, listings, policies, inventory, offers, or publications.

EBAY-RESUME-A3 allows only future gated read-only API calls. It blocks all write behavior.

## What The API Can Audit

The read-only audit is designed to check:

- OAuth authorization success.
- Business policy readability.
- Fulfillment/shipping policy count.
- Return policy count.
- Payment policy count.
- Inventory location count when the read-only inventory scope is available.
- Missing policy types.
- Technical readiness for EBAY-RESUME-B.

## What The API Must Not Audit

This loop must not read buyer PII, orders, fulfillment/order data, or any data that is not needed for seller readiness. It must not use write scopes and must not call write endpoints.

## Manual Seller Hub Review Still Required

Seller Hub remains the source for:

- Internal account alerts.
- Suspension or selling restriction status.
- Identity verification status.
- Payments and payouts final approval.
- Seller limits if not available by API.
- eBay messages.
- Personal to business conversion status.
- Human approval before any listing work.

## Why Tokens Are Not Stored

Tokens are powerful account credentials. This loop keeps tokens only in memory during a gated audit and discards them afterward. It does not write tokens to disk, commit tokens, print tokens, or store refresh tokens.

## Why Client Secret Is Never Printed

The client secret belongs only in local operator-controlled environment variables for the gated runner. The runner checks that it exists but never prints it.

## Why No Draft, Listing, Or Publication Is Created

This loop is an audit layer, not a listing runner. It answers whether the account looks ready to continue. Draft creation remains a later controlled loop. Publication remains blocked.

## How To Interpret Results

- `NEED_MORE_OAUTH_AUDIT_DATA`: OAuth or scope readiness still needs confirmation.
- `EBAY-RESUME-A4`: OAuth works but Seller Hub or policy data is missing and needs a fix plan.
- `EBAY-RESUME-B`: account data is ready enough to return to sandbox draft work.
- `EBAY-RESUME-C`: the safer path is a first manual listing package.
- `EBAY-RESUME-HOLD`: account risk, verification, or suspension must be resolved first.

## When To Advance To EBAY-RESUME-B

Advance to EBAY-RESUME-B only when OAuth read-only audit succeeds, required business policies exist, inventory location is readable or manually confirmed, Seller Hub has no blocking risk, and a human approves continuing.

## When To Advance To EBAY-RESUME-C

Use EBAY-RESUME-C if the seller wants to prepare the first listing manually in Seller Hub before returning to API-assisted draft work.

## When To Use EBAY-RESUME-A4

Use EBAY-RESUME-A4 when policies, item location, payments, limits, alerts, or business conversion steps are missing.

## When To Use EBAY-RESUME-HOLD

Use EBAY-RESUME-HOLD if Seller Hub shows suspension, verification risk, selling restriction, payment block, or any account condition that makes listing unsafe.

## Personal Account Risk And Business Conversion

The account is currently personal. That can be acceptable temporarily for readiness work, but IMNOVA must re-check the account after business conversion. Policies, payout settings, account verification, and OAuth consent may need review again after conversion.

## Safety Boundaries

- No Production write.
- No `main` write.
- No Staging DB write.
- No Supabase write.
- No eBay write API.
- No draft creation.
- No listing creation.
- No publication.
- No token storage.
- No token printing.
- No client secret printing.
- No Amazon 149G mixing.
- No old eBay LOOP 149 mixing.
- No WhatsApp real send.
- No OpenAI/Codex API.
- No scraper.
- No `.env` file changes.

## Definition Of Done

- Fixture defines the A3 safety boundary.
- Pure module builds read-only audit reports.
- Dry-run runs without network, OAuth, or environment reads.
- Runner default mode proves it does nothing real.
- Runner gated mode requires exact approval before any read-only OAuth exchange.
- Tests validate scopes, token safety, route decisions, and no write behavior.
- TypeScript passes.
- Git status is clean.

## Human Explanation Rule

Every result must be explainable to a seller learning eBay Developer, OAuth, Seller Hub, and account setup. The report must say what was checked, what was not checked, what remains manual, and whether it is safe to continue.

## Next Step

The next step depends on the audit result:

- `EBAY-RESUME-A4` if Seller Hub or policies are missing.
- `EBAY-RESUME-B` if the account is ready for sandbox draft work.
- `EBAY-RESUME-C` if the business wants the first listing prepared manually.
- `EBAY-RESUME-HOLD` if account risk appears.
