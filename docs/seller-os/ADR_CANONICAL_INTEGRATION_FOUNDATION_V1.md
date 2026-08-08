# ADR: Seller OS Canonical Integration Foundation V1

- Status: Accepted for controlled engineering; not approved for merge or deployment
- Date: 2026-08-08
- Canonical base branch: `staging/ebay-pro-seller-os`
- Canonical base commit: `ffb2eed1dbf9e41e42ab5343b1a595d69cb15f8b`
- Foundation branch: `feature/seller-os-canonical-integration-foundation-v1`
- Next implementation checkpoint: `PERSISTENT PRODUCT CASE FOUNDATION V1`

## Context

Seller OS has multiple lines of development that contain useful but differently
mature capabilities. The accepted staging line contains the shared eBay Seller OS
foundation. Two stacked Draft pull requests contain the most advanced Strategy Lab
and Product Case work:

1. PR #256, `feature/seller-os-strategy-lab-v1` at
   `932bf5375b77d6582b93776eb23c5146d11d776d`, based on the canonical staging
   commit.
2. PR #257, `feature/seller-os-product-case-runner-v1` at
   `bf0265556ec6b56c68bf75c0ccd164e0c75416b1`, based on PR #256.

The checkout `feature/centralize-ebay-mobile-command-center` at
`c8961eccc9d125802e8d0105589ae4ce48c7be4b` is divergent and contains pre-existing
tracked and untracked work. It is forensic/reference material only. It is not an
integration base, and none of its untracked migrations are part of this decision.

`main`, PR #253, historical OAuth/runtime checkpoints, and the dirty checkout are
also excluded as implementation bases.

## Decision

All new Seller OS foundation work begins from the exact canonical staging commit:

```text
staging/ebay-pro-seller-os
ffb2eed1dbf9e41e42ab5343b1a595d69cb15f8b
```

PR #256 and PR #257 are reviewed as sources of reusable contracts and domain
logic. They are not merged wholesale or automatically. Reuse is performed through
small, reviewable changes after file-level reconciliation and passing safety gates.

The initial foundation commit created for this decision contained documentation
only. Later work on this branch may add independently authorized, scoped runtime
behavior, but it does not thereby authorize Product Case persistence, database
schema, marketplace actions, or notifications.

## Role of PR #256

PR #256 is the reference implementation for Strategy Lab and truthful market
evidence handling. Its reusable responsibilities include:

- explicit listing reconciliation;
- `INSUFFICIENT_EVIDENCE` instead of fabricated values;
- nullable metrics and `syntheticFallbackUsed: false`;
- canonical Item ID normalization;
- strict sold/active separation;
- Item ID deduplication and conflict handling;
- evidence cohorts and sold-price distributions;
- Pilot Mode and no-effect execution;
- deterministic Strategy Lab evidence and decision logic.

PR #256 does not authorize Commercial Monitor mutations, marketplace writes,
WhatsApp delivery, or automatic execution. UI, routing, middleware, and queue
changes are integrated only when their responsibility is required by the target
architecture and independently reviewed.

## Role of PR #257

PR #257 is the reference implementation for Product Case domain behavior. Its
reusable responsibilities include:

- evidence and provenance models;
- versioned source contracts and parsers;
- visual and identity review;
- SHA-256/tamper evidence;
- sensitive-data rejection;
- fail-closed product truth, source, market, stock, policy, and economics gates;
- legacy import with approval/output reset;
- manual listing registration preparation without automatic publication.

Its browser/session storage is not the persistence model. A durable Product Case
must have server-owned identity, immutable versions, append-only evidence and
decisions, explicit approval state, and referential links to listing, experiment,
and outcome registries. Large page and domain files must be decomposed before
integration.

## Persistent Product Case requirement

Before new Commercial Intelligence or automated strategy work, Seller OS must
introduce a persistent Product Case aggregate that:

- has a stable server-generated ID and immutable version identifiers;
- stores normalized evidence separately from derived decisions;
- preserves provenance, source-contract version, hashes, capture time, and actor;
- preserves `UNAVAILABLE != 0`, `UNKNOWN != 0`, `ERROR != 0`, and
  `PARTIAL != COMPLETE`;
- separates product truth from market evidence and supplier assertions;
- records visual review and identity review as explicit, attributable decisions;
- invalidates prior approval when material evidence or parsing changes;
- links listing registration, experiments, monitoring observations, and learning
  outcomes to the exact approved Product Case version;
- fails closed when evidence, identity, stock, policy, or economics is incomplete;
- cannot be bypassed by listing registration or experiment execution.

The next checkpoint may design and implement this foundation, but must not add
Market Opportunity Scout, Commercial Monitor V2, WhatsApp, Assistant Tool Gateway,
Post-Sale, or marketplace writes.

## Commercial Monitor requirement

Commercial Monitor must be read-only with respect to eBay and external channels.
Its monitoring path may produce a typed observation for separately controlled,
append-only persistence, but it must not:

- publish, revise, end, pause, or reactivate a listing;
- change price, inventory, title, images, promotions, or campaigns;
- execute `apply_improvement` or an equivalent mutation;
- send WhatsApp or buyer messages;
- turn unavailable, unknown, error, or partial evidence into zero/complete data;
- use synthetic metrics as marketplace evidence.

Mutation preparation, controlled experiments, outbound notification, and execution
belong to separate capabilities with independent authorization and human review.

## Assistant eBay requirement

Any future Assistant Tool Gateway starts with eBay read-only capabilities. It must
have an explicit tool registry, per-tool authorization, idempotency, evidence
provenance, an audit ledger, and a deny-by-default policy. A read tool must not
share an execution surface with publish, revise, inventory, fulfillment, messaging,
or experiment mutation tools.

This ADR does not implement the gateway.

## Product Research and Luna reuse requirements

Seller OS Product Research extension v1.2.16, its validated capture contract,
idempotency, quarantine, sold/active containment, and provenance must be extended
rather than rebuilt. Future work must add coverage/pagination proof and canonical
Item ID deduplication without weakening current validation.

Existing Luna capture plans/tasks, import controls, product facts, stock evidence,
original-source resolver, and content-addressed manifests must also be reused.
Supplier/Luna evidence may support product truth and execution readiness only after
market evidence exists; it must not become the initial market-demand source.

## Modules that must not be rebuilt

- eBay Sandbox OAuth and runtime read-only checks already integrated into staging;
- seller account scope and identity verification;
- taxonomy, account, inventory, analytics, Browse, and Fulfillment readers;
- active-listing Inventory sync and verified manual registration primitives;
- Product Research v1.2.16 capture, validation, persistence, idempotency, and
  quarantine;
- Strategy Lab canonical Item ID, sold/active, dedupe, cohort, and price-distribution
  logic selected from PR #256;
- Product Case evidence, provenance, parser, review, and fail-closed domain logic
  selected from PR #257;
- Winner Evidence V2 and marketplace product facts;
- Luna original-source resolver and immutable manifests;
- unit economics and pricing primitives;
- Commercial Monitor read collectors and nullable metric domain;
- fulfillment identity/reconciliation primitives;
- category-performance learning primitives;
- outbox, lease, dedupe, and dead-letter primitives, without enabling delivery.

## Target architecture

```text
eBay / Product Research / Luna / Orders / Traffic
-> normalized evidence
-> persistent Product Case + registries
-> Commercial Intelligence
-> Assistant Tool Gateway READ ONLY
-> ChatGPT strategic reasoning
-> human decision
-> controlled experiment
-> learning
```

Each arrow is a typed, versioned boundary. Evidence and derived decisions remain
separate. Human approval is attached to an exact immutable version and cannot be
silently carried across imports, reparses, or materially changed evidence.

## Safety and promotion policy

- Work is based on staging, never directly on `main`.
- Pull requests remain Draft until the scoped implementation, tests, security
  review, and human review are complete.
- No automatic merge or promotion is allowed.
- Seller OS safety, targeted domain tests, TypeScript, audit guards, whitespace,
  and production build must pass on the exact candidate head.
- A Vercel Preview result is not a substitute for Seller OS safety.
- No migration is applied without a separately authorized schema checkpoint.
- No remote DDL/DML or Supabase mutation is part of this foundation.
- No eBay marketplace write, buyer message, WhatsApp send, Production deploy, or
  Production configuration change is part of this foundation.
- Secrets, refresh tokens, auth codes, cookies, and authorization headers must
  never appear in code, fixtures, logs, or review artifacts.

## Consequences

Positive consequences:

- the integration base is reproducible by commit SHA;
- the dirty/divergent checkout cannot silently define architecture;
- advanced PR work can be reused without importing its browser persistence or
  unrelated surfaces;
- Product Case becomes the required aggregate and audit boundary;
- monitoring and assistant reasoning remain separate from execution.

Trade-offs:

- PR #256 and PR #257 require selective extraction instead of a fast wholesale
  merge;
- persistent contracts and registries must be defined before additional product
  functionality;
- some existing UI and route wiring will remain intentionally unintegrated until
  their domain boundaries are proven.

## Supersession rule

This ADR may be superseded only by another reviewed ADR that names the replacement
base SHA, explains compatibility with the Product Case invariant, and records the
human approval and safety evidence. Branch movement alone does not supersede this
decision.
