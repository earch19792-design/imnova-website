# SELLER_OS_LISTING_PUBLICATION_E2E_GATE_V1

This gate certifies the existing NEW LISTING publisher without authorizing or
performing a marketplace write. It keeps live-listing optimization delegation
separate. An unrelated visual proposal in REQUIRES_ATTENTION is not an input.

The same reference Preview reader evaluates the immutable Sell One Like This
generation and reads at most one publication row, by exact account/package,
using the existing package lookup index and an eight-second read timeout. It
does not scan listings, create an intent, refresh Shipping, or call eBay.

The existing publisher implements these stages:

| Gate stage | Existing evidence / runtime |
| --- | --- |
| DRAFT | Own-product package before consistency certification |
| PACKAGE_CERTIFIED | Exact identity, own truth, category, specifics, V2.1, authorized images, immutable generation/hash |
| EBAY_PREVALIDATED | Account-bound official preflight snapshot; category/identifier, policy/location and collision checks |
| INVENTORY_READY | Exact Inventory Item readback in the draft-only executor |
| OFFER_READY | Exact UNPUBLISHED Offer readback and final immutable Preview |
| PUBLISH_REQUESTED | Atomic publication claim with idempotency key and one dispatch allowance, before POST |
| UNKNOWN_COMMIT_STATE | `outcome_unknown`; GET-only reconciliation, never a fresh claim |
| READBACK_REQUIRED | `published_pending_verification`; a POST result or listing ID is not confirmation |
| PUBLISHED_CONFIRMED | Exact Inventory/Offer readback plus Trading ACTIVE/ownership verification and durable monitor receipt |

These are evidence stages, not new database phases. Existing RPCs, leases,
indexes and publisher actions remain authoritative. A completed draft ledger
or historical `preview_ready` does not prove current readiness.

The preparation key and execution key are distinct. For an existing publication,
the gate returns its claimed execution key, or the existing publisher's
`publish:<publication UUID>` key before claim. Derivation conveys no permission;
the claim RPC persists the key atomically. It never substitutes the reference
Preview hash for the publisher's execution key. Existing approval/execution,
offer/account, and publication key uniqueness prevent competing active intents;
historical terminal records remain intact.

The official workflow requires inventory, location and offer data before publish.
The published listing ID is returned by publishOffer; getOffer and exact-SKU
getOffers support reconciliation. References checked 2026-09-10:

- [Official publication requirements](https://developer.ebay.com/api-docs/sell/static/inventory/publishing-offers.html)
- [Official offer management](https://www.developer.ebay.com/api-docs/sell/static/inventory/managing-offers.html)
- [Official listing workflow](https://developer.ebay.com/develop/guides/sell/listing-management)

Unknown outcome recovery does not automatically treat UNPUBLISHED, 404, or a
failed GET as proof that the original request never committed. Existing recovery
remains GET-only unless the separate, already implemented rearm contract proves
no publication and revalidates all dependencies and authorization. Replaying a
claim returns its existing state/token, so a new invocation cannot dispatch.

The directed tests execute the production gateway with injected transport and
the actual publication SQL claim/result functions in isolated PGlite. The SQL
fixture supplies the separately certified image QA verdict; it tests ledger
behavior, not physical image QA. The full suite also covers semantic readback,
preflight, offer ambiguity, authorization, SKU collision and publication/live-sync
separation. No test contacts eBay.

For package `24535b37-0335-4984-a36c-dbb73a7560da`, the current certified
reference generation is internally consistent. Inventory, Shipping and full fee
authority are pending. Its existing historical publication Preview has different
content/images; it must not impersonate the reference generation. The gate reports
`PUBLICATION_PREVIEW_GENERATION_MISMATCH` without rewriting either artifact. A
future publication must use the existing exact-preview preparation/revalidation
contract after evidence is complete. Hosted aliases cannot be assumed equivalent
without a proven image provenance handoff.

Fresh Shipping follows the existing capture-completion economics/Quick Pick
continuation. Normal package reads attach fresh authority and reevaluate readiness
without changing package content/hash. Pending inventory/fees remain pending;
fresh Shipping alone neither authorizes nor triggers publication. No new poller,
worker, capture, or OWNER repair is introduced.
