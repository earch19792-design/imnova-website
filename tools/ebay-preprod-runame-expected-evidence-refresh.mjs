import { createHash, timingSafeEqual } from "node:crypto"
import {
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const TOOL_DIRECTORY = dirname(fileURLToPath(import.meta.url))
const DEFAULT_DOMAIN_PATH = resolve(
  TOOL_DIRECTORY,
  "../lib/ebay/ebay-seller-oauth-reauth-domain.ts",
)
const MAX_RUNAME_BYTES = 512

function replaceExactlyOnce(source, pattern, replacement, errorCode) {
  const matches = [...source.matchAll(pattern)]
  if (matches.length !== 1) throw new Error(errorCode)
  return source.replace(pattern, replacement)
}

export function deriveExpectedRunameEvidence(runameBytes) {
  if (!Buffer.isBuffer(runameBytes) || runameBytes.length < 1 ||
      runameBytes.length > MAX_RUNAME_BYTES ||
      runameBytes.some((byte) => byte < 0x21 || byte > 0x7e)) {
    throw new Error("RUNAME_SECURE_INPUT_INVALID")
  }
  return {
    utf8Length: runameBytes.length,
    sha256: createHash("sha256").update(runameBytes).digest("hex"),
  }
}

export function refreshExpectedRunameEvidenceSource(source, runameBytes) {
  const evidence = deriveExpectedRunameEvidence(runameBytes)
  const withLength = replaceExactlyOnce(
    source,
    /(const EXPECTED_PRODUCTION_RUNAME_UTF8_LENGTH =\s*)\d+/g,
    `$1${evidence.utf8Length}`,
    "RUNAME_EXPECTED_LENGTH_CONTRACT_NOT_UNIQUE",
  )
  return replaceExactlyOnce(
    withLength,
    /(const EXPECTED_PRODUCTION_RUNAME_SHA256 =\s*\n\s*)"[a-f0-9]{64}"/g,
    `$1"${evidence.sha256}"`,
    "RUNAME_EXPECTED_SHA256_CONTRACT_NOT_UNIQUE",
  )
}

function readHiddenAsciiBytes({ input, output, prompt }) {
  if (!input.isTTY || !output.isTTY ||
      typeof input.setRawMode !== "function") {
    return Promise.reject(new Error("SECURE_TTY_REQUIRED"))
  }
  return new Promise((resolveInput, rejectInput) => {
    const bytes = []
    const wasRaw = input.isRaw === true
    let settled = false

    const cleanup = () => {
      input.off("data", onData)
      input.setRawMode(wasRaw)
      input.pause()
    }
    const fail = (code) => {
      if (settled) return
      settled = true
      bytes.fill(0)
      cleanup()
      output.write("\n")
      rejectInput(new Error(code))
    }
    const finish = () => {
      if (settled) return
      settled = true
      const value = Buffer.from(bytes)
      bytes.fill(0)
      cleanup()
      output.write("\n")
      resolveInput(value)
    }
    const onData = (chunk) => {
      const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      for (const byte of incoming) {
        if (byte === 0x03) return fail("OPERATOR_CANCELLED")
        if (byte === 0x0a || byte === 0x0d) return finish()
        if (byte === 0x08 || byte === 0x7f) {
          bytes.pop()
          continue
        }
        if (byte < 0x21 || byte > 0x7e) {
          return fail("RUNAME_SECURE_INPUT_INVALID")
        }
        if (bytes.length >= MAX_RUNAME_BYTES) {
          return fail("RUNAME_SECURE_INPUT_TOO_LONG")
        }
        bytes.push(byte)
      }
    }

    output.write(prompt)
    input.setRawMode(true)
    input.resume()
    input.on("data", onData)
  })
}

export async function refreshExpectedRunameEvidence({
  domainPath = DEFAULT_DOMAIN_PATH,
  input = process.stdin,
  output = process.stdout,
} = {}) {
  const first = await readHiddenAsciiBytes({
    input,
    output,
    prompt: "RuName dedicado (entrada oculta): ",
  })
  let confirmation = null
  try {
    confirmation = await readHiddenAsciiBytes({
      input,
      output,
      prompt: "Confirmar RuName dedicado (entrada oculta): ",
    })
    if (first.length !== confirmation.length ||
        !timingSafeEqual(first, confirmation)) {
      throw new Error("RUNAME_SECURE_CONFIRMATION_MISMATCH")
    }

    const source = readFileSync(domainPath, "utf8")
    const updated = refreshExpectedRunameEvidenceSource(source, first)
    const temporaryPath = `${domainPath}.expected-evidence-${process.pid}`
    const mode = statSync(domainPath).mode
    try {
      writeFileSync(temporaryPath, updated, { encoding: "utf8", mode })
      renameSync(temporaryPath, domainPath)
    } finally {
      if (existsSync(temporaryPath)) rmSync(temporaryPath)
    }
    output.write("RUNAME_EXPECTED_EVIDENCE_REFRESHED=true\n")
    output.write("RUNAME_PLAINTEXT_PERSISTED=false\n")
    output.write("RUNAME_OR_FINGERPRINT_DISPLAYED=false\n")
  } finally {
    first.fill(0)
    confirmation?.fill(0)
  }
}

async function main() {
  if (process.argv.length !== 2) {
    throw new Error("ARGUMENT_INPUT_FORBIDDEN")
  }
  await refreshExpectedRunameEvidence()
}

const directInvocation = process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url

if (directInvocation) {
  main().catch((error) => {
    const safeCodes = new Set([
      "ARGUMENT_INPUT_FORBIDDEN",
      "OPERATOR_CANCELLED",
      "RUNAME_SECURE_CONFIRMATION_MISMATCH",
      "RUNAME_SECURE_INPUT_INVALID",
      "RUNAME_SECURE_INPUT_TOO_LONG",
      "RUNAME_EXPECTED_LENGTH_CONTRACT_NOT_UNIQUE",
      "RUNAME_EXPECTED_SHA256_CONTRACT_NOT_UNIQUE",
      "SECURE_TTY_REQUIRED",
    ])
    const code = error instanceof Error && safeCodes.has(error.message)
      ? error.message
      : "RUNAME_EXPECTED_EVIDENCE_REFRESH_FAILED"
    process.stderr.write(`${code}\n`)
    process.exitCode = 1
  })
}
