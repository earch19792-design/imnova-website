import { createHmac, timingSafeEqual } from "node:crypto"

export type EbayDraftOnlyPreflightTarget = "SANDBOX" | "PRODUCTION"

export const EBAY_DRAFT_ONLY_PREFLIGHT_MAX_AGE_MS = 5 * 60_000
const SNAPSHOT_VERSION = 1

export type EbayDraftOnlyPreflightSnapshotPayload = {
  version: 1
  target: EbayDraftOnlyPreflightTarget
  accountFingerprint: string
  marketplaceId: "EBAY_US"
  fulfillmentPolicyId: string
  paymentPolicyId: string
  returnPolicyId: string
  merchantLocationKey: string
  issuedAt: string
  expiresAt: string
}

type SnapshotExpected = Pick<
  EbayDraftOnlyPreflightSnapshotPayload,
  | "target"
  | "accountFingerprint"
  | "marketplaceId"
  | "fulfillmentPolicyId"
  | "paymentPolicyId"
  | "returnPolicyId"
  | "merchantLocationKey"
>

function safeIdentifier(value: unknown, maximum = 100) {
  const normalized = typeof value === "string" ? value.trim() : ""
  return /^[A-Za-z0-9_-]+$/.test(normalized) && normalized.length <= maximum
    ? normalized
    : ""
}

function fingerprint(value: unknown) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : ""
  return /^[0-9a-f]{64}$/.test(normalized) ? normalized : ""
}

function secretReady(secret: string) {
  return typeof secret === "string" && secret.length >= 32
}

function encoded(value: string) {
  return Buffer.from(value, "utf8").toString("base64url")
}

function signature(encodedPayload: string, secret: string) {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url")
}

export function issueEbayDraftOnlyPreflightSnapshot(
  input: Omit<EbayDraftOnlyPreflightSnapshotPayload, "version" | "issuedAt" | "expiresAt">,
  secret: string,
  now = new Date(),
) {
  if (!secretReady(secret)) throw new Error("EBAY_DRAFT_ONLY_PREFLIGHT_SNAPSHOT_SECRET_MISSING")
  const payload: EbayDraftOnlyPreflightSnapshotPayload = {
    version: SNAPSHOT_VERSION,
    target: input.target,
    accountFingerprint: fingerprint(input.accountFingerprint),
    marketplaceId: "EBAY_US",
    fulfillmentPolicyId: safeIdentifier(input.fulfillmentPolicyId),
    paymentPolicyId: safeIdentifier(input.paymentPolicyId),
    returnPolicyId: safeIdentifier(input.returnPolicyId),
    merchantLocationKey: safeIdentifier(input.merchantLocationKey, 36),
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + EBAY_DRAFT_ONLY_PREFLIGHT_MAX_AGE_MS).toISOString(),
  }
  if (
    !payload.accountFingerprint
    || !payload.fulfillmentPolicyId
    || !payload.paymentPolicyId
    || !payload.returnPolicyId
    || !payload.merchantLocationKey
  ) throw new Error("EBAY_DRAFT_ONLY_PREFLIGHT_SNAPSHOT_INPUT_INVALID")
  const serialized = encoded(JSON.stringify(payload))
  return `${serialized}.${signature(serialized, secret)}`
}

export function verifyEbayDraftOnlyPreflightSnapshot(
  token: unknown,
  expected: SnapshotExpected,
  secret: string,
  now = new Date(),
) {
  const value = typeof token === "string" ? token.trim() : ""
  if (!secretReady(secret)) {
    return { valid: false, blocker: "EBAY_PREFLIGHT_SNAPSHOT_SECRET_MISSING", payload: null }
  }
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value) || value.length > 4_096) {
    return { valid: false, blocker: "EBAY_PREFLIGHT_SNAPSHOT_REQUIRED", payload: null }
  }
  const [encodedPayload, providedSignature] = value.split(".")
  const expectedSignature = signature(encodedPayload, secret)
  const left = Buffer.from(providedSignature, "utf8")
  const right = Buffer.from(expectedSignature, "utf8")
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return { valid: false, blocker: "EBAY_PREFLIGHT_SNAPSHOT_SIGNATURE_INVALID", payload: null }
  }
  let payload: EbayDraftOnlyPreflightSnapshotPayload
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"))
  } catch {
    return { valid: false, blocker: "EBAY_PREFLIGHT_SNAPSHOT_INVALID", payload: null }
  }
  const issuedAt = Date.parse(payload.issuedAt)
  const expiresAt = Date.parse(payload.expiresAt)
  if (
    payload.version !== SNAPSHOT_VERSION
    || !Number.isFinite(issuedAt)
    || !Number.isFinite(expiresAt)
    || issuedAt > now.getTime()
    || now.getTime() > expiresAt
    || expiresAt - issuedAt !== EBAY_DRAFT_ONLY_PREFLIGHT_MAX_AGE_MS
  ) return { valid: false, blocker: "EBAY_PREFLIGHT_SNAPSHOT_STALE", payload: null }
  const exactMatch = payload.target === expected.target
    && payload.accountFingerprint === fingerprint(expected.accountFingerprint)
    && payload.marketplaceId === expected.marketplaceId
    && payload.fulfillmentPolicyId === expected.fulfillmentPolicyId
    && payload.paymentPolicyId === expected.paymentPolicyId
    && payload.returnPolicyId === expected.returnPolicyId
    && payload.merchantLocationKey === expected.merchantLocationKey
  if (!exactMatch) {
    return { valid: false, blocker: "EBAY_PREFLIGHT_SNAPSHOT_BINDING_MISMATCH", payload: null }
  }
  return { valid: true, blocker: "", payload }
}
