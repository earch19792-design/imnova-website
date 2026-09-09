# Official fee context readback — 2026-09-09

Continuation of SELLER_OS_ASSISTANT_FINAL_ECONOMICS_METRICS_AUTO_HANDOFF_CLOSEOUT_V1. Dedicated preprod only. Fee components remain unknown until applicable official evidence is complete; this collector does not create an estimate or enable Ads.

The internal relay accepts one exact Item ID, validates the existing HMAC and environment boundary, and verifies official LIVE ownership before reading account context. It has no arbitrary endpoint, account override, database mutation or marketplace-write option. It uses the deployment’s existing secret bindings only. The public Mayel menu and MCP catalog are unchanged.

Sources:
- [Official Analytics OpenAPI](https://developer.ebay.com/api-docs/master/sell/analytics/openapi/3/sell_analytics_v1_oas3.json): CURRENT US standards, current category-level service benchmarks, OAuth scope and response schema.
- [Seller standards](https://developer.ebay.com/api-docs/sell/static/performance/seller-standards.html): current evaluation differs from projected performance.
- [Service metrics](https://developer.ebay.com/api-docs/sell/static/performance/customer-service-metric.html): a category rating may explicitly be NOT_APPLICABLE; a missing response is not that rating.
- [GetUser](https://developer.ebay.com/devzone/xml/docs/Reference/ebay/GetUser.html): registration country, requested without name, street address or phone.
- [Selling fees](https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822): total-sale fee basis includes buyer tax, handling and applicable shipping. Current account performance, category, subscription and cross-border/currency applicability must be demonstrated. Taxes on seller fees depend on the seller’s tax context.
- [Reconciliation](https://www.ebay.com/help/selling/fees-credits-invoices/reconciling-ebay-sales-transactions?id=4847): the account tax invoice identifies taxes on fees. Historical transaction fees remain historical evidence, not an unqualified current estimate.

Regression fixed: missing/malformed subscription payload previously produced NO_STORE. Only an explicit well-formed subscription result can now establish that status. HTTP 204, 429, unavailable profiles and identity mismatches fail closed. No retry loop was added.

Initial physical read at 2026-09-09T18:27:33.187Z: HTTP 200, trace 2a7bad4f-273c-447c-9e03-067ed8ce2714. Exact item 366650054490 / SKU IMNOVAA59C2C921CDD4975ADD29540657D8A60, category 50692, sale price 18.74 USD; buyer shipping is explicitly 0 USD for the cheapest domestic option. This buyer charge is different from the preserved 6.99 USD seller Shipping cost. Official registration country US. CURRENT PROGRAM_US standards are ABOVE_STANDARD, evaluation month 2026-08, evaluation date 2026-08-21T00:24:21Z. The service metric response contains only category 26395, NOT_APPLICABLE, which is not used as proof for canary category 50692.

The subscription reader returned UNPROVEN after removing the previous missing-data-to-NO_STORE conversion. A subsequent bounded read adds explicit GetUser.StoreOwner evidence, metadata-only subscription diagnostics, and up to 20 entries of the last invoice. Billing entries remain HISTORICAL_ACCOUNT_FEE_ENTRIES; absence never implies zero, and historical values do not certify future fees. Official [GetAccount documentation](https://developer.ebay.com/devzone/xml/docs/Reference/ebay/GetAccount.html) supports this bounded read and its invoice-entry fields.

## Final physical result

Implementation `926f105d68fe5d745a9895a8781a0d9ec904376c` is READY on the dedicated preprod project, deployment `dpl_9HEUstLNMvAefuQge4AJw9zGKigo`. Readback HTTP 200, trace `9ad8ea94-13be-414e-aad7-99b8e5cb32cc`, observed 2026-09-09T18:40:52.058Z. The durable projection is in `assistant-fee-context-closeout-v1-readback.json`.

GetUser explicitly returns StoreOwner=false, country US, state FL and VATStatus=NoVATTax. This independently proves NO_STORE. The subscription API returns HTTP 200, total=0 and no subscriptions array; that omission alone is not used as the proof. The parser also now follows the official [STORE_PLAN subscription enum](https://developer.ebay.com/api-docs/sell/account/types/api:SubscriptionTypeEnum); the previous STORE comparison could miss an actual subscription. Unknown kinds and incomplete responses fail closed.

GetAccount initially returned HTTP 200 with failing XML acknowledgement and error 5. After adding the XML declaration and aligning element order with the documented request, it returns a successful acknowledgement and 20 bounded invoice entries. All 20 entries are FeeInsertion, gross/net 0 USD and VATPercent 0, including canary 366650054490. The response does not establish a final-value selling fee. No claim is made about entries outside this one-page read. No further page was scanned. NoVATTax describes VAT; it is not silently broadened to every possible tax on seller fees.

## Remaining commercial boundary

The current category fee rule, applicability of category service surcharges, currency conversion, taxes on seller fees and buyer-dependent sale basis still need sufficient evidence and binding into the current PRE_SALE_FEE_ESTIMATE producer. This diagnostic is not that completed producer. A zero insertion fee is not a zero selling fee. The default eBay shipping charge to the buyer is distinct from the Luna cost paid by the seller. The previously certified 6.99 USD Shipping authority was not recaptured or modified.

Requested follow-up: availability of a recent real-sale fee breakdown from the same account, to compare fee and tax evidence. Such a record will be kept historical and assessed for comparability; it will not silently substitute for the applicable current authority. If no sale exists, the remaining path is a demonstrated pre-sale scenario or upper bound, not fabricating a sale or a fee.

## Owner-supplied sale summary — follow-up 2026-09-09

The owner supplied a Payment summary showing subtotal $52.99, buyer shipping $0.00, buyer sales tax $4.53, order total $57.52, transaction fees $8.22 and order earnings $44.77. Both arithmetic checks reconcile exactly: 52.99 + 0 + 4.53 = 57.52; 57.52 - 4.53 - 8.22 = 44.77. This is owner-supplied historical evidence, not an independently verified transaction or a current fee authority. Structured evidence is preserved in [assistant-owner-sale-fee-evidence-v1.json](assistant-owner-sale-fee-evidence-v1.json).

Account, Item ID, sale date, category, quantity and ISO currency are not present. The summary cannot be assigned to the current canary, and the aggregate 8.22 does not establish its individual fee components or an applicable future rate. The 44.77 is order earnings before unprovided product and seller shipping costs, not demonstrated contribution profit. Buyer shipping of zero is not seller shipping cost of zero; buyer sales tax is distinct from taxes on seller fees.

Next evidence needed: expanded **View more details** for the 8.22 charge, Item ID, sale date, currency and confirmation of seller account. The [official transaction-report documentation](https://www.ebay.com/help/selling/fees-credits-invoices/reconciling-ebay-sales-transactions?id=4847) identifies separate fee fields, transaction currency, date and listing identifiers for reconciliation. No runtime authority, Ads ceiling or closeout PASS was created from this summary. No runtime code changed; the prior 378/378 certification remains scoped to the previously tested implementation.

## Official schedule supplied by owner — 2026-09-09

Rechecked the owner's supplied table against the [official eBay.com fee schedule](https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822). The basic schedule has a 13.6% first tier for most categories and a 0.40 USD per-order fee above 10 USD. Buyer sales tax is included in the fee basis. Using the reported sale total gives `57.52 * 0.136 + 0.40 = 8.22272`, or 8.22 rounded to cents, exactly matching the reported aggregate charge. This supports a candidate explanation; it does not independently prove which components eBay assessed or the historical listing's category/account/date.

The same schedule assigns jewelry excluding watches a 15% rate at totals up to 5,000 USD. Therefore 13.6% cannot become a universal Seller OS rate or be copied to the jewelry canary. Current category binding, applicable adjustments and a demonstrated pre-sale basis remain required. This is source evidence observed on 2026-09-09; no unprovided effective date or eBay version number was invented. The comparison is preserved in the owner-sale evidence JSON. No runtime code or fee authority was changed, and no marketplace or Ads writes occurred.

## Identified historical order — owner follow-up

The owner subsequently supplied order `09-15056-51468`, dated 2026-08-19 at displayed time 14:56:43 (timezone unknown), status Completed, for a men's brown crossbody bag with a power bank. Its amount 52.99, fees 8.22 and net 44.77 agree with the prior Payment summary. Buyer name and username were excluded from the retained evidence. No category was inferred from the product title.

A read-only lookup of this exact order under the canonical EBAY_US account in staging returned no matching order snapshot or order lines: HTTP 201 from the database query endpoint, observed 2026-09-09T18:55:58.324Z. The lookup bounded orders to 2 rows and lines to 10, selected explicit columns and performed no global scan, database write or eBay request. This only establishes absence in these scoped staging snapshots; it does not contradict the owner's sale or establish which account processed it. Item ID, exact account/currency and the expanded transaction-fee components remain unresolved. The order date is now supplied and should not be requested again. Source and lookup details are retained in `assistant-owner-sale-fee-evidence-v1.json`.

## Validation and operator result

378/378 full-suite files, directed tests, typecheck, lint, build, operational audit and targeted runtime security PASS. Validation completed 2026-09-09T18:41:18.400Z. Zero new regressions. New pollers, background workers, global scans, exact counts and SELECT-star queries: zero. Official reads are bounded; no database or marketplace mutation is part of the collector. No publication, Ads write or OpenAI credential access occurred. Menu, manual, Quality, Keyword and Shipping workstreams remain unchanged.

Cold-start, commercial-envelope and existing handoff results from the preceding report remain separately scoped to their certified contracts. No new publication was executed. This continuation did not execute the final economic canary because its fee prerequisites remain incomplete.

```text
STATUS=BLOCKED_CURRENT_PRE_SALE_FEE_AUTHORITY
IMPLEMENTATION_SHA=926f105d68fe5d745a9895a8781a0d9ec904376c
EBAY_FEE_AUTHORITY_CERTIFIED=false
PRE_SALE_FEE_ESTIMATE_PROVEN=false
EBAY_FEES=UNPROVEN
PROFIT_BEFORE_ADS=UNPROVEN
MARGIN_BEFORE_ADS=UNPROVEN
MAX_SAFE_AD_RATE_PCT=UNPROVEN
METRICS_WARM_CANDIDATE_FOUND=false
METRICS_WARM_CANARY_PASS=NOT_APPLICABLE
METRICS_COLD_START_PASS=true
FUNNEL_DIAGNOSIS_STATUS=PENDING_REAL_SAMPLE
METRICS_AUTO_REEVALUATION_PATH_PASS=true
COMMERCIAL_ENVELOPE_PASS=PARTIAL_AUTHORITIES_PENDING
NEW_LISTING_AUTO_BOUND_TO_MAYEL=CONTRACT_PASS_PHYSICAL_NEW_PUBLICATION_NOT_EXECUTED
SHIPPING_AUTO_BOUND=true
FEE_AUTHORITY_AUTO_BOUND=false
KEYWORD_V2_1_AUTO_BOUND=true
METRICS_AUTO_ATTACHED=true
QUALITY_AUTO_ATTACHED=true
PROMOTION_SIMULATION_PASS=false
CODEX_RUNTIME_DEPENDENCY=false
OWNER_MANUAL_REPAIR_REQUIRED=false
FULL_SUITE_RESULT=378/378_PASS_TYPECHECK_LINT_BUILD_AUDIT_PASS
NEW_REGRESSION_COUNT=0
ASSISTANT_CLOSEOUT=false
SAFE_FOR_SELL_ONE_LIKE_THIS=false
SAFE_FOR_SINGLE_LISTING_PUBLICATION_CANARY=false
SAFE_FOR_EBAY_ADS_WRITE_CANARY=false
NEXT_ACTION=COMPLETE_CURRENT_FEE_APPLICABILITY_AND_PRE_SALE_BASIS_THEN_BIND_AUTHORITY_AND_RUN_ECONOMIC_CANARY
```

The false runtime/manual-repair flags above retain the prior scope: automatic consumption/binding paths. They do not mean that the fee-authority producer is complete or that no further evidence input is needed. The 3–5% example remains a simulation input, not a certified allowed rate or authorization to spend.

## Manual para Mayel

Entra en [Mayel](https://imnova-seller-os-preprod.vercel.app/admin) y abre **Ayuda / Manual**. También puedes abrir el [manual aquí](https://imnova-seller-os-preprod.vercel.app/manual-mayel-menu-v1.pdf).

- **Mejorar listings:** elige un producto y deja que Mayel revise qué puede mejorar. Mira la vista previa antes de cualquier cambio.
- **Impulsar ventas:** prepara una simulación con tus límites de ganancia. Por ahora no activa ni paga publicidad en eBay.
- **Publicar:** prepara el producto y revisa sus datos; este trabajo no publicó ningún anuncio.
- **Oportunidades:** muestra qué productos conviene revisar, reponer o dejar reunir más datos.

Si ves **Obtener más datos**, Mayel todavía no tiene suficiente información para recomendar un impulso. Si falta una comisión, no hay aún una ganancia ni un techo publicitario confirmado. **Ver detalles** es opcional; no necesitas entender los códigos técnicos para usar el menú.
