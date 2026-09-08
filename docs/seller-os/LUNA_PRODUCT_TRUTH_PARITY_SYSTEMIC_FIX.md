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

| Fields | First loss or incorrect projection observed |
| --- | --- |
| Product ID, variant ID, SKU | Identity already present; projection used queue timestamps/IDs instead of field evidence. |
| Title | Retained upstream, but projection permitted a downstream fallback. |
| Material, color, size set, form factor, features, intended uses | Description captured; not materialized as durable fields. Multiline list bodies also required normalization without losing their content. |
| Count, package contents | Explicit set phrase retained in title/description; structure was not materialized. Contents remain the declared phrase, not invented individual components. |
| Weight | Numeric value/unit retained in variant snapshot; omitted from Product Truth. |
| Supplier cost, regular price, sale price | Cost partially retained with misleading projection provenance; other explicit price relationships not materialized. |
| Availability, stock | Availability retained; projection read incorrect queue properties. Numeric stock is not present in the Golden source and remains unproven. |
| Images | Supplier image URLs retained; projection selected generated Package images instead. |
| Variant options | Explicit option values retained in raw variant; not materialized. Default Title is preserved literally, not interpreted as a specification. |
| Brand, model, MPN, GTIN, overall dimensions | No sufficient corresponding source proof in the audited Golden capture. These remain missing; downstream Brand is separately recorded as unsupported. |

Optional structured attributes exposed by future product payloads are now
allowlisted during the existing capture, closing the earlier capture-level loss.

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

Run `npm run test:luna-product-truth` after installing the locked development
dependencies. PGlite is pinned to 0.5.8; it is a test dependency, not a new runtime.

## Physical outcome and remaining integration boundary

The two migrations recovered 125/125 existing candidates. A repeat recovered
zero. All 25 deployed Product Case fields matched durable values, semantic
classes, source timestamps and evidence IDs, with zero mismatches. The Golden
has 18 FACT fields, one SUPPLIER_CLAIM field (six statements), and six MISSING
fields. Product Truth correctly projects PARTIAL.

The connected Tunnel plugin remains pinned to an older deployment in another
Vercel project. Its Product Case read still uses the old projection. The corrected
preprod administrative MCP endpoint passed; its preview cloud relay is not
activated. No relay binding, authentication secret or other-tool routing was
changed. Overall status remains PARTIAL pending approval to align that existing
connection. See `LUNA_PRODUCT_TRUTH_PARITY_SYSTEMIC_FIX_RESULT.json` for the full
truth-mode output, deployment IDs and field-by-field evidence.
