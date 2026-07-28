# Seller OS Strategy Lab V1

## Scope

Strategy Lab V1 is a pure, deterministic decision engine for versioned,
sanitized golden fixtures. It does not persist a Product Case, publish a
listing, change a listing, generate an image, learn automatically, or call an
external provider.

The route is:

`/admin/ebay/strategy-lab`

The engine keeps two decisions separate:

- `commercialDirection`: the scenario worth evaluating;
- `releaseGate`: the evidence, identity, compatibility, or economics gate that
  still prevents action.

This distinction allows a plausible two-pack or three-pack hypothesis to
remain `HOLD_*`. No `EVALUATE_*` result is an authorization to publish.

## Deterministic pipeline

The pipeline runs in memory from immutable inputs:

1. classify evidence and preserve conflicts;
2. validate comparables;
3. canonicalize and deduplicate eBay Item IDs;
4. isolate cohorts by offer scenario, pack quantity, and variant composition;
5. build separate sold and active market distributions;
6. calculate total-buyer-price economics, profit floor, and market ceiling;
7. produce a commercial direction and a fail-closed release gate;
8. derive a text-only creative brief from the selected strategy;
9. compare the OS result with the versioned human conclusion in Shadow Mode.

`expectedHumanConclusion` is not an input to the engine. It is passed only to
the comparison function after the OS evaluation has completed.

## Evidence and market invariants

- Competitor observations cannot become product facts.
- Active listings cannot become sold evidence.
- `estimatedSoldQuantity` cannot become a verified sale.
- Duplicate Item IDs are counted once. Contradictory duplicate offer
  signatures are rejected rather than resolved silently.
- `SINGLE`, `TWO_PACK`, `THREE_PACK`, and `MIXED_VARIANT_BUNDLE` do not share
  price distributions.
- Missing buyer shipping or outbound shipping remains `null`; explicit zero is
  valid only when the input explicitly contains zero.
- Every scenario cost line must resolve to usable economics evidence and match
  its normalized unit cost; an arbitrary or stale cost fails closed.
- A sold-exact P75 is the preferred market ceiling. An active-exact P75 may
  diagnose economics but is labeled as active and cannot support `GO_SINGLE`.
- If every complete scenario fails economics, the overall release gate can
  reach `NO_GO`; each scenario still preserves its `HOLD_ECONOMICS` diagnosis.
- All displayed fixture observations retain `sourceReference` and `observedAt`.

## Golden fixtures

The fixtures are labeled
`SANITIZED_DETERMINISTIC_GOLDEN_FIXTURE`. They reproduce prior human reasoning;
they are not a live market snapshot.

| Case | Preferred scenario | Commercial direction | Release gate |
| --- | --- | --- | --- |
| Motivational bottle | `MIXED_VARIANT_BUNDLE` | `EVALUATE_TWO_PACK` | `HOLD_EVIDENCE_INCOMPLETE` |
| Posi-Temp cartridge | `TWO_PACK` | `EVALUATE_TWO_PACK` | `HOLD_COMPATIBILITY` |
| 80144 nozzle | `THREE_PACK` | `EVALUATE_THREE_PACK` | `HOLD_EVIDENCE_INCOMPLETE` |

The bottle preserves the 1000 mL versus 32 oz conflict. The Posi-Temp brief
prohibits unsupported OEM, Genuine, and Universal claims. The 80144 three-pack
does not inherit the single-unit market median or ceiling.

## Preview environment independence

The Strategy Lab page and engine do not read `process.env`, Supabase, eBay,
OpenAI, WhatsApp, or any runtime API. The Preview for this branch must be built
from the branch commit itself with the project's normal Preview configuration.

It must not use, copy, or depend on branch-scoped environment overrides from
`feature/centralize-ebay-mobile` or any other branch. No `vercel env` mutation
and no deployment-time `--env` override is required for Strategy Lab.

The existing Admin authentication boundary may use the project's ordinary
Preview authentication configuration; that is independent from Strategy Lab's
calculation and is not a branch override.

## External-effect contract

Every evaluation exposes an explicit safety summary:

| Effect | Count |
| --- | ---: |
| Supabase writes | 0 |
| eBay writes | 0 |
| OpenAI calls | 0 |
| WhatsApp calls | 0 |
| Generated images | 0 |
| Listing changes | 0 |

The implementation contains no fetch, database client, environment read, or
implicit clock. The evaluation timestamp is fixture input.

## Verification

Run:

```bash
npm run test:seller-os
npx tsc --noEmit
npm run build
```

The Strategy Lab tests cover the evidence taxonomy, comparable validation,
deduplication, active-versus-sold separation, estimated evidence, pack
isolation, missing-versus-zero shipping, product-fact contamination, economics,
fail-closed holds, creative-strategy dependency, deterministic execution, and
all three golden cases.
