import { createHash, randomUUID } from "node:crypto"

import { createClient } from "@supabase/supabase-js"
import sharp from "sharp"

import {
  persistReferenceGuidedCanaryPng,
  removeReferenceGuidedCanaryPng,
} from "../lib/ebay/reference-guided-canary-persistence.ts"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? ""
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? ""
if (!url || !serviceRole) throw new Error("STAGING_SERVICE_ROLE_REQUIRED")
if (new URL(url).hostname.split(".")[0] !== "vsfthqydfrdzulldbfbe") {
  throw new Error("STAGING_PROJECT_REQUIRED")
}

const supabase = createClient(url, serviceRole, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const fixture = await sharp({
  create: {
    width: 1600,
    height: 1600,
    channels: 3,
    background: { r: 244, g: 246, b: 248 },
  },
}).png({ compressionLevel: 9 }).toBuffer()
const fixtureHash = createHash("sha256").update(fixture).digest("hex")
const prefix = `reference-guided-canary-fixtures/${randomUUID()}`
const storagePath = `${prefix}/fixture.png`
let fixtureCleanedUp = false
let falseMimeBlocked = false
let falseExtensionBlocked = false
let falseBytesBlocked = false

try {
  const persisted = await persistReferenceGuidedCanaryPng({
    supabase,
    output: fixture,
    expectedSha256: fixtureHash,
    storagePath,
  })
  try {
    await persistReferenceGuidedCanaryPng({
      supabase,
      output: fixture,
      expectedSha256: fixtureHash,
      storagePath: `${prefix}/false-mime.png`,
      contentType: "image/webp",
    })
  } catch (error) {
    falseMimeBlocked = error instanceof Error &&
      error.message === "REFERENCE_GUIDED_CANARY_OUTPUT_MIME_INVALID"
  }
  try {
    await persistReferenceGuidedCanaryPng({
      supabase,
      output: fixture,
      expectedSha256: fixtureHash,
      storagePath: `${prefix}/false-extension.jpg`,
    })
  } catch (error) {
    falseExtensionBlocked = error instanceof Error &&
      error.message === "REFERENCE_GUIDED_CANARY_OUTPUT_EXTENSION_INVALID"
  }
  const jpeg = await sharp(fixture).jpeg().toBuffer()
  try {
    await persistReferenceGuidedCanaryPng({
      supabase,
      output: jpeg,
      expectedSha256: createHash("sha256").update(jpeg).digest("hex"),
      storagePath: `${prefix}/jpeg-disguised-as-png.png`,
    })
  } catch (error) {
    falseBytesBlocked = error instanceof Error &&
      error.message === "REFERENCE_GUIDED_CANARY_OUTPUT_BYTES_INVALID"
  }
  await removeReferenceGuidedCanaryPng({ supabase, storagePath })
  const afterCleanup = await supabase.storage
    .from("ebay-listing-image-staging").download(storagePath)
  fixtureCleanedUp = Boolean(afterCleanup.error && !afterCleanup.data)
  console.log(JSON.stringify({
    fixtureUpload: persisted.uploaded,
    fixtureDownload: persisted.downloaded,
    fixtureHashMatch: persisted.hashMatch,
    fixtureDimensions: persisted.dimensions,
    fixtureCleanedUp,
    realPersistencePathTested: true,
    falseMimeBlocked: falseMimeBlocked && falseExtensionBlocked && falseBytesBlocked,
    qaStatus: persisted.qaResult.automaticStatus,
    providerCalls: 0,
    ebayWrites: 0,
    productionChanged: false,
  }))
} finally {
  if (!fixtureCleanedUp) {
    await supabase.storage.from("ebay-listing-image-staging")
      .remove([storagePath])
  }
}
