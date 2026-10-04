# Seller OS Fast Listing V1

Fast Listing is a product-first entry to the existing opportunity and listing
package. It does not publish, purchase, or authorize marketplace mutations.

## Reused authorities

| Capability | Existing component |
| --- | --- |
| Luna identity and facts | `luna_catalog_snapshot_variants_v1`, `LUNA_FIELD_PRODUCT_TRUTH_V1`, `projectLunaFieldTruthV1`, canonical OWNER included-count evidence |
| Canonical product case | `ebay_luna_opportunity_queue`; resolve exact product, variant and supplier SKU before intake |
| Sold and identity matching | Product Research plan/task worker, capture extension, `classifyGoldenComparable`, governed visual comparison and observed marking authorities; visual support never proves EXACT or manufacturer brand |
| Unit and supported packs | `planGoldenPackFallbackV1`, Golden offer counts; each presentation uses its own evidence. Fast Listing limits offers to 2/3/4 and additionally accepts durable explicit OWNER reasons |
| Net economics | `listingEconomicsV1`; proven fee and shipping components, no default rates |
| Category and account fees | `readGoldenPresaleAuthorityV1`, existing category resolver, official taxonomy and fee producer |
| Shipping | Luna Shipping Capture job contract, session signatures, claim v2 and completion v1 |
| Duplicates | Existing exact Luna identity reader and official Golden duplicate authority |
| Reference listing | `classifyReferenceFieldsV1`; only structural names cross the boundary |
| Titles | Existing Product Research keyword handoff and Quick Pick review builder |
| Images | `resolveInheritedLunaSupplierImageRightsV1` and existing Mayel image workspace |
| Internal draft and final review | `ebay_listing_packages`, Quick Pick package builder and Listing Workspace |
| Recovery | Existing Quick Pick recovery cron and Product Research/Shipping leases |
| History and learning | Immutable Fast Listing events linked to canonical opportunity; existing post-sale performance, fee reconciliation and learning readers |

The additive context stores workflow preferences, confirmed field evidence and
the latest projection. It is not a second product catalog, research engine,
shipping calculator, fee calculator or publisher. Historical corrections and
recommendations are append-only. Certified plan membership is never changed.

`CONTROLLED_TEST` describes evidence quality independently of readiness.
Missing values remain null; an active listing never proves a sale. A supplier
unit can contain multiple pieces; offer count is supplier presentation count
times supplier units. Publication remains a separate explicit owner action.

Validation and the deployed five-product Pet Supplies pilot are recorded under
`/home/earch/seller-os-evidence/fast-listing-v1` with source and deployment identifiers.
