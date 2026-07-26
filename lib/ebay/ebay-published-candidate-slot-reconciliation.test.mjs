import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import { deriveSameDayLiveMonitor } from "./ebay-same-day-live-monitor.ts"

const migrationPath =
  "supabase/migrations/20260726142000_reconcile_published_factory_slots_v1.sql"

test("published acquisition reconciliation releases the durable factory slot without deleting history", async () => {
  const migration = await readFile(migrationPath, "utf8")

  assert.match(
    migration,
    /enforce_published_acquisition_factory_terminal_v1/,
  )
  assert.match(migration, /new\.factory_state := 'REJECTED_TERMINAL'/)
  assert.match(migration, /new\.active_slot := false/)
  assert.match(migration, /new\.slot_index := null/)
  assert.match(migration, /new\.factory_lease_token := null/)
  assert.match(
    migration,
    /ebay_same_day_published_candidate_factory_terminal_check/,
  )
  assert.match(migration, /SUPERSEDED_ALREADY_PUBLISHED/)
  assert.match(migration, /ALREADY_LISTED_AND_MONITORED/)
  assert.match(migration, /ALREADY_PUBLISHED_AND_MONITORED/)
  assert.match(
    migration,
    /ebay_luna_opportunity_acquisition_dispositions[\s\S]*opportunity_id = new\.opportunity_id/,
  )
  assert.match(
    migration,
    /array\['ALREADY_PUBLISHED_AND_MONITORED'\]/,
  )
  assert.match(migration, /on conflict \(idempotency_key\) do nothing/)
  assert.match(migration, /set status = 'SUPERSEDED'/)
  assert.match(migration, /set status = 'CANCELLED'/)
  assert.match(migration, /'ebayWrites',\s*0/)
  assert.doesNotMatch(migration, /\bdelete\s+from\b|\btruncate\b/i)
  assert.doesNotMatch(
    migration,
    /publishOffer|createOffer|ReviseFixedPriceItem/,
  )
})

test("the compact database invariant protects init, replenishment and both claims", async () => {
  const [migration, factory] = await Promise.all([
    readFile(migrationPath, "utf8"),
    readFile(
      "supabase/migrations/20260726070000_create_resilient_ebay_listing_factory_batch5.sql",
      "utf8",
    ),
  ])

  assert.match(
    migration,
    /before insert or update of[\s\S]*active_slot[\s\S]*factory_lease_expires_at/,
  )
  assert.match(
    migration,
    /machine_state = 'REJECTED'[\s\S]*factory_state = 'REJECTED_TERMINAL'[\s\S]*not active_slot/,
  )
  assert.match(factory, /initialize_ebay_listing_factory_run_v1/)
  assert.match(factory, /claim_ebay_listing_factory_candidate_v1/)
  assert.match(factory, /claim_ebay_listing_factory_candidate_by_id_v1/)
})

test("a shared opportunity disposition preserves the canonical monitoring row", async () => {
  const migration = await readFile(migrationPath, "utf8")
  const monitoringGuards = migration.match(
    /machine_state = 'VERIFIED_ACTIVE'[\s\S]{0,180}factory_state = 'COMMERCIAL_MONITORING'[\s\S]{0,80}not (?:new|candidate)\.active_slot/g,
  ) ?? []

  assert.equal(
    monitoringGuards.length,
    3,
    "trigger, transition audit and backfill must share the monitoring guard",
  )
  assert.match(
    migration,
    /coalesce\(new\.blockers,[\s\S]{0,180}ALREADY_LISTED_AND_MONITORED[\s\S]{0,100}ALREADY_PUBLISHED_AND_MONITORED[\s\S]{0,700}ebay_luna_opportunity_acquisition_dispositions/,
  )
  assert.match(
    migration,
    /new\.machine_state := 'REJECTED'[\s\S]*new\.factory_state := 'REJECTED_TERMINAL'/,
  )
})

test("the staging legacy blocker cannot become the current product or an operator task", () => {
  const candidate = {
    id: "candidate-item3155",
    ordinal: 1,
    product_title:
      "Hearing Aids Hearing Amplifiers for Seniors Rechargeable with Noise Cancelling",
    supplier_sku: "ITEM3155",
    machine_state: "RUN_CREATED",
    blockers: ["ALREADY_LISTED_AND_MONITORED"],
    evidence_summary: {},
  }
  const monitor = deriveSameDayLiveMonitor({
    now: new Date("2026-07-26T18:00:00.000Z"),
    run: {
      status: "BLOCKED",
      stage: "BLOCKED",
      next_human_action: "Ninguna.",
    },
    candidates: [candidate],
    tasks: [{
      id: "task-item3155",
      candidate_id: candidate.id,
      status: "OPEN",
      title: "Analizar ITEM3155",
    }],
  })

  assert.equal(monitor.status, "BLOCKED")
  assert.equal(monitor.batch.currentOrdinal, null)
  assert.equal(monitor.nextHumanAction, "Ninguna.")
  assert.doesNotMatch(monitor.activityEvidence, /tarea\(s\) humana\(s\)/)
})

test("TodayLaunchPanel filters superseded published candidates only from pending tasks", async () => {
  const panel = await readFile("app/admin/today-launch-panel.tsx", "utf8")

  assert.match(panel, /isPublishedAcquisitionHistory/)
  assert.match(panel, /ALREADY_LISTED_AND_MONITORED/)
  assert.match(panel, /ALREADY_PUBLISHED_AND_MONITORED/)
  assert.match(
    panel,
    /task\.status === "OPEN"[\s\S]*!isPublishedAcquisitionHistory/,
  )
  assert.match(panel, /const candidates = pilot\?\.candidates \?\? \[\]/)
})
