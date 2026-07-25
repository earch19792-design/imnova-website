import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const migrationPath = "supabase/migrations/20260718042000_enable_secure_same_day_pilot_scheduler.sql"

test("same-day scheduler migration is staging-only, durable, and disabled by default", async () => {
  const sql = await readFile(migrationPath, "utf8")

  assert.match(sql, /enabled boolean not null default false/)
  assert.match(sql, /supabase_project_ref = 'vsfthqydfrdzulldbfbe'/)
  assert.match(sql, /deployment_scope = 'PREVIEW'/)
  assert.match(sql, /endpoint_url_secret_name/)
  assert.match(sql, /authorization_secret_name/)
  assert.match(sql, /vault\.decrypted_secrets/)
  assert.match(sql, /security definer/gi)
  assert.match(sql, /net\.http_get/)
  assert.match(sql, /cron\.schedule/)
  assert.match(sql, /cron\.unschedule/)
  assert.match(sql, /grant execute on function public\.enable_same_day_pilot_staging_scheduler[\s\S]*to service_role/)
  assert.match(sql, /grant execute on function public\.disable_same_day_pilot_staging_scheduler[\s\S]*to service_role/)
  assert.match(sql, /SAME_DAY_PILOT_SCHEDULER_AUDIT_APPEND_ONLY/)
  assert.match(sql, /last_worker_heartbeat_at/)

  const defaultInsert = sql.match(/insert into public\.ebay_same_day_pilot_scheduler_config[\s\S]*?on conflict \(singleton\) do nothing;/)?.[0] ?? ""
  assert.match(defaultInsert, /'UNCONFIGURED'/)
  assert.match(defaultInsert, /false/)
  assert.doesNotMatch(defaultInsert, /cron\.schedule/)

  const trailingSafety = sql.slice(sql.lastIndexOf("-- Deliberately no cron.schedule call here."))
  assert.match(trailingSafety, /Production untouched/)
  assert.doesNotMatch(sql, /create extension/i)
})

test("scheduler audit payload excludes secret values and raw response material", async () => {
  const sql = await readFile(migrationPath, "utf8")
  const auditDefinition = sql.match(/create table if not exists public\.ebay_same_day_pilot_scheduler_dispatch_audit[\s\S]*?\n\);/)?.[0] ?? ""

  assert.ok(auditDefinition)
  assert.doesNotMatch(auditDefinition, /\b(url|token|secret_value|headers|body|response_body)\b/i)
  assert.match(auditDefinition, /endpoint_reference_hash/)
  assert.match(auditDefinition, /request_id/)
  assert.match(auditDefinition, /worker_heartbeat_observed_at/)
  assert.match(sql, /Never persist SQLERRM/)
  assert.match(sql, /secretValuesDisplayed', false/g)
})
