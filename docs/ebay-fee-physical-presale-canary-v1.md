# Physical pre-sale fee canary — 2026-09-09

The physical read succeeded and the existing profit guard correctly blocks promotion. A complete fee estimate and the requested automatic fee lifecycle are **not certified**. No new sale is required to demonstrate this blocked result. Implementation `370829caeb73ee11017697f128776c49db6b6626` is deployed only to dedicated preprod, deployment `dpl_9msTFK21KBicQL7vvmDBwUpLNvxi`, READY. Production was not changed.

Exactly one fee-context canary read was executed for one LIVE item. HTTP 200, trace `d9bb5bac-7609-4829-b905-fe0a744ecc1f`, official listing observed 2026-09-09T19:05:36.640Z. [Durable evidence and guard outputs](ebay-fee-physical-presale-canary-v1.json) preserve the physical response, bounded staging cost read and validation receipt. The rate simulations replay the existing production guard locally against these physical sources; they are not a claim that a new UI E2E or a deployed end-to-end reconciliation ran.

| Authority | Physical evidence |
|---|---|
| Item ID | 366650054490 |
| SKU | IMNOVAA59C2C921CDD4975ADD29540657D8A60 |
| Category | 50692 |
| Official category path | Jewelry & Watches:Fashion Jewelry:Jewelry Sets |
| Format | FixedPriceItem; no secondary category returned |
| Sale price | 18.74 USD |
| Shipping charged to buyer | 0 USD, cheapest domestic option |
| Seller product cost | 1.79 USD; fresh until 2026-09-09T19:37:34.154Z |
| Seller Shipping cost | 6.99 USD; fresh until 2026-09-09T23:40:47.783Z |
| Subscription | NO_STORE, independently established by official GetUser.StoreOwner=false |
| Seller status | ABOVE_STANDARD, CURRENT PROGRAM_US, evaluation month 2026-08 |
| Service metrics | Only category 26395 returned NOT_APPLICABLE; not applied to 50692 |
| Owner other-variable-cost policy | Explicit zero retained; application remains conditional on proven product, Shipping and fees |

## Applicable fee policy and missing amounts

[GetItem CategoryName](https://developer.ebay.com/devzone/xml/docs/Reference/ebay/types/CategoryType.html) is the official fully qualified path. It now binds the current item to the jewelry rule, rather than classifying it by title or a past sale. The [official fee schedule](https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822) supplies the category tiers and per-order charge. Source snapshot `SELLER_OS_EBAY_BASIC_FEE_SOURCE_2026_09_09_V1` was verified at 2026-09-09T18:59:52Z. It has a local 24-hour observation-coverage limit. The source did not supply a legal effective date; none was invented. Automatic tariff snapshot refresh has not been certified.

| Required component | Result | Amount USD |
|---|---|---:|
| FINAL_VALUE_PERCENT | Jewelry whole-amount tiers: 15% through 5,000, 9% above; final basis unresolved | unknown |
| PER_ORDER | Single-order scenario, known subtotal above 10 | 0.40 |
| SELLER_PERFORMANCE | No Below Standard surcharge under the returned current profile | 0 |
| SERVICE_METRICS | Applicable category status unresolved | unknown |
| INTERNATIONAL | Buyer registration/delivery and shipping-program applicability unresolved | unknown |
| CURRENCY_CONVERSION | Applicable transaction/payout conversion unresolved | unknown |
| REGULATORY_OPERATING | Explicit applicability authority not bound | unknown |
| TAX_ON_FEES | Applicable tax on seller fees not demonstrated | unknown |

Six of the eight required monetary components remain unknown. Knowing a percentage does not establish its monetary amount. Buyer sales tax differs from tax on seller fees. The historical bag sale is retained only as an observed 8.22 reconciliation; it is not linked to this jewelry item.

`KNOWN_PRE_SALE_BASIS=18.74 USD` contains sale price plus proven buyer shipping only. Handling is unresolved by this read. Buyer sales tax and cross-border/conversion applicability depend on an order scenario. No sufficient official upper bound was demonstrated by the evidence collected. This does not assert that no such bound could ever be established.

Therefore `FEE_ESTIMATE_MODE=UNBOUNDED_UNTIL_ORDER`, `PROMOTION_ALLOWED=false` and `REASON=FEE_BASIS_BUYER_DEPENDENT_UNBOUNDED`. Profit, margin and safe ad ceiling remain null. This is a valid protected outcome, not a request to wait for a new sale.

## Existing guard, using physical evidence

The test policy uses a minimum profit of 8 USD, minimum margin of 15%, NOW and an explicit America/Guatemala timezone. These are canary parameters, not a saved global policy. Each run fixes its requested minimum and maximum rate to 3, 4 or 5 respectively.

| Requested rate | Ad cost | Profit after Ads | Margin after Ads | Safe | Guard |
|---|---|---|---|---|---|
| 3% | unknown | unknown | unknown | false | BLOCKED_EVIDENCE |
| 4% | unknown | unknown | unknown | false | BLOCKED_EVIDENCE |
| 5% | unknown | unknown | unknown | false | BLOCKED_EVIDENCE |

These false values mean not authorized/proven safe, not a finding that the listing is necessarily unprofitable.

## Automation audit — remaining implementation gaps

1. The new resolver is consumed on normal Mayel reads when durable `feeResolutionInputsV1` exists. Updates to that evidence re-evaluate without a new poller or a legacy fallback. This is a consumer path, not a certified complete producer.
2. The canary's existing `EXPECTED_EBAY_FEE` row has no such input bundle. The existing economic refresh writer still calls the prior one-category base model. Consequently `NEW_LISTING_FEE_RESOLUTION_AUTOMATIC=false` for the complete new lifecycle.
3. The existing pre-sale economics module explicitly returns `realizedFeeReconciliation.status=NOT_IMPLEMENTED`. No official transaction-fee ingestion, exact order-to-estimate pairing and durable delta were demonstrated. Consequently `POST_SALE_RECONCILIATION_AUTOMATIC=false` and `CODEX_RUNTIME_DEPENDENCY=NOT_CERTIFIED` for the requested lifecycle.

These are separate from the valid UNBOUNDED promotion block. Waiting for a sale will not fill the missing integrations. Next work must connect the bounded existing refresh path to the resolver and add an official post-sale reconciliation handoff with exact account/item/order/scenario binding, while leaving unbounded listings protected. A later real sale can then supply actual amounts automatically. The prior fee resolver and certified Shipping/Keyword/Quality/Mayel UI were not reimplemented for this physical canary.

## Validation

379/379 full-suite files, typecheck, lint, build, operational audit and targeted runtime security PASS on implementation `370829caeb73ee11017697f128776c49db6b6626`. Completed 2026-09-09T19:05:03.875Z. New regressions: 0. The canary performed no database, marketplace or Ads writes. No Shipping recapture, publication, OpenAI credential access, new poller or new background worker occurred.

```text
STATUS=PHYSICAL_CANARY_PROTECTED_AUTOMATION_PENDING
IMPLEMENTATION_SHA=370829caeb73ee11017697f128776c49db6b6626
CANARY_ITEM_ID=366650054490
CATEGORY_ID=50692
CATEGORY_PATH=Jewelry & Watches:Fashion Jewelry:Jewelry Sets
FEE_ESTIMATE_MODE=UNBOUNDED_UNTIL_ORDER
KNOWN_PRE_SALE_BASIS=18.74_USD_PARTIAL
BUYER_DEPENDENT_COMPONENTS=BUYER_TAX,INTERNATIONAL_APPLICABILITY,CURRENCY_CONVERSION_APPLICABILITY
BUYER_DEPENDENT_BASIS_BOUNDED=false
FEE_COMPONENTS=SEE_COMPONENT_TABLE
EBAY_PRE_SALE_FEE_ESTIMATE=UNPROVEN
UNKNOWN_MATERIAL_FEE_COMPONENT_COUNT=6
PROFIT_BEFORE_ADS=UNPROVEN
MARGIN_BEFORE_ADS=UNPROVEN
MAX_SAFE_AD_RATE_PCT=UNPROVEN
AD_3_PERCENT_SAFE=false
AD_4_PERCENT_SAFE=false
AD_5_PERCENT_SAFE=false
NEW_LISTING_FEE_RESOLUTION_AUTOMATIC=false
POST_SALE_RECONCILIATION_AUTOMATIC=false
CODEX_RUNTIME_DEPENDENCY=NOT_CERTIFIED
ASSISTANT_CLOSEOUT=false
NEXT_ACTION=CONNECT_BOUNDED_FEE_PRODUCER_AND_OFFICIAL_POST_SALE_RECONCILIATION_PRESERVING_UNBOUNDED_GUARD
```

## Para Mayel

En **Impulsar ventas**, Mayel sólo puede permitir un porcentaje cuando haya datos suficientes para proteger tu ganancia. Si todavía falta información de comisiones, deja ese producto sin publicidad. No significa que el producto sea malo: significa que aún no puede confirmar cuánto te quedaría.

En esta revisión no se pagó publicidad ni se cambió ningún listing. Tienes el botón **Ayuda / Manual** dentro de [Mayel](https://imnova-seller-os-preprod.vercel.app/admin), y también el [manual en PDF](https://imnova-seller-os-preprod.vercel.app/manual-mayel-menu-v1.pdf).
