# EBAY-RESUME-B2 / LOOP 149R — Gated eBay Draft / Unpublished Offer Builder

## Why

C-AUTO selected a LOW-risk first product and produced a complete listing package for human review. B2 translates that business package into sanitized technical previews for an eBay inventory item and unpublished offer, while keeping all marketplace execution disabled.

## Current state

- C-AUTO is integrated in PRE/Staging.
- Recommended candidate: Compact Silicone Cable Organizer Clips 20 Pack.
- Buy It Now price: USD 18.99; estimated profit: USD 5.44; estimated margin: 28.65%.
- Candidate risk is LOW and initial quantity is one.
- Seller Hub unlock modeling exists, but final policy identifiers and merchant location key are not stored in this local package.
- ShopEliteCart and the safe `LUNA_PORTEX_BOCA_RATON` alias remain the only business references needed here.

## Official route after C-AUTO

1. EBAY-RESUME-B2 / LOOP 149R — gated draft and unpublished-offer builder.
2. EBAY-RESUME-B2-RUN — future controlled draft or unpublished-offer execution.
3. LOOP 150 — first human-approved real listing.
4. LOOP 151 — Seller OS dashboard.
5. LOOP 152 — active listing monitor, Luna scan, stock guard, and alerts.
6. Safe self-improvement only after selling and operating.

## What the builder means

The builder maps reviewed C-AUTO data into two inert structures: an inventory-item payload preview and an offer payload preview. These structures show what a later gated runtime would need, but they have no transport, credentials, endpoint, or execution capability.

## Payload preview versus real write

A payload preview is local structured data with `previewOnly: true`, `executionAllowed: false`, and `publish: false`. A real write would require authenticated communication with eBay and would change marketplace state. B2 performs only the first activity and expressly forbids the second.

## How C-AUTO feeds B2

C-AUTO supplies SKU/candidate identity, LOW risk assessment, original title, price and currency, description, quantity, condition, fixed-price format, suggested category, item specifics, image requirements, estimated margin, and human approval checklist. B2 preserves those facts and makes unresolved runtime dependencies visible rather than inventing them.

## Fields required for inventory item and offer

The inventory-item preview models SKU, marketplace, NEW condition, quantity, title, description, aspects, image placeholder, and package measurements. The offer preview models SKU, marketplace, fixed-price format, quantity, category, merchant location, fulfillment policy, payment policy, return policy, and USD price.

## Data still required for real execution

- Final fulfillment, payment, and return policy IDs from the approved Seller Hub runtime.
- Merchant location key associated with the safely configured warehouse alias.
- Ernesto-approved real or supplier-authorized main image.
- Final eBay category ID.
- Package dimensions and weight when required.
- Explicit human approval for controlled execution.

These values appear in `missingForRealDraftExecution`. Missing runtime policy identifiers do not invalidate the local builder, but they must never be ignored by a future runner.

## Images and item specifics

The preview records `image_required_or_pending`; it does not copy competitor images or generate a synthetic product image. The authorized image source must be reviewed before execution. Critical item specifics from C-AUTO are present; any missing critical specific would block controlled execution.

## Why no draft or offer is created

B2 exists to inspect mapping, readiness, risks, and dependencies before adding authenticated execution. It contains no marketplace client, OAuth flow, token handling, network request, or write endpoint. Even when `canProceedToControlledDraftExecution` is true, creation remains false in this loop.

## Why publication remains disabled

Draft readiness and publication approval are different gates. Publication exposes a real product to buyers and belongs only after a controlled draft has been inspected and Ernesto explicitly approves LOOP 150. Therefore `canPublish` is always false.

## What B2-RUN will be

B2-RUN is the future controlled execution gate. It must resolve approved runtime dependencies, revalidate account risk, show the exact proposed action, require explicit human authorization, protect credentials, and default to blocked. B2 does not implement or execute that runtime.

## Route decisions

Advance to `EBAY-RESUME-B2-RUN` when C-AUTO is ready, risk is LOW, core content and specifics are complete, an authorized image is available for approval, payload previews are complete, account risk is clear, and runtime dependencies are explicitly marked.

Return to `EBAY-RESUME-A3-RUN` when read-only account facts need renewed verification. Return to `EBAY-RESUME-A4` when Seller Hub unlock or policy setup assumptions are incomplete. Use `NEED_DRAFT_EXECUTION_DATA` when product, image, category, specifics, or payload evidence is insufficient. Move to `EBAY-RESUME-HOLD` whenever account risk appears.

## Safety boundaries

- Production, main, Staging database, and Supabase writes are prohibited.
- No real eBay API, OAuth, credential exchange, draft, listing, offer, or publication is allowed.
- No image generation, external scraping, download, external AI API, or real messaging is allowed.
- No secret, token, environment file, dump, backup, real image, or street-level warehouse data belongs in version control.
- Paused marketplace tracks and older local draft work remain separate.

## Definition of Done

- Inventory-item and offer payload previews are built from the C-AUTO candidate.
- Policy, location, image, category, specifics, and packaging dependencies are visible.
- Readiness score, blockers, warnings, missing runtime data, checklist, and route are deterministic.
- Controlled-execution readiness never changes `canCreateDraftNow`, `canCreateOfferNow`, or `canPublish` from false.
- TypeScript, tests, dry-run, regressions, static guardrails, and security scans pass.

## Human explanation rule

Every handoff must explain the difference between a local payload preview and an eBay write, which runtime values remain unresolved, what Ernesto must approve, and why no draft, offer, or publication happened.

## Next step according to result

The expected result is **EBAY-RESUME-B2-RUN — Controlled Draft / Unpublished Offer Execution**, still behind a strict default-blocked gate. Missing critical data routes to `NEED_DRAFT_EXECUTION_DATA` or A4; account risk routes to HOLD. LOOP 150 remains after controlled draft inspection and explicit human approval.
