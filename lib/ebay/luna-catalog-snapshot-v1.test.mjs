import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("Luna catalog snapshot is V1.3, bounded, and read-only outside catalog tables", async () => {
  const source = await readFile(new URL("luna-catalog-snapshot-v1.ts", import.meta.url), "utf8")
  assert.match(source, /LUNA_CATALOG_SNAPSHOT_IDENTITY_ENGINE_V1\s*=\s*[\s\S]*V1_3/)
  assert.match(source, /LUNA_CATALOG_SNAPSHOT_MAX_WINDOW_MS\s*=\s*5 \* 60/)
  assert.match(source, /PREFLIGHT_PASS.*SEMANTIC_IDENTITY_INCOMPLETE[\s\S]*SOURCE_IDENTITY_BLOCKED[\s\S]*CONTRADICTED/)
  assert.match(source, /UNAVAILABLE_REMOVED/)
  assert.doesNotMatch(source, /startCommercialTrace|runCommercialTrace|publisherBatch|ebayResearchGateway/i)
})

test("fresh source uses structured Shopify JSON and does not infer quantity or GTIN", async () => {
  const source = await readFile(new URL("../market-radar-lunaportex.ts", import.meta.url), "utf8")
  assert.match(source, /collections\/\$\{collection\}\/products\.json/)
  const snapshot = await readFile(new URL("luna-catalog-snapshot-v1.ts", import.meta.url), "utf8")
  assert.match(snapshot, /quantity:\s*\{\s*status:\s*"UNPROVEN"/)
  assert.match(snapshot, /barcodeGtinLimitation:.*DO_NOT_CONCLUDE_CATALOG_WIDE_ABSENCE/)
  assert.doesNotMatch(snapshot, /BARCODE_GTIN_ABSENT_CATALOG_WIDE/)
})

test("snapshot preserves supplier body evidence for canonical Product Truth materialization", async () => {
  const snapshot = await readFile(new URL("luna-catalog-snapshot-v1.ts", import.meta.url), "utf8")
  assert.match(snapshot, /body_html:\s*sourceHtml\(product\.body_html\)/)
  assert.match(snapshot, /function sourceHtml[\s\S]*replace\(\/\\u0000\/g, ""\)/)
  assert.match(snapshot, /sourceFingerprint = stableFingerprint\(fingerprintPayload\)/)
})

test("snapshot execution endpoint is protected and blocks GET", async () => {
  const route = await readFile(new URL("../../app/api/cron/luna-catalog-snapshot/route.ts", import.meta.url), "utf8")
  assert.match(route, /CRON_SECRET/)
  assert.match(route, /sellerOsPostRuntimeAuthorizedV1/)
  assert.match(route, /sellerOsPostOnlyGetResponseV1/)
  assert.match(route, /marketplaceWrites: 0/)
})

test("refresh safety is durable, fail-closed, and version-aware", async () => {
  const snapshot = await readFile(new URL("luna-catalog-snapshot-v1.ts", import.meta.url), "utf8")
  const route = await readFile(new URL("../../app/api/cron/luna-catalog-snapshot/route.ts", import.meta.url), "utf8")
  const migration = await readFile(new URL("../../supabase/migrations/20260915193000_luna_catalog_refresh_safety_v1.sql", import.meta.url), "utf8")
  assert.match(snapshot, /LUNA_CATALOG_PREFLIGHT_CONTRACT_VERSION_V1/)
  assert.match(snapshot, /p_source_fingerprint|source_fingerprint/)
  assert.match(snapshot, /previous\?\.identity_engine_version[\s\S]*previous\.preflight_contract_version/)
  assert.match(snapshot, /start_luna_catalog_snapshot_v1/)
  assert.match(snapshot, /fail_luna_catalog_snapshot_v1/)
  assert.match(route, /ALREADY_RUNNING/)
  assert.match(migration, /'PARTIAL', 'INCOMPLETE'/)
  assert.match(migration, /active_lease_expires_at/)
  assert.match(migration, /complete_luna_catalog_snapshot_v1/)
  assert.match(migration, /LUNA_CATALOG_SNAPSHOT_INTEGRITY_FAILED/)
  assert.match(migration, /snapshot_status = 'BUILDING'/)
})
