import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { extname, join, relative } from "node:path"

import {
  sellerOsMigrationVersionFromFilenameV1,
} from "./ebay-seller-os-migration-version-v1.mjs"

const root = process.cwd()
const failures = []

const immutableMigrations = new Map([
  ["supabase/migrations/20260713070000_create_ebay_image_optimization_pipeline.sql", "3b895d427a54f2492014452a439d3c58ca572c2e6175e20c0b79c1942050cc49"],
  ["supabase/migrations/20260713071000_create_ebay_manual_listing_registration.sql", "69d621b832e00cf2a1862ca44b41b021d26d9ba7a1f7a9c08d21e1cf6a420833"],
  ["supabase/migrations/20260713072000_create_ebay_post_listing_learning.sql", "a55a0d3a8251b6de5367129232c62eda7a08765d0a1e4d35e9dfed90f44067ef"],
  ["supabase/migrations/20260713073000_scope_ebay_seller_whatsapp_claims.sql", "9c584bd4a1ccbea6e77ded738fc9f5fc600d9f4807ff9b0bf92a8f398e415ff0"],
  ["supabase/migrations/20260713074000_harden_ebay_active_listing_sync.sql", "243cca4256a32cda4423a0b641a50607f2078cb99c36eb1591fdac8f99ee964c"],
  ["supabase/migrations/20260713075000_scope_ebay_listing_images_by_account.sql", "c72bd1f0b77d33b63ccd03c9378a4c258bfbd66d9d8fe44a8c841e6038c34589"],
  ["supabase/migrations/20260713076000_limit_ebay_reusable_listing_defaults.sql", "3cf5289ed823e79297d7574d79f291769ad82a6b8c2774e1ceda13f9cab56373"],
  ["supabase/migrations/20260713077000_create_ebay_image_storage_cleanup_reconciliation.sql", "dc5d1c6dcf8626d5068392f9609143e3d309ca0657bd31f4bc0a9b4b675263c7"],
  ["supabase/migrations/20260713078000_validate_ebay_active_listing_constraints.sql", "35521aec11379f954862e795e764be5a728cc3420735d5aff22a1241a9422b35"],
  ["supabase/migrations/20260713079000_add_ebay_active_listing_sync_lease.sql", "fe908b46b96afb3de606f12d06390e60a9b02128a9e9b96cf7e10b897ae9030c"],
])

function walk(directory) {
  const files = []
  for (const entry of readdirSync(directory)) {
    if ([".git", ".next", "node_modules"].includes(entry)) continue
    const absolute = join(directory, entry)
    if (statSync(absolute).isDirectory()) files.push(...walk(absolute))
    else files.push(absolute)
  }
  return files
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

for (const [path, expected] of immutableMigrations) {
  const actual = sha256(join(root, path))
  if (actual !== expected) failures.push(`IMMUTABLE_MIGRATION_CHANGED:${path}`)
}

const migrationDirectory = join(root, "supabase/migrations")
const migrationNames = readdirSync(migrationDirectory)
  .filter((name) => name.endsWith(".sql"))
const timestamps = new Map()
for (const name of migrationNames) {
  const timestamp = sellerOsMigrationVersionFromFilenameV1(name)
  if (!timestamp) {
    failures.push(`MIGRATION_TIMESTAMP_INVALID:${name}`)
    continue
  }
  const prior = timestamps.get(timestamp)
  if (prior) failures.push(`MIGRATION_TIMESTAMP_DUPLICATE:${prior}:${name}`)
  timestamps.set(timestamp, name)
}

// supabase_admin default privileges are managed by Supabase and cannot be
// changed by the project migration role. Future Seller OS tables must close
// client table ACLs explicitly in the migration that creates them.
const sellerOsAclEnforcementStart = "20260713100000"
// Applied migrations are immutable. These narrowly-scoped append-only
// remediations satisfy the same ACL invariant without rewriting history.
const sellerOsAclRemediations = new Map([
  [
    "20260722008000:ebay_reference_guided_generation_attempts",
    "20260722017000_harden_reference_guided_orchestrator_acl.sql",
  ],
  [
    "20260722008000:ebay_reference_guided_generation_jobs",
    "20260722017000_harden_reference_guided_orchestrator_acl.sql",
  ],
])
const v3AclRemediation =
  "20260723014000_harden_v3_reference_guided_table_acl.sql"
for (const sourceTable of [
  "20260722020000:ebay_reference_guided_replacement_canary_events",
  "20260722024000:ebay_reference_guided_human_review_events",
  "20260722024000:ebay_reference_guided_deterministic_previews",
  "20260722024000:ebay_reference_guided_asset_contract_slots",
  "20260722025000:ebay_reference_guided_primary_main_previews",
  "20260722025000:ebay_reference_guided_asset_review_events",
  "20260722026000:ebay_reference_guided_deterministic_asset_variants",
  "20260722027000:ebay_reference_guided_final_asset_selection_events",
  "20260722028000:ebay_reference_guided_final_batch_plans",
  "20260722028000:ebay_reference_guided_final_batch_plan_positions",
  "20260722029000:ebay_reference_guided_batch_plan_successors_v2",
  "20260722029000:ebay_reference_guided_batch_plan_successor_positions_v2",
  "20260722030000:ebay_reference_guided_phase_a_position_2_assets",
  "20260722032000:ebay_reference_guided_successor_provider_events",
  "20260722035000:ebay_reference_guided_position_5_human_verdict_events",
  "20260722037000:ebay_reference_guided_position_3_human_verdict_events",
  "20260722038000:ebay_reference_guided_position_contract_amendments",
  "20260722040000:ebay_reference_guided_position_4_human_verdict_events",
  "20260722041000:ebay_reference_guided_position_4_correction_amendments",
  "20260722042000:ebay_reference_guided_position_6_contract_amendments",
  "20260722045000:ebay_reference_guided_position_6_human_verdict_events",
  "20260722046000:ebay_reference_guided_position_4_fidelity_amendments",
  "20260722046000:ebay_reference_guided_position_6_correction_amendments",
  "20260722046000:ebay_reference_guided_extraordinary_replacement_plans",
  "20260722046000:ebay_reference_guided_extraordinary_replacement_positions",
  "20260722046000:ebay_reference_guided_extraordinary_authorization_events",
  "20260722046000:ebay_reference_guided_extraordinary_provider_events",
  "20260722050000:ebay_reference_guided_position_4_extraordinary_human_verdict_events",
  "20260722052000:ebay_reference_guided_position_6_extraordinary_human_verdict_events",
  "20260722053000:ebay_reference_guided_final_listing_review_previews",
  "20260722054500:ebay_reference_guided_final_listing_reconciliation_events",
  "20260722055000:ebay_reference_guided_final_listing_gate_source_events",
  "20260722056000:ebay_v3_publication_image_transports",
  "20260722056000:ebay_v3_unpublished_offer_authorization_previews",
  "20260722057000:ebay_v3_unpublished_offer_authorization_invalidations",
  "20260722057500:ebay_v3_listing_package_reconciliations",
  "20260723012000:ebay_draft_only_approval_reconciliation_events",
]) {
  sellerOsAclRemediations.set(sourceTable, v3AclRemediation)
}
for (const name of migrationNames) {
  const timestamp = sellerOsMigrationVersionFromFilenameV1(name)
  const source = readFileSync(join(migrationDirectory, name), "utf8")

  if (/alter\s+default\s+privileges\s+for\s+role\s+supabase_admin/i.test(source)) {
    failures.push(`MANAGED_SUPABASE_ADMIN_DEFAULT_PRIVILEGES_FORBIDDEN:${name}`)
  }
  if (/set\s+role\s+supabase_admin/i.test(source)) {
    failures.push(`MANAGED_SUPABASE_ADMIN_SET_ROLE_FORBIDDEN:${name}`)
  }

  if (!timestamp || timestamp <= sellerOsAclEnforcementStart) continue

  const createdSellerOsTables = [...source.matchAll(
    /create\s+table(?:\s+if\s+not\s+exists)?\s+public\.(ebay_[a-z0-9_]+)/gi,
  )].map((match) => match[1])

  for (const table of createdSellerOsTables) {
    const escapedTable = table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const explicitRevoke = new RegExp(
      `revoke\\s+all\\s+on\\s+table\\s+public\\.${escapedTable}\\s+from\\s+anon\\s*,\\s*authenticated\\s*;`,
      "i",
    )
    const remediationName = sellerOsAclRemediations.get(`${timestamp}:${table}`)
    const remediationSource = remediationName &&
      migrationNames.includes(remediationName)
      ? readFileSync(join(migrationDirectory, remediationName), "utf8")
      : ""
    if (!explicitRevoke.test(source) && !explicitRevoke.test(remediationSource)) {
      failures.push(`SELLER_OS_TABLE_ACL_REVOKE_MISSING:${name}:${table}`)
    }
  }
}

function stripCommentsAndStrings(source) {
  let output = ""
  let index = 0
  let mode = "code"
  let quote = ""
  while (index < source.length) {
    const character = source[index]
    const next = source[index + 1]
    if (mode === "code") {
      if (character === "/" && next === "/") {
        mode = "line_comment"; output += "  "; index += 2; continue
      }
      if (character === "/" && next === "*") {
        mode = "block_comment"; output += "  "; index += 2; continue
      }
      if (["\"", "'", "`"].includes(character)) {
        mode = "string"; quote = character; output += " "; index += 1; continue
      }
      output += character; index += 1; continue
    }
    if (mode === "line_comment") {
      if (character === "\n") { mode = "code"; output += "\n" }
      else output += " "
      index += 1; continue
    }
    if (mode === "block_comment") {
      if (character === "*" && next === "/") {
        mode = "code"; output += "  "; index += 2
      } else {
        output += character === "\n" ? "\n" : " "; index += 1
      }
      continue
    }
    if (character === "\\") {
      output += "  "; index += 2; continue
    }
    if (character === quote) {
      mode = "code"; quote = ""; output += " "; index += 1; continue
    }
    output += character === "\n" ? "\n" : " "; index += 1
  }
  return output
}

const forbiddenCalls = [
  "publishOffer",
  "bulkPublish",
  "bulkPublishOffer",
  "AddItem",
  "ReviseItem",
  "EndItem",
]
const executableRoots = [join(root, "app"), join(root, "lib")]
for (const sourceRoot of executableRoots) {
  for (const absolute of walk(sourceRoot)) {
    if (![".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(extname(absolute))) continue
    if (/\.test\.[cm]?[jt]sx?$/.test(absolute)) continue
    const executable = stripCommentsAndStrings(readFileSync(absolute, "utf8"))
    for (const operation of forbiddenCalls) {
      if (new RegExp(`\\b${operation}\\s*\\(`).test(executable)) {
        failures.push(`FORBIDDEN_EXECUTABLE_EBAY_CALL:${relative(root, absolute)}:${operation}`)
      }
    }
  }
}

const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/,
  /\bsb_secret_[A-Za-z0-9_-]{24,}\b/,
  /\bEAA[A-Za-z0-9]{70,}\b/,
]
const trackedResult = spawnSync("git", ["ls-files", "-z"], {
  cwd: root,
  encoding: "utf8",
})
if (trackedResult.status !== 0) failures.push("SECRET_AUDIT_GIT_LS_FILES_FAILED")
const trackedPaths = trackedResult.stdout.split("\0").filter(Boolean)
for (const path of trackedPaths) {
  if (/(^|\/)\.env(?:\.|$)/.test(path) && !/\.example$/.test(path)) {
    failures.push(`TRACKED_ENV_FILE:${path}`)
    continue
  }
  if (/\.(?:png|jpe?g|gif|webp|ico|woff2?|ttf|lock)$/i.test(path)) continue
  const absolute = join(root, path)
  if (!existsSync(absolute)) continue
  const content = readFileSync(absolute, "utf8")
  for (const pattern of secretPatterns) {
    if (pattern.test(content)) failures.push(`POTENTIAL_SECRET:${path}`)
  }
}

if (failures.length) {
  for (const failure of failures) process.stderr.write(`${failure}\n`)
  process.exitCode = 1
} else {
  process.stdout.write("Seller OS CI guards passed: immutable migrations, unique timestamps, secrets, forbidden executable APIs.\n")
}
