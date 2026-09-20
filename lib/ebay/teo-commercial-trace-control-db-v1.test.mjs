import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { PGlite } from "@electric-sql/pglite"

const migration = readFileSync(
  "supabase/migrations/20260920200313_teo_commercial_trace_control_v1.sql",
  "utf8")
const traceSchema = readFileSync(
  "supabase/migrations/20260913193000_seller_os_live_commercial_trace_v1.sql",
  "utf8")
const owner = "11111111-1111-4111-8111-111111111111"
const snapshot = "22222222-2222-4222-8222-222222222222"
const account = `imnova-ebay-us-primary:${"a".repeat(64)}`
const client = "9ab58207-f8b2-4c8a-9f10-047efc97b325"
const resource = "https://imnova-seller-os-preprod.vercel.app/api/seller-os/control/mcp"
const fingerprint = `sha256:${"b".repeat(64)}`
const evidenceDigest = `sha256:${"c".repeat(64)}`
const productId = "9220790976736"
const variantId = "48809590227168"
const sku = "ITEM6952"
const url = "https://lunaportex.com/products/water-filter-kit"

function receipt() {
  const required = { LUNA_PRODUCT_ID: productId, LUNA_VARIANT_ID: variantId,
    SUPPLIER_SKU: sku, TITLE: "Water filter kit", SUPPLIER_COST: 8,
    SUPPLIER_AVAILABILITY: "AVAILABLE" }
  const all = ["LUNA_PRODUCT_ID", "LUNA_VARIANT_ID", "SUPPLIER_SKU", "TITLE",
    "BRAND", "MODEL", "MATERIAL", "COLOR", "DIMENSIONS", "SIZE_SET",
    "WEIGHT", "PACKAGE_CONTENTS", "QUANTITY_OR_SET_COUNT", "FORM_FACTOR",
    "FEATURES", "INTENDED_USES", "GTIN", "MPN", "SUPPLIER_COST",
    "REGULAR_PRICE", "SALE_PRICE", "SUPPLIER_AVAILABILITY", "SUPPLIER_STOCK",
    "IMAGES", "VARIANT_OPTIONS"]
  return { contractVersion: "LUNA_FIELD_PRODUCT_TRUTH_V1",
    sourceAuthorityContract: "SELLER_OS_LUNA_EXACT_PRODUCT_TRUTH_V1",
    sourceSnapshotId: snapshot, sourceProductId: productId,
    sourceVariantId: variantId, sourceSupplierSku: sku,
    sourceCatalogFingerprint: fingerprint, evidenceDigest,
    fields: all.map((FIELD) => FIELD in required ? { FIELD,
      VALUE: required[FIELD], SEMANTIC_CLASS: "FACT", EVIDENCE_STATUS: "PROVEN",
      CONTRADICTION: false, EVIDENCE_ID: `sha256:${"d".repeat(64)}`,
      FRESH_UNTIL: ["SUPPLIER_COST", "SUPPLIER_AVAILABILITY"].includes(FIELD)
        ? "2099-01-01T00:00:00Z" : null } : { FIELD, VALUE: null,
      SEMANTIC_CLASS: "MISSING", EVIDENCE_STATUS: "MISSING",
      CONTRADICTION: false, EVIDENCE_ID: null }) }
}

async function database() {
  const db = new PGlite()
  await db.exec(`create schema auth; create role anon; create role authenticated;
    create role service_role; create table auth.users(id uuid primary key);
    create or replace function public.is_seller_os_service_role_request_v1()
    returns boolean language sql stable as 'select true';
    create table public.luna_catalog_snapshots_v1(
      snapshot_id uuid primary key,snapshot_status text not null,
      snapshot_completed_at timestamptz not null);
    create table public.luna_catalog_snapshot_variants_v1(
      snapshot_id uuid not null,product_id text not null,variant_id text not null,
      sku text not null,canonical_url text not null,source_fingerprint text not null,
      preflight_status text not null,field_truth_v1 jsonb,primary key(snapshot_id,variant_id));`)
  await db.exec(traceSchema)
  await db.exec(migration)
  await db.query("insert into auth.users values ($1)", [owner])
  await db.query("insert into public.luna_catalog_snapshots_v1 values ($1,'COMPLETE',now())", [snapshot])
  await db.query(`insert into public.luna_catalog_snapshot_variants_v1 values
    ($1,$2,$3,$4,$5,$6,'PREFLIGHT_PASS',$7)`, [snapshot, productId,
    variantId, sku, url, fingerprint, receipt()])
  await db.query("select public.authorize_seller_os_commercial_trace_v1($1,$2,$3,$4,null)",
    [account, owner, client, resource])
  return db
}

async function request(db, key = "teo.trace.6952.001", digestChar = "e",
  override = {}) {
  const values = { account, owner, client, resource, key, snapshot, productId,
    variantId, sku, url, fingerprint, evidenceDigest,
    requestDigest: `sha256:${digestChar.repeat(64)}`, ...override }
  return db.query(`select public.request_seller_os_commercial_trace_v1(
    $1,$2,$3,$4,$5,'SELLER_OS_LIVE_COMMERCIAL_TRACE_V1',$6,$7,$8,$9,$10,$11,$12,$13) result`,
  [values.account, values.owner, values.client, values.resource, values.key,
    values.snapshot, values.productId, values.variantId, values.sku, values.url,
    values.fingerprint, values.evidenceDigest, values.requestDigest])
}

test("real PostgreSQL transaction reserves exactly one idempotent Trace", async () => {
  const db = await database()
  const first = await request(db)
  const second = await request(db)
  assert.equal(first.rows[0].result.created, true)
  assert.equal(second.rows[0].result.created, false)
  assert.equal(second.rows[0].result.traceId, first.rows[0].result.traceId)
  assert.equal((await db.query("select count(*)::int count from public.seller_os_live_commercial_traces_v1")).rows[0].count, 1)
  assert.equal((await db.query("select count(*)::int count from public.seller_os_commercial_trace_command_requests_v1")).rows[0].count, 1)
  await db.close()
})

test("persistence rejects idempotency conflict and wrong bindings", async () => {
  const db = await database()
  await request(db)
  await assert.rejects(request(db, "teo.trace.6952.001", "f"),
    /TEO_COMMERCIAL_TRACE_IDEMPOTENCY_CONFLICT/)
  await assert.rejects(request(db, "teo.trace.wrong.owner", "1", {
    owner: "33333333-3333-4333-8333-333333333333" }),
  /TEO_COMMERCIAL_TRACE_CAPABILITY_DENIED/)
  await assert.rejects(request(db, "teo.trace.wrong.client", "2", {
    client: "wrong-client" }), /TEO_COMMERCIAL_TRACE_CAPABILITY_DENIED/)
  await assert.rejects(request(db, "teo.trace.wrong.sku", "3", {
    sku: "WRONG" }), /TEO_COMMERCIAL_TRACE_PRODUCT_TRUTH_DENIED/)
  assert.equal((await db.query("select count(*)::int count from public.seller_os_live_commercial_traces_v1")).rows[0].count, 1)
  await db.close()
})

test("disabled dedicated capability rejects without creating Trace", async () => {
  const db = await database()
  await db.query("select public.disable_seller_os_commercial_trace_v1($1,$2,$3,$4)",
    [account, owner, client, resource])
  await assert.rejects(request(db), /TEO_COMMERCIAL_TRACE_CAPABILITY_DENIED/)
  assert.equal((await db.query("select count(*)::int count from public.seller_os_live_commercial_traces_v1")).rows[0].count, 0)
  await db.close()
})
