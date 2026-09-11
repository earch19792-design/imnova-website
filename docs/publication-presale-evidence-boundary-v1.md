# Prepublication evidence boundary V1

This changes publication readiness, not publication authorization or Ads safety.
A current package must retain exact identity, inventory/exposure, Product Truth,
shipping, Preview and current non-LIVE Offer receipts. No historical ACK suffices.

Official authorities checked 2026-09-11:

- https://developer.ebay.com/api-docs/sell/static/seller-accounts/tax-tables.html
  eBay determines US buyer sales tax at checkout using the buyer's destination.
- https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822
  Sales tax contributes to the final-value fee basis. It is not seller revenue
  or an expense itself. No nationwide monetary tax ceiling is established here.
  Current category tariffs remain authoritative; service-metric and international
  rate maxima can reserve cost on the known basis without pricing unknown tax.
- https://developer.ebay.com/api-docs/sell/static/inventory/publishing-offers.html
  Required fields can be accepted by createOffer and fail on publishOffer.
  Inventory item/Offer readback and getListingFees are not a full publish dry run.

Therefore the certified prepublication result explicitly distinguishes official
CURRENT reads, current fee request, local required-payload/aspect validation and
publish-time-only validation. EBAY_PREVALIDATION_PASS remains false: no complete
official dry run was performed. The next authorized physical publication canary
must handle publish errors and unknown commit with official readback, not retry.

Fee structure readiness requires proven current category/account policies and
known monetary costs. Buyer-tax fee effect is CONTINGENT_POST_ORDER with null
amount and mandatory reconciliation. Missing known costs or rates still block.
Service applicability is not inferred from an unrelated category; its documented
maximum is reserved on the known basis. International applicability remains
contingent with a separate known-basis reserve. The tax-dependent part of those
charges is also contingent. A positive pre-sale contribution is not an absolute
profit guarantee. Ads still requires its existing complete monetary bound.

The versioned proof lives in existing publicationPreparationV1 metadata. It is
bound to current publication/package/account/SKU/Offer/execution/generation/hash,
expires, and does not mutate immutable package/Preview or consume publish intent.
The normal preparation path records it; no new poller or worker is introduced.
