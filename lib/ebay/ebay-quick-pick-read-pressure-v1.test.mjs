import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const migration = await readFile(new URL(
  "../../supabase/migrations/20261004154744_stabilize_quick_pick_read_pressure_v1.sql",
  import.meta.url,
), "utf8")

test("Quick Pick read-pressure mitigation stays additive and reversible", () => {
  assert.match(migration,
    /create index if not exists ebay_luna_queue_updated_at_idx\s+on public\.ebay_luna_opportunity_queue\(updated_at desc\)/)

  assert.match(migration,
    /where jobname = 'seller-os-post-operational-integrity-auditor-v1'/)
  assert.match(migration,
    /cron\.alter_job\(v_job_id, schedule => '7 \* \* \* \*'\)/)
  assert.match(migration,
    /update public\.seller_os_post_runtime_scheduler_v1[\s\S]*?set schedule = '7 \* \* \* \*'[\s\S]*?where lane = 'OPERATIONAL_INTEGRITY_AUDITOR'/)

  assert.doesNotMatch(migration, /set\s+enabled\s*=/i)
  assert.doesNotMatch(migration,
    /publishOffer|createOffer|bulkCreateOffer|ReviseFixedPriceItem/)
  assert.doesNotMatch(migration,
    /(?:insert into|update|delete from)\s+public\.ebay_luna_opportunity_queue/i)
})
