# Portex current shipping resume and traffic bounds

The historical recovery marker excluded current shipping forever in
`acquireEconomicLiveListingShippingJobsV1` (`.is("shipping_legacy_recovery_generation", null)`).
The generic economics SQL claim repeated that exclusion. Its scope was the
`LUNA_CURRENT_SHIPPING` work class. A read-only audit of 23 known LIVE listings
found 18 stale shipping jobs with completed historical recovery, including
366643555454. Their historical rows and markers have not been cleared or rewritten.

Current execution uses `discover_seller_os_current_shipping_refresh_v1`: one
account-scoped due job, active listing, no active lease, and either no historical
marker or a completed historical recovery. Exact product, variant, SKU, linkage
and canonical destination validation still runs through the existing job resolver
before admission. Stale FRESH jobs are rediscovered from their actual evidence
expiry even when the historical cohort reconciler preserves their incident rows.
A new freshness generation has its own attempt ordinal; lifetime attempts remain
intact. Completion routes by `shipping_execution_authority`, not by the mere
presence of a historical marker. Generic HTTP economics claims no longer execute
shipping outside its capability-gated producer.

The existing browser leader lease also holds capture state and
`shipping_next_attempt_at`. Capability updates touch only that row. Heartbeats
neither infer capture ability nor discover/claim jobs. Admission requires the
current leader and a fresh independent capture probe; it reserves a fifteen-minute
window before discovery. Repeated availability messages, reloads and followers
cannot bypass that durable window. Each permitted acquisition claims at most one
job. Existing job and executor binding uniqueness prevent concurrent duplicates.

The existing Phase A timer, leader lease, jitter and circuit breaker remain in
use. Shipping's first empty acquisition now uses its existing fifteen-minute idle
tier. A capture failure closes capability and preserves a conservative durable
backoff with positive jitter; Retry-After, when supplied, cannot be shortened.
Retryable 429/capture-unavailable failures do not permanently terminalize the
current generation. No new poller, worker, global scan, account or Luna bypass
has been introduced.

Extension 1.0.55 adds a read-only probe using the existing canonical binding and
existing Shop checkout DOM responder. It performs no navigation, cart mutation,
fetch or binding mutation. Existing Chrome tab-completion events report capability
changes; the existing due-work timer can reread that state. Version 1.0.54 cannot
claim capture capability through a heartbeat and remains fail-closed. Deployment
of the server and installation of the matching extension artifact are separate
release steps; a connected older worker is not certified as capture-capable.

The physical 5454 authority remains stale: USD 6.99, captured September 8, expired
September 9. No fresh quote, physical capture or proven profit is claimed by the
resume tests. After a valid fresh capture the existing durable economic evidence
producer updates Shipping; the normal economics consumer reevaluates and preserves
independent fee/cost guards. No Ads or marketplace writes occur in this workstream.

Validation includes the actual migration in embedded PostgreSQL, unchanged
historical evidence before/after admission and completion, lifetime attempt 21
with current-generation attempt 1, repeated claims/followers, 429 beyond the old
attempt cap, durable Retry-After through heartbeats, fifteen simulated unavailable
minutes, one available activation, initial idle window, and the actual extension
probe in a network-forbidden browser harness. These are integration/synthetic
results; restored physical capture remains pending.
