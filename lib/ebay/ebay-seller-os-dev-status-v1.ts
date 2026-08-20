import { execFile } from "node:child_process"

export const SELLER_OS_DEV_STATUS_CONTRACT_VERSION = "SELLER_OS_DEV_STATUS_V1"

export const SELLER_OS_DEV_STATUS_TOOL_V1 = Object.freeze({
  name: "seller_os_get_dev_status",
  title: "Get Seller OS development status",
  description: "Inspect only bounded Git metadata for the fixed canonical Seller OS repository. This read cannot select a repository, Git command, revision, path, remote, or network operation and never returns file contents.",
  annotations: Object.freeze({
    readOnlyHint: true as const,
    destructiveHint: false as const,
    openWorldHint: false as const,
    idempotentHint: true as const,
  }),
  sideEffects: false as const,
})

export const SELLER_OS_CANONICAL_REPOSITORY_V1 = Object.freeze({
  id: "SELLER_OS_CANONICAL_REPOSITORY",
  directory: "/home/earch/imnova-seller-os-canonical-integration-foundation-v1",
})

const GIT_EXECUTABLE = "/usr/bin/git"
const GIT_TIMEOUT_MS = 2_000
const GIT_OUTPUT_MAX_BYTES = 65_536
const MAX_PATHS_PER_CATEGORY = 100
const MAX_RECENT_COMMITS = 10
const MAX_SUBJECT_LENGTH = 240
const MAX_LIMITATIONS = 24
const GIT_BASE_ARGUMENTS = Object.freeze([
  "--no-optional-locks",
  "-c", "core.fsmonitor=false",
  "-c", "core.hooksPath=/dev/null",
  "-c", "credential.helper=",
])

type RepoStatusV1 = "AVAILABLE" | "DEGRADED" | "UNAVAILABLE"
type WorkingTreeStatusV1 = "CLEAN" | "DIRTY" | "UNAVAILABLE"
type UpstreamStatusV1 = "AVAILABLE" | "NOT_CONFIGURED" | "UNAVAILABLE"

type GitCommandResultV1 = Readonly<{
  stdout: string
  exitCode: number
}>

export type SellerOsDevStatusAdapterV1 = Readonly<{
  verifyRepository: () => Promise<GitCommandResultV1>
  readHeadSha: () => Promise<GitCommandResultV1>
  readHeadMetadata: () => Promise<GitCommandResultV1>
  readBranch: () => Promise<GitCommandResultV1>
  readStatus: () => Promise<GitCommandResultV1>
  readRecentCommits: () => Promise<GitCommandResultV1>
  readUpstreamName: () => Promise<GitCommandResultV1>
  readAheadBehind: () => Promise<GitCommandResultV1>
}>

type CountV1 = number | null

export type SellerOsDevStatusV1 = Readonly<{
  contractVersion: typeof SELLER_OS_DEV_STATUS_CONTRACT_VERSION
  observedAt: string
  repository: Readonly<{ id: "SELLER_OS_CANONICAL_REPOSITORY"; status: RepoStatusV1 }>
  head: Readonly<{
    sha: string | null
    shortSha: string | null
    branch: string | null
    detached: boolean
    commitTimestamp: string | null
    commitSubject: string | null
  }>
  workingTree: Readonly<{
    status: WorkingTreeStatusV1
    stagedCount: CountV1
    unstagedCount: CountV1
    untrackedCount: CountV1
    stagedPaths: readonly string[]
    unstagedPaths: readonly string[]
    untrackedPaths: readonly string[]
    pathsTruncated: boolean
  }>
  upstream: Readonly<{
    status: UpstreamStatusV1
    name: string | null
    ahead: CountV1
    behind: CountV1
  }>
  recentCommits: readonly Readonly<{
    sha: string
    shortSha: string
    timestamp: string | null
    subject: string | null
  }>[]
  evidenceCompleteness: "COMPLETE" | "PARTIAL" | "UNAVAILABLE"
  limitations: readonly string[]
  safety: Readonly<{
    readOnly: true
    arbitraryGitAllowed: false
    callerControlledRepositoryAllowed: false
    callerControlledRevisionAllowed: false
    fileContentsIncluded: false
    remoteMutationAllowed: false
    credentialsIncluded: false
    environmentValuesIncluded: false
    marketplaceWrites: 0
    inventoryWrites: 0
    productCaseMutations: 0
    lunaLinkMutations: 0
    whatsappSends: 0
  }>
}>

const SAFETY = Object.freeze({
  readOnly: true as const,
  arbitraryGitAllowed: false as const,
  callerControlledRepositoryAllowed: false as const,
  callerControlledRevisionAllowed: false as const,
  fileContentsIncluded: false as const,
  remoteMutationAllowed: false as const,
  credentialsIncluded: false as const,
  environmentValuesIncluded: false as const,
  marketplaceWrites: 0 as const,
  inventoryWrites: 0 as const,
  productCaseMutations: 0 as const,
  lunaLinkMutations: 0 as const,
  whatsappSends: 0 as const,
})

function runFixedGit(args: readonly string[]) {
  return new Promise<GitCommandResultV1>((resolve, reject) => {
    execFile(GIT_EXECUTABLE, [...GIT_BASE_ARGUMENTS, ...args], {
      cwd: SELLER_OS_CANONICAL_REPOSITORY_V1.directory,
      encoding: "utf8",
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_OUTPUT_MAX_BYTES,
      windowsHide: true,
      shell: false,
    }, (error, stdout) => {
      const output = typeof stdout === "string" ? stdout : ""
      if (Buffer.byteLength(output, "utf8") > GIT_OUTPUT_MAX_BYTES) {
        reject(new Error("SELLER_OS_DEV_STATUS_GIT_OUTPUT_NOT_BOUNDED"))
        return
      }
      const exitCode = typeof error?.code === "number" ? error.code : 0
      if (error && exitCode === 0) {
        reject(new Error("SELLER_OS_DEV_STATUS_GIT_READ_UNAVAILABLE"))
        return
      }
      resolve(Object.freeze({ stdout: output, exitCode }))
    })
  })
}

const DEFAULT_ADAPTER: SellerOsDevStatusAdapterV1 = Object.freeze({
  verifyRepository: () => runFixedGit(["rev-parse", "--is-inside-work-tree"]),
  readHeadSha: () => runFixedGit(["rev-parse", "HEAD"]),
  readHeadMetadata: () => runFixedGit(["show", "-s", "--format=%cI%x1f%s", "HEAD"]),
  readBranch: () => runFixedGit(["symbolic-ref", "--quiet", "--short", "HEAD"]),
  readStatus: () => runFixedGit(["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
  readRecentCommits: () => runFixedGit([
    "log", `-${MAX_RECENT_COMMITS}`, "--format=%H%x1f%h%x1f%cI%x1f%s%x1e",
  ]),
  readUpstreamName: () => runFixedGit([
    "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}",
  ]),
  readAheadBehind: () => runFixedGit([
    "rev-list", "--left-right", "--count", "@{upstream}...HEAD",
  ]),
})

function cleanText(value: string, maxLength = MAX_SUBJECT_LENGTH) {
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim()
  return normalized.length <= maxLength ? normalized : normalized.slice(0, maxLength)
}

function safeSha(value: string) {
  const sha = value.trim()
  return /^[a-f0-9]{40}$/i.test(sha) ? sha.toLowerCase() : null
}

function safeTimestamp(value: string) {
  const timestamp = value.trim()
  if (!timestamp || timestamp.length > 100) return null
  const parsed = Date.parse(timestamp)
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString()
}

function safeBranch(value: string) {
  const branch = value.trim()
  return branch && branch.length <= 160 &&
    /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(branch) && !branch.includes("..")
    ? branch : null
}

function safeRepoRelativePath(value: string) {
  const path = value.replace(/\\/g, "/")
  const segments = path.split("/")
  if (!path || path.length > 1_024 || path.startsWith("/") || path.startsWith("~") ||
      segments.some((segment) => !segment || segment === "." || segment === ".." ||
        segment === ".git")) return null
  const basename = segments.at(-1) ?? ""
  if (/^\.env(?:\.|$)/i.test(basename) ||
      /^(?:credentials?|secrets?|keys?)$/i.test(basename) ||
      /\.(?:pem|key|p12|pfx)$/i.test(basename)) return null
  return path
}

function parseStatus(raw: string) {
  const staged: string[] = []
  const unstaged: string[] = []
  const untracked: string[] = []
  const limitations: string[] = []
  let stagedCount = 0
  let unstagedCount = 0
  let untrackedCount = 0
  let pathsTruncated = false
  let malformed = false
  const records = raw.split("\0")
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (!record) continue
    if (record.length < 4 || record.slice(2, 3) !== " ") {
      limitations.push("GIT_STATUS_OUTPUT_MALFORMED")
      malformed = true
      continue
    }
    const x = record.slice(0, 1)
    const y = record.slice(1, 2)
    const path = safeRepoRelativePath(record.slice(3))
    if (!path) {
      pathsTruncated = true
      limitations.push("GIT_STATUS_PATH_OMITTED_UNSAFE")
    }
    if (x === "?" && y === "?") {
      untrackedCount += 1
      if (path && untracked.length < MAX_PATHS_PER_CATEGORY) untracked.push(path)
      else if (path) pathsTruncated = true
      continue
    }
    if (!" MADRCU".includes(x) || !" MADRCU".includes(y)) {
      limitations.push("GIT_STATUS_OUTPUT_MALFORMED")
      malformed = true
      continue
    }
    if (x !== " ") {
      stagedCount += 1
      if (path && staged.length < MAX_PATHS_PER_CATEGORY) staged.push(path)
      else if (path) pathsTruncated = true
    }
    if (y !== " ") {
      unstagedCount += 1
      if (path && unstaged.length < MAX_PATHS_PER_CATEGORY) unstaged.push(path)
      else if (path) pathsTruncated = true
    }
    if (x === "R" || x === "C" || y === "R" || y === "C") index += 1
  }
  return { stagedCount, unstagedCount, untrackedCount,
    staged: Object.freeze(staged), unstaged: Object.freeze(unstaged),
    untracked: Object.freeze(untracked), pathsTruncated, limitations, malformed }
}

function parseRecentCommits(raw: string) {
  const limitations: string[] = []
  if (Buffer.byteLength(raw, "utf8") > GIT_OUTPUT_MAX_BYTES) {
    return { commits: Object.freeze([]), limitations: ["GIT_LOG_OUTPUT_NOT_BOUNDED"] }
  }
  const commits: Array<{ sha: string; shortSha: string; timestamp: string | null;
    subject: string | null }> = []
  for (const record of raw.split("\x1e").filter(Boolean)) {
    const [full, short, timestamp, subject, ...extra] = record.split("\x1f")
    const sha = safeSha(full ?? "")
    if (!sha || extra.length || !/^[a-f0-9]{7,40}$/i.test(short ?? "")) {
      limitations.push("GIT_LOG_OUTPUT_MALFORMED")
      continue
    }
    const normalizedSubject = cleanText(subject ?? "")
    commits.push(Object.freeze({ sha, shortSha: short!.toLowerCase(),
      timestamp: safeTimestamp(timestamp ?? ""),
      subject: normalizedSubject || null }))
    if (commits.length === MAX_RECENT_COMMITS) break
  }
  return { commits: Object.freeze(commits), limitations }
}

export function createUnavailableSellerOsDevStatusV1(
  timestamp = new Date().toISOString(),
): SellerOsDevStatusV1 {
  return Object.freeze({
    contractVersion: SELLER_OS_DEV_STATUS_CONTRACT_VERSION,
    observedAt: timestamp,
    repository: Object.freeze({ id: SELLER_OS_CANONICAL_REPOSITORY_V1.id,
      status: "UNAVAILABLE" as const }),
    head: Object.freeze({ sha: null, shortSha: null, branch: null,
      detached: false, commitTimestamp: null, commitSubject: null }),
    workingTree: Object.freeze({ status: "UNAVAILABLE" as const, stagedCount: null,
      unstagedCount: null, untrackedCount: null, stagedPaths: Object.freeze([]),
      unstagedPaths: Object.freeze([]), untrackedPaths: Object.freeze([]),
      pathsTruncated: false }),
    upstream: Object.freeze({ status: "UNAVAILABLE" as const, name: null,
      ahead: null, behind: null }),
    recentCommits: Object.freeze([]), evidenceCompleteness: "UNAVAILABLE" as const,
    limitations: Object.freeze(["GIT_REPOSITORY_EVIDENCE_UNAVAILABLE"]), safety: SAFETY,
  })
}

export async function collectSellerOsDevStatusV1(options: {
  adapter?: SellerOsDevStatusAdapterV1
  now?: () => Date
} = {}): Promise<SellerOsDevStatusV1> {
  const timestamp = (() => {
    try { return (options.now ?? (() => new Date()))().toISOString() } catch { return new Date().toISOString() }
  })()
  const adapter = options.adapter ?? DEFAULT_ADAPTER
  let verified: GitCommandResultV1
  try { verified = await adapter.verifyRepository() } catch { return createUnavailableSellerOsDevStatusV1(timestamp) }
  if (verified.exitCode !== 0 || verified.stdout.trim() !== "true") return createUnavailableSellerOsDevStatusV1(timestamp)

  const [headResult, metadataResult, branchResult, statusResult, logResult,
    upstreamResult, aheadBehindResult] = await Promise.allSettled([
    adapter.readHeadSha(), adapter.readHeadMetadata(), adapter.readBranch(),
    adapter.readStatus(), adapter.readRecentCommits(), adapter.readUpstreamName(),
    adapter.readAheadBehind(),
  ])
  const limitations: string[] = []
  const headSha = headResult.status === "fulfilled" && headResult.value.exitCode === 0
    ? safeSha(headResult.value.stdout) : null
  if (!headSha) limitations.push("GIT_HEAD_UNAVAILABLE")
  const metadata = metadataResult.status === "fulfilled" && metadataResult.value.exitCode === 0
    ? metadataResult.value.stdout.split("\x1f") : []
  const commitTimestamp = metadata.length === 2 ? safeTimestamp(metadata[0]) : null
  const commitSubject = metadata.length === 2 ? cleanText(metadata[1]) || null : null
  if (!commitTimestamp || !commitSubject) limitations.push("GIT_HEAD_METADATA_PARTIAL")
  const branch = branchResult.status === "fulfilled" && branchResult.value.exitCode === 0
    ? safeBranch(branchResult.value.stdout) : null
  const detached = branch === null
  if (branchResult.status === "fulfilled" && branchResult.value.exitCode !== 0 &&
      branchResult.value.exitCode !== 1) limitations.push("GIT_BRANCH_UNAVAILABLE")

  let workingTree: SellerOsDevStatusV1["workingTree"]
  if (statusResult.status !== "fulfilled" || statusResult.value.exitCode !== 0) {
    limitations.push("GIT_STATUS_UNAVAILABLE")
    workingTree = Object.freeze({ status: "UNAVAILABLE", stagedCount: null,
      unstagedCount: null, untrackedCount: null, stagedPaths: Object.freeze([]),
      unstagedPaths: Object.freeze([]), untrackedPaths: Object.freeze([]), pathsTruncated: false })
  } else {
    const parsed = parseStatus(statusResult.value.stdout)
    limitations.push(...parsed.limitations)
    if (parsed.malformed) {
      workingTree = Object.freeze({ status: "UNAVAILABLE", stagedCount: null,
        unstagedCount: null, untrackedCount: null, stagedPaths: Object.freeze([]),
        unstagedPaths: Object.freeze([]), untrackedPaths: Object.freeze([]),
        pathsTruncated: parsed.pathsTruncated })
    } else {
      const dirty = parsed.stagedCount + parsed.unstagedCount + parsed.untrackedCount > 0
      workingTree = Object.freeze({ status: dirty ? "DIRTY" : "CLEAN",
        stagedCount: parsed.stagedCount, unstagedCount: parsed.unstagedCount,
        untrackedCount: parsed.untrackedCount, stagedPaths: parsed.staged,
        unstagedPaths: parsed.unstaged, untrackedPaths: parsed.untracked,
        pathsTruncated: parsed.pathsTruncated })
    }
  }

  const parsedLog = logResult.status === "fulfilled" && logResult.value.exitCode === 0
    ? parseRecentCommits(logResult.value.stdout)
    : { commits: Object.freeze([]), limitations: ["GIT_LOG_UNAVAILABLE"] }
  limitations.push(...parsedLog.limitations)
  let upstream: SellerOsDevStatusV1["upstream"]
  const upstreamName = upstreamResult.status === "fulfilled" && upstreamResult.value.exitCode === 0
    ? safeBranch(upstreamResult.value.stdout) : null
  if (upstreamResult.status === "fulfilled" && upstreamResult.value.exitCode !== 0 &&
      upstreamResult.value.exitCode !== 128) limitations.push("GIT_UPSTREAM_UNAVAILABLE")
  if (!upstreamName) {
    upstream = Object.freeze({ status: upstreamResult.status === "fulfilled" &&
      upstreamResult.value.exitCode === 128 ? "NOT_CONFIGURED" : "UNAVAILABLE",
      name: null, ahead: null, behind: null })
  } else if (aheadBehindResult.status === "fulfilled" && aheadBehindResult.value.exitCode === 0) {
    const values = aheadBehindResult.value.stdout.trim().split(/\s+/)
    const behind = /^\d+$/.test(values[0] ?? "") ? Number(values[0]) : null
    const ahead = /^\d+$/.test(values[1] ?? "") ? Number(values[1]) : null
    if (behind === null || ahead === null) limitations.push("GIT_AHEAD_BEHIND_MALFORMED")
    upstream = Object.freeze({ status: "AVAILABLE", name: upstreamName, ahead, behind })
  } else {
    limitations.push("GIT_AHEAD_BEHIND_UNAVAILABLE")
    upstream = Object.freeze({ status: "UNAVAILABLE", name: upstreamName,
      ahead: null, behind: null })
  }

  const repositoryStatus: RepoStatusV1 = headSha && workingTree.status !== "UNAVAILABLE"
    ? limitations.length === 0 ? "AVAILABLE" : "DEGRADED"
    : "DEGRADED"
  const boundedLimitations = Object.freeze([...new Set(limitations)].sort()
    .slice(0, MAX_LIMITATIONS))
  const evidenceCompleteness = boundedLimitations.length === 0 ? "COMPLETE" as const
    : repositoryStatus === "DEGRADED" ? "PARTIAL" as const : "UNAVAILABLE" as const
  return Object.freeze({
    contractVersion: SELLER_OS_DEV_STATUS_CONTRACT_VERSION, observedAt: timestamp,
    repository: Object.freeze({ id: SELLER_OS_CANONICAL_REPOSITORY_V1.id,
      status: repositoryStatus }),
    head: Object.freeze({ sha: headSha, shortSha: headSha?.slice(0, 12) ?? null,
      branch, detached, commitTimestamp, commitSubject }),
    workingTree, upstream, recentCommits: parsedLog.commits, evidenceCompleteness,
    limitations: boundedLimitations, safety: SAFETY,
  })
}
