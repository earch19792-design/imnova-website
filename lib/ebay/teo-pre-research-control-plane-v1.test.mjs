import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { registerHooks } from "node:module"

registerHooks({ resolve(specifier, context, nextResolve) {
  const value = String(specifier ?? "")
  if (value.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(value)) {
    try { return nextResolve(`${value}.ts`, context) } catch {
      return nextResolve(specifier, context)
    }
  }
  return nextResolve(specifier, context)
} })

const control = await import("./teo-pre-research-control-plane-v1.ts")
const mcp = readFileSync("lib/ebay/teo-pre-research-control-mcp-v1.ts", "utf8")
const oauth = readFileSync("lib/ebay/teo-pre-research-control-oauth-v1.ts", "utf8")
const controlSource = readFileSync(
  "lib/ebay/teo-pre-research-control-plane-v1.ts", "utf8")
const readOnlyMcp = readFileSync("lib/ebay/ebay-seller-os-mcp-server-v1.ts", "utf8")
const runner = readFileSync(
  "app/admin/ebay/opportunity-queue/research/mayel-market-revalidation-runner.tsx",
  "utf8")
const operator = readFileSync(
  "app/api/admin/ebay/live-optimization-operator/route.ts", "utf8")

const candidates = [
  { productId: "101", variantId: "201", sku: "ITEM101" },
  { productId: "102", variantId: "202", sku: "ITEM102" },
]
const accountKey = "ebay-us-owner"
const ownerUserId = "11111111-1111-4111-8111-111111111111"
const commandClientId = "chatgpt-control-client"
const capabilityId = "22222222-2222-4222-8222-222222222222"
const contractVersion = "LUNA_PRE_RESEARCH_RESULT_V2_2026_09_19"

function createListSupabase({ capabilityEnabled = true, capabilityPresent = true,
  batches = [] } = {}) {
  const operations = []
  const capability = { capability_id: capabilityId,
    capability_code: "TEO_PRE_RESEARCH_NORMAL_BATCH_V1",
    marketplace_account_key: accountKey, owner_user_id: ownerUserId,
    command_client_id: commandClientId,
    allowed_contract_version: contractVersion, maximum_candidates: 50,
    enabled: capabilityEnabled, expires_at: null }
  const matches = (row, filters) => filters.every(([column, value]) =>
    row[column] === value)
  return { operations, client: {
    from(table) {
      operations.push(["from", table])
      const filters = []
      let maximum = Number.POSITIVE_INFINITY
      const query = {
        select(columns) { operations.push(["select", table, columns]); return query },
        eq(column, value) {
          operations.push(["eq", table, column, value])
          filters.push([column, value])
          return query
        },
        order(column, options) {
          operations.push(["order", table, column, options])
          return query
        },
        limit(value) {
          operations.push(["limit", table, value])
          maximum = value
          return query
        },
        maybeSingle() {
          const data = capabilityPresent && matches(capability, filters)
            ? capability : null
          return Promise.resolve({ data, error: null })
        },
        then(resolve, reject) {
          const data = table === "seller_os_pre_research_batches_v1"
            ? batches.filter((row) => matches(row, filters)).slice(0, maximum)
            : []
          return Promise.resolve({ data, error: null }).then(resolve, reject)
        },
      }
      return query
    },
  } }
}

function batch(overrides = {}) {
  return { batch_id: "33333333-3333-4333-8333-333333333333",
    marketplace_account_key: accountKey, owner_authorization_id: capabilityId,
    owner_user_id: ownerUserId, command_client_id: commandClientId,
    batch_state: "COMPLETED", created_at: "2026-09-19T18:00:00.000Z",
    updated_at: "2026-09-19T18:10:00.000Z", candidate_count: 2,
    contract_version: contractVersion, ...overrides }
}

test("request schema is closed, bounded, identity-only, and deterministic", () => {
  const parsed = control.parseTeoPreResearchRequestV1({
    snapshotId: "11111111-1111-4111-8111-111111111111",
    clientIdempotencyKey: "teo.batch.0001", candidates,
  })
  assert.equal(parsed.candidates.length, 2)
  for (const forbidden of ["ownerUserId", "commandClientId", "contractVersion",
    "sql", "url", "path", "publisher", "commercialTrace"]) {
    assert.throws(() => control.parseTeoPreResearchRequestV1({
      snapshotId: parsed.snapshotId,
      clientIdempotencyKey: parsed.clientIdempotencyKey,
      candidates, [forbidden]: "spoofed",
    }), /BATCH_REQUEST_INVALID/)
  }
  assert.throws(() => control.parseTeoPreResearchCandidatesV1(
    Array.from({ length: 51 }, (_, index) => ({ productId: `${index + 1}`,
      variantId: `${index + 101}`, sku: `ITEM${index}` }))), /BOUNDS_INVALID/)
  assert.throws(() => control.parseTeoPreResearchCandidatesV1(
    [candidates[0], candidates[0]]), /DUPLICATE_CANDIDATE/)
})

test("the isolated command catalog exposes only bounded certified controls", () => {
  assert.deepEqual(mcp.match(/"seller_os_(?:(?:request|get|resume)_pre_research_batch|list_pre_research_batches|(?:request|get)_commercial_trace)"/g), [
    '"seller_os_request_pre_research_batch"',
    '"seller_os_get_pre_research_batch"',
    '"seller_os_resume_pre_research_batch"',
    '"seller_os_list_pre_research_batches"',
    '"seller_os_request_commercial_trace"',
    '"seller_os_get_commercial_trace"',
  ])
  assert.doesNotMatch(mcp, /z\.object\(\{\s*(?:sql|url|path):/)
  assert.doesNotMatch(mcp, /import[^\n]*publisher|runPublisher|publishListing/i)
  assert.match(controlSource, /marketplaceWrites: 0/)
  const listTool = mcp.slice(mcp.indexOf(
    "title: \"List authorized normal Pre-Research batches\""))
  assert.match(listTool, /inputSchema: z\.object\(\{\}\)\.strict\(\)/)
  assert.match(listTool, /outputSchema:/)
  assert.match(listTool, /readOnlyHint: true/)
  assert.match(listTool, /destructiveHint: false/)
  assert.doesNotMatch(readOnlyMcp, /teo-pre-research-control|seller_os_request_pre_research_batch/)
})

test("authorized owner lists only its bounded NORMAL V2 batches", async () => {
  const otherOwnerBatch = batch({
    batch_id: "44444444-4444-4444-8444-444444444444",
    owner_user_id: "55555555-5555-4555-8555-555555555555",
  })
  const wrongContractBatch = batch({
    batch_id: "66666666-6666-4666-8666-666666666666",
    contract_version: "OTHER_CONTRACT",
  })
  const fake = createListSupabase({ batches: [batch(), otherOwnerBatch,
    wrongContractBatch] })
  const result = await control.listTeoPreResearchBatchesV1({
    supabase: fake.client, accountKey,
    principal: { ownerUserId, commandClientId },
  })
  assert.deepEqual(result, { batches: [{
    batchId: "33333333-3333-4333-8333-333333333333", status: "COMPLETED",
    createdAt: "2026-09-19T18:00:00.000Z",
    updatedAt: "2026-09-19T18:10:00.000Z", candidateCount: 2,
    contractVersion,
  }], count: 1, maximumRows: 25 })
  for (const binding of [
    ["marketplace_account_key", accountKey],
    ["owner_authorization_id", capabilityId],
    ["owner_user_id", ownerUserId],
    ["command_client_id", commandClientId],
    ["contract_version", contractVersion],
  ]) assert.ok(fake.operations.some((entry) =>
    entry[0] === "eq" && entry[2] === binding[0] && entry[3] === binding[1]))
  assert.ok(fake.operations.some((entry) =>
    entry[0] === "limit" && entry[1] ===
      "seller_os_pre_research_batches_v1" && entry[2] === 25))
})

test("authorized owner receives an empty successful list", async () => {
  const result = await control.listTeoPreResearchBatchesV1({
    supabase: createListSupabase().client, accountKey,
    principal: { ownerUserId, commandClientId },
  })
  assert.deepEqual(result, { batches: [], count: 0, maximumRows: 25 })
})

test("readback exposes bounded member retry and lease evidence without worker secrets", async () => {
  const planId = "77777777-7777-4777-8777-777777777777"
  const memberId = "88888888-8888-4888-8888-888888888888"
  const rows = {
    seller_os_pre_research_command_capabilities_v1: [{
      capability_id: capabilityId, capability_code:
        "TEO_PRE_RESEARCH_NORMAL_BATCH_V1",
      marketplace_account_key: accountKey, owner_user_id: ownerUserId,
      command_client_id: commandClientId,
      allowed_contract_version: contractVersion, maximum_candidates: 50,
      enabled: true, expires_at: null,
    }],
    seller_os_pre_research_batches_v1: [{
      batch_id: batch().batch_id, marketplace_account_key: accountKey,
      owner_user_id: ownerUserId, command_client_id: commandClientId,
      source_snapshot_id: "99999999-9999-4999-8999-999999999999",
      candidate_identity_digest: `sha256:${"a".repeat(64)}`,
      candidate_count: 1, contract_version: contractVersion,
      batch_state: "NEEDS_ATTENTION", created_at: "2026-09-23T12:00:00Z",
      started_at: "2026-09-23T12:01:00Z",
      completed_at: "2026-09-23T12:02:00Z",
    }],
    seller_os_pre_research_batch_members_v1: [{
      member_id: memberId, batch_id: batch().batch_id, ordinal: 1,
      luna_product_id: "101", luna_variant_id: "201", luna_sku: "ITEM101",
      plan_id: planId, execution_state: "NEEDS_ATTENTION",
      bounded_failure_reason: "MARKET_REVALIDATION_REQUEST_FAILED",
      retry_safety: "SAFE_IDEMPOTENT_RUNTIME_RESUME",
      started_at: "2026-09-23T12:01:00Z", completed_at: null,
    }],
    marketplace_product_research_query_plans: [{
      id: planId, marketplace_account_key: accountKey,
      source_context: "LUNA_PRE_RESEARCH", status: "ACTIVE",
      pre_research_result: "PENDING", pre_research_evidence: {},
      worker_claim_count: 2, worker_lease_owner: null,
      worker_lease_expires_at: null,
      worker_next_retry_at: "2026-09-23T12:07:00Z",
      worker_last_release_code: "MARKET_REVALIDATION_REQUEST_FAILED",
      worker_last_result: { state: "RELEASED_RETRY_SAFE",
        releasedAt: "2026-09-23T12:02:00Z",
        secretRawPayload: "MUST_NOT_LEAK" },
    }],
    marketplace_product_research_query_tasks: [],
  }
  const fake = { from(table) {
    const filters = []
    const query = {
      select() { return query },
      eq(column, value) { filters.push([column, value]); return query },
      order() { return query },
      limit() { return query },
      not() { return query },
      in() { return query },
      maybeSingle() {
        const data = (rows[table] ?? []).find((row) =>
          filters.every(([column, value]) => row[column] === value)) ?? null
        return Promise.resolve({ data, error: null })
      },
      then(resolve, reject) {
        return Promise.resolve({ data: rows[table] ?? [], error: null })
          .then(resolve, reject)
      },
    }
    return query
  } }
  const read = await control.readTeoPreResearchBatchV1({
    supabase: fake, accountKey,
    principal: { ownerUserId, commandClientId }, batchId: batch().batch_id,
  })
  assert.equal(read.batch.terminal, true)
  assert.deepEqual(read.batch.memberStateCounts, {
    pending: 0, running: 0, needsAttention: 1, completed: 0,
  })
  assert.deepEqual({ blocker: read.members[0].blocker,
    leaseState: read.members[0].leaseState,
    claimCount: read.members[0].claimCount,
    retryAttempted: read.members[0].retryAttempted,
    lastReleaseAt: read.members[0].lastReleaseAt }, {
    blocker: "MARKET_REVALIDATION_REQUEST_FAILED", leaseState: "NONE",
    claimCount: 2, retryAttempted: true,
    lastReleaseAt: "2026-09-23T12:02:00Z",
  })
  assert.doesNotMatch(JSON.stringify(read), /MUST_NOT_LEAK|secretRawPayload/)
})

test("wrong OAuth client and missing or disabled capability fail closed", async () => {
  await assert.rejects(control.listTeoPreResearchBatchesV1({
    supabase: createListSupabase().client, accountKey,
    principal: { ownerUserId, commandClientId: "wrong-client" },
  }), /TEO_PRE_RESEARCH_CAPABILITY_DENIED/)
  for (const options of [{ capabilityPresent: false },
    { capabilityEnabled: false }]) {
    await assert.rejects(control.listTeoPreResearchBatchesV1({
      supabase: createListSupabase(options).client, accountKey,
      principal: { ownerUserId, commandClientId },
    }), /TEO_PRE_RESEARCH_CAPABILITY_DENIED/)
  }
})

test("list is read-only and inherits the exact OAuth resource gate", async () => {
  const fake = createListSupabase({ batches: [batch()] })
  await control.listTeoPreResearchBatchesV1({ supabase: fake.client, accountKey,
    principal: { ownerUserId, commandClientId } })
  assert.deepEqual([...new Set(fake.operations.map((entry) => entry[0]))].sort(),
    ["eq", "from", "limit", "order", "select"])
  const listAt = controlSource.indexOf(
    "export async function listTeoPreResearchBatchesV1")
  const getAt = controlSource.indexOf(
    "export async function readTeoPreResearchBatchV1")
  const listSource = controlSource.slice(listAt, getAt)
  assert.doesNotMatch(listSource,
    /\.rpc\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(|requestLunaPreResearchV1|resumeTeoPreResearchBatchV1|publisher|commercial.?trace|marketplace.?write/i)
  const handler = mcp.slice(mcp.indexOf(
    "export async function handleSellerOsControlMcpRequestV1"))
  assert.ok(handler.indexOf("authenticateSellerOsControlRequestV1(request)") <
    handler.indexOf("createServer(auth.principal)"))
  assert.match(oauth, /SELLER_OS_CONTROL_OAUTH_RESOURCE/)
  assert.match(oauth, /resource_metadata=/)
})

test("persistent browser runner obtains only an authorized explicit plan", () => {
  assert.match(runner, /GET_NEXT_AUTHORIZED_PRE_RESEARCH_BATCH_PLAN/)
  assert.match(runner, /planId = nextPlanId/)
  assert.match(runner,
    /CLAIM_AUTONOMOUS_RESEARCH_PLAN[\s\S]*\.\.\.\(planId \? \{ planId \} : \{\}\)/)
  assert.match(operator,
    /GET_NEXT_AUTHORIZED_PRE_RESEARCH_BATCH_PLAN[\s\S]*nextAuthorizedTeoPreResearchPlanV1/)
  assert.match(operator, /globalQueueFallback: 0/)
})

test("normal intake and certified evidence engines are reused rather than duplicated", () => {
  assert.match(readFileSync(
    "lib/ebay/teo-pre-research-control-plane-v1.ts", "utf8"),
    /requestLunaPreResearchV1/)
  assert.doesNotMatch(mcp,
    /buildProductResearchCommercialQueryPlanV1|classifyCommercial|complete_luna_pre_research/)
})
