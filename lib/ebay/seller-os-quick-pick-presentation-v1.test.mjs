import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({ resolve(specifier, context, nextResolve) {
  const value = String(specifier ?? "")
  if (value.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(value)) {
    try { return nextResolve(`${value}.ts`, context) } catch {}
  }
  return nextResolve(specifier, context)
} })

const { mergeSellerOsQuickPickPresentationV1 } = await import(
  "./seller-os-quick-pick-presentation-v1.ts")

test("canonical durable identity removes an optimistic duplicate render", () => {
  const sourceUrl = "https://www.lunaportex.com/products/phone-mount?variant=2"
  const optimistic = { sourceUrl, sourceSku: null, candidateKey: null,
    opportunityId: null, stages: { IDENTITY: "RUNNING" }, state: "RUNNING" }
  const durable = { sourceUrl, sourceSku: "FL-CUP-PHONE-MOUNT",
    lunaProductId: "9220873322720", lunaVariantId: "48809689415904",
    candidateKey: `sha256:${"6".repeat(64)}`,
    opportunityId: "b7087b76-3c03-4892-b99b-421a6f0c545c",
    stages: { IDENTITY: "PASS", MARKETPLACE_READINESS: "BLOCKED" },
    state: "BLOCKED" }
  const result = mergeSellerOsQuickPickPresentationV1([optimistic], [durable])
  assert.equal(result.length, 1)
  assert.equal(result[0].opportunityId, durable.opportunityId)
  assert.equal(result[0].sourceSku, "FL-CUP-PHONE-MOUNT")
  assert.equal(result[0].stages.IDENTITY, "PASS")
})

test("different exact variants are never deduplicated by SKU or title alone", () => {
  const first = { sourceUrl: "quick-pick:first", sourceSku: "SHARED-SKU",
    lunaProductId: "100", lunaVariantId: "200", opportunityId: "one" }
  const second = { sourceUrl: "quick-pick:second", sourceSku: "SHARED-SKU",
    lunaProductId: "100", lunaVariantId: "201", opportunityId: "two" }
  assert.equal(mergeSellerOsQuickPickPresentationV1([first, second]).length, 2)
})

test("receipt plus durable progress projects the real three-operation batch once", () => {
  const durable = [
    ["FL-CUP-PHONE-MOUNT", "9220873322720", "48809689415904", "one"],
    ["Alibaba-ScanReader-DigitalPen-B0CPHN5395", "9220840456416",
      "48809652158688", "two"],
    ["M-Smarthome-Toilet-Paper-Holder-B08DRKHV14", "9220834754784",
      "48809645900000", "three"],
  ].map(([sourceSku, lunaProductId, lunaVariantId, opportunityId]) => ({
    sourceUrl: `https://www.lunaportex.com/products/${sourceSku}`,
    sourceSku, lunaProductId, lunaVariantId, opportunityId,
  }))
  const staleReceiptCopy = { ...durable[0], opportunityId: null }
  const projected = mergeSellerOsQuickPickPresentationV1(
    [staleReceiptCopy], durable)
  assert.equal(projected.length, 3)
  assert.equal(new Set(projected.map((card) => card.sourceSku)).size, 3)
})
