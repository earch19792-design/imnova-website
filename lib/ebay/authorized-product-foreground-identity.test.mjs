import assert from "node:assert/strict"
import test from "node:test"
import sharp from "sharp"

import {
  buildAuthorizedForegroundIdentityEvidence,
} from "./authorized-product-foreground-identity.ts"

async function whiteColanderFixture() {
  const holes = Array.from({ length: 12 }, (_, index) => {
    const x = 620 + (index % 4) * 90
    const y = 650 + Math.floor(index / 4) * 90
    return `<circle cx="${x}" cy="${y}" r="18" fill="#c2c2c2"/>`
  }).join("")
  return sharp(Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="1100">
      <rect width="1500" height="1100" fill="white"/>
      <ellipse cx="750" cy="230" rx="530" ry="115" fill="#f5f5f5" stroke="#424242" stroke-width="16"/>
      <path d="M220 250h1060c-45 450-260 620-530 620S265 700 220 250z" fill="#f4f4f4" stroke="#555" stroke-width="14"/>
      ${holes}
      <path d="M220 330H35M1280 330h185" stroke="#444" stroke-width="32" stroke-linecap="round"/>
      <path d="M610 850h280l80 190H530z" fill="#f4f4f4" stroke="#555" stroke-width="14"/>
    </svg>`,
  )).jpeg({ quality: 95 }).toBuffer()
}

test("Calypso-style white colander foreground excludes the white source background", async () => {
  const evidence = await buildAuthorizedForegroundIdentityEvidence(
    await whiteColanderFixture(),
    "PROTECTED_TRIMAP",
    "FRONT",
  )
  assert.equal(evidence.whiteBackgroundExcluded, true)
  assert.equal(evidence.allRequiredFeaturesPassed, true)
  assert.equal(evidence.colorAndProportionsPassed, true)
  assert.deepEqual(
    evidence.visibleFeatureChecks.map((feature) => feature.feature),
    ["HANDLES", "RIM", "PERFORATIONS", "BASE"],
  )
})
