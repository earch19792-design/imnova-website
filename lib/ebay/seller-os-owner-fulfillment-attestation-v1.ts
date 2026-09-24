import { createHash, randomUUID } from "node:crypto"

export const OWNER_PRODUCT_FULFILLMENT_ATTESTATION =
  "OWNER_PRODUCT_FULFILLMENT_ATTESTATION" as const
export const OWNER_FULFILLMENT_RECEIPT_CONTRACT =
  "SELLER_OS_OWNER_PRODUCT_FULFILLMENT_ATTESTATION_V1" as const

export const OWNER_FULFILLMENT_FIELDS = [
  "containsBattery", "containsLiquid", "containsAerosol",
  "containsFlammableMaterial", "containsPressurizedMaterial",
  "knownSpecialTransportRestriction",
] as const

export type OwnerFulfillmentAnswerV1 = boolean | "UNKNOWN"
export type OwnerFulfillmentFieldsV1 = Readonly<Record<
  typeof OWNER_FULFILLMENT_FIELDS[number], OwnerFulfillmentAnswerV1>>

type Identity = Readonly<{
  accountKey: string
  marketplace: "EBAY_US"
  opportunityId: string
  candidateKey: string
  sku: string
  productId: string
  variantId: string
}>

const SHA = /^sha256:[0-9a-f]{64}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const record = (value: unknown): Record<string, any> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any> : {}
const digest = (value: unknown) => `sha256:${createHash("sha256")
  .update(JSON.stringify(value), "utf8").digest("hex")}`

export function normalizeOwnerFulfillmentFieldsV1(value: unknown):
  OwnerFulfillmentFieldsV1 {
  const input = record(value)
  if (Object.keys(input).length !== OWNER_FULFILLMENT_FIELDS.length ||
      OWNER_FULFILLMENT_FIELDS.some((key) =>
        input[key] !== true && input[key] !== false &&
        input[key] !== "UNKNOWN")) {
    throw new Error("OWNER_FULFILLMENT_EXPLICIT_FIELDS_REQUIRED")
  }
  return Object.freeze(Object.fromEntries(OWNER_FULFILLMENT_FIELDS.map(
    (key) => [key, input[key]])) as OwnerFulfillmentFieldsV1)
}

export function classifyOwnerFulfillmentAttestationV1(
  fields: OwnerFulfillmentFieldsV1) {
  const escalationFields = OWNER_FULFILLMENT_FIELDS.filter(
    (key) => fields[key] !== false)
  return Object.freeze(escalationFields.length === 0 ? {
    fulfillmentAuthorityStatus: "PROVEN" as const,
    classification: "UNRESTRICTED" as const,
    restrictionStatus: "NO_KNOWN_SPECIAL_RESTRICTION_OWNER_ATTESTED" as const,
    specializedRestrictedGoodsAuthorityRequired: false as const,
    escalationFields,
  } : {
    fulfillmentAuthorityStatus: "ESCALATION_REQUIRED" as const,
    classification: "UNKNOWN" as const,
    restrictionStatus: "SPECIALIZED_RESTRICTED_GOODS_AUTHORITY_REQUIRED" as const,
    specializedRestrictedGoodsAuthorityRequired: true as const,
    escalationFields,
  })
}

function receiptMaterial(value: Record<string, any>) {
  return {
    contractVersion: value.contractVersion,
    provenance: value.provenance,
    receiptId: value.receiptId,
    accountKey: value.accountKey,
    marketplace: value.marketplace,
    opportunityId: value.opportunityId,
    candidateKey: value.candidateKey,
    sku: value.sku,
    productId: value.productId,
    variantId: value.variantId,
    fields: normalizeOwnerFulfillmentFieldsV1(value.fields),
    ownerActorUserId: value.ownerActorUserId,
    ownerConfirmedAt: value.ownerConfirmedAt,
    fulfillmentAuthorityStatus: value.fulfillmentAuthorityStatus,
    classification: value.classification,
    restrictionStatus: value.restrictionStatus,
    specializedRestrictedGoodsAuthorityRequired:
      value.specializedRestrictedGoodsAuthorityRequired,
    escalationFields: value.escalationFields,
    supersedesReceiptId: value.supersedesReceiptId,
  }
}

export function certifyOwnerFulfillmentReceiptV1(value: unknown,
  identity: Identity) {
  const receipt = record(value)
  let fields: OwnerFulfillmentFieldsV1
  try { fields = normalizeOwnerFulfillmentFieldsV1(receipt.fields) }
  catch { return null }
  const classification = classifyOwnerFulfillmentAttestationV1(fields)
  if (receipt.contractVersion !== OWNER_FULFILLMENT_RECEIPT_CONTRACT ||
      receipt.provenance !== OWNER_PRODUCT_FULFILLMENT_ATTESTATION ||
      !UUID.test(String(receipt.receiptId ?? "")) ||
      !UUID.test(String(receipt.ownerActorUserId ?? "")) ||
      !Number.isFinite(Date.parse(receipt.ownerConfirmedAt)) ||
      receipt.accountKey !== identity.accountKey ||
      receipt.marketplace !== identity.marketplace ||
      receipt.opportunityId !== identity.opportunityId ||
      receipt.candidateKey !== identity.candidateKey ||
      receipt.sku !== identity.sku ||
      receipt.productId !== identity.productId ||
      receipt.variantId !== identity.variantId ||
      receipt.fulfillmentAuthorityStatus !==
        classification.fulfillmentAuthorityStatus ||
      receipt.classification !== classification.classification ||
      receipt.restrictionStatus !== classification.restrictionStatus ||
      receipt.specializedRestrictedGoodsAuthorityRequired !==
        classification.specializedRestrictedGoodsAuthorityRequired ||
      JSON.stringify(receipt.escalationFields) !==
        JSON.stringify(classification.escalationFields) ||
      (receipt.supersedesReceiptId !== null &&
        !UUID.test(String(receipt.supersedesReceiptId ?? ""))) ||
      !SHA.test(String(receipt.evidenceDigest ?? "")) ||
      receipt.evidenceDigest !== digest(receiptMaterial(receipt))) return null
  return Object.freeze(receipt)
}

export function createOwnerFulfillmentReceiptV1(input: Readonly<{
  identity: Identity
  fields: OwnerFulfillmentFieldsV1
  ownerActorUserId: string
  ownerConfirmedAt: string
  previousReceiptId: string | null
}>) {
  if (!UUID.test(input.ownerActorUserId) ||
      !Number.isFinite(Date.parse(input.ownerConfirmedAt)) ||
      (input.previousReceiptId !== null &&
        !UUID.test(input.previousReceiptId))) {
    throw new Error("OWNER_FULFILLMENT_CONFIRMATION_INVALID")
  }
  const fields = normalizeOwnerFulfillmentFieldsV1(input.fields)
  const classification = classifyOwnerFulfillmentAttestationV1(fields)
  const material = receiptMaterial({
    contractVersion: OWNER_FULFILLMENT_RECEIPT_CONTRACT,
    provenance: OWNER_PRODUCT_FULFILLMENT_ATTESTATION,
    receiptId: randomUUID(), ...input.identity, fields,
    ownerActorUserId: input.ownerActorUserId,
    ownerConfirmedAt: input.ownerConfirmedAt,
    ...classification,
    supersedesReceiptId: input.previousReceiptId,
  })
  return Object.freeze({ ...material, evidenceDigest: digest(material) })
}

export function readOwnerFulfillmentAttestationV1(input: Readonly<{
  assessment: unknown
  identity: Identity
}>) {
  const authority = record(record(input.assessment)
    .ownerFulfillmentAttestationByAccountV1)
  const state = record(authority[input.identity.accountKey])
  const current = certifyOwnerFulfillmentReceiptV1(state.current,
    input.identity)
  const history = (Array.isArray(state.history) ? state.history : [])
    .map((value: unknown) => certifyOwnerFulfillmentReceiptV1(value,
      input.identity)).filter(Boolean)
  return Object.freeze({ current, history,
    fulfillmentAuthorityStatus: current?.fulfillmentAuthorityStatus ??
      "UNKNOWN",
    classification: current?.classification ?? "UNKNOWN",
    specializedRestrictedGoodsAuthorityRequired:
      current?.specializedRestrictedGoodsAuthorityRequired ?? false,
  })
}

export function reconcileOwnerFulfillmentAttestationV1(input: Readonly<{
  assessment: unknown
  identity: Identity
  receipt: ReturnType<typeof createOwnerFulfillmentReceiptV1>
}>) {
  if (!certifyOwnerFulfillmentReceiptV1(input.receipt, input.identity)) {
    throw new Error("OWNER_FULFILLMENT_RECEIPT_INVALID")
  }
  const assessment = { ...record(input.assessment) }
  const byAccount = { ...record(
    assessment.ownerFulfillmentAttestationByAccountV1) }
  const state = record(byAccount[input.identity.accountKey])
  const current = certifyOwnerFulfillmentReceiptV1(state.current,
    input.identity)
  if (state.current && !current) {
    throw new Error("OWNER_FULFILLMENT_EXISTING_RECEIPT_INVALID")
  }
  if (input.receipt.supersedesReceiptId !== (current?.receiptId ?? null)) {
    throw new Error("OWNER_FULFILLMENT_SUPERSESSION_MISMATCH")
  }
  const history = Array.isArray(state.history) ? [...state.history] : []
  if (current) history.push(current)
  byAccount[input.identity.accountKey] = {
    current: input.receipt, history,
  }
  assessment.ownerFulfillmentAttestationByAccountV1 = byAccount
  return assessment
}
