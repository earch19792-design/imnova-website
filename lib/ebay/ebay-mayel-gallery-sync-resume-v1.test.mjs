import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { mayelGallerySyncResumeV1 } from
  "../seller-os/mayel-gallery-sync-resume-v1.ts"

const digest = `sha256:${"a".repeat(64)}`
const task = { id: "task", ebay_item_id: "366574069492",
  visual_manifest_digest: digest }
const row = { id: "00000000-0000-4000-8000-000000000001",
  account_key: "account", item_id: task.ebay_item_id, kind: "IMAGE_SYNC",
  state: "PENDING_EBAY_SYNC", reason_code: "EBAY_QUOTA_EXHAUSTED",
  next_attempt_at: "2026-09-14T00:00:00Z", lease_until: null,
  dispatch_count: 0, received_at: "2026-09-13T00:00:00Z",
  intent: { requestedChanges: { taskId: task.id, manifestDigest: digest } } }

test("owner retry projects only the exact current image manifest", () => {
  const retry = mayelGallerySyncResumeV1({ rows: [
    { ...row, id: "00000000-0000-4000-8000-000000000002",
      item_id: "366574069493" },
    { ...row, id: "00000000-0000-4000-8000-000000000003",
      intent: { requestedChanges: { taskId: task.id,
        manifestDigest: `sha256:${"b".repeat(64)}` } } },
    row,
  ], task, now: "2026-09-13T12:00:00Z" })
  assert.equal(retry?.outboxId, row.id)
  assert.equal(retry?.mode, "SYNC")
  assert.equal(retry?.label, "Sincronizar imágenes ahora")
})

test("uncertain prior dispatch becomes verify-only and active leases disable the button", () => {
  const retry = mayelGallerySyncResumeV1({ rows: [{ ...row,
    state: "OFFICIAL_READBACK_REQUIRED", dispatch_count: 1,
    lease_until: "2026-09-13T12:05:00Z" }], task,
    now: "2026-09-13T12:00:00Z" })
  assert.equal(retry?.mode, "VERIFY")
  assert.equal(retry?.label, "Verificar sincronización ahora")
  assert.equal(retry?.canResume, false)
})

test("completed, unrelated and superseded work never exposes a retry", () => {
  for (const patch of [{ state: "SYNCED" }, { state: "SUPERSEDED" },
    { kind: "IMAGE_UPLOAD" }, { item_id: "other" }]) {
    assert.equal(mayelGallerySyncResumeV1({ rows: [{ ...row, ...patch }],
      task }), null)
  }
})

test("production surface exposes an owner-scoped exact retry without blind duplicate writes", () => {
  const ui = readFileSync(new URL(
    "../../app/admin/mayel-visual-workstation.tsx", import.meta.url), "utf8")
  const route = readFileSync(new URL(
    "../../app/api/admin/ebay/mayel-visual-workstation/route.ts",
    import.meta.url), "utf8")
  const runtime = readFileSync(new URL(
    "../seller-os/ipad-sync-engine-v1.ts", import.meta.url), "utf8")
  assert.match(ui, /task\.gallerySyncResume\.label/)
  assert.match(ui, /Reanudar sincronización de imágenes con eBay/)
  assert.match(route, /MAYEL_VISUAL_OWNER_AUTHORITY_REQUIRED/)
  assert.match(route, /\.eq\("kind", "IMAGE_SYNC"\)/)
  assert.match(route, /MAYEL_GALLERY_SYNC_RETRYABLE_STATES/)
  assert.match(route, /next_attempt_at: now/)
  assert.match(runtime, /if \(before\.matchesIntent\)/)
  assert.match(runtime, /if \(dispatched\)/)
  assert.match(runtime, /UNKNOWN_COMMIT_REQUIRES_REVIEW/)
})
