# Mayel missing gallery recovery

The gallery reader used `maybeSingle()` against active listing observations. A current seller-list discovery and a historical GetItem certificate can coexist for the same exact account/item/SKU. For 366647547173 the physical read returned PGRST116. The common resolver now accepts that proven pair, rejects conflicting bindings, and is shared by gallery reads and task creation. No historical row is deleted.

The existing delegated runtime previously discovered only finished manifests. It now discovers missing galleries for unfinished tasks too, independently of QA/publication readiness. One account lease permits one gallery recovery at a time. Quota hold records durable retry authority for a bounded batch of at most 50 tasks; one due task is recovered per normal runtime execution. Station opening shares the same lease and retry authority. No new poller, worker, or marketplace writer is added.

A successful read stores the complete ordered gallery observation. It never rewrites an approved manifest, source provenance, asset, or QA result. The reader and legacy manifest builder use the saved full gallery when present. Existing current-readback and gallery drift guards remain mandatory before any marketplace mutation.

The iPad UI explicitly marks incomplete galleries and their pending automatic recovery. It does not infer six images from a product category, copy another listing, or describe a primary-only saved image as a complete official gallery.

Validation includes the exact duplicate-observation failure, SKU/account ambiguity, unfinished task discovery, JSON-null gallery records, six-image recovery, one account lease, follower suppression, durable quota deferral, 429 backoff, private RPC permissions, and preservation of the source/manifest generation. Physical fresh eBay galleries remain pending while the quota hold is active; no fresh eBay read or marketplace write is part of this rollout.
