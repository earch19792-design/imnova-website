# Economics closeout during eBay quota hold

Scope: dedicated Seller OS preprod. Baseline `50cb2f2307b401099508a4fb89d70af747afaaeb`, 393 passing suite files. No eBay request, Ads write, publication, image action, or production change is part of this closeout. The existing Ads contract is reused without new research.

The service-only Ads inputs RPC supplied all 23 last-certified listings. [The saved audit](ebay-quota-hold-economics-evidence-v1.json) contains their individual reasons, null-safe previews and overlapping blocker counts. None currently proves economics. A reset time alone does not prove recovered quota, current inventory, fresh costs or safe promotion economics.

| Saved evidence blocker | Listings |
| --- | ---: |
| Sale price stale | 23 |
| Product cost stale | 22 |
| Product cost lacks certified exact Luna linkage | 1 |
| Shipping stale | 18 |
| Shipping awaiting Luna authentication | 4 |
| Shipping awaiting exact current-live identity | 1 |
| Fee Authority head missing | 22 |
| Official category fee policy not certified in latest economic evidence | 20 |
| Legacy numeric fee cannot substitute for Fee Authority | 3 |
| Explicit OWNER other-cost policy awaiting its proven dependencies | 23 |

Listing `366650054490` has the sole Fee Authority head, still pending. Its base category policy was proven at observation time; unresolved account authority covers exact-category service metrics and tax on fees. Future-order dependencies cover buyer tax/total sale basis, international applicability and currency conversion. These are distinct dependencies, not five technical failures. The official contingent rate limits do not prove a complete monetary upper bound. No per-listing monetary repair was written.

The common changes are:

- Read latest evidence independently for each component/listing using the existing index; a stream of price snapshots cannot hide a cost observation.
- Assemble Fee Authority inputs from the current official/package handoff, with previous evidence as a fallback. A first listing needs no previous fee row. A newer incomplete handoff invalidates older success; identity/category/Store/format and official bound coverage remain mandatory. The implementation supplies no invented buyer tax or fee-tax ceiling.
- Share one Fee Authority/economics consumer across Ads, treatment previews and worker arithmetic. Fees with no lifecycle authority remain unproven. Fee evidence cannot outlive its source authority. Apply the recorded explicit other-cost policy only within its authorized scope and when its dependencies are proven; preserve an observed material nonzero cost.
- Persist normal pending fee/cost work as waiting with business dependency metadata and no technical failure class. Account/policy gaps produce `PROMOTION_BLOCKED_EVIDENCE`; order-dependent components remain `PENDING_ORDER_CONTEXT`. A complete proven bound produces `CONSERVATIVE_SAFE_BOUND`.
- Include cost, shipping, authority, profit, margin and safe ad ceiling in the treatment commercial envelope. These values are recalculated on normal reads; no Codex process or OWNER economics repair is required. Evidence acquisition or account reauthentication can still be required by the existing source authorities.
- Reconcile actual fees against the original pre-sale authority at sale time. An actual order basis outside its bound is `ORDER_OUTSIDE_PROVEN_BOUND`; a later fee revision appends evidence. Actuals never replace pre-sale authority.

`ADS_POST_SALE_REPORT_INGESTION_CONTRACT_V1` accepts a trusted server-normalized observation of an already downloaded official report. It requires exact account/item/campaign identity, report/task/revision, period, USD currency, source and metadata hashes, normalizer version and explicit per-metric availability. The service-only ledger provides idempotent receipts, conflicting-revision rejection and immutable history. Next normal Mayel Ads reads expose the latest receipt. No report task was created or downloaded during quota hold. This is an ingestion contract, not certification of a live download/metadata adapter. Actual report mapping must use the official metadata on recovery, not historical metric names. Cached official Marketing OpenAPI reviewed for the preceding certification defines report/task/metadata transport; it was not fetched again.

Report spend and attributed revenue are separate from order fees and profit. Profit after ads remains null until order costs, allocation and coverage of advertising fees are demonstrable; attribution does not establish causation. No synthetic report was inserted into the real account.

The OWNER endpoint `POST /api/admin/ebay/assistant/revenue-engine` accepts `mode=ADS_ECONOMICS_HOLD` and bounded `itemIds` for a strictly durable review. It enforces the existing authenticated OWNER, same-origin and dedicated-preprod boundary. `ADS_ACTIVATION` also returns the economics audit and resume plan, using the existing current-evidence gate for official reads.

Resume after recovery uses the existing runtime, in this exact order:

1. Refresh current official eBay evidence, preserving source quota/retry guards.
2. Refresh/resolve economics using the normal cost, shipping and fee producers.
3. Obtain official Ads listing eligibility for economically safe candidates.
4. Select exactly one safe technical TEST canary; warm metrics are not required.
5. Show the full OWNER Preview with fresh profit, margin and rate ceilings.
6. **Stop for explicit OWNER approval.** A policy draft, reset timer or successful read never authorizes spending.

Both single and multi-listing Ads write flags remain false. The canary still requires a later explicit authorization and physical official readback. The preprod migration changes only database reads and the report-observation ledger; it does not dispatch any eBay work.
