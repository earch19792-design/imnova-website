# Product Selection Strategy V1

Date: 2026-06-28

## Purpose

Product Selection Strategy V1 defines how IMNOVA decides whether an eBay product candidate can move toward a draft, needs review, should be rejected, or must be blocked.

The strategy exists to avoid listing products with weak margin, doubtful stock, brand risk, operational risk, incomplete data, or unsafe eBay compliance signals.

This strategy is advisory-only until a human approves the next step. It does not create real eBay drafts, publish listings, synchronize suppliers, or modify existing listings.

## Principles

- Protect the eBay seller account before trying to scale.
- Do not list products without confirmed stock.
- Do not list products without enough net margin.
- Do not list products with high VeRO, IP, brand, or policy risk.
- Do not create drafts without minimum operational data.
- Do not publish automatically.
- Treat Price Intelligence as evidence, not automatic approval.
- Keep every recommendation explainable to a human seller.

## Selection Matrix

### Identification

| Field | Purpose |
|---|---|
| Product name | Human-readable product identity. |
| Supplier | Source of the product and operating model. |
| Supplier SKU | Supplier-side variant/product reference. |
| Internal SKU | IMNOVA-side tracking reference when available. |
| Category | Product/category context for eBay fees, policy, and competition. |
| Niche | Business positioning and demand context. |

### Economics

| Field | Purpose |
|---|---|
| Supplier cost | Base acquisition cost. |
| Supplier shipping | Cost or assumption needed to acquire/ship the product. |
| Estimated eBay price | Proposed sale price or Price Intelligence recommendation. |
| eBay fees | Estimated final value fee and fixed order fee. |
| Buyer shipping | Shipping charged to buyer, if any. |
| Net margin | Net profit divided by total buyer revenue. |
| ROI | Net profit divided by supplier cost. |
| Net profit | Estimated dollars remaining after costs, fees, shipping, and reserves. |

### Operation

| Field | Purpose |
|---|---|
| Available stock | Confirms whether the product can safely be sold. |
| Stock change frequency | Detects volatile inventory and oversell risk. |
| Shipping time | Identifies slow fulfillment risk. |
| Weight | Required for shipping cost confidence. |
| Dimensions | Required for shipping cost confidence and carrier constraints. |
| Fragility | Flags breakage, packaging, and return risk. |
| Return risk | Estimates operational exposure after sale. |

### eBay Risk

| Field | Purpose |
|---|---|
| Restricted brand | Blocks or reviews brands with account or VeRO risk. |
| VeRO/IP | Flags intellectual property, trademark, or rights-owner risk. |
| Risky category | Identifies restricted or policy-sensitive categories. |
| Medical/health claims | Blocks or reviews strong cure, treatment, diagnostic, or health claims. |
| Compatibility/fitment | Requires accuracy for parts, accessories, model fit, and variations. |
| Authorized images | Confirms images can be used safely in listings. |

### Competition

| Field | Purpose |
|---|---|
| Competitors | Number of relevant comparable sellers/listings. |
| Sold comps | Evidence of actual demand and realized market price. |
| Sold median price | Preferred market anchor when comparable quality is strong. |
| Active/sold range | Detects pricing spread and outliers. |
| Competitor listing quality | Compares title, images, specifics, trust, and offer quality. |
| Saturation | Flags crowded markets where price/margin may compress. |
| Comparable confidence | Indicates whether evidence is exact, same model, similar, category-only, or unknown. |

## V1 Thresholds

Initial business thresholds:

- Profit mínimo / minimum profit: `$5`
- Profit ideal / ideal profit: `$7+`
- ROI mínimo / minimum ROI: `30%`
- Margen neto mínimo recomendado / recommended minimum net margin: `20%`
- No stock: `blocked`
- Unknown stock: `review`
- Missing weight or dimensions: `review`
- High brand or VeRO risk: `blocked`
- Strong medical claims: `blocked` or `risk_review`
- Incomplete data: `review`
- Profitable price more than 10% above market: `review` or `blocked`, depending on severity.

Current technical defaults already include values such as `idealProfitUsd: 7`, default eBay fee `13.25% + $0.30`, and default shipping cost `6.99`.

This V1 strategy intentionally raises the recommended business standard for net margin to 20%, even if current technical configuration uses a lower minimum in some paths. Implementation should make that difference explicit rather than silently changing behavior.

## Proposed States

| State | Meaning |
|---|---|
| `NEW_CANDIDATE` | Product was detected and has not been evaluated fully. |
| `DATA_INCOMPLETE` | Required data is missing but could be completed. |
| `MARGIN_REVIEW` | Economics are weak, unclear, or sensitive to price/shipping changes. |
| `RISK_REVIEW` | Brand, compliance, shipping, returns, or operational risk needs human review. |
| `APPROVED_FOR_DRAFT` | Candidate has enough margin, data, stock, and low risk for a human-approved draft step. |
| `BLOCKED` | Candidate cannot move forward due to hard risk or missing critical requirement. |
| `REJECTED` | Candidate is intentionally rejected by business judgment or repeated weak economics. |

## Possible Decisions

| Decision | Meaning |
|---|---|
| `approve` | Candidate can proceed toward a controlled draft workflow after human confirmation. |
| `review` | Candidate may be viable, but needs more data or human judgment. |
| `reject` | Candidate is not attractive enough for current strategy, usually because of economics or weak demand. |
| `blocked` | Candidate must not proceed because of hard stock, policy, brand, or operational risk. |

## Decision Rules

- No stock -> `blocked`
- Unknown stock -> `DATA_INCOMPLETE` or `review`
- High VeRO, IP, or restricted-brand risk -> `blocked`
- Strong medical, cure, treatment, or diagnostic claims -> `blocked` or `RISK_REVIEW`
- Low net margin -> `reject` or `MARGIN_REVIEW`
- Low ROI -> `review` or `reject`
- Missing weight or dimensions -> `DATA_INCOMPLETE`
- Missing authorized images -> `DATA_INCOMPLETE`
- Supplier price increased -> `MARGIN_REVIEW`
- Profitable target price is materially above sold-comparable market -> `MARGIN_REVIEW` or `blocked`
- Reliable sold comps, good margin, complete data, confirmed stock, and low risk -> `APPROVED_FOR_DRAFT`

## Expected Advisor Output

The Advisor should explain every decision in seller-readable language and include:

- decision
- main reason
- risks
- key numbers
- next human action

Example:

```text
Decision: REVIEW
Main reason: Net margin qualifies, but dimensions are missing.
Key numbers: Net profit $6.80, ROI 32%, estimated eBay fee 13.25% + $0.30.
Risk: Shipping cost may be inaccurate without dimensions.
Next human action: Confirm weight and dimensions before creating a draft.
```

## Out Of Scope For V1

- No real eBay API.
- No OAuth.
- No real drafts.
- No publishing.
- No real listing changes.
- No automatic approval.
- No real supplier synchronization.
- No automatic decisions without a human.
- No production database migration as part of this strategy document.

## Next Steps

Recommended next loop:

```text
LOOP 038 — eBay Product Selection Decision Service V1
```

Recommended scope:

- Implement a mockable evaluation/scoring service based on this document.
- Keep the service read-only and advisory-only.
- Add focused tests for thresholds, blockers, review decisions, and Advisor output.
- Do not connect to the real eBay API.
- Do not create UI yet.
