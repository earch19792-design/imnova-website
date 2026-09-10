# Single-candidate resume after quota recovery

Baseline: `fb9c2ab336d9c7d18973c6fc71778b6db60248be`. Scope is dedicated preprod, one candidate, no marketplace writes, no publications and no Ads writes.

On 2026-09-10 the existing official Trading quota reader returned AVAILABLE / OPEN, matching the configured application, with 3,960 requests remaining in the observed 5,000-request window (trace `218101ef-2d15-4e68-9a9e-5f855697b5b7`). The scoped fee-context reader subsequently verified seller/account identity and item `366650054490`, with successful current official account/performance reads (trace `6da00b26-1ddb-4a96-ace6-2ee96016e7ed`). This verifies Trading recovery and seller authentication, not Marketing eligibility or Marketing quota.

The candidate has the sole prior Fee Authority head and the most recent saved shipping among the 23 listings inspected in durable storage. No portfolio refresh was initiated. Its current price is USD 18.74, product cost USD 1.79, and exact supplier linkage is preserved. The already fresh price and supplier-cost producers were not rerun. The normal fee producer consumed the current official context and existing package binding without monetary overrides, then its durable authority was read back.

The current base category policy is proven. Total fees remain `PROMOTION_BLOCKED_EVIDENCE`, with future-order components in `PENDING_ORDER_CONTEXT`: buyer tax/total basis, international applicability and currency conversion. Exact-category service authority and account fee-tax authority also remain unproven. The current service response covers category 26395, not the candidate's 50692. Historical zero insertion-fee entries and NoVATTax do not prove a complete future selling-fee or advertising-fee tax bound. No unknown component is treated as zero.

The shared other-variable-cost policy is already configured for this candidate; its dependency gate requires proven cost, shipping and fees. That is the common cause of `OTHER_COST_POLICY_DEPENDENCIES_PENDING`, not a missing listing-specific manual cost entry. The product cost had already been refreshed automatically. The official rate caps alone do not supply the missing monetary exposure bound.

Shipping is stale. The normal server capture returned `LUNA_PROTECTED_BROWSER_UNAVAILABLE`, with an upstream HTTP 429 on Luna cart-add and no Retry-After. The existing exact-live Chrome capture UI was opened separately without navigating Mayel or enabling portfolio claims; its normal capture control remained disabled with `LUNA_SHIPPING_EXTENSION_PRESENCE_UNPROVEN`. No browser capture, purchase, manual amount or stale-quote TTL extension was forced.

The physical Mayel read also exposed two consumer defects addressed by this change:

- A current GetMyEbaySelling row and an older exact GetItem row were treated as ambiguous listings, discarding the current price/title. Accept only that ordered pair with matching item, nonempty SKU and currency; conflicting identities, duplicate current rows and ties remain blocked. Current stock and freshness gates remain mandatory.
- An obsolete numeric-evidence category error persisted after a fresh exact Fee Authority proved its base policy. Suppress only that superseded diagnosis; preserve the missing total-basis and account/order dependencies. A stale, mismatching or changed-price base authority cannot suppress the error.

Regression coverage includes current/historical ordering, stale/current-stock guards, conflicting identities and category diagnostics with unresolved or stale authority. The safety gates still prevent eligibility calls and Ads previews until economics are demonstrable. A 3%, 4% or 5% simulation cannot supply profit, margin or actual ad cost without a proven fee basis; those fields remain null and no rate is certified safe.

Resume remains: recover scoped shipping and fee evidence through normal producers; recompute economics; only then read official Ads eligibility for the same candidate; prepare a safe Preview if possible; stop for a later explicit OWNER authorization. Approval is not requested for a Preview that is still blocked.
