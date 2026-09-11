# Semantic gallery removal authority

The full-gallery mutation contract remains unchanged. Its removal evidence can now
reference an immutable semantic QA receipt, in addition to the existing proof that
identical source content survives in a retained slot. No OWNER approval is added.

`RECORD_REMOVAL_SEMANTIC_REVIEW_V1` on the existing preprod workstation route records
the assigned Mayel/operator review. The browser uses its authenticated actor; the
existing service boundary supplies the assigned actor explicitly. Both use the same
private RPC. An active FULL grant and its removal addendum are required.

The review contains contract `MAYEL_SEMANTIC_REMOVAL_REVIEW_V1`, exact `itemId`,
`productTruthDigest`, `sourceImageSetDigest`, `baseManifestDigest`, full ordered
`currentImages` and `finalImages`, `sourcePosition`, `reason`, `evidenceReferences`,
an explanation, and semantic `checks`. It must inspect the removed image and retained
evidence. New final images must already have the existing durable semantic QA and
Product Truth binding. Rejected or discarded assets cannot supply that evidence.

Required checks are `exactListingIdentity`, `productTruthPreserved`, `semanticQaPass`,
`removalReasonProven`, `requiredProductInformationNotLost`, `finalGalleryRemainsValid`.
`identityDrift` and `productUncertainty` must be false; unsupported claims and competitor
contamination counts must be zero. All are explicit typed values, never defaults.

Supported reasons are LOW_QUALITY, REDUNDANT, MISLEADING, OBSOLETE,
WEAK_CONVERSION_VALUE, VISUAL_DUPLICATE, REPLACED_BY_BETTER_AUTHORIZED_ASSET.
These are review conclusions, not facts inferred by choosing a reason from a menu.
The reviewer must substantiate the reason from evidence; this change does not invent
conversion metrics or automatically conclude that a photograph reduces conversion.

The returned receipt ID, reason and base manifest digest are included in the existing
decision's `removalEvidence`, with the same evidence references. The server loads the
private receipt by exact account/task/ID (maximum 24); caller flags cannot substitute
for it. The SQL execution authority independently requires the same receipt, current
gallery, desired order, image position and product/source digests. Revocation and
current full-gallery revalidation apply before execution. Explicit receipt failures
never fall through to duplicate-image authorization.

Receipts are immutable except revocation and replay-idempotent. Their MD5 replay key
only deduplicates database requests; SHA-256 remains the product/image identity
authority. No review creates an outbox, calls eBay, changes a live listing, schedules
work or authorizes publishing or advertising. Existing full-gallery preparation and
execution remain responsible for the single intent, complete ordered write and
official readback. Missing review evidence remains fail-closed.

Validation covers all reasons, exact binding, non-identical-image removal, current and
final gallery mismatch, required checks, foreign/rejected images, revocation, replay,
private ACLs and the unchanged duplicate-source path. Physical REPLACE certification
is separate and requires the real eBay read/write/readback cycle after quota recovery.
