# Mayel: exact visual station and scoped promotion recovery

An active visual station now stays bound to the listing explicitly opened by the operator. Bulk selection cannot switch or unmount it. Responses and rendered tasks are filtered by that item, and late responses are discarded. The saved-image workspace rejects any response containing a different item before autosaving it.

The four Mayel actions and the Listing Quality upload control remain in place. Publication explains the three new-draft readiness categories separately from pending changes to live listings; this surface grants no publication authority. Visual prompts, hashes and executor diagnostics are collapsed under “Ver detalles”. Each asset retains its separate OWNER approval.

## 1136 physical evidence

The September 10 official GetItem read confirms six existing eBay pictures. The approved saved manifest is based on one old thumbnail and proposes two pictures. The approved asset is absent from the official gallery. Automatically executing that manifest could remove other current pictures; therefore this run leaves the durable outbox in REQUIRES_ATTENTION with zero dispatches and zero image writes. The previous failed outbox is retained.

`owner_approval_status=PENDING` is the legacy visual QA field. The independent `owner_sync_approval` is validated by `seller_os_visual_asset_owner_approved_v1`: exact asset/output generation, source and product digests, explicit OWNER confirmation and durable OWNER authority. It is valid for this asset. No legacy Phase A flag is rewritten.

Every provided image-intent manifest digest now has to match, including IMAGE_DRAFT. Current visual status is scoped to item/task/manifest and the newest matching receipt, so old attention records do not override a newer verified generation. The existing sync executor can reconcile an exactly matching ordered gallery without requiring a previous execution row; protected listing fields and current OWNER authority must also match. Unknown commits retain official-readback-before-retry behavior.

## Promotion candidate 366650054490

One targeted recovery through the existing live-shipping capture route returned Luna HTTP 429 at cart/add, with no Retry-After. This is supplier-scoped and does not imply exhausted eBay quota. No second supplier attempt is made. The existing fallback is 60 seconds when upstream provides no deadline; the economics lane retains its longer 15-minute worker backoff. The capture error now carries retryNotBefore, and normal economics retry respects the later upstream deadline. No poller, worker, account bypass or global refresh was added.

The common fee producer now reads the bounded, cached official US selling-fee-tax policy and combines it with current exact account registration evidence. Florida is outside the four states listed in that official policy; missing, stale or unsupported jurisdiction evidence stays unknown. This does not classify buyer sales tax as zero. Payout-currency proof is a pre-sale dependency, not an error requiring a future order. Official contingent rate limits remain separate from monetary upper bounds.

Sources: [eBay tax on selling fees](https://www.ebay.com/help/fees-billing/sell-fees-payments/payments-taxes-import-charges?id=4121) and [Payments Terms](https://pages.ebay.com/payment/2.0/terms.html). The certified base tariff and Ads contract were not re-researched.

The saved OWNER other-variable-cost policy is reported as present independently of whether shipping and full fees are proven. Missing buyer/order fee bounds still block economics and Ads eligibility. No Ads request, Ads write or publication write is authorized by this change.

## Validation and operational boundary

Directed tests exercise approval authority, stale manifests, official image readback, already-applied zero-write reconciliation, one dispatch, bulk/item scoping, friendly states, publication/live-sync separation, Quality discoverability, 429 retry metadata, fee classifications, unknown costs, safe ceilings and the OWNER stop. Existing local-first, six-asset approval and unknown-commit tests remain required. The full certification receipt records suite, typecheck, lint, build and audit against the final committed SHA.

Deployment is limited to the dedicated Seller OS preprod project. Subsequent synchronization continues in the existing server runtime; the iPad may close after a durable receipt. Material drift requires review, not unattended mutation. Ads remains disabled pending proven economics, official listing eligibility, a reviewable preview and later explicit OWNER authorization.
