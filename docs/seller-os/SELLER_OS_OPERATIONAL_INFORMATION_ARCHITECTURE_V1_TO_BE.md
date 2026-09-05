# Seller OS Operational Information Architecture V1 — TO-BE

## Operating contract

Seller OS has one navigation catalog, one owner-facing operational snapshot and
one durable integrity auditor. Navigation does not own executors. Hiding or
moving a route never disables its scheduler, API, lease, extension bridge or
durable receipt.

Publisher remains `FAILED_PHYSICAL_ACCEPTANCE`. Prepared packages are visible,
but `ACTIONABLE_READY_COUNT=0` until a later physical Publisher acceptance.
This work order does not publish, create/recreate offers, choose categories or
change Product Truth.

## Canonical navigation and capability ownership

| TIER | AREA | CANONICAL ENTRY | CHILDREN / CAPABILITIES | RETAINED COMPATIBILITY ROUTES |
|---|---|---|---|---|
| Primary | Inicio | `/admin` | Próxima acción, Publicación, Negocio LIVE, Mayel, compact operational state | `/admin/ebay-seller-os` |
| Primary | Publicar | `/admin/ebay/quick-pick` | Preparar productos, Listos, Datos por confirmar, Publicación por lote, Historial | `/admin/ebay/listing-workspace`, `/admin/ebay/listings/register` |
| Primary | Oportunidades | `/admin/ebay/opportunity-queue/research` | Radar, Research, Matches Luna | `/admin/ebay/mobile-review`, `/admin/ebay/opportunity-queue` |
| Primary | Listings LIVE | `/admin/ebay/monitor` | Portfolio, Monitoreo, Listing Quality | `/admin/ebay/listing-optimization`, `/admin/ebay/seller-performance` |
| Primary | Ventas | `/admin/ebay/sales` | Órdenes, Fulfillment, Tracking | embedded fulfillment projection in Mobile Review |
| Primary | Postventa | `/admin/ebay/post-sale` | Comunicación, Alertas, Excepciones, Casos owner, Historial | prior compact Home projection |
| Primary | Mayel | `/admin/ebay/mayel` | Trabajo delegado, Imágenes, Resultados | remote operator route and Mayel APIs |
| System | StockGuard | `/admin/ebay/stock-guard` | Current LIVE stock/linkage authority | `/admin/ebay/luna-supplier-linkage-review` |
| System | Administración | `/admin/ebay/operational-readiness` | Cuenta y policies, Extensiones, Runtime, Diagnóstico | Luna capture/session/shipping routes, Decisions, Learning, Copilot, Strategic Review |
| System | Experimentos | `/admin/ebay/experiments` | Guarded experiment preparation and evidence | experiment preparation in Listing Optimization |

Quick Pick is no longer an independent primary application. Its route and
contracts remain intact and its canonical function is exposed as
`Publicar → Preparar productos`.

## Common operational authority

`SELLER_OS_OPERATIONAL_SNAPSHOT_V1` is the server-owned Home projection. It
reads bounded authoritative sources and emits nullable counts; failed or absent
authority emits `null`, never a fabricated zero.

```text
durable Quick Pick + listing packages
official Current LIVE receipt + commercial readers
official Orders + fulfillment receipts
Mayel durable task queue
Product Research capture/query-plan receipts
Luna Shipping eligible-job read + durable runtime trace
                           │
                           ▼
SELLER_OS_OPERATIONAL_SNAPSHOT_V1
                           │
             ┌─────────────┴─────────────┐
             ▼                           ▼
        Owner Home              Integrity Auditor
```

Allowed capability states are only `OPERANDO`, `SIN_TRABAJO`, `RECUPERANDO`,
`BLOQUEADO` and `DESCONOCIDO`. `CONNECTED` is evidence about a bridge, not
worker capability. `SIN_TRABAJO` requires an authoritative eligible-pending
count of exactly zero.

## Runtime Operational Integrity Auditor

`SELLER_OS_OPERATIONAL_INTEGRITY_AUDITOR_V1` evaluates:

- authoritative ready count = read-model ready count = visible ready count;
- visible ready = actionable ready + explicitly classified blockers;
- unknown numeric authority is never presented as zero;
- a connected worker is never presented capable without queue authority and
  current capability evidence;
- UI ready requires either a real action or an explicit blocker;
- internal pass never becomes physical pass;
- UI ready never becomes publishable by implication;
- HTTP success never becomes marketplace success without the official result;
- owner success requires both a durable receipt and official readback;
- GET/render/refresh business continuation count is zero.

Every audit persists a bounded receipt in
`seller_os_operational_integrity_runs_v1`. Every violation is learned at the
mechanism level in `seller_os_operational_learning_ledger_v1` with:

`failureClass`, `invariantCode`, `mechanismVersion`, `evidenceFingerprint`,
`recoveryPolicyVersion`, `retrySafety`, `recoveryOutcome`, `regressionGuard`,
`observedAt`, and `resolvedAt`.

The ledger stores no Product Truth, product memory, owner authorization or
marketplace mutation authority.

## Recovery policy

| RECOVERY_CLASS | PERMITTED ACTION | FORBIDDEN ACTION |
|---|---|---|
| `AUTO_RECOVERABLE + SAFE_READ_ONLY_RECONCILIATION` | atomic lease, one fresh authority read, invariant re-evaluation, durable close/escalation | Product Truth changes, publication, offer writes |
| `AUTO_RECOVERABLE + SAFE_IDEMPOTENT_RUNTIME_RESUME` | only an already-declared shared runtime resume contract | one-off batch/SKU continuation |
| `OWNER_COMMERCIAL` | present the legitimate commercial decision | technical recovery click |
| `ENGINEERING_REQUIRED` | fail closed with durable evidence | automatic business write |
| `OBSERVATION_ONLY` | retain evidence | claim or mutate anything |

Recovery claims are single-flight and lease-bound. A re-read that remains
incoherent closes the attempt as `STILL_VIOLATED`; it does not retry a product
or compensate by changing commercial facts.

## POST-only executor boundary

All `/api/cron/*` execution handlers are POST-only. Their GET handlers return
`405 POST_REQUIRED_FOR_RUNTIME_EXECUTION` and invoke no executor. Vercel Cron
entries were removed because Vercel invokes cron paths with GET. Existing
durable schedules move to Supabase `pg_cron + pg_net.http_post` and reuse the
existing Vault secret references. The local Seller OS recovery service also
uses POST.

The scheduler records `POST_QUEUED`; this is transport evidence only and never
means commercial or marketplace success.

The global `/admin` shell is presentation-only and never mounts Luna Shipping's
auto-acquisition executor. The existing Luna control plane remains intact on its
dedicated route; automatic acquisition is enabled only in the extension-owned
`bridgeOnly=1` context. Opening or refreshing the human diagnostics view cannot
claim a Shipping job.

## Role and owner burden boundaries

- Owner sees attention, legitimate commercial decisions and explicit
  blockers. No refresh or recovery CTA is required to run a worker.
- Mayel has an independent route and only explicitly acquires work inside the
  existing delegation. Merely rendering Mayel performs no work acquisition.
- Technical IDs, hashes, traces, versions and scheduler details are confined to
  Administración.
- `OWNER_PRODUCT_BY_PRODUCT_TESTING_AS_DIAGNOSTIC=FORBIDDEN`.

## Acceptance evidence

The release can be marked `PASS=true` only after:

1. schema migrations are applied and RLS/ACL checks pass;
2. the deployed desktop and mobile navigation expose every canonical area;
3. Inicio renders from the common snapshot and preserves unknown values;
4. dedicated Postventa, Ventas, Mayel and Listing Quality routes load;
5. legacy/hidden routes still resolve and extension endpoints still respond;
6. every execution GET physically returns 405 with zero executor invocation;
7. a runtime POST authorization preflight proves the new boundary without
   operating a product or marketplace;
8. the durable auditor writes/readbacks a receipt through its normal scheduler;
9. Publisher remains `FAILED_PHYSICAL_ACCEPTANCE` with no product canary;
10. mobile and desktop physical browser checks pass.

Screenshots and unit tests alone do not satisfy this acceptance.
