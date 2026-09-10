# SELLER_OS_SELL_ONE_LIKE_THIS_V1

Mayel → Publicar → Preparar con una referencia eBay opens an inline draft Preview
using one existing own-product package and one reference already captured in that
product's research. It does not fetch arbitrary competitor URLs, initiate research,
capture Shipping, approve publication, or copy competitor content into the package.

The authenticated preprod API accepts identities only. Account scope comes from
the server; the route is OWNER-only. The reader resolves the exact package,
opportunity, product and variant before reading the accepted Keyword V2.1 plan and
the reference observation belonging to that plan. Unsupported/stale keyword data
remains pending with no legacy fallback. Category comes from the existing official
own-product semantic resolution, never the competitor category by assumption.

Reference classification keeps provenance and structural names transferable;
observed attribute values require corroboration. Competitor title, images,
identifiers, policies and unknown payloads are rejected as content sources.
The output is constructed from explicit own facts and exact-product aspect
resolutions. Batch mappings must cite the matching own-product excerpt. Images
must belong to both the proven own-image field and the reviewed exact supplier
image set. No visual generation or reupload is involved.

The existing V2.1 title builder receives a clean own-fact input. Preview and its
Listing Package projection share exactly the same content and generation digest.
They remain `DRAFT_PREVIEW`, with `publicationAuthorized=false`. Preview readiness
is independent of publication readiness; missing Shipping/fees do not become zero.
The original durable package is preserved, not overwritten or approved. The URL
retains package/reference identities so the Preview can be prepared again from
current durable evidence. This version does not create a second publication draft
ledger or a publish action.

Commercial Envelope reuses the existing contract and Fee Authority reader.
Shipping reads only the latest exact-product Portex frontier and requires its
canonical destination, capture identity, receipt and existing six-hour freshness
policy. The capture candidate hash is the family/product/variant/SKU identity,
not the opportunity candidate key. Unavailable or stale Shipping is
`WAITING_FOR_DATA`; the shipping runtime remains untouched. The existing capture
completion route already invokes economics and Quick Pick continuation. A later
Preview read attaches fresh authority to the same package, without manual repair,
a new poller, worker or claim.

The one staging reference canary used reference `137290616476` and own package
`24535b37-0335-4984-a36c-dbb73a7560da` (Double Pearl Dream Catcher Bracelet).
It reached Preview with category 261987, own Type/Brand/Style, five authorized
source images and accepted V2.1, while Shipping remained pending. The competitor
brand and claims were excluded. Capture/marketplace/Ads/publication calls were
blocked by the canary's transport guard. The fee reader and capture-identity
projection are additionally covered by directed integration tests; the canary is
not an assertion that Shipping has recovered or that the draft can be published.

Tests cover contamination, default-deny classification, exact scope, V2.1 failure,
unproven required facts, image provenance, stale Shipping, deterministic generation,
later Shipping attachment and preservation of the normal continuation route.
