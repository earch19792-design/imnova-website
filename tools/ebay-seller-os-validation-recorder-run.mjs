import {
  recordSellerOsValidationEvidenceV1,
} from "./ebay-seller-os-validation-recorder.mjs"

const evidence = await recordSellerOsValidationEvidenceV1()
const failed = Object.values(evidence.checks).some((check) => check.status !== "PASS")
process.stdout.write(`${JSON.stringify({ artifactVersion: evidence.artifactVersion,
  validatedHeadSha: evidence.validatedHeadSha, headChangedDuringValidation: evidence.headChangedDuringValidation,
  validationSubjectType: evidence.validationSubject.type,
  workspaceChangedDuringValidation: evidence.workspaceChangedDuringValidation,
  checks: Object.fromEntries(Object.entries(evidence.checks).map(([name, check]) =>
    [name, { status: check.status, exitCode: check.exitCode }])) })}\n`)
if (failed || evidence.headChangedDuringValidation) process.exitCode = 1
