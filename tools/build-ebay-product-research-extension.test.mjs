import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"

import {
  PRODUCT_RESEARCH_EXTENSION_FILES,
  buildProductResearchExtensionArtifact,
} from "./build-ebay-product-research-extension.mjs"

const root = resolve("tools/browser-extensions/ebay-product-research-capture")
const archivePath = resolve(
  "public/seller-os-tools/ebay-product-research-capture-extension-v1.2.39.zip",
)

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

test("build identity is derived from the exact archive and its manifest version", () => {
  const artifact = buildProductResearchExtensionArtifact(root)
  const manifest = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8"))
  const archive = readFileSync(archivePath)
  assert.equal(PRODUCT_RESEARCH_EXTENSION_FILES.includes("manifest.json"), true)
  assert.equal(artifact.version, manifest.version)
  assert.equal(artifact.artifactSha256, sha256(artifact.archive))
  assert.equal(artifact.buildId, artifact.artifactSha256)
  assert.equal(artifact.artifactSha256, sha256(archive))
  assert.equal(artifact.version, "1.2.39")
  assert.match(artifact.sourceTreeSha256, /^[0-9a-f]{64}$/)
})

test("a versioned archive cannot inherit a previous version build identity", () => {
  const artifact = buildProductResearchExtensionArtifact(root)
  const previousArchive = readFileSync(resolve(
    "public/seller-os-tools/ebay-product-research-capture-extension-v1.2.37.zip",
  ))
  assert.notEqual(artifact.buildId, sha256(previousArchive))
})
