// Retain an isolated build using the existing validation producer/receipt.
// This command never changes systemd, relay configuration, or runtime services.
import { spawn } from "node:child_process"
import { createWriteStream } from "node:fs"
import { readFile, writeFile, mkdir, readdir, rename } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { recordSellerOsValidationEvidenceV1 } from "./ebay-seller-os-validation-recorder.mjs"
import { capturePrecompiledSourceSubjectV1, digestPrecompiledPayloadV1,
  inspectPrecompiledRuntimeArtifactV1, PRECOMPILED_ARTIFACT_VERSION,
  VALIDATION_RECEIPT } from "../lib/ebay/ebay-seller-os-precompiled-artifact-v1.mjs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const node = process.execPath
const resolver = resolve(root, "tools/seller-os-test-module-resolution-v1.mjs")
const targeted = ["lib/ebay/ebay-seller-os-mcp-tunnel-development-v1.test.mjs",
  "lib/ebay/ebay-seller-os-mcp-transport-v1.test.mjs",
  "lib/ebay/ebay-seller-os-mcp-oauth-v1.test.mjs",
  "lib/ebay/ebay-seller-os-precompiled-artifact-v1.test.mjs",
  "lib/ebay/ebay-seller-os-table-acl-parser-v1.test.mjs",
  "lib/ebay/ebay-seller-os-watchdog-recovery-v1.test.mjs",
  "lib/ebay/ebay-seller-os-controlled-restart-settle-v1.test.mjs",
  "lib/seller-os/product-case-read-budget-v1.test.mjs"]

async function runCheck(name, args, timeoutMs = 15 * 60 * 1000) {
  const started = Date.now(), log = createWriteStream(resolve(root, `.seller-os/${name}.log`))
  let tail = "", byteCount = 0, overflow = false, timedOut = false
  const child = spawn(node, args, { cwd: root, detached: true,
    env: { ...process.env, NODE_ENV: name === "build" ? "production" : "test", NEXT_TELEMETRY_DISABLED: "1",
      EBAY_DRAFT_ONLY_WRITES_ENABLED: "false", EBAY_DRAFT_ONLY_PRODUCTION_WRITES_ENABLED: "false",
      EBAY_SELLER_WHATSAPP_ENABLED: "false" }, stdio: ["ignore", "pipe", "pipe"] })
  const stop = () => { try { process.kill(-child.pid, "SIGTERM") } catch {} }
  const timer = setTimeout(() => { timedOut = true; stop() }, timeoutMs)
  const killTimer = setTimeout(() => { try { process.kill(-child.pid, "SIGKILL") } catch {} }, timeoutMs + 2000)
  const capture = chunk => {
    if ((byteCount += chunk.length) > 16 * 1024 * 1024) { overflow = true; stop(); return }
    log.write(chunk); tail = (tail + chunk.toString()).slice(-16000)
  }
  child.stdout.on("data", capture); child.stderr.on("data", capture)
  const exitCode = await new Promise(res => { child.once("error", () => res(null)); child.once("close", res) })
  clearTimeout(timer); clearTimeout(killTimer)
  await new Promise(res => log.end(res))
  const count = key => { const m = new RegExp(`^# ${key} (\\d+)`, "m").exec(tail); return m ? Number(m[1]) : null }
  const result = { status: exitCode === 0 && !overflow && !timedOut ? "PASS" : "FAIL",
    exitCode, durationMs: Date.now() - started, completedAt: new Date().toISOString(),
    ...(name === "tests" ? { scope: "FULL_SELLER_OS_SUITE", passed: count("pass"), failed: count("fail"), skipped: count("skipped"), failureSummaries: [], failuresTruncated: false } : {}) }
  console.log(JSON.stringify({ check: name, ...result }))
  return result
}

async function certify() {
  // Never build in the currently operational checkout, even if invoked there.
  if (root === "/home/earch/imnova-seller-os-canonical-integration-foundation-v1") throw new Error("ISOLATED_CHECKOUT_REQUIRED")
  if (process.cwd() !== root) throw new Error("CHECKOUT_CWD_REQUIRED")
  const subject = await capturePrecompiledSourceSubjectV1(root)
  if (subject.status !== "AVAILABLE" || subject.workingTreeStatus !== "CLEAN") throw new Error("CLEAN_COMMITTED_SOURCE_REQUIRED")
  await mkdir(resolve(root, ".seller-os"), { recursive: true })
  const targetedResult = await runCheck("targetedRuntimeSecurity", ["--import", resolver, "--test", "--test-concurrency=2", ...targeted])
  if (targetedResult.status !== "PASS") throw new Error("TARGETED_SECURITY_VALIDATION_FAILED")
  const full = []
  for (const directory of ["lib/ebay", "lib/seller-os", "tools"]) {
    for (const file of (await readdir(resolve(root, directory))).sort()) {
      if (directory === "tools" ? /^ebay-.*-tests\.mjs$/.test(file) : /\.test\.mjs$/.test(file)) full.push(`${directory}/${file}`)
    }
  }
  const commands = { tests: ["--import", resolver, "--test", "--test-concurrency=2", ...full],
    typecheck: ["node_modules/typescript/bin/tsc", "--noEmit", "--incremental", "false"],
    lint: ["node_modules/eslint/bin/eslint.js", "."],
    build: ["node_modules/next/dist/bin/next", "build", "--webpack"],
    sellerOsAudit: ["tools/ebay-seller-os-ci-guards.mjs"] }
  const evidence = await recordSellerOsValidationEvidenceV1({
    readSubject: () => capturePrecompiledSourceSubjectV1(root),
    executeCheck: async name => {
      // Next owns these generated files; restore their input bytes in this
      // isolated worktree so they never enter the source commit/fingerprint.
      const generated = ["next-env.d.ts", "tsconfig.tsbuildinfo"]
      const originals = name === "build" ? await Promise.all(generated.map(async file =>
        ({ file, bytes: await readFile(resolve(root, file)).catch(() => null) }))) : []
      try { return await runCheck(name, commands[name]) }
      finally { for (const original of originals) if (original.bytes) await writeFile(resolve(root, original.file), original.bytes) }
    },
  })
  const checks = { ...evidence.checks, targetedRuntimeSecurity: targetedResult }
  let buildArtifact = null
  if (checks.build.status === "PASS") {
    const payload = await digestPrecompiledPayloadV1(root)
    buildArtifact = { version: PRECOMPILED_ARTIFACT_VERSION, sourceCommitSha: evidence.validatedHeadSha,
      worktreeFingerprint: evidence.validationSubject.validatedWorkspaceFingerprint,
      buildId: (await readFile(resolve(root, ".next/BUILD_ID"), "utf8")).trim(),
      buildArtifactDigest: payload.digest, payloadFileCount: payload.fileCount,
      payloadByteCount: payload.byteCount, builtAt: checks.build.completedAt,
      nodeVersion: process.version, nextVersion: JSON.parse(await readFile(resolve(root, "node_modules/next/package.json"), "utf8")).version,
      dynamicCompilationAtBoot: false }
  }
  const final = { ...evidence, checks, buildArtifact }
  const temporary = resolve(root, VALIDATION_RECEIPT + ".tmp")
  await writeFile(temporary, JSON.stringify(final) + "\n", { mode: 0o600 })
  await rename(temporary, resolve(root, VALIDATION_RECEIPT))
  console.log(JSON.stringify({ receipt: VALIDATION_RECEIPT, buildArtifact }))
  if (Object.values(checks).some(x => x.status !== "PASS") || evidence.workspaceChangedDuringValidation) process.exitCode = 1
}

try {
  if (process.argv[2] === "certify") await certify()
  else if (process.argv[2] === "verify") {
    const binding = await inspectPrecompiledRuntimeArtifactV1()
    console.log(JSON.stringify(binding))
    if (!binding.runtimeBuildShaMatch) process.exitCode = 1
  } else throw new Error("MODE_MUST_BE_CERTIFY_OR_VERIFY")
} catch (error) { console.error(error.message); process.exitCode = 1 }
