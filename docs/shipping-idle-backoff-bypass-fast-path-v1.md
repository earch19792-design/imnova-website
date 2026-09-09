# SHIPPING_IDLE_BACKOFF_BYPASS_FAST_PATH_V1

Root cause proven locally: CLIENT_TIMER_BYPASSES_BACKOFF. The existing Phase A controller stores the empty ordinal and declared duration but the pre-fix acquirePollPermit() checks only the circuit breaker, with no empty deadline. A deterministic reproduction at a frozen clock reports declaredBackoffMs=900000 and permitWithoutTimeAdvancing=true.

The sole direct RPC caller in the repository is acquireLunaChromeShippingJobsV1 in lib/ebay/ebay-luna-chrome-shipping-capture-server-v1.ts, entered by POST /api/admin/ebay/luna-shipping-capture, action resolve_jobs with no explicit candidate IDs. The route verifies the Phase A server lease before acquiring. Discovery resolves candidates before calling the RPC; an HTTP 200 is not a successful job claim. The durable standard claim rows remained COMPLETED from September 8, so these September 9 invocations did not represent new processed work.

| Caller / trigger before fix | Cadence | Backoff check used | Leader check used |
| --- | --- | --- | --- |
| Control-page acquisition timer → loadJobs(AUTO) → resolve_jobs → acquireLunaChromeShippingJobsV1 → RPC | Nominal empty tier up to 900s | Scheduling duration only; entry permit checks circuit only | Browser leader + server leader flags; server lease verify |
| Extension binding diagnostic/status/active-job messages → attemptProductionAcquisition | Event-driven, including reconnect | Cancels pending timer; no empty deadline | Same browser/server gate |
| Heartbeat grant transition false→true → acquisitionWakeRef | Heartbeat 60s; also connection/leadership events | No empty deadline | Same browser/server gate |
| Canonical binding completion and real-work completion → attemptProductionAcquisition | Event-driven | No empty deadline | Same browser/server gate |
| Extension supervisor ensureShippingWorkerControlPage | 2-minute alarm/startup/install | No direct claim; may create/reload the existing control tab | Control tab later uses same gate |
| Economic refresh runtime | Separate economic claim RPC | Does not call claim_seller_os_luna_shipping_job_v1 | Independent economic authority |
| OWNER_ADMIN shell | Presentation only for Shipping | No direct Shipping caller | N/A |

Historical window: 2026-09-09T11:19:48Z–11:34:48Z. All 19 rows below are Supabase edge logs: HTTP 200, role service_role, user-agent node, client_info supabase-js-node/2.106.1, Amazon Data Services Northern Virginia. Supabase trace_id is request_id with hyphens removed; unique span_id is included. Vercel retained matching route requests for deployment dpl_4h7RM936CCWJeo95tyNeN5S8ip77 on imnova-seller-os-preprod.vercel.app, but traceId/body were absent. Temporal matching is not an exact distributed-trace join.

Historical worker attribution is bounded by leases, not by captured RPC arguments. Lease generation 24 was observed at 11:17:31: worker ca16aa0c-8cf8-41f0-8928-47cce8913203, leader a630348e-d24d-488d-835b-4e3d382c5814, acquired 11:14:44.636168Z. Generation 25 was acquired 11:23:27.078066Z and persisted through later readbacks: worker 54d4ef45-8ad3-449b-ac2d-e69c2b4dd879, leader 78288325-247c-4a6f-94c1-3ebf89cfa34e. Because successful route acquisition requires that lease, generation 24 is consistent with rows 1–2 and generation 25 with rows 3–19; exact per-request worker/session arguments are UNAVAILABLE. There were at least two sequential worker incarnations, not proof of concurrent leaders. Historical exact tab/profile IDs and specific triggering event for each request are UNPROVEN. All rows share one RPC/code route; all belonging to one browser instance is NOT proven.

| UTC timestamp | Request ID | Span ID | Worker/session attribution | Exact event trigger |
| --- | --- | --- | --- | --- |
| 2026-09-09T11:20:17.139000Z | 01a085e5-adf3-7d5d-90a3-fb697f1342ac | 3f9df0a7ab43615b | Generation 24 consistent; not trace-joined | UNPROVEN |
| 2026-09-09T11:20:56.249000Z | 01a085e6-46b9-7a22-b377-66fde0075d1a | e463c6112f0a7ebb | Generation 24 consistent; not trace-joined | UNPROVEN |
| 2026-09-09T11:23:29.402000Z | 01a085e8-9cfa-79c9-920f-3d7572199938 | 0323065bf9a111f1 | Generation 25 consistent; not trace-joined | UNPROVEN |
| 2026-09-09T11:23:58.376000Z | 01a085e9-0e28-7c51-84e7-9f149df616d0 | f5b6fb6175dfcf9f | Generation 25 consistent; not trace-joined | UNPROVEN |
| 2026-09-09T11:24:56.189000Z | 01a085e9-effd-7aa0-8660-0a91fbe2fb54 | 97eca011cd224ea5 | Generation 25 consistent; not trace-joined | UNPROVEN |
| 2026-09-09T11:25:49.656000Z | 01a085ea-c0d8-76d7-9621-6cdccbcc17be | a8f27e69dbe628a8 | Generation 25 consistent; not trace-joined | UNPROVEN |
| 2026-09-09T11:26:19.289000Z | 01a085eb-3499-70a3-95da-19a4a7d5df78 | 5440609d56f9a805 | Generation 25 consistent; not trace-joined | UNPROVEN |
| 2026-09-09T11:26:56.566000Z | 01a085eb-c636-7085-b968-ba53632bc790 | a5ef40f85d73b6a8 | Generation 25 consistent; not trace-joined | UNPROVEN |
| 2026-09-09T11:27:26.381000Z | 01a085ec-3aad-7665-89c5-4c7741de2b1e | 53a816bd428f7e68 | Generation 25 consistent; not trace-joined | UNPROVEN |
| 2026-09-09T11:27:56.596000Z | 01a085ec-b0b4-77dd-8b89-b7217ce02a38 | 549e6a57537b0140 | Generation 25 consistent; not trace-joined | UNPROVEN |
| 2026-09-09T11:28:56.490000Z | 01a085ed-9aaa-7208-8dbf-d4966e51fc77 | 266009e9e3ecfd8c | Generation 25 consistent; not trace-joined | UNPROVEN |
| 2026-09-09T11:29:26.806000Z | 01a085ee-1116-7339-a4ef-31c926d82ec8 | 7618237d520addb9 | Generation 25 consistent; not trace-joined | UNPROVEN |
| 2026-09-09T11:29:56.599000Z | 01a085ee-8577-707b-b4ee-8ecbef09cf70 | b73e74e640f40b69 | Generation 25 consistent; not trace-joined | UNPROVEN |
| 2026-09-09T11:30:56.585000Z | 01a085ef-6fc9-7ebb-98ec-609f153cdbd7 | f17a5f80a5cdad16 | Generation 25 consistent; not trace-joined | UNPROVEN |
| 2026-09-09T11:31:26.501000Z | 01a085ef-e4a5-738f-b312-d1ac6aacb880 | 12d5569021e9fccd | Generation 25 consistent; not trace-joined | UNPROVEN |
| 2026-09-09T11:31:56.921000Z | 01a085f0-5b79-74ac-945f-85540d77237c | bab34dde914ca06f | Generation 25 consistent; not trace-joined | UNPROVEN |
| 2026-09-09T11:32:56.403000Z | 01a085f1-43d3-700e-aff8-ecf2da91d90a | 910719ff31e38789 | Generation 25 consistent; not trace-joined | UNPROVEN |
| 2026-09-09T11:33:26.789000Z | 01a085f1-ba85-74bd-9517-9e0cc8ece5fa | 675d953f62e1a3b5 | Generation 25 consistent; not trace-joined | UNPROVEN |
| 2026-09-09T11:33:56.614000Z | 01a085f2-2f06-73b0-8914-ecd39cd4b940 | e82c42e654b6beea | Generation 25 consistent; not trace-joined | UNPROVEN |

Implementation reuses createSellerOsBackgroundWorkloadControllerV1, the existing localStorage key, browser lock and server leader lease. Shipping persists an empty deadline, checks it at the acquisition entry, prevents in-flight duplicate acquisitions and retains the deadline across reload/takeover. Heartbeat uses the existing circuit-only permit and never invokes acquisition. Extension status only schedules the existing gated acquisition timer. Terminal Shipping empty tier is exactly 900 seconds (no negative jitter); earlier tiers retain contractual ±10% jitter. No new worker/poller, DB migration, cohort edit, remote fixture, Legacy Shipping recovery or Research reprocessing.

Local verification: eight requested tests plus reload persistence and the efficiency gate pass. The full suite with the existing tools/seller-os-test-module-resolution-v1.mjs resolver passes 360/360 test files; Seller OS CI guards pass. The plain suite command needs that pre-existing resolver for an unrelated extensionless cloud-relay import.

Physical post-deployment observation: PENDING.

