# Keyword Intelligence V2: specificity and semantic family

V1 gave coverage 55% of the score, sales share 25%, and only a small difference between
head nouns and qualified phrases. Its qualified candidates required contiguous matches;
the phrase was then classified independently of its constituents. Semantic alternatives
were limited to the final entity extracted from proven package contents. Confidence did
not sufficiently expose query concentration, sales concentration or ambiguity.

V2 changes the decision semantics, not the canonical evidence or comparable classifier.
The existing V1 pure derivation remains the safety/input adapter: current Product Truth
binding, FACT versus claim handling, current structural revalidation, allowed comparable
classes, Item-ID deduplication, maximum observed sales per item and query provenance are
unchanged. Its ranking and previous winner are not inputs to V2 selection.

## Concepts, not added token frequencies

The hierarchy distinguishes HEAD_CONCEPT, QUALIFIED_CONCEPT, ATTRIBUTE_QUALIFIER,
SEMANTIC_ALTERNATIVE and SECONDARY_ATTRIBUTE. A qualified concept must contain one
complete explicit material, form or factually authorized feature and the family head.
It is generated only after a sold title supplies an ordered occurrence of those parts.
No list of attributes is concatenated into a query.

A contiguous span is fully coherent. A bounded ordered elision can skip up to three
intervening words also present in the current Product Truth title; these words are not
promoted or asserted as attributes. It cannot cross use, accessory, brand, model or
replacement clauses. The actual surface and elided tokens are retained per Item ID.
For example, with a proven material and a current title containing an intervening
descriptor, an observed `material descriptor entity` may support `material entity`.
The descriptor itself still needs its own Product Truth authorization to be promoted.

Each concept counts each canonical Item ID once. Parent, qualifier and child scores are
never summed. Relationships expose retained/lost items, zero additional unique items
versus the head, and incremental specificity. A weaker qualified phrase remains a child
with an explicit reason; it is not an unrelated secondary keyword.

## Selection rules and auditable scoring

The rules were fixed against synthetic families before the new Golden was read. They are
ranking heuristics with regression invariants, not learned marketplace search-volume or
conversion estimates. No SKU or expected Golden term appears in implementation/tests.

Primary eligibility:

- Head: at least two compatible sold items and 60% coverage.
- Qualified concept: at least three compatible sold items, 50% coverage, one proven
  attribute axis, at most four normalized words and at most 60 characters.
- Every candidate must pass current truth, structural, sold and query-provenance gates.

Score components:

| Component | Points / rule |
|---|---|
| Compatible Item-ID coverage | 30 × coverage |
| Proven observed sold quantity share | 10 × share |
| Discriminative specificity | 20 for one proven qualified concept; no word-length bonus |
| Concept coherence | 15 × (literal items + 0.8 × licensed elision items) / matched items |
| Cross-comparable support | 10 × min(matched items / 5, 1) |
| Current query diversity | 5 × min(distinct bound queries / 2, 1) |
| Discriminative information gain | 5 × clipped positive log2 lift, maximum 10 points |
| Genericity penalty | 15 for a bare head when a qualified child passes the eligibility gates |
| Ambiguity penalty | 15 × negative matched items / all matched items |

Information gain compares Laplace-smoothed prevalence in compatible items with prevalence
in negative items. With no negative sample, it is unproven as a discriminator and contributes
no points. The component is an observed-language information proxy, not measured buyer clicks.
Unknown price and seller diversity never add evidence. Sales quantities come exclusively
from the certified Research adapter, never aggregate price or cumulative sales-value fields.

The highest eligible score must exceed the next by at least three points. Otherwise the
primary is UNPROVEN; lexical order is only display order, never an evidential tie breaker.
These thresholds enforce repeated support and avoid choosing long/rare phrases simply
for their length. A head can win when no discriminative child clears the evidence gates.

## Semantic-family recall and safety boundary

V2 retains explicitly proven package-family alternatives and additionally considers
observed derivational variants of the family root. Morphology only licenses clustering;
at least two compatible sold Item IDs and 25% coverage are still required for promotion.
The source surfaces, structural compatibility and multi-query receipts remain inspectable.
A derivational cluster cannot authorize a supplier claim or contradicted/unproven term.
It is marked semantic compatibility, not a newly proven product feature.

Unlicensed cross-noun substitutions remain UNPROVEN. A repeated word alone cannot prove
it is a synonym rather than a component, brand, model, use or adjacent product. External
dictionaries, arbitrary query suggestions and LLM intuition are not demand evidence.
The current comparable classifier also bounds recall: an otherwise suggestive alias on
an adjacent or false-positive item cannot provide positive support. Empty expansions
remain a valid result. This limitation is recorded explicitly in the decision.

## Confidence and durable operation

Every decision exposes sample size, current query diversity, concept concentration,
largest-item sales concentration, ambiguity and the primary winning margin. Confidence
is LIMITED for fewer than five comparable items, fewer than two bound queries, an item
contributing over half the supported sales, ambiguity over 70%, or a primary margin below
five points. Otherwise it is capped at MODERATE. Query diversity does not prove independent
seller diversity. SELLER_DIVERSITY and PRICE_BAND remain UNPROVEN with null values.

The existing `refresh_product_research_keyword_intelligence_v1` and cohort recovery entry
point now dispatch to the V2 pure derivation. The same triggers and plan decision column
remain in use. An append-only history array on that same plan preserves prior decisions,
including the full V1 decision on first recompute. Direct history rewrites are rejected.
The fingerprint binds V2 to the existing input-authority fingerprint; no time or historic
winner influences ranking. Repeated unchanged inputs make no decision/history writes.

Only the existing service role can execute the new functions. All use invoker security
and fixed search paths. No new table, worker, runtime, public endpoint or ledger is created.
No Listing Package, reference, category/aspect, pricing, publisher, relay or operational
service changes occur in this migration.

## V2.1: bounded concept boundaries

The first V2 cohort readback is frozen independently. It exposed a noncommercial unit
selected as a head and showed that the original omission rule discarded an otherwise
supported attribute/head relationship whenever a comparable added an extra modifier.
An audit of all fourteen cases found no contiguous head-before-material cases, so word
order was not changed to influence this cohort.

V2.1 keeps V2's score weights, eligibility thresholds, classification gates and pure
function intact. A unit or numeric head now makes the decision UNPROVEN with
`UNIT_OR_NUMERIC_TOKEN_IS_NOT_A_PRODUCT_ENTITY`. It does not guess another entity or
change the Research classifier.

An ordered span can additionally omit one comparator-only alphabetic word when another
intervening word is a lexical anchor present in the current product title. The existing
three-word gap bound and accessory/use/brand clause boundaries still apply. This is
generalization from an already structurally compatible comparable, not authorization of
the omitted property. For example, with proven nylon and a title containing `tapered`,
`nylon narrow tapered funnel` supports the broader `nylon funnel`; it does not prove or
promote `narrow`. `nylon narrow funnel`, identifiers, unanchored gaps and clauses such as
`nylon holder for funnel` remain unsupported. Every observed span and omitted token is
retained with its Item ID. The existing noncontiguous coherence discount still applies.

Missing explicit Product Truth attributes still cannot be recovered from marketing
title adjectives. Cross-noun synonyms without licensed equivalence remain UNPROVEN.
These recall limits are intentional evidence boundaries, not evidence of no demand.

The final contract is `PRODUCT_RESEARCH_KEYWORD_INTELLIGENCE_V2_1`. V1 and V2 decisions
and executable derivations remain auditable; the existing plan history preserves both.

## Regression scope

`tools/ebay-product-research-keyword-specificity-v2-tests.mjs` runs the actual V1 and V2 SQL
in isolated PGlite, using non-Golden synthetic product families. It covers all 19 required
regressions plus observed elision boundaries, indistinguishable candidates, concentration,
derivational-family evidence, normal cohort triggers, immutable history, claim laundering
and service-only permissions. The V1 regressions remain unchanged and run separately.
