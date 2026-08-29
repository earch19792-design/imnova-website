import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  deriveExpectedRunameEvidence,
  refreshExpectedRunameEvidenceSource,
} from "./ebay-preprod-runame-expected-evidence-refresh.mjs"

const FIXTURE_RUNAME = Buffer.from("fixture-production-runame-1234567890", "ascii")
const SOURCE = [
  "const EXPECTED_PRODUCTION_RUNAME_UTF8_LENGTH = 37",
  "const EXPECTED_PRODUCTION_RUNAME_SHA256 =",
  `  "${"a".repeat(64)}"`,
  "",
].join("\n")

test("secure evidence derivation persists only length and SHA-256", () => {
  const evidence = deriveExpectedRunameEvidence(FIXTURE_RUNAME)
  assert.deepEqual(evidence, {
    utf8Length: FIXTURE_RUNAME.length,
    sha256: createHash("sha256").update(FIXTURE_RUNAME).digest("hex"),
  })
  const updated = refreshExpectedRunameEvidenceSource(SOURCE, FIXTURE_RUNAME)
  assert.match(updated, new RegExp(
    `EXPECTED_PRODUCTION_RUNAME_UTF8_LENGTH = ${FIXTURE_RUNAME.length}`,
  ))
  assert.match(updated, new RegExp(evidence.sha256))
  assert.doesNotMatch(updated, new RegExp(FIXTURE_RUNAME.toString("ascii")))
})

test("evidence refresh requires one exact existing length and hash contract", () => {
  assert.throws(
    () => refreshExpectedRunameEvidenceSource("", FIXTURE_RUNAME),
    /RUNAME_EXPECTED_LENGTH_CONTRACT_NOT_UNIQUE/,
  )
  assert.throws(
    () => refreshExpectedRunameEvidenceSource(
      SOURCE.replace("EXPECTED_PRODUCTION_RUNAME_SHA256", "OTHER"),
      FIXTURE_RUNAME,
    ),
    /RUNAME_EXPECTED_SHA256_CONTRACT_NOT_UNIQUE/,
  )
})

test("operator mechanism forbids argv or environment secret input", () => {
  const tool = readFileSync(
    new URL("./ebay-preprod-runame-expected-evidence-refresh.mjs", import.meta.url),
    "utf8",
  )
  assert.match(tool, /SECURE_TTY_REQUIRED/)
  assert.match(tool, /input\.setRawMode\(true\)/)
  assert.match(tool, /process\.argv\.length !== 2/)
  assert.doesNotMatch(tool, /process\.env/)
  assert.doesNotMatch(tool, /console\.(?:log|error)/)
  assert.doesNotMatch(tool, /analytics|telemetry|fetch\(/i)
})

test("invalid or non-printable RuName material is rejected", () => {
  assert.throws(
    () => deriveExpectedRunameEvidence(Buffer.alloc(0)),
    /RUNAME_SECURE_INPUT_INVALID/,
  )
  assert.throws(
    () => deriveExpectedRunameEvidence(Buffer.from("bad value", "ascii")),
    /RUNAME_SECURE_INPUT_INVALID/,
  )
  assert.throws(
    () => deriveExpectedRunameEvidence(Buffer.alloc(513, 0x41)),
    /RUNAME_SECURE_INPUT_INVALID/,
  )
})
