# Product Research Keyword Intelligence V1

The decision is stored in `marketplace_product_research_query_plans.keyword_intelligence_decision`.
It is a derived, versioned projection of existing Product Truth and Product Research authorities.
It does not generate a title, select a reference, set a price, change a package, or advance a workflow.
The connected MCP relay is not an input.

## Canonical inputs and eligibility

`refresh_product_research_keyword_intelligence_v1(plan_id)` reads inputs itself. It accepts no terms,
owner suggestions, package text, benchmark conclusions, or caller-supplied evidence. Source identity
must match the plan, queue and field-level Luna product/variant facts. Research must be completed
and commercially sufficient, with either the current sufficient terminal conclusion or a legacy
completed plan without a terminal conclusion. This is only discovery eligibility: missing current
field truth, structural evidence or query provenance still produces `UNPROVEN`.

Only `FACT` / `PROVEN` fields with evidence IDs, source evidence and no contradiction provide factual
support. TITLE supplies the entity through the existing Research entity extractor. Other title
words cannot establish brand, model, MPN or feature claims. Proven explicit material, form, size,
set count and feature fields can support core qualifiers. Color and intended uses are secondary.
Supplier claims remain claims, with rejection reasons. Defining field contradictions block readiness.

Canonical evidence V2 supplies one row per Item ID and multi-query provenance. A second defensive
dedup unions query receipts, takes maximum observed sold quantity per item, and excludes conflicting
classifications or titles. Only exact, close-variant and core-family items with positive confirmed
sales, complete source receipts, current V2 semantics and all structural compatibility flags can
contribute positive weight. The existing structural classifier rechecks each item against the
current proven product facts. An old compatible classification cannot override changed truth.
Adjacent and false-positive records contribute zero positive demand weight.

## Ranking and commercial semantics

Candidate primary concepts are the proven entity and contiguous combinations with proven material
or form. They need at least two compatible sold items and 50% comparable coverage. The score is:

```
55 × comparable coverage
+ 25 × share of observed compatible sold quantity
+ 20 for an entity phrase, or 12 for the bare entity
− 10 × negative-item fraction among items containing the term
```

This is an explainable ranking score, not a conversion probability or search-volume estimate.
Highest score wins; deterministic ties prefer the more specific entity phrase, then lexical order.
If the evidence cannot support a primary, the decision remains `UNPROVEN`.

Core qualifiers require repeated compatible sold support and explicit attribute truth. Alternatives
can be semantic expansions only if a proven package-content entity and at least two compatible sold
items (25% coverage minimum) support that term. No synonym dictionary or adjacent-listing vocabulary
is used to invent equivalence. Unproven alternatives are rejected. Terms with truth and weaker demand
support remain secondary; terms with no meaningful sold support are rejected, including accurate
supplier wording. All terms retain classification reason, field receipts, matched Item IDs, query
provenance, sold support, rank, score components, confidence and limitations.

Confidence is capped at MODERATE for this bounded observational evidence; smaller coverage is LIMITED.
Seller diversity and price band remain explicitly UNPROVEN with null values. They do not block the
decision and never add positive evidence. Field promotion blockers explicitly record unproven brand,
model, MPN and supplier claims so later stages cannot silently reintroduce them.

## Durability and normal cohort processing

The input fingerprint binds the decision version, canonical truth receipt, normalized deduplicated
items, queries and prerequisite state. No wall clock participates. Unchanged evidence produces the
same fingerprint and JSON; persistence updates only when the decision differs. Existing plan state,
timestamps, worker claims and evidence receipts are not rewritten.

Normal plan completion and task-evidence events refresh the decision. Product Truth changes refresh
affected plans in stable UUID order. Observation reclassification invalidates an existing ready decision
cheaply; the existing task's final AFTER trigger refreshes once reclassification completes. A standalone
observation change leaves the decision explicitly UNPROVEN until canonical refresh, rather than exposing
stale positive terms. No new timer, runtime, worker, table or parallel ledger is introduced.

Existing eligible plans are recoverable through a generic cursor, without per-product dispatch:

```sql
select recover_product_research_keyword_intelligence_v1(null, 50);
-- Continue with NEXT_AFTER_ID while a full page is returned.
```

The batch limit is 1–100. Individual derivations reject inputs above 1,000 items, 100 queries or 100
truth fields. The database migration uses bounded lock/statement acquisition. Functions use invoker
security and fixed search paths, with execution restricted to the existing service role. Existing
Research table RLS and grants remain the authority; no public/browser access is added.

## Regression verification

`tools/ebay-product-research-keyword-intelligence-tests.mjs` runs the actual migration and existing
semantic helpers in isolated PGlite. Synthetic unrelated product families cover the required positive
and negative eligibility, dedup, multi-query provenance, claim/brand safety, family expansions, null
limitations, deterministic recomputation, normal triggers, legacy cohort recovery and function ACLs.
The Golden is a subsequent blind physical canary, not an algorithm fixture.
