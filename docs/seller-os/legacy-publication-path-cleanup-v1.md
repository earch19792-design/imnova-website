# CURRENT preparation and historical publication isolation

Base: 20ea40e14e945557e12895a5b57857ad255bc586. No marketplace writes are part of this change.

## Root cause

The UNIQUE(opportunity_id) package slot selected the same old package on reentry. The factory rematerializer retained prior owner-review/draft configuration. Other-package category and historical package Product Truth fallbacks could participate in preparation. Preview construction spread old Inventory/Offer payloads. Explicit CURRENT preparation could fall through to legacy approvals. Operational cards/recovery selected the historical package table without compatibility filtering.

The CURRENT slot is now separate and created under an exact account/product/variant/SKU advisory lock. A security-invoker view exposes compatible packages to operational selectors. The base table remains the authority for historical identity, audit, deduplication and relists. No rows, receipts or lineage are deleted. Legacy packages excluded from this view are logically LEGACY_SUPERSEDED_FOR_NEW_PUBLICATION, without rewriting their historical evidence.

## Contract inventory

Every class below remains AUDIT_REQUIRED. Identity/lineage references remain readable; authority compatibility is checked at consumption, not inferred from age or a READY string.

| Class / contract | CURRENT compatibility and runtime authority | Legacy treatment / lineage |
|---|---|---|
| Package: SELLER_OS_CURRENT_PUBLICATION_FACTORY_V1 | Exact marker/account/package; certification uses existing CURRENT package hash/generation gate | Prior opportunity slot excluded from new selection; full history retained |
| Existing certified revision: SELLER_OS_PACKAGE_PREVIEW_REVISION_V1 | Existing compatible CURRENT revision preserved; exact content/hash checked by its reader | Older revisions remain immutable history |
| Keyword: PRODUCT_RESEARCH_KEYWORD_INTELLIGENCE_V2_1 | Current-input/transport/exact identity/accepted semantic decision checks retained | No title/term fallback from package or older keyword versions |
| Product Truth: SELLER_OS_LUNA_EXACT_PRODUCT_TRUTH_V1 | Exact canonical opportunity authority; fallback package must be CURRENT | Historical package snapshot cannot become new supplier fact; identities retained |
| Category / categoryResolverV1 | New package-bound official resolver; no prior other-package fallback | Category history remains audit/learning, not direct new authority |
| Shipping: LUNA_PORTEX_SHIPPING_AUTHORITY | Exact product/variant/SKU/destination/quantity/currency + current expiry validated by existing reader | Historical package shipping/profit estimates stripped; expired quotes rejected |
| Fees: SELLER_OS_EBAY_FEE_AUTHORITY_V1 | Existing exact CURRENT package binding and pre-sale/post-order classification | Prior package fee receipts are not copied |
| Preview: SELLER_OS_PACKAGE_PREVIEW_REVISION_V1 | Content from certified snapshot; configuration supplied by CURRENT policy/condition authority | Old preview only prior-hash/execution lineage; no payload spread |
| Approval / QUICK_PICK_REMOTE_OWNER_REVIEW_V1 | New approval route requires CURRENT preparation | Old owner-review and one-click mode cannot authorize new preparation |
| Execution / CURRENT publication contract | Exact publication/package/preview/account/SKU/Offer, idempotency and evidence checks retained | Approval/execution/ACK never copied to new package |
| Offer identity / existing unpublished preparation | All publication identities still participate in collision checks; existing Offer requires strict CURRENT readback/reconciliation | Never create a replacement Offer to hide an old incompatible Offer |
| Publication intent/idempotency | Existing intent and write/readback evidence preserved | Conflict blocks new creation; no consumed key or new intent in canaries |
| READY_TO_PUBLISH / EXECUTOR_CLAIMABLE | Existing CURRENT gates; legacy market-test readiness cannot authorize CURRENT | New draft projects missing CURRENT authorities, not old dependent errors |
| Stock / exposure | Existing exact availability + freshness and separate exposure policy required | No numeric supplier quantity or old exposure inferred |

Eight identified preparation-authority entry edges are removed: opportunity-slot reuse, historical rematerialization, other-package category fallback, historical Truth package fallback, historical Preview payload spread, CURRENT-to-legacy approval fallthrough, legacy one-click approval, and historical operational selection/recovery. This is a count of audited edges, not rows or a claim that all historical code has been deleted.

## Preserved paths

LIVE optimization, manual/official linkage, audit, relist history, Offer collision checks and idempotency continue reading the base historical store. The relist resolver excludes a new unpublished CURRENT package from competing predecessor evidence; a published package remains attributable by certified predecessor package identity. Tests exercise the real relist function with both generations present.

## Migration attestation

Only 20260911200135_current_publication_factory_isolation.sql is required. It removes one old uniqueness constraint, replaces it with separate legacy/CURRENT unique slots, adds a service-role-only intake RPC and read view, and narrows one relist lineage predicate. Physical audit found no foreign key referencing opportunity_id uniqueness; package-ID foreign keys remain untouched. No table/column drops, no row rewrite, no account default, no history replay, no marketplace operations. RLS is preserved and the view uses security_invoker.

## Certification limits

Clean intake is not publication readiness. Required CURRENT Keyword, Shipping, Fee, exposure, Preview and execution authorities must actually exist. The new marker is never a substitute for these authorities. No success is inferred from a historical package's readiness=100. The physical report must distinguish clean same-link/greenfield admission from complete READY_TO_PUBLISH; pending acquisition or orchestration is reported as REAL_PRODUCT_OR_EBAY_BLOCKER or SELLER_OS_CURRENT_FACTORY_DEFECT, never repaired by copying legacy payloads.
