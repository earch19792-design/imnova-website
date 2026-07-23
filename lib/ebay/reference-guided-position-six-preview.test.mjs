import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const route = readFileSync(new URL(
  "../../app/api/admin/ebay/images/route.ts", import.meta.url), "utf8")
const workspace = readFileSync(new URL(
  "../../app/admin/ebay/listing-workspace/page.tsx", import.meta.url), "utf8")

test("attempt GET explicitly binds extraordinary ordinal 8 and verifies it fail-closed", () => {
  assert.match(route, /positionSixExtraordinaryReview/)
  assert.match(route, /event\.event_type === "OUTPUT_PERSISTED"/)
  assert.match(route, /Number\(event\.extraordinary_ordinal\) === 8/)
  assert.match(route, /positionSixSlot\?\.asset_role === "SECONDARY_HUMAN_CONTEXT"/)
  assert.match(route, /ordinal8StoragePath\.includes\(`\/\$\{attempt\.id\}\/position-6\/ordinal-8\/`\)/)
  assert.match(route, /ordinal8StoragePath\.endsWith\(`\/\$\{ordinal8OutputSha256\}\.png`\)/)
  assert.match(route, /roundtrip\.data\.type === "image\/png"/)
  assert.match(route, /metadata\.width === 1600[\s\S]{0,40}metadata\.height === 1600/)
  assert.match(route, /actualSha256 === input\.outputSha256/)
  assert.match(route, /signedPreviewUrl: preview\.data\.signedUrl/)
  assert.match(route, /roundtripVerified: true/)
  assert.match(route, /currentCandidate: true/)
  assert.match(route, /approvalEnabled: Boolean/)
  assert.match(route, /\["QA_PENDING", "PASSED"\]\.includes\(positionSixJob\.status\)/)
})

test("workspace separates rejected evidence from current ordinal 8 candidate", () => {
  assert.match(workspace, /positionSixRejectedEvidence/)
  assert.match(workspace, /Output anterior rechazado · evidencia preservada/)
  assert.match(workspace, /data-position-6-extraordinary-ordinal="8"/)
  assert.match(workspace, /Secundaria 6 · SECONDARY_HUMAN_CONTEXT/)
  assert.match(workspace, /Pendiente de revisión humana/)
  assert.match(workspace, /Aprobado por revisión humana/)
  assert.match(workspace, /key=\{`position-6-ordinal-8-\$\{String\(positionSixExtraordinaryReview\.output_sha256\)\}`\}/)
  assert.match(workspace, /src=\{String\(positionSixExtraordinaryReview\.signedPreviewUrl\)\}/)
  assert.match(workspace, /REFERENCE_GUIDED_POSITION_6_ORDINAL_8_SIGNED_PREVIEW_LOAD_FAILED/)
  assert.match(workspace, /La aprobación permanece bloqueada/)
  assert.match(workspace, /Recarga para solicitar una URL firmada nueva/)
})

test("preview fix contains no provider, authorization, lease, output, or eBay write", () => {
  const relevantRoute = route.slice(
    route.indexOf("const positionSixJob"),
    route.indexOf("const progressedJobs"),
  )
  assert.doesNotMatch(relevantRoute, /OPENAI|provider_calls|AUTHORIZED|CONSUMED/)
  assert.doesNotMatch(relevantRoute, /\.(?:insert|upsert|remove)\(/)
  assert.doesNotMatch(relevantRoute, /\.from\([^)]*\)[\s\S]{0,80}\.update\(/)
  assert.doesNotMatch(relevantRoute, /lease_owner|ebay/i)
})
