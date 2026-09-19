import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"

import { zipSync } from "fflate"

export const PRODUCT_RESEARCH_EXTENSION_FILES = ["README.md", "admin-bridge.js",
  "background.js", "content.js",
  "ended-item-content.js", "manifest.json", "sold-content.js",
  "worker-control-recovery.js", "navigation-binding.js"]

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

export function buildProductResearchExtensionArtifact(root) {
  const manifest = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8"))
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) {
    throw new Error("PRODUCT_RESEARCH_EXTENSION_VERSION_INVALID")
  }
  const archive = zipSync(Object.fromEntries(PRODUCT_RESEARCH_EXTENSION_FILES.map((name) =>
    [name, new Uint8Array(readFileSync(resolve(root, name)))])), {
    level: 0,
    // ZIP metadata must not inherit wall-clock time. Use midday so fflate's
    // local-time DOS timestamp remains in the representable year 1980.
    mtime: new Date("1980-01-02T12:00:00.000Z"),
  })
  const artifactSha256 = sha256(archive)
  return Object.freeze({
    version: manifest.version,
    archive,
    artifactSha256,
    buildId: artifactSha256,
  })
}

export function writeProductResearchExtensionArtifact({ root, outputRoot }) {
  const artifact = buildProductResearchExtensionArtifact(root)
  const versioned = resolve(outputRoot,
    `ebay-product-research-capture-extension-v${artifact.version}.zip`)
  const current = resolve(outputRoot,
    "ebay-product-research-capture-extension.zip")
  writeFileSync(versioned, artifact.archive)
  writeFileSync(current, artifact.archive)
  return Object.freeze({
    version: artifact.version,
    artifactSha256: artifact.artifactSha256,
    buildId: artifact.buildId,
    archiveBytes: artifact.archive.byteLength,
    versioned,
    current,
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = writeProductResearchExtensionArtifact({
    root: resolve("tools/browser-extensions/ebay-product-research-capture"),
    outputRoot: resolve("public/seller-os-tools"),
  })
  console.log(JSON.stringify(result))
}
