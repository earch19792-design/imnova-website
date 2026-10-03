import { goldenDigest, goldenFresh, goldenNumber, goldenRecord, type GoldenAuthority, type GoldenCandidateKey, type GoldenRecord } from "./commercial-golden-path-domain-v1"

export type GoldenOwnerFeePolicyInput = {
  variableRateFraction: number; fixedAmountUsd: number; freshUntil: string
  sourceLocator: string; sourceDigest: string; approvalNote: string; operatorAttested: true
}
const source = "OWNER_EXPLICIT_PROVISIONAL_EBAY_FEE_POLICY_V1"
const sha = (value: unknown) => /^sha256:[0-9a-f]{64}$/.test(String(value ?? ""))
export function buildGoldenOwnerFeePolicyV1(input: { policy: GoldenOwnerFeePolicyInput; candidate: GoldenCandidateKey; accountKey: string; ownerUserId: string; invocationSource?: string; sourceFingerprint: unknown; price: number | null; now: Date }): GoldenAuthority {
  const p = input.policy, rate = goldenNumber(p.variableRateFraction), fixed = goldenNumber(p.fixedAmountUsd)
  if (input.invocationSource !== "AUTHENTICATED_CONTROL_MCP" || !input.ownerUserId || p.operatorAttested !== true || rate === null || rate < 0 || rate > 1 || fixed === null || fixed < 0 || fixed > 10000 || !sha(p.sourceDigest) || !sha(input.sourceFingerprint) || typeof p.sourceLocator !== "string" || p.sourceLocator.length < 8 || typeof p.approvalNote !== "string" || p.approvalNote.length < 8 || !Number.isFinite(Date.parse(p.freshUntil)) || Date.parse(p.freshUntil) <= +input.now || Date.parse(p.freshUntil) > +input.now + 24 * 3600000) throw Error("OWNER_PROVISIONAL_FEE_POLICY_INVALID_OR_UNAUTHENTICATED")
  if (input.price === null || !Number.isFinite(input.price) || input.price <= 0) return { status: "UNPROVEN", reasonCode: "OWNER_PROVISIONAL_FEE_POLICY_REQUIRES_OBSERVED_SOLD_PRICE" }
  const body = { status: "PROVISIONAL_OWNER_POLICY", source, accountKey: input.accountKey, ownerUserId: input.ownerUserId, ...input.candidate, sourceFingerprint: input.sourceFingerprint, price: input.price, buyerShipping: 0, currency: "USD", amountUsd: Math.ceil((input.price * rate + fixed - 1e-9) * 100) / 100, variableRateFraction: rate, fixedAmountUsd: fixed, observedAt: input.now.toISOString(), freshUntil: p.freshUntil, sourceLocator: p.sourceLocator, sourceDigest: p.sourceDigest, approvalNote: p.approvalNote, ownerApproved: true, approvalAuthority: "AUTHENTICATED_CONTROL_MCP", officialFeeAuthority: false, realizedFeeAuthority: false }
  return { ...body, receiptId: goldenDigest(body) }
}
export function validGoldenOwnerFeePolicyV1(fee: GoldenRecord, input: { candidate: GoldenCandidateKey; accountKey: string; sourceFingerprint: unknown; price: number | null; now: Date }) {
  const { receiptId, ...body } = fee, k = input.candidate
  const rate = goldenNumber(fee.variableRateFraction), fixed = goldenNumber(fee.fixedAmountUsd)
  return fee.status === "PROVISIONAL_OWNER_POLICY" && fee.source === source && fee.ownerApproved === true && fee.approvalAuthority === "AUTHENTICATED_CONTROL_MCP" && typeof fee.ownerUserId === "string" && fee.ownerUserId.length > 0 && fee.officialFeeAuthority === false && fee.realizedFeeAuthority === false && receiptId === goldenDigest(body) && sha(fee.sourceDigest) && fee.accountKey === input.accountKey && fee.productId === k.productId && fee.variantId === k.variantId && fee.supplierSku === k.supplierSku && fee.supplierQuantity === k.supplierQuantity && fee.sourceFingerprint === input.sourceFingerprint && fee.price === input.price && input.price !== null && input.price > 0 && fee.buyerShipping === 0 && fee.currency === "USD" && rate !== null && rate >= 0 && rate <= 1 && fixed !== null && fixed >= 0 && fixed <= 10000 && fee.amountUsd === Math.ceil((input.price * rate + fixed - 1e-9) * 100) / 100 && goldenFresh(fee, input.now, 24 * 3600000)
}
export function readGoldenOwnerFeePolicyFromReceiptV1(row: GoldenRecord, input: { candidate: GoldenCandidateKey; accountKey: string; ownerUserId: string; sourceFingerprint: unknown; price: number | null; now: Date }): GoldenAuthority | null {
  const payload = goldenRecord(row.payload), execution = goldenRecord(payload.executionAuthority), fee = goldenRecord(goldenRecord(payload.economics).feeAuthority)
  if (goldenDigest(payload) !== row.evidence_digest || execution.source !== "AUTHENTICATED_CONTROL_MCP" || execution.ownerUserId !== input.ownerUserId || fee.ownerUserId !== input.ownerUserId || !validGoldenOwnerFeePolicyV1(fee, input)) return null
  return { ...fee, status: "PROVISIONAL_OWNER_POLICY" }
}
