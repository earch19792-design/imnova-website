import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { lstat, readFile, readlink } from "node:fs/promises"
import { resolve } from "node:path"

export const SELLER_OS_WORKSPACE_FINGERPRINT_VERSION = "SELLER_OS_WORKSPACE_FINGERPRINT_V1"

const REPOSITORY_DIRECTORY = "/home/earch/imnova-seller-os-canonical-integration-foundation-v1"
const GIT_EXECUTABLE = "/usr/bin/git"
const GIT_TIMEOUT_MS = 10_000
const MAX_GIT_OUTPUT_BYTES = 32 * 1024 * 1024
const MAX_UNTRACKED_FILES = 2_000
const MAX_UNTRACKED_FILE_BYTES = 16 * 1024 * 1024
const MAX_TOTAL_UNTRACKED_BYTES = 64 * 1024 * 1024
const GIT_BASE_ARGUMENTS = Object.freeze([
  "--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null",
  "-c", "credential.helper=",
])

function runFixedGit(args) {
  return new Promise((resolveResult, reject) => {
    execFile(GIT_EXECUTABLE, [...GIT_BASE_ARGUMENTS, ...args], {
      cwd: REPOSITORY_DIRECTORY,
      encoding: "buffer",
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
      windowsHide: true,
      shell: false,
    }, (error, stdout) => {
      if (error) {
        reject(new Error("SELLER_OS_WORKSPACE_GIT_READ_UNAVAILABLE"))
        return
      }
      const output = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout ?? "")
      if (output.byteLength > MAX_GIT_OUTPUT_BYTES) {
        reject(new Error("SELLER_OS_WORKSPACE_GIT_OUTPUT_NOT_BOUNDED"))
        return
      }
      resolveResult(output)
    })
  })
}

function safeRepoRelativePath(value) {
  if (!value || value.length > 1_024 || value.startsWith("/") || value.startsWith("~") ||
      value.includes("\\") || value.includes("\u0000")) return null
  const segments = value.split("/")
  if (segments.some((segment) => !segment || segment === "." || segment === ".." ||
      segment === ".git")) return null
  const absolute = resolve(REPOSITORY_DIRECTORY, value)
  return absolute.startsWith(`${REPOSITORY_DIRECTORY}/`) ? { relative: value, absolute } : null
}

async function readFixedUntrackedEntry(path) {
  const safePath = safeRepoRelativePath(path)
  if (!safePath) throw new Error("SELLER_OS_WORKSPACE_PATH_NOT_SAFE")
  const stat = await lstat(safePath.absolute)
  if (stat.isSymbolicLink()) {
    const target = await readlink(safePath.absolute, "buffer")
    if (target.byteLength > MAX_UNTRACKED_FILE_BYTES) {
      throw new Error("SELLER_OS_WORKSPACE_ENTRY_NOT_BOUNDED")
    }
    return Buffer.concat([Buffer.from("symlink\0"), target])
  }
  if (!stat.isFile() || stat.size > MAX_UNTRACKED_FILE_BYTES) {
    throw new Error("SELLER_OS_WORKSPACE_ENTRY_NOT_BOUNDED")
  }
  return readFile(safePath.absolute)
}

const DEFAULT_ADAPTER = Object.freeze({
  readHead: () => runFixedGit(["rev-parse", "HEAD"]),
  readStatus: () => runFixedGit(["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
  readUnstagedDiff: () => runFixedGit(["diff", "--binary", "--no-ext-diff", "--no-textconv"]),
  readStagedDiff: () => runFixedGit(["diff", "--cached", "--binary", "--no-ext-diff", "--no-textconv"]),
  readUntrackedPaths: () => runFixedGit(["ls-files", "--others", "--exclude-standard", "-z"]),
  readUntrackedEntry: readFixedUntrackedEntry,
})

function shaFromBuffer(value) {
  const sha = value.toString("utf8").trim()
  return /^[a-f0-9]{40}$/i.test(sha) ? sha.toLowerCase() : null
}

function parseUntrackedPaths(value) {
  const rawPaths = value.toString("utf8").split("\u0000").filter(Boolean)
  if (rawPaths.length > MAX_UNTRACKED_FILES) return null
  const safePaths = rawPaths.map(safeRepoRelativePath)
  if (safePaths.some((entry) => entry === null)) return null
  return safePaths.map((entry) => entry.relative).sort()
}

function hashSection(hash, name, value) {
  hash.update(`${name}\u0000${value.byteLength}\u0000`)
  hash.update(value)
  hash.update("\u0000")
}

async function captureWorkspaceSnapshot(adapter) {
  const [headBuffer, status, unstagedDiff, stagedDiff, untrackedPathBuffer] =
    await Promise.all([adapter.readHead(), adapter.readStatus(), adapter.readUnstagedDiff(),
      adapter.readStagedDiff(), adapter.readUntrackedPaths()])
  const headSha = shaFromBuffer(headBuffer)
  const untrackedPaths = parseUntrackedPaths(untrackedPathBuffer)
  if (!headSha || !untrackedPaths) throw new Error("SELLER_OS_WORKSPACE_METADATA_MALFORMED")
  const hash = createHash("sha256")
  hash.update(`${SELLER_OS_WORKSPACE_FINGERPRINT_VERSION}\u0000`)
  hashSection(hash, "status", status)
  hashSection(hash, "unstaged", unstagedDiff)
  hashSection(hash, "staged", stagedDiff)
  let untrackedBytes = 0
  for (const path of untrackedPaths) {
    const content = await adapter.readUntrackedEntry(path)
    if (!Buffer.isBuffer(content)) throw new Error("SELLER_OS_WORKSPACE_ENTRY_MALFORMED")
    untrackedBytes += content.byteLength
    if (untrackedBytes > MAX_TOTAL_UNTRACKED_BYTES) {
      throw new Error("SELLER_OS_WORKSPACE_UNTRACKED_CONTENT_NOT_BOUNDED")
    }
    hashSection(hash, `untracked-path:${path}`, content)
  }
  return Object.freeze({
    status: "AVAILABLE",
    headSha,
    workingTreeStatus: status.byteLength === 0 ? "CLEAN" : "DIRTY",
    fingerprint: `sha256:${hash.digest("hex")}`,
    fingerprintVersion: SELLER_OS_WORKSPACE_FINGERPRINT_VERSION,
    limitations: Object.freeze([]),
  })
}

export async function collectSellerOsWorkspaceFingerprintV1(options = {}) {
  const adapter = options.adapter ?? DEFAULT_ADAPTER
  try {
    const first = await captureWorkspaceSnapshot(adapter)
    const second = await captureWorkspaceSnapshot(adapter)
    if (first.headSha !== second.headSha || first.fingerprint !== second.fingerprint ||
        first.workingTreeStatus !== second.workingTreeStatus) {
      return Object.freeze({ status: "UNAVAILABLE", headSha: null,
        workingTreeStatus: "UNAVAILABLE", fingerprint: null,
        fingerprintVersion: SELLER_OS_WORKSPACE_FINGERPRINT_VERSION,
        limitations: Object.freeze(["WORKSPACE_CHANGED_DURING_FINGERPRINT_CAPTURE"]) })
    }
    return first
  } catch {
    return Object.freeze({ status: "UNAVAILABLE", headSha: null,
      workingTreeStatus: "UNAVAILABLE", fingerprint: null,
      fingerprintVersion: SELLER_OS_WORKSPACE_FINGERPRINT_VERSION,
      limitations: Object.freeze(["WORKSPACE_FINGERPRINT_UNAVAILABLE"]) })
  }
}
