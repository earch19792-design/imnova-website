import { execFile, spawn } from "node:child_process"
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, readlink,
  rename, rm, symlink, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import {
  SELLER_OS_WORKSPACE_FINGERPRINT_VERSION,
  collectSellerOsWorkspaceFingerprintV1,
} from "../lib/ebay/ebay-seller-os-workspace-fingerprint-v1.mjs"

export const SELLER_OS_VALIDATION_EVIDENCE_VERSION = "SELLER_OS_VALIDATION_EVIDENCE_V1"
export const SELLER_OS_VALIDATION_PRODUCER_VERSION = "SELLER_OS_VALIDATION_RECORDER_V2"
export const SELLER_OS_VALIDATION_ARTIFACT_RELATIVE_PATH = ".seller-os/validation-evidence-v1.json"

const REPOSITORY_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const ARTIFACT_PATH = resolve(REPOSITORY_DIRECTORY, SELLER_OS_VALIDATION_ARTIFACT_RELATIVE_PATH)
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024
const MAX_FAILURE_SUMMARIES = 20
const MAX_BUILD_WORKSPACE_FILES = 10_000
const MAX_BUILD_WORKSPACE_FILE_BYTES = 64 * 1024 * 1024
const MAX_BUILD_WORKSPACE_TOTAL_BYTES = 512 * 1024 * 1024
const VALIDATION_CHECKS = Object.freeze([
  "tests", "typecheck", "lint", "build", "sellerOsAudit",
])

function now() {
  return new Date().toISOString()
}

function run(executable, args, options = {}) {
  return new Promise((resolveResult) => {
    const started = Date.now()
    const child = spawn(executable, args, {
      cwd: options.workingDirectory ?? REPOSITORY_DIRECTORY,
      env: { ...process.env,
        EBAY_DRAFT_ONLY_WRITES_ENABLED: "false",
        EBAY_DRAFT_ONLY_PRODUCTION_WRITES_ENABLED: "false",
        EBAY_SELLER_WHATSAPP_ENABLED: "false" },
      windowsHide: true,
      shell: false,
    })
    let output = ""
    let overflowed = false
    let timedOut = false
    let spawnError = false
    const capture = (chunk) => {
      if (overflowed) return
      const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk)
      if (Buffer.byteLength(output, "utf8") + Buffer.byteLength(text, "utf8") > MAX_OUTPUT_BYTES) {
        overflowed = true
        child.kill("SIGTERM")
        return
      }
      output += text
    }
    child.stdout?.on("data", capture)
    child.stderr?.on("data", capture)
    child.on("error", () => { spawnError = true })
    const timeout = setTimeout(() => {
      timedOut = true
      child.kill("SIGTERM")
    }, options.timeoutMs ?? 15 * 60 * 1000)
    child.on("close", (exitCode) => {
      clearTimeout(timeout)
      const unavailable = spawnError || overflowed || timedOut
      resolveResult(Object.freeze({
        status: unavailable ? "UNAVAILABLE" : exitCode === 0 ? "PASS" : "FAIL",
        exitCode: unavailable ? null : typeof exitCode === "number" ? exitCode : null,
        durationMs: Date.now() - started,
        output,
      }))
    })
  })
}

function listFixedGitVisiblePaths() {
  return new Promise((resolvePaths, reject) => {
    execFile("/usr/bin/git", ["--no-optional-locks", "ls-files", "--cached", "--others",
      "--exclude-standard", "-z"], { cwd: REPOSITORY_DIRECTORY, encoding: "utf8",
      timeout: 10_000, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true, shell: false },
    (error, stdout) => {
      if (error) {
        reject(new Error("SELLER_OS_VALIDATION_WORKSPACE_LIST_UNAVAILABLE"))
        return
      }
      const paths = stdout.split("\u0000").filter(Boolean).sort()
      if (paths.length > MAX_BUILD_WORKSPACE_FILES || paths.some((path) => path.startsWith("/") ||
          path.includes("\\") || path.split("/").some((segment) => !segment ||
            segment === "." || segment === ".." || segment === ".git"))) {
        reject(new Error("SELLER_OS_VALIDATION_WORKSPACE_LIST_UNSAFE"))
        return
      }
      resolvePaths(paths)
    })
  })
}

async function createFixedBuildWorkspace() {
  const directory = await mkdtemp("/tmp/seller-os-validation-build-")
  try {
    let copiedBytes = 0
    for (const path of await listFixedGitVisiblePaths()) {
      const source = resolve(REPOSITORY_DIRECTORY, path)
      const destination = resolve(directory, path)
      let stat
      try { stat = await lstat(source) } catch (error) {
        if (error?.code === "ENOENT") continue
        throw error
      }
      await mkdir(dirname(destination), { recursive: true })
      if (stat.isSymbolicLink()) {
        await symlink(await readlink(source), destination)
      } else if (stat.isFile()) {
        copiedBytes += stat.size
        if (stat.size > MAX_BUILD_WORKSPACE_FILE_BYTES ||
            copiedBytes > MAX_BUILD_WORKSPACE_TOTAL_BYTES) {
          throw new Error("SELLER_OS_VALIDATION_WORKSPACE_COPY_NOT_BOUNDED")
        }
        await copyFile(source, destination)
        await chmod(destination, stat.mode & 0o777)
      } else {
        throw new Error("SELLER_OS_VALIDATION_WORKSPACE_ENTRY_UNSUPPORTED")
      }
    }
    await symlink(resolve(REPOSITORY_DIRECTORY, "node_modules"),
      resolve(directory, "node_modules"), "dir")
    return directory
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}

async function listFixedSellerOsTests() {
  const [libraryEntries, toolEntries] = await Promise.all([
    readdir(resolve(REPOSITORY_DIRECTORY, "lib/ebay")),
    readdir(resolve(REPOSITORY_DIRECTORY, "tools")),
  ])
  const libraryTests = libraryEntries.filter((entry) => /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.test\.mjs$/.test(entry))
    .sort().map((entry) => `lib/ebay/${entry}`)
  const toolTests = toolEntries.filter((entry) => /^ebay-[a-zA-Z0-9][a-zA-Z0-9._-]*-tests\.mjs$/.test(entry))
    .sort().map((entry) => `tools/${entry}`)
  return Object.freeze([...libraryTests, ...toolTests])
}

function parseCount(output, name) {
  const match = new RegExp(`^# ${name} (\\d+)\\s*$`, "m").exec(stripTerminalCodes(output))
  return match && Number.isSafeInteger(Number(match[1])) ? Number(match[1]) : null
}

function stripTerminalCodes(value) {
  return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
}

function safeTestIdentifier(value) {
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim()
  return normalized && normalized.length <= 180 && !normalized.startsWith("/") &&
    !normalized.includes("..") && /^[a-zA-Z0-9 _.,:;#()[\]{}./-]+$/.test(normalized)
    ? normalized : null
}

function testFailureSummaries(output) {
  const summaries = []
  for (const match of stripTerminalCodes(output).matchAll(/^not ok \d+ - ([^\r\n]+)/gm)) {
    const identifier = safeTestIdentifier(match[1] ?? "")
    if (identifier && summaries.length < MAX_FAILURE_SUMMARIES) {
      summaries.push(Object.freeze({ identifier }))
    }
  }
  return Object.freeze(summaries)
}

async function executeFixedCheck(name) {
  if (name === "tests") {
    const tests = await listFixedSellerOsTests()
    if (tests.length === 0) return Object.freeze({ status: "UNAVAILABLE", exitCode: null,
      durationMs: null, completedAt: now(), scope: "FULL_SELLER_OS_SUITE",
      passed: null, failed: null, skipped: null, failureSummaries: Object.freeze([]),
      failuresTruncated: false })
    const temporaryDirectory = await mkdtemp("/tmp/seller-os-validation-tap-")
    const reportPath = resolve(temporaryDirectory, "tap.txt")
    try {
      const result = await run(process.execPath, ["--test", "--test-reporter=tap",
        `--test-reporter-destination=${reportPath}`, "--", ...tests])
      let report = ""
      try {
        report = await readFile(reportPath, "utf8")
        if (Buffer.byteLength(report, "utf8") > MAX_OUTPUT_BYTES) report = ""
      } catch {}
      const summaries = testFailureSummaries(report)
      return Object.freeze({ status: result.status, exitCode: result.exitCode,
        durationMs: result.durationMs, completedAt: now(), scope: "FULL_SELLER_OS_SUITE",
        passed: parseCount(report, "pass"), failed: parseCount(report, "fail"),
        skipped: parseCount(report, "skipped"), failureSummaries: summaries,
        failuresTruncated: false })
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true })
    }
  }
  if (name === "typecheck" || name === "build") {
    const buildWorkspace = await createFixedBuildWorkspace()
    try {
      const args = name === "typecheck"
        ? ["node_modules/typescript/bin/tsc", "--noEmit", "--incremental", "false"]
        : ["node_modules/next/dist/bin/next", "build", "--webpack"]
      const result = await run(process.execPath, args,
        { workingDirectory: buildWorkspace })
      return Object.freeze({ status: result.status, exitCode: result.exitCode,
        durationMs: result.durationMs, completedAt: now() })
    } finally {
      await rm(buildWorkspace, { recursive: true, force: true })
    }
  }
  const fixedArguments = {
    lint: ["node_modules/eslint/bin/eslint.js", "."],
    sellerOsAudit: ["tools/ebay-seller-os-ci-guards.mjs"],
  }
  const args = fixedArguments[name]
  if (!args) throw new Error("SELLER_OS_VALIDATION_CHECK_NOT_ALLOWLISTED")
  const result = await run(process.execPath, args)
  return Object.freeze({ status: result.status, exitCode: result.exitCode,
    durationMs: result.durationMs, completedAt: now() })
}

async function publishFixedArtifact(evidence) {
  const artifactDirectory = dirname(ARTIFACT_PATH)
  await mkdir(artifactDirectory, { recursive: true })
  const temporaryPath = `${ARTIFACT_PATH}.tmp-${process.pid}`
  await writeFile(temporaryPath, `${JSON.stringify(evidence)}\n`, { encoding: "utf8", mode: 0o600 })
  await rename(temporaryPath, ARTIFACT_PATH)
}

export async function recordSellerOsValidationEvidenceV1(dependencies = {}) {
  const readSubject = dependencies.readSubject ?? collectSellerOsWorkspaceFingerprintV1
  const executeCheck = dependencies.executeCheck ?? executeFixedCheck
  const publish = dependencies.publish ?? publishFixedArtifact
  const observedNow = dependencies.now ?? now
  const startedAt = observedNow()
  const startSubject = await readSubject()
  const checks = {}
  for (const name of VALIDATION_CHECKS) checks[name] = await executeCheck(name)
  const endSubject = await readSubject()
  const headChangedDuringValidation = startSubject.status !== "AVAILABLE" ||
    endSubject.status !== "AVAILABLE" || startSubject.headSha !== endSubject.headSha
  const workspaceChangedDuringValidation = startSubject.status !== "AVAILABLE" ||
    endSubject.status !== "AVAILABLE" ||
    startSubject.fingerprint !== endSubject.fingerprint ||
    startSubject.workingTreeStatus !== endSubject.workingTreeStatus
  const subjectStable = !headChangedDuringValidation && !workspaceChangedDuringValidation
  const subjectType = subjectStable
    ? startSubject.workingTreeStatus === "CLEAN"
      ? "CLEAN_COMMITTED_HEAD" : "DIRTY_WORKTREE_SNAPSHOT"
    : "UNAVAILABLE"
  const evidence = Object.freeze({
    artifactVersion: SELLER_OS_VALIDATION_EVIDENCE_VERSION,
    producer: Object.freeze({ id: "SELLER_OS_VALIDATION_RECORDER",
      version: SELLER_OS_VALIDATION_PRODUCER_VERSION }),
    source: "LOCAL_VALIDATION",
    validatedHeadSha: subjectStable ? endSubject.headSha : null,
    startedAt,
    completedAt: observedNow(),
    headChangedDuringValidation,
    workspaceChangedDuringValidation,
    validationSubject: Object.freeze({
      type: subjectType,
      validatedWorkingTreeStatus: subjectStable
        ? startSubject.workingTreeStatus : "UNAVAILABLE",
      validatedWorkspaceFingerprint: subjectStable ? startSubject.fingerprint : null,
      fingerprintVersion: SELLER_OS_WORKSPACE_FINGERPRINT_VERSION,
      workspaceStableDuringValidation: subjectStable,
    }),
    checks,
  })
  await publish(evidence)
  return evidence
}
