# Seller OS Strategy Lab V1.1

## Scope

Strategy Lab is a pure, deterministic decision engine for versioned,
sanitized golden fixtures. It does not persist a Product Case, publish or
change a listing, generate an image, learn automatically, or call an external
provider.

The route is:

`/admin/ebay/strategy-lab`

The engine keeps two decisions separate:

- `commercialDirection`: the scenario worth evaluating;
- `releaseGate`: the evidence, identity, compatibility, or economics gate that
  still prevents action.

An `EVALUATE_*` direction is never permission to publish. Confidence describes
the strength of evidence and is also not readiness or authorization.

## Deterministic pipeline

The pipeline runs in memory from immutable inputs:

1. classify evidence and preserve conflicts;
2. validate comparables;
3. canonicalize and deduplicate eBay Item IDs;
4. isolate cohorts by offer scenario, pack quantity, and variant composition;
5. build separate sold and active market distributions;
6. validate evidence for every cost and calculate scenario economics;
7. produce a commercial direction and fail-closed release gate;
8. calculate explainable multidimensional confidence;
9. derive a text-only creative brief from the selected strategy;
10. compare the completed OS result with the unchanged human conclusion.

`expectedHumanConclusion` is never an engine input. Shadow Mode receives it
only after `evaluateStrategyLabCase()` has completed.

## Integrity corrections

### ROI over total investment

ROI uses the complete invested cost:

```text
investedCost =
  productCost + packagingCost + outboundShippingCost

roiPercent =
  estimatedProfit / investedCost × 100

minimumRoiPrice =
  (
    investedCost
    + fixedOrderFee
    + investedCost × minimumRoiRate
  )
  / (1 - variableRate)
```

ROI and `minimumRoiPrice` remain `null` when invested cost is missing,
non-finite, or less than or equal to zero. The isolated, fully evidence-backed
Posi-Temp economics test produces:

- product cost: USD 11.50;
- packaging: USD 0.00;
- outbound shipping: USD 6.99;
- invested cost: USD 18.49;
- estimated profit: USD 7.60;
- ROI: 41.10%;
- minimum ROI price: USD 32.29.

This test evidence is local to the test. It is not inserted into a golden
fixture and does not claim to be live evidence.

### Evidence-backed costs

Product cost, packaging, and outbound shipping must each resolve to evidence
that:

- exists;
- is `PRODUCT_VERIFIED` or `SUPPLIER_STATED`;
- is usable as a product fact;
- declares purpose `ECONOMICS`;
- declares the matching semantic cost role, USD currency, and cost basis;
- contains a finite, non-negative normalized number;
- exactly matches the value used by the scenario.

An unknown cost is `MISSING`, never zero. Zero is accepted only when the
linked evidence also has normalized value zero. Missing, unauthorized, or
discordant evidence produces an explicit blocker and `MISSING_INPUT`.
Product cost requires `PRODUCT_UNIT_COST`, `PER_UNIT`, and the applicable
variant. Packaging requires `PACKAGING_COST` and `PER_ORDER`; outbound
shipping requires `OUTBOUND_SHIPPING_COST` and `PER_ORDER`. Stock, weight,
dimensions, another currency, or another variant therefore fail closed even
when their numeric value happens to match.

The golden fixtures contain supplier unit-cost evidence, but no current
packaging or outbound-shipping evidence. Those fields therefore changed from
unsupported synthetic values to `null`. No new `fixture://` evidence was
created to preserve the old conclusions.

### Human hypotheses and selection

`HUMAN_HYPOTHESIS` contributes no positive evidence or confidence. A
hypothetical scenario receives a conservative `-10` ranking penalty. It stays
visible and can remain an `EVALUATE_*` direction, but it cannot outrank an
otherwise equivalent non-hypothetical scenario because of its hypothesis.

Every assessment exposes `selectionReasons`, including:

- release-gate score;
- unique complete SOLD_EXACT contribution;
- explicit hypothesis penalty or confirmation that no bonus exists.

`selectionScore` is only a deterministic within-case ranking mechanism. It is
not confidence and is not a probability.

### Accepted evidence classes

Each hard requirement declares:

- field;
- blocker;
- accepted evidence classes;
- required purpose;
- whether a usable product fact is required.

Policies are explicit by field:

- fitment and dimensions: only `PRODUCT_VERIFIED`;
- product, packaging, and shipping costs:
  `PRODUCT_VERIFIED` or `SUPPLIER_STATED`;
- bottle variants and Luna identifiers:
  `PRODUCT_VERIFIED` or `SUPPLIER_STATED`;
- model 80144: `PRODUCT_VERIFIED`;
- real visual source: `PRODUCT_VERIFIED`.

An empty policy fails closed. `SUPPLIER_STATED` and `HUMAN_HYPOTHESIS` cannot
release fitment or dimensions. A human hypothesis never resolves identity.

## Multidimensional confidence

Each case returns:

```ts
confidence: {
  identity: "LOW" | "MEDIUM" | "HIGH"
  compatibility: "NOT_APPLICABLE" | "LOW" | "MEDIUM" | "HIGH"
  market: "LOW" | "MEDIUM" | "HIGH"
  economics: "LOW" | "MEDIUM" | "HIGH"
  strategy: "LOW" | "MEDIUM" | "HIGH"
  reasons: string[]
}
```

Identity is high only when all required fields are product-verified; allowed
supplier evidence produces medium; missing, conflicted, or hypothetical
required evidence produces low.

Compatibility is not applicable without a hard gate. It is high only when
every requirement is product-verified and low when any requirement is missing,
conflicted, supplier-only, or hypothetical.

Market confidence uses unique complete-price SOLD_EXACT Item IDs:

- high: five or more;
- medium: two through four;
- low: zero or one, active-only, estimated-only, or no sold ceiling.

Economics is high when all costs are concordant and product-verified, medium
for a complete allowed mix with supplier evidence, and low for any missing,
invalid, unauthorized, or discordant cost.

Strategy confidence is the conservative minimum of the critical dimensions.
It does not change a HOLD into GO. A fully evidenced scenario can have high
confidence that its outcome is `HOLD_ECONOMICS` or `NO_GO`.

## Updated golden outputs

Every fixture declares all three labels:

```text
SANITIZED_DETERMINISTIC_GOLDEN_FIXTURE
NOT_LIVE_MARKET_EVIDENCE
NOT_LINKED_TO_OWN_EBAY_LISTING
```

They are not independent market validation and are not linked to an owned
manual eBay listing.

| Case | OS preferred scenario | Direction | Release gate | Shadow |
| --- | --- | --- | --- | --- |
| Motivational bottle | `SINGLE` | `TEST_SINGLE` | `HOLD_EVIDENCE_INCOMPLETE` | `PARTIAL` |
| Posi-Temp cartridge | `TWO_PACK` | `EVALUATE_TWO_PACK` | `HOLD_COMPATIBILITY` | `PARTIAL` |
| 80144 nozzle | `SINGLE` | `TEST_SINGLE` | `HOLD_EVIDENCE_INCOMPLETE` | `PARTIAL` |

### Motivational bottle

- The 1000 mL versus 32 oz conflict remains unresolved.
- Single keeps four complete SOLD_EXACT prices: P25 USD 17.12, median
  USD 18.24, P75/ceiling USD 19.37.
- Single economics is `MISSING_INPUT`: packaging and outbound shipping are
  missing, so invested cost, profit, margin, ROI, and profit floor are null.
- Mixed two-pack remains visible as `EVALUATE_TWO_PACK` and
  `HOLD_EVIDENCE_INCOMPLETE`, with three SOLD_EXACT prices and ceiling
  USD 40.24. It receives no hypothesis bonus.
- The OS now selects single because it has stronger sold evidence and no
  hypothesis penalty.
- Confidence: identity `MEDIUM`, compatibility `NOT_APPLICABLE`, market
  `MEDIUM`, economics `LOW`, strategy `LOW`.
- Shadow differences: preferred scenario, direction, blockers, next action,
  and positioning. The human expectation remains unchanged.

### Posi-Temp cartridge

- Two-pack keeps four complete SOLD_EXACT prices: P25 USD 34.62, median
  USD 35.49, P75/ceiling USD 36.37.
- Golden-fixture economics is `MISSING_INPUT` because packaging and
  consolidated shipping lack evidence. The previous 66.06% ROI is removed
  from the fixture output.
- The isolated fully backed economics test reports the corrected 41.10% ROI.
- Direction remains `EVALUATE_TWO_PACK`; release remains
  `HOLD_COMPATIBILITY`.
- Fitment and dimensions require `PRODUCT_VERIFIED`; supplier or human
  hypothesis evidence cannot release the gate.
- Confidence: identity `MEDIUM`, compatibility `LOW`, market `MEDIUM`,
  economics `LOW`, strategy `LOW`.
- Shadow difference: blockers now also expose missing packaging and
  consolidated shipping. The human expectation remains unchanged.

### 80144 nozzle

- Single remains isolated from the three-pack cohort.
- Single has zero SOLD_EXACT and six ACTIVE_EXACT prices: P25 USD 21.24,
  median USD 22.47, active P75/ceiling USD 24.48. Active evidence cannot
  support GO.
- Single economics is `MISSING_INPUT` because packaging and outbound shipping
  lack evidence.
- Three-pack remains visible as `EVALUATE_THREE_PACK`,
  `HUMAN_HYPOTHESIS`, and `HOLD_EVIDENCE_INCOMPLETE`. It has no exact sold
  cohort, no market ceiling, no packaging evidence, no consolidated-shipping
  evidence, and no real visual source.
- The OS now selects single; the three-pack no longer receives a hypothesis
  bonus.
- Confidence: identity `MEDIUM`, compatibility `NOT_APPLICABLE`, market
  `LOW`, economics `LOW`, strategy `LOW`.
- Shadow differences: preferred scenario, direction, blockers, next action,
  and positioning. The human expectation remains unchanged.

## Seller OS home in Pilot Mode

`/admin` renders an informational lock instead of the same-day automation
component:

```text
LANZAMIENTO AUTOMÁTICO BLOQUEADO EN PILOT MODE
Strategy Lab está disponible únicamente para análisis read-only.
```

The rendered component contains no button, click handler, POST, worker start,
scan, publication, repricing, or external write. Its only action is a safe link
to `/admin/ebay/strategy-lab`.

The server-side middleware remains unchanged:

- POST `/api/admin/ebay/same-day-pilot` returns 423 with
  `SINGLE_PRODUCT_LAB_ACTION_BLOCKED` and
  `SAME_DAY_AUTOMATION_BLOCKED`;
- GET remains read-only and allowed.

If a residual 423 reaches the legacy response formatter, the UI says the
action was blocked correctly, confirms that no automation or external change
occurred, and displays `reason` and `mode`. It is not presented as invalid
confirmation data.

## Preview environment independence

The Strategy Lab page and engine do not read `process.env`, Supabase, eBay,
OpenAI, WhatsApp, or any runtime API. Preview must be built from the branch
commit with normal Preview configuration.

It must not use, copy, or depend on branch-scoped environment overrides from
`feature/centralize-ebay-mobile` or any other branch. No `vercel env` mutation
or deployment-time `--env` override is required.

The existing Admin authentication boundary may use the project's ordinary
Preview authentication configuration; that is independent from Strategy Lab.

## External-effect contract

Every evaluation exposes:

| Effect | Count |
| --- | ---: |
| Supabase writes | 0 |
| eBay writes | 0 |
| OpenAI calls | 0 |
| WhatsApp calls | 0 |
| Generated images | 0 |
| Listing changes | 0 |

The engine contains no fetch, database client, environment read, external
adapter, implicit clock, or product-specific branch. The evaluation timestamp
is fixture input.

## Verification

Run:

```bash
node lib/ebay/strategy-lab.test.mjs
npm run test:seller-os
node_modules/.bin/tsc --noEmit
npm run build
npm run audit:seller-os
git diff --check
```

The tests cover evidence taxonomy, comparable validation, dedupe, active versus
sold, estimated evidence, pack isolation, evidence-backed costs, missing versus
zero, ROI over total investment, hard-gate evidence classes, hypothesis
ranking, confidence levels, Shadow differences, deterministic execution,
Pilot Mode home containment, and zero external effects.
