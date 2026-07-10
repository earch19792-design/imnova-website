# eBay Developer Seller Link Readiness Resume A2 V1

## Why

The user has created a personal eBay seller account and wants to resume the eBay Professional Seller OS route while Amazon stays paused. Before any OAuth audit, sandbox draft, listing package, or publication, IMNOVA OS needs to understand whether the eBay Developer account can be safely connected to the personal seller account.

EBAY-RESUME-A2 is a local/read-only readiness layer. It prepares the checklist for linking Developer Account and Seller Account, but does not perform real OAuth, does not exchange tokens, and does not call eBay APIs.

## Current State

- EBAY-RESUME-A is integrated in PRE/Staging.
- eBay LOOP 148 Sandbox OAuth is integrated.
- eBay LOOP 149 Sandbox Draft Listing is not integrated.
- Amazon Track is paused.
- Amazon 149G is local only and must not be mixed into eBay resume work.
- The current seller account is personal.
- The planned future seller account type is business in about 15 days.
- Production and `main` remain frozen.

## Why We Paused Amazon And Retook eBay

The business priority changed because the seller account now exists. That means the system can focus on the practical eBay readiness path: Seller Hub, Developer account, OAuth readiness, policies, payments, logistics, and first listing preparation.

Amazon work remains useful, but it is paused to avoid mixing marketplace tracks.

## Developer Account vs Seller Account

The eBay Developer account is where the application is created. It controls app keys, redirect URI, OAuth scopes, and technical readiness.

The eBay Seller account is the account that owns Seller Hub, payments, payouts, listings, policies, item location, messages, limits, and seller risk.

Both are needed for API work, but they are not the same thing.

## Personal Seller Account Now, Business Later

Using a personal seller account temporarily can be acceptable for preparation and readiness checks, but it creates transition risk:

- Seller limits may change.
- Payments or payouts may need re-verification.
- Business identity and tax data may be required.
- OAuth consent may need to be reauthorized.
- Policies and item location may need review after conversion.

The system must rerun readiness after the business conversion.

## What Changes In 15 Days

When the account changes to business, the seller should prepare:

- LLC/legal business name.
- EIN/tax information if applicable.
- Beneficial owner information.
- Business address.
- Business bank/payout account.
- Confirmation that existing policies remain correct.
- Confirmation that item location remains correct.
- New OAuth consent if eBay requires it.

No sensitive or risky products should be published during the transition.

## What OAuth/API Can Help Review

A future read-only OAuth audit may help review:

- OAuth authorization status.
- Developer app readiness.
- Marketplace target.
- Business policies if access is permitted.
- Fulfillment/shipping policies if access is permitted.
- Return policies if access is permitted.
- Payment policies if access is permitted.
- Inventory locations if access is permitted.
- Technical readiness for a later sandbox draft.

## What Must Remain Manual In Seller Hub

Seller Hub must still be checked manually for:

- Internal alerts.
- Suspension or selling restrictions.
- Identity verification.
- Payments really approved.
- Payouts/bank really approved.
- Seller limits when not available by API.
- eBay messages.
- Personal to business conversion steps.
- Human approval before listing.

## Why This Loop Does Not Do Token Exchange

EBAY-RESUME-A2 is not the OAuth execution loop. It only prepares readiness. A real token exchange would introduce secrets and consent risk. That belongs later, after the human confirms app settings and approves a read-only audit.

## Why This Loop Does Not Store Tokens

Tokens are credentials. This loop must not store `access_token`, `refresh_token`, `client_secret`, auth codes, or any other secret. It must also not print tokens.

## Why This Loop Does Not Publish

This loop is about readiness only. It does not create drafts, listings, publications, or any production action. Publishing requires Seller Hub readiness, product readiness, image readiness, human approval, and a later explicit workflow.

## EBAY-RESUME-A2 vs EBAY-RESUME-A3

EBAY-RESUME-A2 checks whether the Developer Account and Seller Account link is ready.

EBAY-RESUME-A3 would be the later read-only OAuth data audit. A3 may inspect allowed account data after explicit human approval, but A2 does not call the API.

## Safety Boundaries

- No Production touch.
- No main touch.
- No Staging DB write.
- No Supabase write.
- No eBay API call.
- No eBay Production write.
- No real token exchange.
- No access token storage.
- No refresh token storage.
- No client secret storage.
- No draft creation.
- No listing creation.
- No publication.
- No Amazon Track mixing.
- No WhatsApp real send.
- No OpenAI/Codex API.
- No scraper.
- No `.env` changes.
- No secrets, tokens, dumps, backups, uploads, downloads, or migrations.

## Definition Of Done

- Fixture models a personal seller account and future business conversion.
- Pure module builds developer app readiness, seller authorization readiness, OAuth safety, API-readable map, manual Seller Hub map, business conversion checklist, risk assessment, and route recommendation.
- Unknown Developer/Seller link data recommends `NEED_MORE_DEVELOPER_SELLER_LINK_DATA`.
- Confirmed app + redirect URI + human approval can recommend `EBAY-RESUME-A3`.
- Account risk recommends `EBAY-RESUME-HOLD`.
- `canPublish` always remains false.
- Tests and dry-run pass.

## Human Explanation Rule

The output must be clear for someone learning eBay Developer, OAuth, Seller Hub, and seller accounts. It should explain what can be checked by API later, what must still be checked manually, and why no token or listing action is allowed in this loop.

## Next Step By Result

If Developer app and seller authorization are still unknown:

`NEED_MORE_DEVELOPER_SELLER_LINK_DATA`

If Developer app, redirect URI, seller authorization, and human approval are confirmed:

`EBAY-RESUME-A3 — Seller Account Read-Only OAuth Data Audit`

If Seller Hub and developer link are both ready later:

`EBAY-RESUME-B — Complete eBay LOOP 149 Sandbox Draft Listing`

If the user wants a manual listing path first:

`EBAY-RESUME-C — First Manual Human-Approved eBay Listing Package`

If there is suspension, verification, or account risk:

`EBAY-RESUME-HOLD — Resolve eBay Account Risk Before Any Listing`
