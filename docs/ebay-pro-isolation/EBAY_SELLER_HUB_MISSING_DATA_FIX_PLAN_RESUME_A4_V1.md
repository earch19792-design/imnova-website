# EBAY-RESUME-A4 - Seller Hub Missing Data Fix Plan

## Why

The read-only OAuth audit succeeded, but it showed that the seller account is not ready for draft or listing work. IMNOVA OS needs to convert the audit result into a practical Seller Hub fix plan that a human can follow.

This loop does not call eBay, OAuth, Amazon, Supabase, or any external service. It is local and read-only.

## Current State

- EBAY-RESUME-A is integrated.
- EBAY-RESUME-A2 is integrated.
- EBAY-RESUME-A3 is integrated.
- EBAY-RESUME-A3-RUN executed successfully in Production read-only mode.
- Amazon 149G remains paused.
- Old eBay LOOP 149 remains excluded.
- The seller account is currently personal.
- Business conversion is planned in about 15 days.

## Real A3 Sanitized Result

- OAuth read-only authorization succeeded.
- Token exchange succeeded.
- eBay read-only API was used.
- eBay write API was not used.
- No token was stored.
- No token was printed.
- No draft, listing, or publication was created.
- Business policies were not readable.
- Fulfillment policies count: 0.
- Return policies count: 0.
- Payment policies count: 0.
- Inventory locations count: 0.

## What OAuth Read-Only Succeeded Means

The Developer app can complete authorization and make read-only calls under the approved runner. It does not mean the account is ready to list. It only means we can safely inspect some allowed seller data.

## What `businessPoliciesReadable: false` Means

The account does not currently show readable business policy data through the audit. That can mean policies are missing in Seller Hub, the scope/configuration needs review, or both.

## What `unavailable_or_scope_missing 400` Means

The fulfillment, return, and payment policy endpoints returned a 400-style unavailable/scope result. A4 treats that as two required actions:

1. Check eBay Developer scopes and app configuration.
2. Manually confirm inside Seller Hub whether each policy exists.

## Missing Items

The current account needs manual correction or confirmation for:

- Fulfillment/shipping policy.
- Return policy.
- Payment policy.
- Inventory or item location.
- Seller Hub account alerts.
- Identity verification status.
- Payments and payouts final approval.
- Seller limits.
- eBay messages.
- Personal-to-business conversion status.
- Manual Seller Hub checklist confirmation.

## Seller Hub Setup Recommendation

For a new seller account, use a conservative setup:

- USA domestic shipping only.
- Handling time: 2 business days.
- Tracked shipping service.
- Return policy: 30 days.
- Buyer pays return shipping at the start unless a commercial strategy says otherwise.
- Confirm payment policy and managed payments readiness.
- Confirm payouts and bank account.
- Confirm item location and logistics.
- Use Buy It Now.
- Start with 1 unit quantity.
- List 1-3 items per day maximum at the beginning.
- Use low-risk categories first.

Avoid early listings for:

- Supplements.
- Medical claim products.
- Batteries.
- Aerosols.
- Perfumes.
- Restricted brands.
- Complex electronics.
- VERO/IP risk products.

## Why Not Advance To Listing Yet

The account is missing or has not confirmed core listing prerequisites. No draft, listing, or publication should happen until policies, item location, payments/payouts, limits, alerts, and account risk are confirmed.

## When To Re-Run A3-RUN

Re-run the read-only OAuth audit after creating or confirming:

- Fulfillment/shipping policy.
- Return policy.
- Payment policy.
- Inventory/item location.
- Required eBay Developer scopes.

## When To Advance To EBAY-RESUME-B

Advance to EBAY-RESUME-B only when Seller Hub policies and item location are confirmed, no account risk exists, and the team wants to resume sandbox draft work.

## When To Advance To EBAY-RESUME-C

Advance to EBAY-RESUME-C if the first listing should be prepared manually in Seller Hub with human approval before returning to API-assisted workflows.

## When To Use EBAY-RESUME-HOLD

Use HOLD if Seller Hub shows suspension, verification block, payment block, selling restriction, or any account condition that makes listing unsafe.

## Safety Boundaries

- No Production write.
- No `main` write.
- No Staging DB write.
- No Supabase write.
- No eBay API in this loop.
- No OAuth in this loop.
- No token storage.
- No token printing.
- No draft creation.
- No listing creation.
- No publication.
- No Amazon 149G mixing.
- No old eBay LOOP 149 mixing.
- No WhatsApp real send.
- No OpenAI/Codex API.
- No scraper.
- No `.env` changes.

## Definition Of Done

- Fixture captures the sanitized A3 result.
- Pure module builds a Seller Hub fix plan.
- Dry-run prints the required counts and route recommendation.
- Tests validate missing policies, endpoint gaps, manual checks, route recommendation, and safety guardrails.
- TypeScript passes.
- Git status is clean.

## Human Explanation Rule

Every report must be understandable to a person learning Seller Hub. It must explain what is missing, why it matters, where to check it, and why listing is still blocked.

## Next Step

The current route is `NEED_SELLER_HUB_FIXES`. After the user fixes policies and manual checks, run `EBAY-RESUME-A3-RUN` again. Then choose `EBAY-RESUME-B`, `EBAY-RESUME-C`, or `EBAY-RESUME-HOLD` based on the new result.
