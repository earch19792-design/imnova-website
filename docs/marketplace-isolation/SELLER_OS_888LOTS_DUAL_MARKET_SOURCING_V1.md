# Seller OS 888 Lots Dual-Market Sourcing V1

## Objective

Evaluate an authorized 888 Lots catalog export for shared inventory that may be
sold on eBay US and Amazon US. The contract answers three questions without
buying, listing, publishing, or repricing:

1. Is the exact supplier product the exact marketplace product on each channel?
2. Is there fresh, non-zero demand on each channel?
3. What is the highest supplier unit cost that preserves at least USD 4 net on
   either channel?

## Existing authorities reused

- eBay Product Truth, `CANONICAL_OPPORTUNITY_RESULT_V2`, exact sold evidence,
  shipping, fees, Duplicate Gate, and the Commercial Golden Path.
- Amazon Catalog Items identity/ASIN evidence, the existing restriction/category/
  brand/GTIN gate, and the existing fees/profit guard.
- `market_radar_sources`, registered as inactive for `888lots`; no parallel
  supplier or opportunity tables are introduced.

The older local Amazon score models are not accepted as purchase evidence when
they substitute missing values with zero. Live or owner-authorized evidence must
preserve `UNPROVEN`, `UNAVAILABLE`, `STALE`, and an authoritative zero as distinct
states.

## Evidence sequence

1. Authorized 888 Lots export or future authorized API.
2. Exact supplier identity, condition, UPC/EAN/model, MOQ, inventory, and costs.
3. Exact eBay identity and SOLD demand through existing Seller OS authorities.
4. Exact Amazon ASIN through Catalog Items read-only evidence.
5. Amazon demand through an authorized Product Opportunity Explorer/report
   artifact. Sales rank alone can support research but does not manufacture unit
   velocity.
6. Channel-specific price, fees, fulfillment, promotion, return reserve, and
   eligibility evidence.
7. One prioritized next-best-evidence action.

## Price ceiling

For each marketplace:

`max delivered unit cost = buyer-landed sale price - marketplace fees - fulfillment - promotion - return reserve - other variable costs - USD 4`

The supplier-unit ceiling subtracts the observed inbound cost per unit. The
shared-inventory ceiling is the lower of the eBay and Amazon ceilings, so a unit
remains profitable if it must be routed to either channel.

## Conservative initial quantity

The initial policy is explicit and auditable, not market evidence:

- 14 days of coverage;
- 10% capture of the combined observed eBay + Amazon unit velocity;
- maximum 12 units;
- never above current supplier availability;
- must satisfy the supplier MOQ.

If either marketplace lacks a fresh unit-velocity authority, quantity remains
unknown rather than zero. A recommendation below MOQ remains HOLD.

## Safety boundary

The API is owner-admin and preview-only. It has no Supabase write client, supplier
purchase operation, eBay writer, Amazon writer, ASIN creation, publication, or
repricing capability. Even `READY_FOR_OWNER_BUY_REVIEW` is not purchase
authorization.

## Upstream availability

- eBay Marketplace Insights sales history is a limited/restricted capability;
  Seller OS must preserve unavailable evidence and use only its already certified
  exact SOLD paths.
- Amazon SP-API catalog, pricing, and fee operations require the relevant seller
  authorization and roles. Product Opportunity Explorer remains an owner-accessed
  Seller Central evidence source until a certified authorized ingestion path is
  available.
