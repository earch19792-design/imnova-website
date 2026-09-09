# eBay Ads revenue activation: guarded Preview

The first real Ads action is **not authorized**. Both single-listing writes and bulk writes remain disabled. The new Mayel control under **Impulsar ventas → Revisar publicidad guardada** reads each selected listing's durable policy and economic evidence, including during Trading quota exhaustion. It does not load the commercial monitor or call eBay while current-LIVE authority is unavailable. Existing Quality, Keyword, images, Shipping, local outbox and synchronization workflows are preserved.

## Economic and policy contract

`SELLER_OS_EBAY_FEE_AUTHORITY_V1` remains the only fee authority. A fresh matching authority head is required; a legacy numeric fee row, historical order or pending newer head cannot supply a current estimate. Base pre-sale policy, contingent components and actual post-sale reconciliation remain separate. The existing fee producer and order reconciliation continue to run in the normal runtime.

Conservative bounds remain accepted. An unbounded buyer-tax/total-sale basis, international or conversion exposure, category surcharge or fee tax leaves economics unproven. A conservative base-fee amount alone does not prove incremental tax/conversion on Ads; the current canary additionally requires explicit non-applicability for those incremental components. No unknown becomes zero. The existing conditional OWNER variable-cost policy is reused.

Each listing independently applies `min(recommendedRate, OWNER_MAX_RATE, MAX_SAFE_AD_RATE_PCT)`, then rounds **down** to eBay's one-decimal representation. It rechecks the rounded monetary charge against minimum profit and margin. Rates below OWNER minimum or eBay's API minimum cannot proceed. A 3–5% OWNER configuration is not a universal ceiling. In cold start, Mayel's technical TEST proposal is the smallest representable OWNER rate unless an official recommendation is available; TEST does not imply SCALE or forecast revenue.

The latest persisted OWNER draft is loaded per listing and actor. Invalid schedules are reported without losing the economic diagnosis. AUTO mode is a policy draft, not approval of the first canary.

## Official contract and runtime gates

The companion `ebay-ads-revenue-official-contract-v1.json` records fresh official source versions, hashes, endpoints, scopes, success statuses and error IDs. Marketing v1.23.2 defines CPS `FIXED`, string `bidPercentage`, create (201), update (204), delete (204), and readback. The new official Account v1.9.3 spec resolves `PROMOTED_LISTINGS_STANDARD` to the current **general campaign strategy**; the name is taken from the current schema, not memory.

Sources:

- [Marketing official OpenAPI](https://www.developer.ebay.com/api-docs/master/sell/marketing/openapi/3/sell_marketing_v1_oas3.json)
- [Current Account official OpenAPI](https://www.developer.ebay.com/develop/api/spec/account_api_v1.json)
- [Developer Analytics official OpenAPI](https://www.developer.ebay.com/api-docs/master/developer/analytics/openapi/3/developer_analytics_v1_beta_oas3.json)
- [Eligibility rules](https://developer.ebay.com/api-docs/sell/static/marketing/pl-verify-eligibility.html)
- [Marketing requirements](https://developer.ebay.com/api-docs/sell/marketing/static/overview.html)
- [Default call limits](https://developer.ebay.com/develop/get-started/api-call-limits)
- [Official fee policy and jurisdiction-dependent taxes](https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822)

Documentation certification does **not** assert that this seller or a listing is eligible. Only after current economics and policy pass, the bounded read-only adapter verifies canonical account identity, actual eligibility, application/user quota, an existing running fixed CPS campaign, and exact ad/listing state. An exact existing ad or official suggestion supplies positive listing evidence; absence from suggestions remains unknown. Complete campaign/ad pagination is required to prove absence. Terms evidence is explicitly an inference from the eligible account and an existing running CPS campaign. No terms are accepted automatically. Only fixed-price listings are within this canary's supported scope.

A Preview contains price, cost, shipping, fees, profit/margin, policy, safe/proposed rate and projected ad cost/profit/margin, bound to a digest. It always requires explicit OWNER approval. This release exposes no Ads write action. Execution, durable Ads receipt and physical readback remain pending the first authorized canary; no physical PASS is claimed. Unknown dispatch results require readback before any future retry. The removal path is `deleteAd` for the exact campaign/ad followed by complete filtered `getAds` absence verification; it has not been executed.

## Preprod evidence and remaining work

The preprod durable input RPC evaluated all 23 last-certified listings in two bounded pages. At the observed quota hold, none had complete fresh economics, so no listing or rate was selected. Only item 366650054490 had a Fee Authority head; its base pre-sale policy was proven, but the complete amount remained unbounded. The latest OWNER policy available during verification was 3–5%, $8 minimum profit, 15% minimum margin, NOW, AUTO. It authorizes no expenditure by itself.

Post-sale fee estimate versus actual reconciliation is already automatic and is surfaced in this Ads diagnostic. Actual ad spend, attributed sales and realized profit after Ads remain unknown until official Ads report evidence is ingested; they are not inferred from listing metrics or used for causal claims.

After quota recovery, existing runtime sources must refresh current identity, price, cost, shipping and bound fee evidence. Mayel can then perform its official read-only Ads preflight and present a concrete Preview. OWNER authorization, the single physical Ads action and its official readback are still required before any bulk capability can be enabled. No production deployment or marketplace write is part of this change.

Validation receipt: `.seller-os/validation-evidence-v1.json`. Physical preprod results are recorded separately from synthetic arithmetic/guard tests.
