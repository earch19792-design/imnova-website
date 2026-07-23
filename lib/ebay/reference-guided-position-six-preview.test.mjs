import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const route = readFileSync(new URL(
  "../../app/api/admin/ebay/images/route.ts", import.meta.url), "utf8")
const workspace = readFileSync(new URL(
  "../../app/admin/ebay/listing-workspace/page.tsx", import.meta.url), "utf8")

test("attempt GET binds and verifies the private position 6 output fail-closed", () => {
  assert.match(route, /Number\(job\.position\) === 6/)
  assert.match(route, /positionSixSlot\?\.asset_role === "SECONDARY_HUMAN_CONTEXT"/)
  assert.match(route, /outputPath\.includes\(`\/\$\{attempt\.id\}\/position-6\/`\)/)
  assert.match(route, /outputPath\.endsWith\(`\/\$\{outputSha256\}\.png`\)/)
  assert.match(route, /roundtrip\.data\.type === "image\/png"/)
  assert.match(route, /metadata\.width === 1600 && metadata\.height === 1600/)
  assert.match(route, /createHash\("sha256"\)\.update\(bytes\)\.digest\("hex"\) === outputSha256/)
  assert.match(route, /signedPreviewUrl: preview\.data\.signedUrl/)
  assert.match(route, /roundtripVerified: true/)
})

test("workspace renders QA_PENDING position 6 with immutable identity and fresh URL", () => {
  assert.match(workspace, /referenceGuidedPositionSix\?\.status === "QA_PENDING"/)
  assert.match(workspace, /Secundaria 6 · SECONDARY_HUMAN_CONTEXT/)
  assert.match(workspace, /Estado: QA_PENDING · revisión humana requerida/)
  assert.match(workspace, /key=\{`position-6-\$\{String\(referenceGuidedPositionSix\.output_sha256\)\}`\}/)
  assert.match(workspace, /src=\{String\(referenceGuidedPositionSix\.signedPreviewUrl\)\}/)
  assert.match(workspace, /REFERENCE_GUIDED_POSITION_6_SIGNED_PREVIEW_LOAD_FAILED/)
  assert.match(workspace, /Recarga para solicitar una URL firmada nueva/)
  assert.match(workspace, /if \(positionSix\?\.status === "QA_PENDING"\) return/)
})

test("preview fix contains no provider, authorization, lease, output, or eBay write", () => {
  const relevantRoute = route.slice(
    route.indexOf("const positionSixSlot"),
    route.indexOf("const progressedJobs"),
  )
  assert.doesNotMatch(relevantRoute, /OPENAI|provider_calls|AUTHORIZED|CONSUMED/)
  assert.doesNotMatch(relevantRoute, /\.(?:insert|upsert|remove)\(/)
  assert.doesNotMatch(relevantRoute, /\.from\([^)]*\)[\s\S]{0,80}\.update\(/)
  assert.doesNotMatch(relevantRoute, /lease_owner|ebay/i)
})
