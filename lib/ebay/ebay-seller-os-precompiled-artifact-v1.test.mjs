import assert from "node:assert/strict"
import test from "node:test"
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { assessPrecompiledReceiptV1 as assess, digestPrecompiledPayloadV1 as digest } from "./ebay-seller-os-precompiled-artifact-v1.mjs"

const subject = { status: "AVAILABLE", workingTreeStatus: "CLEAN", headSha: "a".repeat(40), fingerprint: "sha256:source" }
const receipt = { artifactVersion: "SELLER_OS_VALIDATION_EVIDENCE_V1", producer: { id: "SELLER_OS_VALIDATION_RECORDER" },
  checks: Object.fromEntries(["tests", "typecheck", "lint", "build", "sellerOsAudit", "targetedRuntimeSecurity"].map(k => [k, { status: "PASS" }])),
  headChangedDuringValidation: false, workspaceChangedDuringValidation: false, validatedHeadSha: subject.headSha,
  validationSubject: { type: "CLEAN_COMMITTED_HEAD", validatedWorkspaceFingerprint: subject.fingerprint },
  buildArtifact: { version: "SELLER_OS_PRECOMPILED_ARTIFACT_V1", sourceCommitSha: subject.headSha,
    worktreeFingerprint: subject.fingerprint, buildId: "test-build", buildArtifactDigest: "sha256:payload", builtAt: "2026-09-08T00:00:00Z" } }
test("artifact binds all successful validation gates, clean exact source, fingerprint and payload", () => {
  assert.equal(assess(receipt, subject, { digest: "sha256:payload" }, "test-build"), true)
  for (const patch of [{ headSha: "b".repeat(40) }, { fingerprint: "other" }, { workingTreeStatus: "DIRTY" }]) {
    assert.equal(assess(receipt, { ...subject, ...patch }, { digest: "sha256:payload" }, "test-build"), false)
  }
  for (const key of Object.keys(receipt.checks)) {
    assert.equal(assess({ ...receipt, checks: { ...receipt.checks, [key]: { status: "FAIL" } } }, subject, { digest: "sha256:payload" }, "test-build"), false)
  }
  assert.equal(assess(receipt, subject, { digest: "tampered" }, "test-build"), false)
  assert.equal(assess(receipt, subject, { digest: "sha256:payload" }, "old-build"), false)
  assert.equal(assess({}, subject, { digest: "sha256:payload" }, "test-build"), false)
})
test("payload digest detects compiled middleware changes while excluding compiler cache", async () => {
  const root = await mkdtemp(join(tmpdir(), "seller-os-artifact-test-"))
  try {
    for (const path of [".next/server", ".next/cache", "public"]) await mkdir(join(root, path), { recursive: true })
    for (const path of ["package.json", "package-lock.json", "next.config.mjs", ".next/server/middleware.js"]) await writeFile(join(root, path), "one")
    const first = await digest(root)
    await writeFile(join(root, ".next/cache/scratch"), "cache")
    assert.equal((await digest(root)).digest, first.digest)
    await writeFile(join(root, ".next/server/middleware.js"), "changed")
    assert.notEqual((await digest(root)).digest, first.digest)
  } finally { await rm(root, { recursive: true, force: true }) }
})
