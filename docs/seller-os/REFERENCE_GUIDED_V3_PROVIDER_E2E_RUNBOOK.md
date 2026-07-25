# Visual Strategy V3 — controlled provider E2E runbook

This runbook is preparation only. It does not authorize enabling the provider
or starting the worker.

## Fixed scope

- Revision: `3a4a233e-d4bc-4a65-825f-c4882bceb9d1`
- Audited attempt: `a17327c6-c26c-49ef-8c64-4ea33d64ab1f`
- `MAX_PROVIDER_CALLS=6`
- `MAX_CONCURRENCY=2`
- eBay writes: 0
- `productionChanged: false`
- Keep `OPENAI_REFERENCE_GUIDED_PRODUCT_GENERATION_ENABLED=false` until every
  preflight item below passes and one authenticated operator explicitly starts
  the controlled E2E.

## Mandatory preflight

Abort before claiming a lease unless all checks pass in one read-only snapshot:

1. The active persisted revision is V3 under
   `REFERENCE_GUIDED_PRODUCT_GENERATION_V1`.
2. Exactly one selected attempt belongs to that revision and its manifest is
   unchanged.
3. Exactly six jobs exist at unique positions 1–6.
4. Every unexecuted job is `PENDING`, has no lease, provider request, output or
   error, and all provider counters remain zero.
5. Every job is bound to the same non-null dossier hash and market brief hash
   stored on the revision.
6. Each stored `prompt_hash` equals the SHA-256 of the exact prompt that will be
   sent; a role/manifest surrogate hash is not acceptable.
7. MAIN and SIDE hashes equal the two protected, content-addressed source
   objects and neither appears in the excluded-source set.
8. Shipping weight and package dimensions remain `UNKNOWN`; product-unit
   weight must never be presented as shipping weight.
9. Storage buckets are private, expose no anon/authenticated policy, and the
   tables and RPCs are accessible only to `service_role` (plus database owner).

## Execution envelope

1. Claim at most two PENDING jobs using the persisted manifest; concurrency may
   never exceed `MAX_CONCURRENCY=2`.
2. Reserve one provider-call budget unit atomically before each HTTP request.
   Stop permanently when the attempt reaches `MAX_PROVIDER_CALLS=6`.
3. Send only the protected MAIN and SIDE bytes and the exact audited prompt.
   Do not send competitor images or excluded hashes.
4. Make one provider HTTP request per job. Do not perform transport retries
   inside the image request.
5. Validate 1600×1600 PNG, product fidelity, absence of added text, factual
   grounding and commercial distinctness before changing a job to `PASSED`.
6. On resume, conservar todo trabajo `PASSED`; never regenerate or overwrite
   its output.
7. No reintentar automáticamente un trabajo visualmente fallido. Preserve its
   evidence and require a new human-reviewed append-only plan.
8. Stop on outcome unknown, manifest drift, source drift, lease loss, any
   forbidden claim, unexpected provider-call count, eBay activity or production
   mutation.

## Completion evidence

Record attempt ID, six job IDs and positions, prompt/source hashes, provider
request IDs, output hashes, QA decisions, total provider-call count and the
final assertions `ebayWrites=0` and `productionChanged=false`. Human approval
remains separate; this E2E must not authorize publication.
