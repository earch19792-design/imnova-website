import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"

function moduleUrl(source) {
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  return `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`
}

const environmentSource = readFileSync(
  new URL("./environment-boundaries.ts", import.meta.url),
  "utf8",
)
const policySource = readFileSync(
  new URL("./ebay-production-capability-policy.ts", import.meta.url),
  "utf8",
).replace(
  'from "./environment-boundaries"',
  `from "${moduleUrl(environmentSource)}"`,
)
const {
  EBAY_PRODUCTION_CAPABILITIES,
  EBAY_PRODUCTION_CAPABILITY_REGISTRY,
  assertEbayProductionCapability,
  evaluateEbayProductionCapability,
} = await import(moduleUrl(policySource))

const actorId = "123e4567-e89b-42d3-a456-426614174000"
const policyVersion = "EBAY_ACTIVE_LISTING_TITLE_REVISION_POLICY_V1"
const proposalHash = "a".repeat(64)

function titleContext(stage = "route") {
  return {
    capability: "active_title.apply",
    stage,
    invocation: "interactive",
    authenticationMode: "admin_user",
    userId: actorId,
    accountKey: "imnova-ebay-us",
    marketplace: "EBAY_US",
    resourceKey: "123456789012",
    idempotencyKey: "title:123456789012:v1",
    policyVersion,
    confirmedHumanAction: true,
    ...(stage === "effect" ? {
      proposalHash,
      preflightPassed: true,
      preflightObservedAt: "2026-07-26T12:00:00.000Z",
    } : {}),
  }
}

test("registry declares every exact capability disabled by explicit Production flags", () => {
  assert.deepEqual(
    Object.keys(EBAY_PRODUCTION_CAPABILITY_REGISTRY).sort(),
    [...EBAY_PRODUCTION_CAPABILITIES].sort(),
  )
  for (const capability of EBAY_PRODUCTION_CAPABILITIES) {
    assert.match(
      EBAY_PRODUCTION_CAPABILITY_REGISTRY[capability].environmentFlag,
      /^EBAY_PRODUCTION_CAPABILITY_[A-Z0-9_]+_ENABLED$/,
    )
  }
})

test("Production is fail-closed when master and capability are absent", () => {
  const evaluation = evaluateEbayProductionCapability(
    titleContext(),
    {
      vercelEnv: "production",
      now: new Date("2026-07-26T12:00:00.000Z"),
    },
  )
  assert.equal(evaluation.allowed, false)
  assert.equal(evaluation.status, "blocked")
  assert.ok(evaluation.blockerCodes.includes(
    "EBAY_PRODUCTION_MASTER_CAPABILITY_GATE_DISABLED",
  ))
  assert.ok(evaluation.blockerCodes.includes(
    "EBAY_PRODUCTION_CAPABILITY_DISABLED",
  ))
})

test("service and effect cannot bypass the route grant", () => {
  assert.throws(
    () => assertEbayProductionCapability(
      titleContext("service"),
      undefined,
      {
        vercelEnv: "preview",
        now: new Date("2026-07-26T12:00:00.000Z"),
      },
    ),
    /EBAY_CAPABILITY_ROUTE_GRANT_REQUIRED/,
  )
})

test("service role never authenticates an interactive capability", () => {
  const evaluation = evaluateEbayProductionCapability({
    ...titleContext(),
    authenticationMode: "service_role",
    userId: null,
  }, {
    vercelEnv: "preview",
    now: new Date("2026-07-26T12:00:00.000Z"),
  })
  assert.equal(evaluation.allowed, false)
  assert.ok(evaluation.blockerCodes.includes(
    "EBAY_INTERACTIVE_ADMIN_OR_DEDICATED_CRON_REQUIRED",
  ))
})

test("route, service and effect grants remain bound to actor, resource and policy", () => {
  const environment = {
    vercelEnv: "preview",
    now: new Date("2026-07-26T12:00:00.000Z"),
  }
  const routeGrant = assertEbayProductionCapability(
    titleContext("route"),
    undefined,
    environment,
  )
  const serviceGrant = assertEbayProductionCapability(
    titleContext("service"),
    routeGrant,
    environment,
  )
  const effectGrant = assertEbayProductionCapability(
    titleContext("effect"),
    serviceGrant,
    environment,
  )
  assert.equal(effectGrant.stage, "effect")
  assert.equal(effectGrant.capability, "active_title.apply")
  assert.equal(effectGrant.proposalHash, proposalHash)
})
