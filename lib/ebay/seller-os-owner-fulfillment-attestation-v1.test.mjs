import assert from "node:assert/strict"
import test from "node:test"

const { normalizeOwnerFulfillmentFieldsV1,
  classifyOwnerFulfillmentAttestationV1,
  createOwnerFulfillmentReceiptV1,
  readOwnerFulfillmentAttestationV1,
  reconcileOwnerFulfillmentAttestationV1 } = await import(
  "./seller-os-owner-fulfillment-attestation-v1.ts")

const accountKey = `seller:${"a".repeat(64)}`
const identity = { accountKey, marketplace: "EBAY_US",
  opportunityId: "ad6671f6-81b1-4d76-a1fd-a3f6408e8842",
  candidateKey: "luna-portex:10211942072544:54943494865120",
  sku: "ITEM-8058-RED-LU-DE", productId: "10211942072544",
  variantId: "54943494865120" }
const falseFields = { containsBattery: false, containsLiquid: false,
  containsAerosol: false, containsFlammableMaterial: false,
  containsPressurizedMaterial: false,
  knownSpecialTransportRestriction: false }
const actor = "1dbe5c36-4ef0-43ee-aea9-b9061ab589fa"

test("unrestricted needs six explicit false OWNER answers", () => {
  assert.throws(() => normalizeOwnerFulfillmentFieldsV1({
    ...falseFields, containsBattery: undefined }),
  /OWNER_FULFILLMENT_EXPLICIT_FIELDS_REQUIRED/)
  assert.throws(() => normalizeOwnerFulfillmentFieldsV1({
    ...falseFields, extra: false }),
  /OWNER_FULFILLMENT_EXPLICIT_FIELDS_REQUIRED/)
  assert.equal(classifyOwnerFulfillmentAttestationV1(falseFields)
    .fulfillmentAuthorityStatus, "PROVEN")
  assert.equal(classifyOwnerFulfillmentAttestationV1(falseFields)
    .classification, "UNRESTRICTED")
})

test("positive or unknown material answers require specialized authority", () => {
  for (const key of Object.keys(falseFields)) {
    for (const value of [true, "UNKNOWN"]) {
      const result = classifyOwnerFulfillmentAttestationV1({
        ...falseFields, [key]: value })
      assert.equal(result.fulfillmentAuthorityStatus, "ESCALATION_REQUIRED")
      assert.equal(result.classification, "UNKNOWN")
      assert.equal(result.specializedRestrictedGoodsAuthorityRequired, true)
      assert.deepEqual(result.escalationFields, [key])
    }
  }
})

test("receipts bind exact account and variant and retain supersession history", () => {
  const first = createOwnerFulfillmentReceiptV1({ identity,
    fields: falseFields, ownerActorUserId: actor,
    ownerConfirmedAt: "2026-09-24T04:00:00.000Z",
    previousReceiptId: null })
  const initial = reconcileOwnerFulfillmentAttestationV1({
    assessment: {}, identity, receipt: first })
  assert.equal(readOwnerFulfillmentAttestationV1({ assessment: initial,
    identity }).current?.receiptId, first.receiptId)
  const reordered = JSON.parse(JSON.stringify(initial))
  const stored = reordered.ownerFulfillmentAttestationByAccountV1[accountKey]
  stored.current.fields = Object.fromEntries(
    Object.entries(stored.current.fields).reverse())
  assert.equal(readOwnerFulfillmentAttestationV1({ assessment: reordered,
    identity }).current?.receiptId, first.receiptId)
  assert.equal(readOwnerFulfillmentAttestationV1({ assessment: initial,
    identity: { ...identity, variantId: "wrong" } }).current, null)
  const second = createOwnerFulfillmentReceiptV1({ identity,
    fields: { ...falseFields, containsBattery: "UNKNOWN" },
    ownerActorUserId: actor,
    ownerConfirmedAt: "2026-09-24T04:01:00.000Z",
    previousReceiptId: first.receiptId })
  const next = reconcileOwnerFulfillmentAttestationV1({
    assessment: initial, identity, receipt: second })
  const read = readOwnerFulfillmentAttestationV1({ assessment: next,
    identity })
  assert.equal(read.current?.receiptId, second.receiptId)
  assert.equal(read.history.length, 1)
  assert.equal(read.history[0].receiptId, first.receiptId)
  assert.equal(read.fulfillmentAuthorityStatus, "ESCALATION_REQUIRED")
  assert.equal(readOwnerFulfillmentAttestationV1({ assessment: {
    ...next, ownerFulfillmentAttestationByAccountV1: {
      [accountKey]: { current: { ...second, fields: falseFields },
        history: [first] },
    },
  }, identity }).current, null)
  assert.throws(() => reconcileOwnerFulfillmentAttestationV1({
    assessment: {}, identity, receipt: second,
  }), /OWNER_FULFILLMENT_SUPERSESSION_MISMATCH/)
})
