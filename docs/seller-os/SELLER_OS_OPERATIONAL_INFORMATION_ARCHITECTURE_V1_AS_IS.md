# Seller OS Operational Information Architecture V1 — AS-IS

Observed from the repository on 2026-09-05 before changing navigation. This
inventory describes UI entry points; hiding an entry point does not authorize
removing its route, API, scheduler, extension bridge, lease, or worker.

## Route and capability inventory

| ROUTE | CAPABILITY | AUTHORITATIVE_DATA_SOURCE | MUTATING_OR_READ_ONLY | RUNTIME_DEPENDENCY | ROLE | CURRENT_ENTRY_POINTS | DUPLICATE_ENTRY_POINTS | CAN_BE_HIDDEN_WITHOUT_STOPPING_RUNTIME |
|---|---|---|---|---|---|---|---|---|
| `/admin` | Inicio / Hoy; inline Quick Pick; ready review; LIVE summary; Postventa summary; Listing Quality import; technical tools | `commercial-monitor?dashboardHealthOnly=1`, bounded Luna queue projection, owner runtime provider | `HYBRID` | Commercial monitor readers, Quick Pick, Luna Shipping extension bridge | Owner admin; remote operator is routed to its delegated surface | Login return, logo, desktop/mobile Hoy | `/admin/ebay-seller-os`; Quick Pick and owner review duplicate dedicated pages | `NO` — canonical shell and session boundary |
| `/admin/ebay-seller-os` | Legacy Seller OS hub and route directory | Static route catalog plus disaster-recovery read model | `READ_ONLY_PRESENTATION` | None for navigation; linked capabilities retain their own runtimes | Owner admin | Home technical tools; old backlinks | `/admin` | `YES` — route must remain as a compatibility entry |
| `/admin/ebay/quick-pick` | Luna intake, durable preparation stages, required-fact review | `/api/admin/ebay/luna-quick-pick`; `ebay_luna_opportunity_queue`; `ebay_listing_packages`; `ebay_seller_automation_runs` | `HYBRID` | Quick Pick recovery, category resolver, Luna Shipping jobs, Radar enrichment | Owner admin | Primary desktop/mobile nav; Home inline Quick Pick; old hubs | `/admin` inline intake and cards; listing workspace handoff | `YES` — runtime is API/scheduler/extension based, not route-lifetime based |
| `/admin/ebay/listing-workspace` | Publisher preparation, package review, offer lifecycle and LIVE reconciliation | Command Center, listing package/draft services, official eBay readback | `HYBRID_MARKETPLACE_CAPABLE` | Publisher runtime and official eBay APIs | Owner admin only for commercial authorizations | Primary Listings nav; ready-card handoff; hubs; register flow | Home inline owner review; `/admin/ebay/mobile-review`; register route | `NO` while it is the canonical Publisher surface; Publisher remains `FAILED_PHYSICAL_ACCEPTANCE` |
| `/admin/ebay/listings/register` | Link/import an existing LIVE listing to the canonical registry | `/api/admin/ebay/listings/register`; official eBay read; Luna product import | `HYBRID_INTERNAL` | Manual listing domain, registry and supplier linkage | Owner admin | System/owner tools; StockGuard exceptions; workspace | StockGuard linkage review; mobile review intake | `YES` — APIs and reconciliation workers are independent |
| `/admin/ebay/opportunity-queue/research` | Market/Product Research query workspace | `/api/admin/ebay/market-research`; official/read-only market evidence | `HYBRID_INTERNAL` | eBay research readers and bounded evidence persistence | Owner admin | Primary Oportunidades link; hubs | Mobile review research; browser research capture | `NO` until a canonical Research replacement owns the capability |
| `/admin/ebay/opportunity-queue` | Legacy Luna opportunity scan queue and recovery controls | `/api/admin/ebay/luna-opportunity-queue`; scan tasks/runs/queue | `HYBRID_INTERNAL` | Luna scan runtime, leases and read-rate coordinator | Owner admin | Technical/legacy list; register error fallback | Radar/Research surfaces; Home Radar summary | `YES` — scheduler and queue do not depend on this page |
| `/admin/ebay/mobile-review` | Opportunity command center plus LIVE/fulfillment panels | Command Center, keyword demand, winner evidence, commercial monitor | `HYBRID_INTERNAL` | Research, Listing AI, fulfillment and monitor services | Owner admin | Hubs; workspace back links | Research route; listing workspace; monitor; embedded fulfillment | `YES` after canonical owners expose every retained capability |
| `/admin/ebay/mobile-review/product-research-capture` | Product Research browser-extension control/bridge | Product research capture, query plan and identity reconciliation APIs | `HYBRID_INTERNAL` | Product Research Chrome extension and capture receipts | Owner admin / extension | Legacy technical list; extension workflow | Research page and mobile review | `YES` — extension background runtime calls APIs directly |
| `/admin/ebay/monitor` | Official/current LIVE portfolio and commercial monitoring | `/api/admin/ebay/monitor`; registry; eBay official reads; durable snapshots | `READ_ONLY` | Commercial monitor and StockGuard schedulers | Owner admin; scoped remote LIVE operator has a separate projection | Hubs; Home LIVE CTA; StockGuard backlinks | `/admin/ebay/listing-optimization`; mobile review LIVE panels | `NO` until canonical Listings LIVE → Monitoreo owns it |
| `/admin/ebay/listing-optimization` | Read-only LIVE optimization command center and experiment preparation | `/api/admin/ebay/strategic-review`; LIVE/analytics/quality/visual evidence | `HYBRID_INTERNAL` | Strategic read model; experiment preparation persistence | Owner admin | Hubs; Listings links | Monitor, strategic review, experiments | `YES` after canonical Listings LIVE/Experiments ownership is visible |
| `/admin/ebay/seller-performance` | Category/listing performance learning | `/api/admin/ebay/seller-performance`; analytics and category learning | `READ_ONLY` | Seller analytics reader and performance-learning scheduler | Owner admin | Owner tools; old hubs | Monitor analytics; Learning | `YES` — learning runtime is scheduler based |
| `EMBEDDED:/admin#listing-quality` | Listing Quality report freshness/import and portfolio signals | `/api/admin/ebay/listing-quality-report`; report imports/signals; official current LIVE set | `HYBRID_INTERNAL` | Owner report import; integrity reconciliation | Owner admin | Home below main dashboard | Listing optimization quality evidence; remote LIVE surface | `YES` only after a dedicated Listing Quality entry exists |
| `EMBEDDED:/admin#remote-live/visual` | Mayel delegated visual work, outputs and owner review | `/api/admin/ebay/mayel-visual-workstation`; Mayel visual tasks/assets/manifests/executions | `HYBRID_INTERNAL_AND_OWNER_GATED_MARKETPLACE` | Mayel durable workstation and delegated role | Mayel remote operator; owner admin for approval | Collapsed Remote LIVE area on Home | Strategic review visual evidence; remote operator VISUAL tab | `YES` only after Mayel receives an independent canonical entry; runtime/API remain active |
| `EMBEDDED:/admin/ebay/mobile-review#fulfillment` | Orders requiring purchase confirmation, tracking and fulfillment follow-up | `/api/admin/marketplace/fulfillment/tasks`; official order and fulfillment receipts | `HYBRID_OWNER_GATED` | Fulfillment reconciler/submitter and official eBay order reader | Owner admin | Mobile review panel; legacy hub Operación | Home Orders/Postventa summary | `YES` only after Ventas dedicated entries exist |
| `EMBEDDED:/admin#postventa` | Sale detection, owner WhatsApp, buyer thank-you observability | Commercial dashboard `postSale` projection; official orders; delivery receipts | `READ_ONLY_PRESENTATION` | Commercial alert dispatcher and buyer-message runtime | Owner admin | Home compact system card | Fulfillment panel; commercial monitor | `YES` only after Postventa receives a visible canonical entry |
| `/admin/ebay/stock-guard` | LIVE stock/linkage evidence and risk presentation | `/api/admin/ebay/monitor`; official current LIVE set; Luna linkage/jobs/observations | `READ_ONLY` | StockGuard and Luna stock worker | Owner admin | Secondary Inventory nav; Home tools; monitor | Monitor stock projection; supplier linkage review | `NO` until secondary Sistema → StockGuard points here |
| `/admin/ebay/luna-supplier-linkage-review` | Exact eBay → Luna linkage exception review | Linkage decision repository/control plane | `HYBRID_INTERNAL` | Linkage reconciliation and stock capture | Owner admin | StockGuard exceptions; technical tools | Register listing; Luna Capture | `YES` — runtime and decisions persist independently |
| `/admin/ebay/luna-shipping-capture` | Luna Shipping extension binding, worker status, claims and diagnostics | `/api/admin/ebay/luna-shipping-capture`; shipping jobs/claims/traces; extension storage/port | `HYBRID_INTERNAL` | Luna Shipping Chrome extension background/content runtime | Owner admin / extension | Technical tools; embedded owner runtime on every admin page | Operational Readiness extension section | `YES` — embedded provider and extension runtime must remain mounted/active |
| `/admin/ebay/luna-capture` | Luna product/stock capture activation | Commercial monitor and Luna evidence APIs | `HYBRID_INTERNAL` | Luna browser capture and stock evidence runtime | Owner admin | Technical tools; Operational Readiness | StockGuard and protected session | `YES` — worker/API are independent |
| `/admin/ebay/luna-protected-session` | Owner-authenticated Luna browser session renewal | Protected-session API and durable ceremony | `HYBRID_AUTH` | Luna canonical browser worker | Owner admin | Technical tools; Operational Readiness | Luna Capture and Shipping diagnostics | `YES` — normal worker continues until explicit auth degradation |
| `/admin/ebay/experiments` | Experiment evidence and guarded experiment surface | Protected intelligence surface / strategic read model | `READ_ONLY_OR_PREPARE_ONLY` | Experiment guardian; no direct marketplace mutation from page | Owner admin | Primary nav; hubs | Listing optimization experiment preparation | `NO` as the intended secondary Sistema destination |
| `/admin/ebay/decisions` | Priorities and owner decisions | Protected intelligence surface | `READ_ONLY` | Strategic intelligence projection | Owner admin | Owner tools; hubs; deep links | Home next action; strategic review | `YES` after Inicio owns next action and exceptions |
| `/admin/ebay/learning` | Evidence-backed commercial learning | Protected intelligence surface and durable learning evidence | `READ_ONLY` | Performance/strategic learning runtimes | Owner admin | Owner tools; hubs | Seller performance; strategic review | `YES` after System diagnostics/learning ledger owns mechanism learning |
| `/admin/ebay/copilot` | Read-only assistant over canonical Seller OS evidence | `/api/admin/ebay/copilot`; canonical read-only MCP evidence | `HYBRID_CONVERSATION_NO_BUSINESS_WRITE` | Seller OS assistant/MCP runtime | Owner admin | Owner tools; contextual deep links | Decisions and strategic review | `YES` — underlying assistant runtime is independent |
| `/admin/ebay/strategic-review` | Technical strategic evidence and guarded recommendations | `/api/admin/ebay/strategic-review`; LIVE/analytics/visual evidence | `HYBRID_INTERNAL` | Strategic agent/assistant runtime | Owner admin | Owner tools; listing optimization | Decisions, Learning, listing optimization | `YES` after Diagnóstico/Experimentos own its retained capabilities |
| `/admin/ebay/operational-readiness` | Account, policies, OAuth, runtime and extension diagnostics | Operational-readiness API; official eBay account/capability reads; extension/worker receipts | `HYBRID_CONFIGURATION` | eBay, Luna, extensions and scheduler health | Owner admin | Secondary system nav; technical tools | Luna pages; seller OAuth route | `NO` until Administración subnavigation points here |
| `/admin/ebay/monitor/seller-oauth-reauth` | eBay owner OAuth repair ceremony | Seller OAuth/publication/marketing authorization ledger | `HYBRID_AUTH` | eBay OAuth callbacks and account readers | Owner admin | Operational Readiness and error CTAs | Publication OAuth start/status | `YES` — callback/authorization runtime is independent |
| `/admin/ebay/monitor/commercial-orders-oauth-start` | Internal commercial Orders OAuth browser start | Commercial Orders OAuth ceremony | `HYBRID_AUTH_INTERNAL` | OAuth callback | Owner admin, internal transition only | Internal redirect only | Seller OAuth/publication OAuth | `YES` — never a primary navigation entry |

## AS-IS findings

1. Quick Pick has three owner entry points: primary navigation, an inline Home
   application, and handoffs from Publisher/Research. Its runtime itself is
   already independent of the page and can survive navigation de-duplication.
2. Mayel, Fulfillment and Postventa are real capabilities with durable APIs and
   runtimes, but are embedded inside unrelated surfaces and have no canonical
   navigation owner.
3. Listings preparation, LIVE portfolio, monitoring and Listing Quality are
   mixed across `listing-workspace`, `mobile-review`, `monitor`, Home and
   `listing-optimization`.
4. Home performs commercial intake and authorization as well as presentation.
   It is therefore not a read-only answer to “what needs attention now?”.
5. Worker presentation vocabularies mix connection, capability, pending work
   and execution. A connected Chrome port is not sufficient worker authority.
6. Technical identifiers and legacy controls are exposed from Home even though
   their executors are page-independent.
7. Existing schedulers and extension workers use durable tables, receipts,
   claims and leases. Navigation changes must preserve them rather than create
   substitute runtimes.

## Dependencies that must survive navigation changes

- `AdminOwnerRuntimeProvider` remains mounted in the shared admin layout; it is
  the owner Chrome bridge for Luna Shipping and is not owned by a menu item.
- Quick Pick/category recovery, Radar, StockGuard, commercial monitor,
  fulfillment, Postventa and learning schedulers remain server-owned.
- Product Research and Luna Shipping extension endpoints remain stable.
- Existing route URLs remain compatibility entry points even when removed from
  primary navigation.
- Publisher remains fail-closed at `FAILED_PHYSICAL_ACCEPTANCE`; this work order
  does not publish, create offers, or request product-by-product owner tests.

