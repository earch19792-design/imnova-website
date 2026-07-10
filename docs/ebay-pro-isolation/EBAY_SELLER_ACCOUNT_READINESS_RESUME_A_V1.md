# eBay Seller Account Readiness Resume A V1

## Why

The user created an eBay seller account and wants to pause Amazon work to resume the eBay Professional Seller OS route. Before rebuilding eBay LOOP 149 or preparing a first manual listing, IMNOVA OS needs a local, read-only readiness check for Seller Hub and account setup.

This loop prevents moving too fast into drafts, listings, OAuth, or publication before the seller account is confirmed ready.

## Current State

- `main` remains frozen.
- Production remains frozen.
- PRE/Staging has eBay LOOP 148 Sandbox OAuth integrated.
- eBay LOOP 149 Sandbox Draft Listing is not integrated.
- Amazon Track is paused.
- Amazon 149G may exist locally, but it is not integrated and must not be mixed into eBay resume work.

## What This Loop Checks

EBAY-RESUME-A asks whether the seller account is ready for the next eBay step:

- Seller account active and without suspension.
- Seller Hub accessible.
- Payments configured.
- Payouts configured.
- Payment method configured.
- Bank or payout account configured if required.
- Address and item location confirmed.
- Target marketplace is USA / `EBAY_US`.
- Shipping policies exist.
- Return policies exist.
- Handling time is defined.
- Seller limits are known.
- Category permissions are known.
- Luna Portex can be item location / warehouse.
- Warehouse/logistics document exists if needed.
- First low-risk product candidate exists.
- Real main image is available.
- Human approval exists before moving forward.

## Why Unknown Means Hold

This loop does not assume that a newly created seller account is ready. Any critical unknown field produces `NEED_MORE_SELLER_HUB_DATA`.

That is intentional. A missing payment setup, seller limit, item location, or policy can block listing or create account risk.

## Route Recommendations

The readiness report can recommend:

- `EBAY-RESUME-B`: complete eBay LOOP 149 Sandbox Draft Listing from current PRE/Staging.
- `EBAY-RESUME-C`: prepare a first manual human-approved eBay listing package and Seller Hub checklist.
- `EBAY-RESUME-HOLD`: resolve account suspension, verification, payment, policy, logistics, or risk before any listing.
- `NEED_MORE_SELLER_HUB_DATA`: collect missing Seller Hub confirmations first.

## Account Risk Rules

If the account has suspension, verification requirement, blocked payment, blocked payout, or other seller account risk, the correct route is hold. No draft, listing, or publication should happen until the risk is resolved.

## Why No API Is Used

EBAY-RESUME-A is local/read-only. It does not call eBay, OAuth, Supabase, Amazon, WhatsApp, OpenAI, or any external service. It only converts sanitized checklist state into a seller readiness report.

## What This Does Not Do

- No eBay API.
- No eBay Production API.
- No OAuth.
- No draft creation.
- No listing creation.
- No publication.
- No Staging DB write.
- No Production touch.
- No main touch.
- No Amazon Track mixing.
- No WhatsApp real send.
- No OpenAI/Codex API.
- No scraper.
- No secrets or tokens.

## Manual Seller Hub Checklist

The user must confirm manually:

- Cuenta eBay vendedor activa y sin suspensión.
- Seller Hub accesible.
- Payments configurado.
- Payouts configurado.
- Método de pago configurado.
- Banco/payout account configurado si aplica.
- Dirección / item location.
- Mercado objetivo: USA.
- Shipping policy.
- Return policy.
- Handling time.
- Seller limits.
- Categorías permitidas.
- Luna Portex item location / warehouse.
- Documento de almacén/logística si aplica.
- Primer producto candidato de bajo riesgo.
- Imagen principal real disponible.
- Aprobación humana antes de avanzar.

## Definition Of Done

- Fixture local models the new seller account with unknown fields.
- Pure module builds core, Seller Hub, payments, policy, logistics, listing prerequisite, and risk assessments.
- Readiness report returns score, blockers, warnings, checklist, and route recommendation.
- Unknown critical fields recommend `NEED_MORE_SELLER_HUB_DATA`.
- Account risk recommends `EBAY-RESUME-HOLD`.
- Ready account can recommend `EBAY-RESUME-B` or `EBAY-RESUME-C`, but `canPublish` remains false.
- Tests and dry-run pass.

## Human Explanation Rule

The output must be understandable to a seller. It should say what is ready, what is unknown, what blocks the next step, and what the seller must confirm in Seller Hub before touching any listing workflow.

## Next Step

If the user confirms Seller Hub readiness, continue with:

`EBAY-RESUME-B — Complete eBay LOOP 149 Sandbox Draft Listing from current PRE/Staging`

If the user wants a manual path before API/draft work, use:

`EBAY-RESUME-C — First Manual Human-Approved eBay Listing Package + Seller Hub Checklist`

If there is account risk:

`EBAY-RESUME-HOLD — Resolve eBay Account Risk Before Any Listing`
