# EBAY-RESUME-B2A — eBay Winning Listing Data Resolver + Missing Data Enrichment

## Why

B2 builds a safe technical payload mold, but a technically valid payload is not yet a professionally optimized listing. B2A exists to enrich that mold with market intelligence before any controlled draft execution is considered.

This local B2A loop creates the resolver model and proves both strategies with sanitized fixtures. It does not claim that real eBay winning data or a real Luna Portex match has been resolved.

## Current state

- B2 is integrated in PRE/Staging and recommends B2A.
- The source candidate is Compact Silicone Cable Organizer Clips 20 Pack, risk LOW.
- B2 has inert inventory-item and offer previews with creation and publication disabled.
- B2A uses only sanitized local fixture evidence in this loop: no eBay API, OAuth, network search, or scraper.
- ShopEliteCart and the safe `LUNA_PORTEX_BOCA_RATON` alias remain in scope without street-level warehouse data.

## Official route after B2

1. EBAY-RESUME-B2A — winning-listing data resolver and missing-data enrichment.
2. EBAY-RESUME-B2A-RUN — controlled eBay read-only winning-listing resolver execution.
3. EBAY-RESUME-B2-RUN — controlled draft or unpublished-offer execution.
4. LOOP 150 — first human-approved real listing.
5. LOOP 151 — Seller OS dashboard.
6. LOOP 152 — active listing monitor, Luna scan, stock guard, and alerts.
7. Safe self-improvement only after selling and operating.

## Why B2A comes before B2-RUN

B2 proves the technical shape. B2A asks whether the product, language, category, specifics, price, demand, supplier match, and risk are commercially defensible. Execution must wait until both technical and market gates are satisfied.

B2A-RUN is the next gate. It will consult real eBay market evidence in controlled read-only mode and confirm the Luna match without creating or publishing anything. B2-RUN must not execute until B2A-RUN confirms the market data, category, specifics, price range, supplier match, and required human approval. This is not a route deviation; it is the correct closure of the market-first and Luna-first strategies.

## Luna-first strategy

Luna-first begins with a Luna Portex candidate. It compares that product with sanitized winning/comparable eBay patterns, extracts reusable keyword and pricing signals, confirms category and specifics patterns, evaluates risk, and produces an original enriched listing package.

## eBay-first or market-first strategy

Market-first begins with strong demand patterns observed on eBay, then searches conceptually for an equivalent Luna Portex product. A viable match needs acceptable risk, positive estimated margin, manageable logistics, and sufficient product facts. A winner without a supplier match routes to `NEED_LUNA_MATCH`.

## Why market-first is professional

Professional sellers validate demand before committing inventory. Market-first helps avoid selecting products only because a supplier offers them. It balances buyer demand, competition, price range, risk, logistics, and supplier availability.

## Replicating winning logic without plagiarism

“Replicate” means learn the decision structure, not copy content. The resolver learns which facts buyers search for, how information is ordered, which specifics matter, and where price and shipping expectations cluster. The resulting title and package are original and tied to the actual Luna product.

## What can be learned

- Winning keyword patterns.
- Title structure, such as material + product type + pack count + feature + use case.
- Likely category and final category evidence.
- Required or useful item specifics.
- Viable price range and median signals.
- Shipping and handling patterns.
- Return-policy patterns.
- Demand signals such as sanitized sold strength.

## What cannot be copied

- Exact competitor title.
- Exact description or distinctive prose.
- Competitor images or generated substitutes presented as the real product.
- A competitor brand that does not belong to the sourced product.
- Unsupported performance, medical, authenticity, regulatory, or guarantee claims.

## Matching against Luna Portex

The match compares product type, pack count, material, features, logistics, estimated margin, and risk. `MATCHED_TO_LUNA` requires a plausible equivalent and positive margin. Restricted brands, VERO/IP exposure, aerosols, hazardous goods, batteries, supplements, perfumes, medical claims, and complex electronics are unsuitable for a first listing.

## Feeding B2-RUN

The enrichment package supplies original title, winning keyword set, category suggestion, item specifics, price range, shipping and return guidance, copy-safety flags, and remaining runtime dependencies. B2-RUN must still resolve approved policy IDs, merchant location, final category, packaging measurements, authorized image, and explicit human approval.

## Route decisions

Use `NEED_MARKET_DATA` when no reliable comparable pattern exists. Use `NEED_LUNA_MATCH` when demand exists but Luna has no viable equivalent. Use `NEED_HUMAN_APPROVAL` when enrichment is complete but approval remains the deciding gate. Move to `EBAY-RESUME-HOLD` when account or product risk appears. Recommend B2-RUN only when a LOW-risk Luna match, positive margin, winning patterns, and a complete enrichment package exist.

## Why publication is always disabled

B2A is research and enrichment, not marketplace execution. A good market match does not authorize account access, draft creation, offer creation, listing creation, or publication. `canPublish` remains false and Ernesto retains final approval.

## Safety boundaries

- Production, main, Staging database, and Supabase writes are prohibited.
- No real eBay API, search API, OAuth, credential exchange, draft, listing, offer, or publication is allowed.
- No scraper, image generation, download, external AI API, or real messaging is allowed.
- No exact competitor content, secret, token, environment file, dump, backup, real image, or full warehouse street address belongs in this loop.
- Amazon work and older eBay draft experiments remain separate.

## Definition of Done

- Luna-first and eBay-first strategies are both evaluated.
- At least three sanitized comparable patterns are analyzed.
- Keywords, title structure, category, specifics, price, shipping, returns, demand, Luna match, margin, and risk are represented.
- The recommended title is original and all copy-safety flags remain false.
- High-risk and unmatched products are rejected or watchlisted.
- Enrichment can recommend B2-RUN without enabling a write or publication.
- TypeScript, tests, dry-run, regressions, guardrails, and security scans pass.

## Human explanation rule

Every handoff must explain which strategy won, what market patterns were learned, why the output is original, how Luna match and risk were evaluated, what remains for human approval, and why no eBay action occurred.

## Next step according to result

Because this loop uses `LOCAL_FIXTURE_ONLY_IN_THIS_LOOP`, the immediate next route is **EBAY-RESUME-B2A-RUN — Controlled eBay Read-Only Winning Listing Resolver Execution**. Only after B2A-RUN confirms real eBay winning data, the real Luna match, category, specifics, price range, and approval may the route advance to **EBAY-RESUME-B2-RUN — Controlled Draft / Unpublished Offer Execution**. Missing market data, supplier match, approval, or safe account state routes to the corresponding blocked path.
