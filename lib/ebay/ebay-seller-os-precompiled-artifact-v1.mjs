import { createHash } from "node:crypto"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { lstat, readFile, readdir, readlink, realpath } from "node:fs/promises"
import { resolve, relative } from "node:path"
import { collectSellerOsWorkspaceFingerprintV1 } from "./ebay-seller-os-workspace-fingerprint-v1.mjs"

export const PRECOMPILED_ARTIFACT_VERSION = "SELLER_OS_PRECOMPILED_ARTIFACT_V1"
export const VALIDATION_RECEIPT = ".seller-os/validation-evidence-v1.json"
const CANONICAL = "/home/earch/imnova-seller-os-canonical-integration-foundation-v1"
const exec = promisify(execFile)

async function git(directory, args) {
  return (await exec("/usr/bin/git", ["--no-optional-locks", "-c", "core.fsmonitor=false",
    "-c", "core.hooksPath=/dev/null", ...args], { cwd: directory, encoding: "buffer",
    timeout: 5000, maxBuffer: 32 * 1024 * 1024 })).stdout
}

// Operator/build-only directory binding; the HTTP consumer always uses cwd.
export async function capturePrecompiledSourceSubjectV1(directory) {
  const root = await realpath(directory)
  const fixedRead = args => () => git(root, args)
  return collectSellerOsWorkspaceFingerprintV1({ adapter: {
    readHead: fixedRead(["rev-parse", "HEAD"]),
    readStatus: fixedRead(["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
    readUnstagedDiff: fixedRead(["diff", "--binary", "--no-ext-diff", "--no-textconv"]),
    readStagedDiff: fixedRead(["diff", "--cached", "--binary", "--no-ext-diff", "--no-textconv"]),
    readUntrackedPaths: fixedRead(["ls-files", "--others", "--exclude-standard", "-z"]),
    readUntrackedEntry: async path => {
      const target = resolve(root, path)
      if (!target.startsWith(root + "/")) throw new Error("SOURCE_PATH_INVALID")
      const stat = await lstat(target)
      if (stat.isSymbolicLink()) return Buffer.concat([Buffer.from("symlink\0"), await readlink(target, "buffer")])
      if (!stat.isFile() || stat.size > 16 * 1024 * 1024) throw new Error("SOURCE_ENTRY_INVALID")
      return readFile(target)
    },
  } })
}

export async function digestPrecompiledPayloadV1(directory) {
  const root = await realpath(directory), hash = createHash("sha256")
  let files = 0, bytes = 0
  async function visit(path) {
    const stat = await lstat(path), name = relative(root, path)
    if (stat.isDirectory()) {
      for (const entry of (await readdir(path)).sort()) {
        // Compiler caches/telemetry are not executable build outputs.
        if (name === ".next" && ["cache", "dev", "trace", "trace-build", "diagnostics"].includes(entry)) continue
        await visit(resolve(path, entry))
      }
    } else if (stat.isFile()) {
      if (++files > 30000 || (bytes += stat.size) > 1024 * 1024 * 1024) throw new Error("ARTIFACT_NOT_BOUNDED")
      hash.update(`${name}\0${stat.mode & 0o777}\0${stat.size}\0`)
      hash.update(await readFile(path))
    } else if (stat.isSymbolicLink()) {
      const destination = await realpath(path)
      if (!destination.startsWith(root + "/")) throw new Error("ARTIFACT_EXTERNAL_LINK")
      hash.update(`${name}\0symlink\0${await readlink(path)}\0`)
    } else throw new Error("ARTIFACT_ENTRY_INVALID")
  }
  for (const path of [".next", "public", "package.json", "package-lock.json", "next.config.mjs"]) {
    await visit(resolve(root, path))
  }
  return { digest: `sha256:${hash.digest("hex")}`, fileCount: files, byteCount: bytes }
}

export function assessPrecompiledReceiptV1(receipt, subject, payload, buildId) {
  const artifact = receipt?.buildArtifact
  return Boolean(receipt?.artifactVersion === "SELLER_OS_VALIDATION_EVIDENCE_V1" &&
    receipt.producer?.id === "SELLER_OS_VALIDATION_RECORDER" &&
    ["tests", "typecheck", "lint", "build", "sellerOsAudit", "targetedRuntimeSecurity"].every(name => receipt.checks?.[name]?.status === "PASS") &&
    receipt.headChangedDuringValidation === false && receipt.workspaceChangedDuringValidation === false &&
    receipt.validationSubject?.type === "CLEAN_COMMITTED_HEAD" &&
    artifact?.version === PRECOMPILED_ARTIFACT_VERSION &&
    subject.status === "AVAILABLE" && subject.workingTreeStatus === "CLEAN" &&
    /^[a-f0-9]{40}$/.test(subject.headSha ?? "") &&
    artifact.sourceCommitSha === subject.headSha && receipt.validatedHeadSha === subject.headSha &&
    artifact.worktreeFingerprint === subject.fingerprint &&
    receipt.validationSubject.validatedWorkspaceFingerprint === subject.fingerprint &&
    artifact.buildId === buildId && Boolean(buildId) &&
    artifact.buildArtifactDigest === payload.digest &&
    Number.isFinite(Date.parse(artifact.builtAt)))
}

export async function inspectPrecompiledRuntimeArtifactV1() {
  const unavailable = { status: "UNAVAILABLE", runtimeBuildShaMatch: false,
    sourceCommitSha: null, worktreeFingerprint: null, buildId: null,
    buildArtifactDigest: null, operationalServiceBound: false }
  try {
    const root = await realpath(process.cwd())
    const raw = await readFile(resolve(root, VALIDATION_RECEIPT))
    if (raw.byteLength > 96 * 1024) return unavailable
    const receipt = JSON.parse(raw), subject = await capturePrecompiledSourceSubjectV1(root)
    const [common, canonicalCommon] = await Promise.all([root, CANONICAL].map(dir =>
      git(dir, ["rev-parse", "--path-format=absolute", "--git-common-dir"])))
    if (common.toString().trim() !== canonicalCommon.toString().trim()) return unavailable
    const buildId = (await readFile(resolve(root, ".next/BUILD_ID"), "utf8")).trim()
    const payload = await digestPrecompiledPayloadV1(root)
    if (!assessPrecompiledReceiptV1(receipt, subject, payload, buildId)) return unavailable
    return { status: "MATCHED", runtimeBuildShaMatch: true, sourceCommitSha: subject.headSha,
      worktreeFingerprint: subject.fingerprint, buildId, buildArtifactDigest: payload.digest,
      operationalServiceBound: root === await realpath(CANONICAL) }
  } catch { return unavailable }
}
