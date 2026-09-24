# EBAY_LISTING_CATEGORY_AUTHORITY_V1 (local, not deployed)

The canonical durable store is `ebay_listing_packages.package_data.categoryAuthorityV1`.
The authenticated OWNER confirms a numeric category in the Seller OS listing
workspace. `save_package` records the exact account/SKU/product/variant/category
selection with the actor and package ID. `taxonomy_preflight` re-reads the
current EBAY_US tree and exact leaf ancestry using the existing server-side
eBay application credential, then saves a digest-bound receipt through the
existing guarded package RPC. No marketplace mutation is involved.

The current receipt contains account, marketplace, SKU, product and variant,
leaf Category ID and full official path, tree ID/version, observed/fresh-until
timestamps, source selection and confirmation time, and receipt ID. The
receipt digest canonicalizes object keys so PostgreSQL `jsonb` readback cannot
invalidate it merely by reordering fields. The
previous receipt is retained in package history when a changed category
is confirmed. An unconfirmed recommendation, parent, wrong identity, changed
package category, expired ancestry, or known tree-version mismatch cannot
read back as `PROVEN`.

The existing package fee lane consumes a current PROVEN receipt automatically.
Its older exact official-ancestry path remains intact for already validated
packages. The new route `/api/admin/ebay/taxonomy-exact-leaf` is a bounded,
authenticated GET-only official Taxonomy probe; it does not establish SKU
selection on its own.

This is not a production certification. The local environment has no current
authenticated Taxonomy response for ITEM-8058, and no corresponding preprod
listing package/opportunity was found in the read-only staging lookup. The
OWNER video metadata is recorded separately; its bytes were not available for
independent hashing. A real canary and deployed guarded-save readback are
still required. External eBay editor selections without an exact official
draft readback are not automatically ingested by this local implementation;
Seller OS workspace confirmation is the normal no-screenshot path.
