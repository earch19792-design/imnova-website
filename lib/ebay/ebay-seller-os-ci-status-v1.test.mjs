import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const previousTypeScriptLoader = require.extensions[".ts"]
require.extensions[".ts"] = (module, filename) => {
  const source = readFileSync(filename, "utf8")
  const output = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10, target: ts.ScriptTarget.ES2022 },
  })
  module._compile(output.outputText, filename)
}

const {
  SELLER_OS_CI_STATUS_CONTRACT_VERSION,
  SELLER_OS_CI_STATUS_TOOL_V1,
  SELLER_OS_VALIDATION_EVIDENCE_VERSION,
  collectSellerOsCiStatusV1,
} = require("./ebay-seller-os-ci-status-v1.ts")
if (previousTypeScriptLoader) require.extensions[".ts"] = previousTypeScriptLoader
else delete require.extensions[".ts"]
import {
  recordSellerOsValidationEvidenceV1,
} from "../../tools/ebay-seller-os-validation-recorder.mjs"
import {
  SELLER_OS_WORKSPACE_FINGERPRINT_VERSION,
  collectSellerOsWorkspaceFingerprintV1,
} from "./ebay-seller-os-workspace-fingerprint-v1.mjs"

const HEAD = "540c2e0647e99f219016c781098400cce2001d96"
const OTHER_HEAD = "4c64d41699bb6dabf7413919042a7be732046d3d"
const NOW = new Date("2026-08-20T07:00:00.000Z")
const FINGERPRINT = `sha256:${"a".repeat(64)}`
const OTHER_FINGERPRINT = `sha256:${"b".repeat(64)}`

function check(status = "PASS", overrides = {}) {
  return { status, exitCode: status === "PASS" ? 0 : status === "FAIL" ? 1 : null,
    durationMs: 42, completedAt: "2026-08-20T06:59:00.000Z", ...overrides }
}

function artifact(overrides = {}) {
  const base = {
    artifactVersion: SELLER_OS_VALIDATION_EVIDENCE_VERSION,
    producer: { id: "SELLER_OS_VALIDATION_RECORDER",
      version: "SELLER_OS_VALIDATION_RECORDER_V2" },
    source: "LOCAL_VALIDATION",
    validatedHeadSha: HEAD,
    startedAt: "2026-08-20T06:50:00.000Z",
    completedAt: "2026-08-20T06:59:00.000Z",
    headChangedDuringValidation: false,
    workspaceChangedDuringValidation: false,
    validationSubject: {
      type: "CLEAN_COMMITTED_HEAD",
      validatedWorkingTreeStatus: "CLEAN",
      validatedWorkspaceFingerprint: FINGERPRINT,
      fingerprintVersion: SELLER_OS_WORKSPACE_FINGERPRINT_VERSION,
      workspaceStableDuringValidation: true,
    },
    checks: {
      tests: { ...check(), scope: "FULL_SELLER_OS_SUITE", passed: 189, failed: 0,
        skipped: 0, failureSummaries: [], failuresTruncated: false },
      typecheck: check(), lint: check(), build: check(), sellerOsAudit: check(),
    },
  }
  return { ...base, ...overrides, checks: { ...base.checks, ...(overrides.checks ?? {}) } }
}

function currentSubject(overrides = {}) {
  return { status: "AVAILABLE", headSha: HEAD, workingTreeStatus: "CLEAN",
    fingerprint: FINGERPRINT,
    fingerprintVersion: SELLER_OS_WORKSPACE_FINGERPRINT_VERSION,
    limitations: [], ...overrides }
}

function collect(data = artifact(), subject = currentSubject()) {
  return collectSellerOsCiStatusV1({
    adapter: {
      readArtifact: async () => JSON.stringify(data),
      readCurrentSubject: async () => subject,
    },
    now: () => NOW,
  })
}

test("current SHA with every fixed check passed reports complete PASS evidence", async () => {
  const observed = await collect()
  assert.equal(observed.contractVersion, SELLER_OS_CI_STATUS_CONTRACT_VERSION)
  assert.equal(observed.observedAt, NOW.toISOString())
  assert.equal(observed.currentHead.sha, HEAD)
  assert.equal(observed.validation.status, "PASS")
  assert.equal(observed.validation.validatedHeadSha, HEAD)
  assert.equal(observed.validation.freshness, "CURRENT_SUBJECT")
  assert.equal(observed.validation.source, "LOCAL_VALIDATION")
  assert.equal(observed.evidenceCompleteness, "COMPLETE")
  assert.deepEqual(observed.validationSubject, {
    type: "CLEAN_COMMITTED_HEAD", validatedWorkingTreeStatus: "CLEAN",
    currentWorkingTreeStatus: "CLEAN", validatedWorkspaceFingerprint: FINGERPRINT,
    currentWorkspaceFingerprint: FINGERPRINT, workspaceMatch: true,
    fingerprintVersion: SELLER_OS_WORKSPACE_FINGERPRINT_VERSION,
    workspaceStableDuringValidation: true,
  })
  assert.deepEqual(observed.checks.tests, {
    status: "PASS", exitCode: 0, durationMs: 42,
    completedAt: "2026-08-20T06:59:00.000Z", scope: "FULL_SELLER_OS_SUITE",
    passed: 189, failed: 0, skipped: 0, failureSummaries: [], failuresTruncated: false,
  })
  assert.deepEqual(observed.safety, {
    readOnly: true, arbitraryCommandAllowed: false,
    callerControlledCommandAllowed: false, callerControlledWorkingDirectoryAllowed: false,
    fullLogsIncluded: false, fileContentsIncluded: false, credentialsIncluded: false,
    environmentValuesIncluded: false, marketplaceWrites: 0, inventoryWrites: 0,
    productCaseMutations: 0, lunaLinkMutations: 0, whatsappSends: 0,
  })
})

for (const [name, key] of [
  ["test", "tests"], ["typecheck", "typecheck"], ["lint", "lint"],
  ["build", "build"], ["Seller OS audit", "sellerOsAudit"],
]) {
  test(`${name} failure remains visible as validation FAIL`, async () => {
    const changed = key === "tests"
      ? { ...artifact().checks.tests, ...check("FAIL"), passed: 189, failed: 3,
        skipped: 0, failureSummaries: [{ identifier: "bounded test title" }],
        failuresTruncated: false }
      : check("FAIL")
    const observed = await collect(artifact({ checks: { [key]: changed } }))
    assert.equal(observed.validation.status, "FAIL")
    assert.equal(observed.checks[key].status, "FAIL")
    if (key === "tests") {
      assert.equal(observed.checks.tests.passed, 189)
      assert.equal(observed.checks.tests.failed, 3)
      assert.deepEqual(observed.checks.tests.failureSummaries, [{
        check: "tests", identifier: "bounded test title", classification: "TEST_FAILURE",
      }])
    }
  })
}

test("not-run and unavailable checks are PARTIAL instead of PASS", async () => {
  const observed = await collect(artifact({ checks: {
    lint: check("NOT_RUN", { exitCode: null, durationMs: null }),
    build: check("UNAVAILABLE", { exitCode: null, durationMs: null }),
  } }))
  assert.equal(observed.validation.status, "PARTIAL")
  assert.equal(observed.evidenceCompleteness, "PARTIAL")
  assert.equal(observed.checks.lint.status, "NOT_RUN")
  assert.equal(observed.checks.build.status, "UNAVAILABLE")
})

test("missing or malformed artifacts fail closed as UNAVAILABLE", async () => {
  const missing = await collectSellerOsCiStatusV1({
    adapter: { readArtifact: async () => { throw new Error("ENOENT") },
      readCurrentSubject: async () => currentSubject() }, now: () => NOW,
  })
  const malformed = await collectSellerOsCiStatusV1({
    adapter: { readArtifact: async () => "{not-json",
      readCurrentSubject: async () => currentSubject() },
    now: () => NOW,
  })
  for (const observed of [missing, malformed]) {
    assert.equal(observed.validation.status, "UNAVAILABLE")
    assert.equal(observed.evidenceCompleteness, "UNAVAILABLE")
    assert.equal(observed.checks.tests.passed, null)
  }
})

test("stale, missing, and invalidated SHA evidence cannot become PASS", async () => {
  const stale = await collect(artifact({ validatedHeadSha: OTHER_HEAD }))
  assert.equal(stale.validation.status, "STALE")
  assert.equal(stale.validation.freshness, "STALE_HEAD")

  const missing = await collect(artifact({ validatedHeadSha: null }))
  assert.equal(missing.validation.status, "PARTIAL")
  assert.equal(missing.validation.freshness, "UNKNOWN")

  const invalidated = await collect(artifact({ validatedHeadSha: null,
    headChangedDuringValidation: true }))
  assert.equal(invalidated.validation.status, "PARTIAL")
  assert.ok(invalidated.limitations.includes("VALIDATION_HEAD_CHANGED_DURING_RUN"))
})

test("bound dirty workspace can PASS only as an explicit dirty snapshot", async () => {
  const dirtyArtifact = artifact({ validationSubject: {
    type: "DIRTY_WORKTREE_SNAPSHOT", validatedWorkingTreeStatus: "DIRTY",
    validatedWorkspaceFingerprint: FINGERPRINT,
    fingerprintVersion: SELLER_OS_WORKSPACE_FINGERPRINT_VERSION,
    workspaceStableDuringValidation: true,
  } })
  const observed = await collect(dirtyArtifact,
    currentSubject({ workingTreeStatus: "DIRTY" }))
  assert.equal(observed.validation.status, "PASS")
  assert.equal(observed.validationSubject.type, "DIRTY_WORKTREE_SNAPSHOT")
  assert.equal(observed.validationSubject.workspaceMatch, true)
  assert.notEqual(observed.validationSubject.type, "CLEAN_COMMITTED_HEAD")
})

test("dirty workspace without a bound fingerprint cannot PASS", async () => {
  const unbound = artifact({ validationSubject: {
    type: "DIRTY_WORKTREE_SNAPSHOT", validatedWorkingTreeStatus: "DIRTY",
    validatedWorkspaceFingerprint: null,
    fingerprintVersion: SELLER_OS_WORKSPACE_FINGERPRINT_VERSION,
    workspaceStableDuringValidation: true,
  } })
  const observed = await collect(unbound,
    currentSubject({ workingTreeStatus: "DIRTY" }))
  assert.equal(observed.validation.status, "PARTIAL")
  assert.equal(observed.validationSubject.type, "UNAVAILABLE")
  assert.ok(observed.limitations.includes("DIRTY_WORKTREE_VALIDATION_SUBJECT_UNBOUND"))
})

test("matching HEAD with a changed workspace fingerprint is STALE", async () => {
  const observed = await collect(artifact(),
    currentSubject({ workingTreeStatus: "DIRTY", fingerprint: OTHER_FINGERPRINT }))
  assert.equal(observed.validation.status, "STALE")
  assert.equal(observed.validation.freshness, "STALE_WORKSPACE")
  assert.equal(observed.validationSubject.workspaceMatch, false)
})

test("unknown numbers remain null while actual zero remains zero", async () => {
  const observed = await collect(artifact({ checks: { tests: {
    ...artifact().checks.tests, passed: null, failed: 0, skipped: null,
  } } }))
  assert.equal(observed.checks.tests.passed, null)
  assert.equal(observed.checks.tests.failed, 0)
  assert.equal(observed.checks.tests.skipped, null)
})

test("failure summaries are bounded and unsafe artifact payload is not exposed", async () => {
  const summaries = Array.from({ length: 25 }, (_, index) => ({
    identifier: `bounded test ${index}`,
  }))
  const observed = await collect(artifact({ fullLog: "secret=do-not-return", environment: { TOKEN: "x" },
    checks: { tests: { ...artifact().checks.tests, ...check("FAIL"), failed: 25,
      failureSummaries: summaries, failuresTruncated: false } } }))
  assert.equal(observed.validation.status, "FAIL")
  assert.equal(observed.checks.tests.failureSummaries.length, 20)
  assert.equal(observed.checks.tests.failuresTruncated, true)
  assert.doesNotMatch(JSON.stringify(observed), /secret=do-not-return|TOKEN/)
})

test("malformed checks preserve uncertainty instead of inferred success", async () => {
  const observed = await collect(artifact({ checks: { typecheck: {
    status: "PASS", exitCode: "zero", durationMs: 5, completedAt: "bad-date",
  } } }))
  assert.equal(observed.validation.status, "PARTIAL")
  assert.equal(observed.checks.typecheck.status, "UNAVAILABLE")
  assert.equal(observed.checks.typecheck.exitCode, null)
  assert.equal(observed.checks.typecheck.completedAt, null)
  assert.ok(observed.limitations.includes("VALIDATION_CHECK_TYPECHECK_PARTIAL"))
})

test("fixed recorder invalidates evidence when HEAD changes during the validation run", async () => {
  const subjects = [currentSubject(), currentSubject({ headSha: OTHER_HEAD })]
  const checked = []
  let published = null
  const evidence = await recordSellerOsValidationEvidenceV1({
    now: () => "2026-08-20T07:00:00.000Z",
    readSubject: async () => subjects.shift() ?? currentSubject({ status: "UNAVAILABLE" }),
    executeCheck: async (name) => {
      checked.push(name)
      return name === "tests" ? { ...check(), scope: "FULL_SELLER_OS_SUITE",
        passed: 1, failed: 0, skipped: 0, failureSummaries: [], failuresTruncated: false } : check()
    },
    publish: async (value) => { published = value },
  })
  assert.deepEqual(checked, ["tests", "typecheck", "lint", "build", "sellerOsAudit"])
  assert.equal(evidence.validatedHeadSha, null)
  assert.equal(evidence.headChangedDuringValidation, true)
  assert.equal(published.validatedHeadSha, null)
})

test("fixed recorder invalidates evidence when workspace changes during validation", async () => {
  const subjects = [currentSubject({ workingTreeStatus: "DIRTY" }),
    currentSubject({ workingTreeStatus: "DIRTY", fingerprint: OTHER_FINGERPRINT })]
  const evidence = await recordSellerOsValidationEvidenceV1({
    now: () => "2026-08-20T07:00:00.000Z",
    readSubject: async () => subjects.shift() ?? currentSubject({ status: "UNAVAILABLE" }),
    executeCheck: async (name) => name === "tests" ? { ...check(),
      scope: "FULL_SELLER_OS_SUITE", passed: 1, failed: 0, skipped: 0,
      failureSummaries: [], failuresTruncated: false } : check(),
    publish: async () => {},
  })
  assert.equal(evidence.workspaceChangedDuringValidation, true)
  assert.equal(evidence.validatedHeadSha, null)
  assert.equal(evidence.validationSubject.type, "UNAVAILABLE")
  assert.equal(evidence.validationSubject.validatedWorkspaceFingerprint, null)
})

test("workspace fingerprint is deterministic, opaque, and content-sensitive", async () => {
  const adapter = (unstaged) => ({
    readHead: async () => Buffer.from(`${HEAD}\n`),
    readStatus: async () => Buffer.from(unstaged ? " M bounded.ts\0" : ""),
    readUnstagedDiff: async () => Buffer.from(unstaged),
    readStagedDiff: async () => Buffer.alloc(0),
    readUntrackedPaths: async () => Buffer.alloc(0),
    readUntrackedEntry: async () => { throw new Error("unexpected") },
  })
  const first = await collectSellerOsWorkspaceFingerprintV1({ adapter: adapter("change-a") })
  const repeated = await collectSellerOsWorkspaceFingerprintV1({ adapter: adapter("change-a") })
  const changed = await collectSellerOsWorkspaceFingerprintV1({ adapter: adapter("change-b") })
  assert.equal(first.workingTreeStatus, "DIRTY")
  assert.equal(first.fingerprint, repeated.fingerprint)
  assert.notEqual(first.fingerprint, changed.fingerprint)
  assert.match(first.fingerprint, /^sha256:[a-f0-9]{64}$/)
  assert.doesNotMatch(JSON.stringify(first), /change-a|bounded\.ts/)
})

test("CI reader and recorder retain the fixed no-command MCP boundary", () => {
  const reader = readFileSync(new URL("./ebay-seller-os-ci-status-v1.ts", import.meta.url), "utf8")
  const recorder = readFileSync(new URL("../../tools/ebay-seller-os-validation-recorder.mjs", import.meta.url), "utf8")
  assert.equal(SELLER_OS_CI_STATUS_TOOL_V1.name, "seller_os_get_ci_status")
  assert.doesNotMatch(reader, /execFile|spawn\(|shell:\s*true|process\.env/)
  assert.match(recorder, /shell: false/)
  assert.match(recorder, /SELLER_OS_VALIDATION_ARTIFACT_RELATIVE_PATH/)
  assert.doesNotMatch(recorder, /git fetch|git pull|git push|git ls-remote/)
  assert.doesNotMatch(reader, /rawDiffIncluded:\s*true|perFileHashesIncluded:\s*true/i)
})
