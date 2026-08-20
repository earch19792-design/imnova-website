#!/usr/bin/env node
/*
 * Developer-side recorder for the bounded RCA-03 attestation.  This is not
 * an MCP capability and accepts no arguments, SQL, paths, or object names.
 * It records the immutable, read-only RCA conclusions against the exact
 * workspace observed at publication time; it never queries or mutates data.
 */
import { mkdir, rename, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { collectSellerOsWorkspaceFingerprintV1 } from
  "../lib/ebay/ebay-seller-os-workspace-fingerprint-v1.mjs"

const repositoryDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const artifactPath = resolve(repositoryDirectory,
  ".seller-os/targeted-migration-attestation-v1.json")
const SOURCE = "RCA03_FIXED_READONLY_TARGETED_ATTESTATION"
const SHA = (value) => value ? `sha256:${value}` : null
const EMPTY = Object.freeze([])

function local(migrationId, classification, confidence, expected, observed = expected,
  limitationCodes = EMPTY) {
  return { migrationId, classification, confidence, expectedOperationDigest: SHA(expected),
    observedOperationDigest: SHA(observed), evidenceSource: SOURCE, limitationCodes }
}
function remote(migrationId, classification, confidence, historical, applied = historical,
  limitationCodes = EMPTY) {
  return { migrationId, classification, confidence, historicalArtifactDigest: SHA(historical),
    appliedArtifactDigest: SHA(applied), evidenceSource: SOURCE, limitationCodes }
}

// These are the bounded semantic/digest conclusions from RCA-03.  They are
// deliberately not a green result: incomplete target semantics remain visible
// and the remediation decision remains INSUFFICIENT_EVIDENCE.
const LOCAL_RESULTS = Object.freeze([
  local("20260717160000", "OPERATION_PRESENT_EQUIVALENT", "HIGH",
    "4a47b13741593f97a2f61e0a4cc6b5571c87e621fe80d6371e8818e78e00942b"),
  local("20260719150000", "ATTESTATION_INSUFFICIENT", "UNPROVEN", null, null,
    ["SCHEDULER_OPERATION_ATTESTATION_UNAVAILABLE"]),
  local("20260719214500", "OPERATION_PARTIALLY_PRESENT", "MEDIUM", null, null,
    ["CONFIGURATION_OPERATION_NOT_FULLY_ATTESTED"]),
  local("20260719220000", "OPERATION_PRESENT_EQUIVALENT", "HIGH",
    "e3e7e1ce900d9750cdcfb42634fbbcf38286608498fb8f756f45ff1c8836cdb5"),
  local("20260723012000", "OPERATION_PRESENT_EQUIVALENT", "HIGH",
    "6a8d0a72b5c771065de526946042ad5d43a6d7a2cafd1799e4c0a7407fb62cf1"),
  local("20260723013000", "OPERATION_PRESENT_EQUIVALENT", "HIGH",
    "f4b2350806601d483d74eac679a5fa86269dc3db56732834c365d4c8f1c69800"),
  local("20260724008000", "OPERATION_PRESENT_EQUIVALENT", "HIGH",
    "96ce7609f47a7fed69ddb17d76dd30e4ff4100d5dc9871e852c134c6d15ef984"),
  local("20260725001000", "OPERATION_PARTIALLY_PRESENT", "MEDIUM",
    "51c3a522208c34fb557397d98a85441a547fee20d0d722715bcf059953d00a85", null,
    ["CONFIGURATION_OPERATION_NOT_FULLY_ATTESTED"]),
  local("20260725002000", "OPERATION_PRESENT_EQUIVALENT", "HIGH",
    "7b7347c2f326ea049f70295cedc0934369f7a75bb717007394c44b6566dd6ce8"),
  local("20260725003000", "OPERATION_PRESENT_EQUIVALENT", "HIGH",
    "380a03c2e9b6ab810b775e9844b89c94a46561d6c68fd4dda648dce14b93d058"),
  local("20260725004000", "OPERATION_PRESENT_EQUIVALENT", "HIGH",
    "6984c8fe07c4514a0afc9fb1980b14ff1905b7cb49f4e5bd490e437edad02cf0"),
  local("20260725004500", "OPERATION_PRESENT_EQUIVALENT", "HIGH",
    "aa427efff8920a5b12000a38dc107233c57d19300bdfa263bcec2b75a4299abc"),
  local("20260725004600", "OPERATION_PRESENT_EQUIVALENT", "HIGH",
    "53f781d44625f876f1f18137842a2348f2f89c6faaa9d4a39c604724cfb0835d"),
  local("20260725005000", "OPERATION_PRESENT_EQUIVALENT", "HIGH",
    "62934c58401c06a1907a1eb78e37192c1e12c5955776a6eef436e91b5a6c2004"),
])
const REMOTE_RESULTS = Object.freeze([
  remote("20260725013000", "EXACT_APPLIED_OPERATION_PROVEN", "HIGH",
    "ea936cd5fea62c29c5bd8b32df0f1df9d37bc4e783c3369c9e8d35c0506c5fa2"),
  remote("20260726140000", "APPLIED_OPERATION_ATTESTATION_ONLY", "MEDIUM",
    "62a0297e745b616d143e66b63e6a17544dd5e8e159c83aeda87fd24fb257f4a5",
    "0f3c959de8dd522d5a0ffd05dbfc158af57c8c7ce0b15c05ebcbc8b77ec8849a",
    ["EXACT_OPERATION_EQUIVALENCE_UNPROVEN"]),
  remote("20260726141000", "HISTORICAL_ARTIFACT_PROVEN_APPLIED", "HIGH", null, null),
  remote("20260726142000", "HISTORICAL_ARTIFACT_PROVEN_APPLIED", "HIGH",
    "e2a93f5303028b43ce0caf1ff43bac97806f018390f3d9cb640603fd41101b2e"),
  remote("20260726144000", "HISTORICAL_ARTIFACT_PROVEN_APPLIED", "HIGH", null, null),
])

export async function recordSellerOsTargetedMigrationAttestationV1({
  now = () => new Date(),
  readSubject = collectSellerOsWorkspaceFingerprintV1,
  publish = async (payload) => {
    await mkdir(dirname(artifactPath), { recursive: true, mode: 0o700 })
    const temporary = `${artifactPath}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(payload)}\n`, { mode: 0o600 })
    await rename(temporary, artifactPath)
  },
} = {}) {
  const start = await readSubject()
  const end = await readSubject()
  if (start.status !== "AVAILABLE" || end.status !== "AVAILABLE" ||
      start.headSha !== end.headSha || start.fingerprint !== end.fingerprint ||
      start.workingTreeStatus !== end.workingTreeStatus) {
    throw new Error("TARGETED_ATTESTATION_WORKSPACE_CHANGED")
  }
  const payload = Object.freeze({
    artifactVersion: "SELLER_OS_TARGETED_MIGRATION_ATTESTATION_V1",
    observedAt: now().toISOString(),
    subject: Object.freeze({ headSha: end.headSha,
      workingTreeStatus: end.workingTreeStatus, workspaceFingerprint: end.fingerprint }),
    localOnlyResults: LOCAL_RESULTS,
    remoteOnlyResults: REMOTE_RESULTS,
    decision: Object.freeze({ classification: "INSUFFICIENT_EVIDENCE",
      databaseMutationAuthorized: false, repositoryMutationAuthorized: false }),
    schemaDrift: Object.freeze({ status: "UNPROVEN" }),
    limitations: Object.freeze(["GLOBAL_SCHEMA_DRIFT_UNPROVEN"]),
  })
  await publish(payload)
  return Object.freeze({ headSha: end.headSha, workspaceFingerprint: end.fingerprint,
    localOnlyCount: LOCAL_RESULTS.length, remoteOnlyCount: REMOTE_RESULTS.length })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  recordSellerOsTargetedMigrationAttestationV1().then((result) => {
    console.log(JSON.stringify({ recorded: true, localOnlyCount: result.localOnlyCount,
      remoteOnlyCount: result.remoteOnlyCount, credentialsIncluded: false }))
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : "TARGETED_ATTESTATION_RECORD_FAILED")
    process.exitCode = 1
  })
}
