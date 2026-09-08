# Luna → Product Truth field parity

Scope: supplier evidence only. Query Intelligence, reformulation, browser,
comparable semantics, marketplace packages and downstream stage transitions are
unchanged. Golden identifiers are used only for physical verification.

## Root cause

The first general loss was `NORMALIZED_SOURCE_EVIDENCE → FIELD_LEVEL_PRODUCT_TRUTH`:
the catalog retained description, price, inventory context, weight and images,
but intake materialized identity and a small required-specifics subset. Optional
structured product attributes were also discarded during source capture.
The audit projection then accepted package/assessment fallbacks, used generated
package images as product evidence, read incorrect stock properties, and called
any nonempty truth object `PROVEN`.

## Contract and authority

`LUNA_FIELD_PRODUCT_TRUTH_V1` reuses
`SELLER_OS_LUNA_EXACT_PRODUCT_TRUTH_V1` / `SUPPLIER` authority. Exact product,
variant and supplier SKU binding is required. The existing catalog capture now
preserves explicitly exposed product attributes and description in its snapshots.
No vendor-to-brand mapping, reference inheritance, human visual assessments,
supplier marketing promotion, or image interpretation is performed.

The existing `assessment.productTruth.fieldTruthV1` is the one current
materialization. Each field has value, semantic/evidence status, source locator,
source authority, capture/observation/freshness times, confidence, evidence ID,
reasoning and contradiction details. Supporting observations retain raw values.
Set members retain normalized values, units, order and supporting evidence IDs.
Supplier claims are unverified; missing values are null, never false or zero.
Stock quantity requires an explicit numeric variant inventory observation.

Product Case projects that materialization without inventing fallback facts.
It reports `PARTIAL` whenever not all fields are proven/current and exposes
unsupported downstream Brand/Model/MPN separately, without changing Package.
Historical source status is preserved; `FRESHNESS` and
`DOWNSTREAM_CONSUMABLE` express whether a temporal observation is usable now.

## Recovery and safeguards

- Detection: an exact Luna source exists and its derived field receipt differs
  from the current materialization, including missing legacy field receipts.
- Recovery: existing queue/source writes rematerialize through database triggers;
  deployment runs the same bounded cohort recovery function. No SKU dispatch.
- Retry: `recover_luna_product_truth_parity_v1(limit)` accepts 1–1000 writes,
  returns affected/recovered/remaining counts and skips locked candidates.
- Idempotency: evidence digest deduplication; one current receipt; append-only
  prior versions; legacy truth receipt preserved. An older source cannot replace
  newer truth, and missing same-age evidence cannot erase a previously proven fact.
- Observability: current field receipt, original legacy receipt and historical
  versions remain in the existing assessment; source receipts are not updated.
- Escalation: conflicting supplier observations remain unresolved and null-valued;
  absent source evidence requires the ordinary source capture, not manual facts.
- Permissions: internal invoker functions; no anon/authenticated execution grants.
- Invariant: zero marketplace writes, package changes or downstream advancements.

## Regression coverage

`tools/luna-product-truth-parity-tests.mjs` runs the actual SQL migration in
isolated PostgreSQL (PGlite), using synthetic products, not Golden fixtures.
It covers all requested field/claim/size/count/stock/provenance/contradiction,
recovery/idempotency/projection guards and normal source triggers, including
candidates without an internal catalog ID cache. The audit gateway tests verify
that downstream packages cannot become supplier truth.

Physical results and deployment identifiers are recorded separately after
readback. Local test success alone does not certify runtime or the physical canary.
`E2E_CERTIFIED=false`; no next-stage progression is authorized by this change.
