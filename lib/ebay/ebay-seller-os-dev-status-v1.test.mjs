import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  SELLER_OS_CANONICAL_REPOSITORY_V1,
  SELLER_OS_DEV_STATUS_CONTRACT_VERSION,
  SELLER_OS_DEV_STATUS_TOOL_V1,
  collectSellerOsDevStatusV1,
} from "./ebay-seller-os-dev-status-v1.ts"

const NOW = new Date("2026-08-20T04:44:00.000Z")
const HEAD = "4c64d41699bb6dabf7413919042a7be732046d3d"
const PREVIOUS = "5e56febb3d497556d8e7d3337196a92c0c9526b3"
const result = (stdout = "", exitCode = 0) => ({ stdout, exitCode })

function status(...records) {
  return records.length ? `${records.join("\0")}\0` : ""
}

function adapter(overrides = {}) {
  return {
    verifyRepository: async () => result("true\n"),
    readHeadSha: async () => result(`${HEAD}\n`),
    readHeadMetadata: async () => result("2026-08-19T23:16:10-06:00\x1ffeat(tunnel): add read-only runtime health observability\n"),
    readHeadParents: async () => result(`${PREVIOUS}\n`),
    readHeadChangedPaths: async () => result("A\0lib/ebay/runtime-health.ts\0M\0lib/ebay/mcp-server.ts\0"),
    readBranch: async () => result("feature/seller-os-canonical-integration-foundation-v1\n"),
    readStatus: async () => result(""),
    readRecentCommits: async () => result(`${HEAD}\x1f4c64d41\x1f2026-08-19T23:16:10-06:00\x1ffeat(tunnel): add read-only runtime health observability\x1e${PREVIOUS}\x1f5e56feb\x1f2026-08-19T22:00:00-06:00\x1ffix(mcp): make stateless tunnel probe lifecycle compatible\x1e`),
    readUpstreamName: async () => result("origin/feature/seller-os-canonical-integration-foundation-v1\n"),
    readAheadBehind: async () => result("2\t3\n"),
    ...overrides,
  }
}

function collect(overrides = {}) {
  return collectSellerOsDevStatusV1({ adapter: adapter(overrides), now: () => NOW })
}

test("clean fixed repository returns complete SHA, branch, upstream, and bounded history", async () => {
  const observed = await collect()
  assert.equal(observed.contractVersion, SELLER_OS_DEV_STATUS_CONTRACT_VERSION)
  assert.equal(observed.observedAt, NOW.toISOString())
  assert.deepEqual(observed.repository, {
    id: "SELLER_OS_CANONICAL_REPOSITORY", status: "AVAILABLE",
  })
  assert.deepEqual(observed.head, {
    sha: HEAD, shortSha: "4c64d41699bb", detached: false,
    branch: "feature/seller-os-canonical-integration-foundation-v1",
    commitTimestamp: "2026-08-20T05:16:10.000Z",
    commitSubject: "feat(tunnel): add read-only runtime health observability",
  })
  assert.deepEqual(observed.headCommit, {
    sha: HEAD, parentSha: PREVIOUS,
    subject: "feat(tunnel): add read-only runtime health observability",
    changedPathCount: 2,
    changedPaths: [
      { path: "lib/ebay/runtime-health.ts", status: "A" },
      { path: "lib/ebay/mcp-server.ts", status: "M" },
    ],
    pathsTruncated: false,
  })
  assert.deepEqual(observed.workingTree, {
    status: "CLEAN", stagedCount: 0, unstagedCount: 0, untrackedCount: 0,
    stagedPaths: [], unstagedPaths: [], untrackedPaths: [], pathsTruncated: false,
  })
  assert.deepEqual(observed.upstream, {
    status: "AVAILABLE", name: "origin/feature/seller-os-canonical-integration-foundation-v1",
    ahead: 3, behind: 2,
  })
  assert.equal(observed.recentCommits.length, 2)
  assert.equal(observed.evidenceCompleteness, "COMPLETE")
})

test("staged, unstaged, and untracked evidence remain independently visible", async () => {
  const observed = await collect({ readStatus: async () => result(status(
    "M  lib/ebay/staged.ts", " M lib/ebay/unstaged.ts", "?? notes/local.txt",
    "MM lib/ebay/both.ts",
  )) })
  assert.equal(observed.workingTree.status, "DIRTY")
  assert.equal(observed.workingTree.stagedCount, 2)
  assert.equal(observed.workingTree.unstagedCount, 2)
  assert.equal(observed.workingTree.untrackedCount, 1)
  assert.deepEqual(observed.workingTree.stagedPaths,
    ["lib/ebay/staged.ts", "lib/ebay/both.ts"])
  assert.deepEqual(observed.workingTree.unstagedPaths,
    ["lib/ebay/unstaged.ts", "lib/ebay/both.ts"])
  assert.deepEqual(observed.workingTree.untrackedPaths, ["notes/local.txt"])
})

test("detached HEAD is explicit and no upstream is a non-error", async () => {
  const observed = await collect({
    readBranch: async () => result("", 1),
    readUpstreamName: async () => result("", 128),
    readAheadBehind: async () => result("", 128),
  })
  assert.equal(observed.head.branch, null)
  assert.equal(observed.head.detached, true)
  assert.deepEqual(observed.upstream, {
    status: "NOT_CONFIGURED", name: null, ahead: null, behind: null,
  })
  assert.equal(observed.evidenceCompleteness, "COMPLETE")
})

test("history and path lists are bounded while true counts remain visible", async () => {
  const changes = Array.from({ length: 101 }, (_, index) =>
    `?? scratch/file-${index}.txt`)
  const commits = Array.from({ length: 12 }, (_, index) =>
    `${HEAD}\x1f4c64d41\x1f2026-08-19T23:16:10-06:00\x1fcommit ${index}\x1e`).join("")
  const observed = await collect({
    readStatus: async () => result(status(...changes)),
    readRecentCommits: async () => result(commits),
  })
  assert.equal(observed.workingTree.untrackedCount, 101)
  assert.equal(observed.workingTree.untrackedPaths.length, 100)
  assert.equal(observed.workingTree.pathsTruncated, true)
  assert.equal(observed.recentCommits.length, 10)
})

test("HEAD commit paths preserve status metadata, rename destinations, and bounded counts", async () => {
  const manyPaths = Array.from({ length: 101 }, (_, index) =>
    `A\0lib/ebay/changed-${index}.ts\0`).join("")
  const observed = await collect({ readHeadChangedPaths: async () => result(
    `A\0lib/ebay/added.ts\0M\0lib/ebay/modified.ts\0D\0lib/ebay/deleted.ts\0` +
    `R100\0lib/ebay/old-name.ts\0lib/ebay/new-name.ts\0` +
    `C100\0lib/ebay/source.ts\0lib/ebay/copied.ts\0T\0lib/ebay/type.ts\0` + manyPaths,
  ) })
  assert.equal(observed.headCommit.changedPathCount, 107)
  assert.equal(observed.headCommit.pathsTruncated, true)
  assert.deepEqual(observed.headCommit.changedPaths.slice(0, 6), [
    { path: "lib/ebay/added.ts", status: "A" },
    { path: "lib/ebay/modified.ts", status: "M" },
    { path: "lib/ebay/deleted.ts", status: "D" },
    { path: "lib/ebay/new-name.ts", status: "R" },
    { path: "lib/ebay/copied.ts", status: "C" },
    { path: "lib/ebay/type.ts", status: "T" },
  ])
  assert.equal(observed.headCommit.changedPaths.length, 100)
})

test("unavailable repository and malformed output fail closed without invented counts", async () => {
  const unavailable = await collect({ verifyRepository: async () => result("false\n") })
  assert.equal(unavailable.repository.status, "UNAVAILABLE")
  assert.equal(unavailable.workingTree.status, "UNAVAILABLE")
  assert.equal(unavailable.workingTree.stagedCount, null)
  const malformed = await collect({
    readHeadSha: async () => result("not-a-sha\n"),
    readStatus: async () => result("unexpected status payload\0"),
    readRecentCommits: async () => result("bad\x1e"),
    readHeadParents: async () => result("not-a-parent\n"),
    readHeadChangedPaths: async () => result("M\0"),
    readAheadBehind: async () => result("unknown values\n"),
  })
  assert.equal(malformed.head.sha, null)
  assert.equal(malformed.workingTree.status, "UNAVAILABLE")
  assert.equal(malformed.workingTree.stagedCount, null)
  assert.equal(malformed.upstream.ahead, null)
  assert.ok(malformed.limitations.includes("GIT_HEAD_UNAVAILABLE"))
  assert.ok(malformed.limitations.includes("GIT_STATUS_OUTPUT_MALFORMED"))
  assert.ok(malformed.limitations.includes("GIT_LOG_OUTPUT_MALFORMED"))
  assert.ok(malformed.limitations.includes("GIT_AHEAD_BEHIND_MALFORMED"))
  assert.equal(malformed.headCommit.parentSha, null)
  assert.equal(malformed.headCommit.changedPathCount, null)
})

test("unsafe paths, remote-looking values, and sensitive values are omitted", async () => {
  const observed = await collect({ readStatus: async () => result(status(
    "?? /home/earch/.config/secret", "?? ../outside", "?? .env.local",
    "?? keys/production.pem", "?? safe/repo-relative.txt",
  )) })
  assert.equal(observed.workingTree.untrackedCount, 5)
  assert.deepEqual(observed.workingTree.untrackedPaths, ["safe/repo-relative.txt"])
  assert.equal(observed.workingTree.pathsTruncated, true)
  const serialized = JSON.stringify(observed)
  assert.doesNotMatch(serialized, /\/home\/earch|\.env\.local|production\.pem|secret/)
})

test("unsafe HEAD commit paths remain omitted and unknown statuses never expose contents", async () => {
  const observed = await collect({ readHeadChangedPaths: async () => result(
    "M\0/home/earch/.config/secret\0A\0.env.local\0Q\0safe/unknown-status.ts\0",
  ) })
  assert.equal(observed.headCommit.changedPathCount, 3)
  assert.equal(observed.headCommit.pathsTruncated, true)
  assert.deepEqual(observed.headCommit.changedPaths, [
    { path: "safe/unknown-status.ts", status: "UNKNOWN" },
  ])
  const serialized = JSON.stringify(observed.headCommit)
  assert.doesNotMatch(serialized, /\/home\/earch|\.env\.local|secret|diff|patch|contents/)
})

test("fixed collector source prohibits arbitrary Git, repo, revision, contents, and network", () => {
  const source = readFileSync(new URL("./ebay-seller-os-dev-status-v1.ts", import.meta.url), "utf8")
  assert.equal(SELLER_OS_CANONICAL_REPOSITORY_V1.id, "SELLER_OS_CANONICAL_REPOSITORY")
  assert.equal(SELLER_OS_DEV_STATUS_TOOL_V1.name, "seller_os_get_dev_status")
  assert.equal(SELLER_OS_DEV_STATUS_TOOL_V1.annotations.readOnlyHint, true)
  assert.equal(SELLER_OS_DEV_STATUS_TOOL_V1.sideEffects, false)
  assert.match(source, /execFile\(GIT_EXECUTABLE, \[\.\.\.GIT_BASE_ARGUMENTS, \.\.\.args\]/)
  assert.match(source, /"diff-tree", "--no-commit-id", "--name-status", "-r", "-z", "--find-renames", "HEAD"/)
  assert.doesNotMatch(source, /\bexec\s*\(|\bspawn\s*\(|shell\s*:\s*true|\beval\s*\(|\bfetch\s*\(/)
  assert.doesNotMatch(source, /["'](?:ls-remote|fetch|pull|push|commit|reset|checkout|restore|clean|stash|merge|rebase)["']/)
  assert.doesNotMatch(source, /options\.(?:repo|repository|revision|command|path)|input\.(?:repo|repository|revision|command|path)/)
})

test("safety contract keeps every mutation counter at zero", async () => {
  const observed = await collect()
  assert.deepEqual(observed.safety, {
    readOnly: true,
    arbitraryGitAllowed: false,
    callerControlledRepositoryAllowed: false,
    callerControlledRevisionAllowed: false,
    fileContentsIncluded: false,
    remoteMutationAllowed: false,
    credentialsIncluded: false,
    environmentValuesIncluded: false,
    marketplaceWrites: 0,
    inventoryWrites: 0,
    productCaseMutations: 0,
    lunaLinkMutations: 0,
    whatsappSends: 0,
  })
})
