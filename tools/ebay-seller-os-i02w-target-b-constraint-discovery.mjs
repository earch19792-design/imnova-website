#!/usr/bin/env node

import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

const PROJECT_REF = "vsfthqydfrdzulldbfbe"
const ROOT = "/home/earch/imnova-seller-os-canonical-integration-foundation-v1"
const TARGET_A = resolve(ROOT,
  "supabase/migrations/20260823023000_create_seller_os_daily_dollar_radar_autopilot.sql")
const ACCESS_TOKEN_PATH = "/home/earch/.supabase/access-token"

const targetA = await readFile(TARGET_A, "utf8")
const accessToken = (await readFile(ACCESS_TOKEN_PATH, "utf8")).trim()
if (!accessToken || /[\r\n\u0000]/.test(accessToken)) {
  throw new Error("SUPABASE_ACCESS_TOKEN_INVALID")
}

const query = `begin;
${targetA}
select coalesce(jsonb_agg(jsonb_build_object(
  'tableName', constraints.table_name,
  'constraintName', constraints.constraint_name,
  'constraintType', constraints.constraint_type,
  'definition', constraints.definition
) order by constraints.table_name collate "C",
  constraints.constraint_name collate "C"), '[]'::jsonb) as constraints
from (
  select relation.relname as table_name,
    constraint_row.conname as constraint_name,
    constraint_row.contype::text as constraint_type,
    pg_catalog.pg_get_constraintdef(constraint_row.oid, true) as definition
  from pg_catalog.pg_constraint constraint_row
  join pg_catalog.pg_class relation on relation.oid = constraint_row.conrelid
  join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and relation.relname in (
      'seller_os_daily_dollar_radar_scheduler_policy',
      'seller_os_daily_dollar_radar_runs'
    )
) constraints;
rollback;`

const response = await fetch(
  `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(60_000),
  })
const body = await response.json().catch(() => ({}))
if (!response.ok) {
  throw new Error(`CONSTRAINT_DISCOVERY_FAILED:${String(
    body?.message ?? body?.error ?? "UNKNOWN").replace(/[\r\n]+/g, " ").slice(0, 1_000)}`)
}

const resultSets = Array.isArray(body) ? body : []
const discovery = resultSets.find((row) => Array.isArray(row?.constraints))
  ?? resultSets.find((row) => row?.constraints)
const constraints = discovery?.constraints ?? []
if (!Array.isArray(constraints) || constraints.length === 0) {
  throw new Error("CONSTRAINT_DISCOVERY_RESULT_MISSING")
}

process.stdout.write(`${JSON.stringify({
  constraintDiscoverySource: "PG_CATALOG_PG_CONSTRAINT",
  targetAShaExpected: "5956e9209c98da3b3b2255500f6f5f31c34eeb95a1579147a08777d89845b6ff",
  explicitBeginCount: 1,
  explicitRollbackCount: 1,
  constraints,
  secretsDisplayed: false,
})}\n`)
