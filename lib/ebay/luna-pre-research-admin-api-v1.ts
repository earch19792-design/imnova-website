import { createHash, randomBytes, timingSafeEqual } from "node:crypto"

import { getSellerOsAdminOriginBindingV1 } from
  "../admin-session-origin-v1"
import { SELLER_OS_ACCESS_ROLES } from "../seller-os-access-control"
import {
  LUNA_PRE_RESEARCH_MAX_BATCH_SIZE_V1,
  type LunaPreResearchCandidateRequestV1,
} from "./luna-pre-research-intake-v1"

export const SELLER_OS_ADMIN_PRE_RESEARCH_CONTROLLED_RERUN_V1 =
  "SELLER_OS_ADMIN_PRE_RESEARCH_CONTROLLED_RERUN_V1" as const
export const SELLER_OS_ADMIN_PRE_RESEARCH_CSRF_TTL_MS = 10 * 60 * 1_000

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CSRF_TOKEN = /^pr1\.[A-Za-z0-9_-]{43}$/
const INSTANCE_ID = /^[A-Za-z0-9_-]{22}$/
const REASON_CODE = /^[A-Z0-9_]{3,80}$/
const OPERATIONS = new Set([
  "NORMAL_PRE_RESEARCH",
  "CONTROLLED_RERUN",
  "TEO_CONTROL_AUTHORIZATION",
])

type AdminValidation = Readonly<{
  ok: boolean
  userId?: string | null
  authenticationMode?: string | null
  accessRole?: string | null
}>

type CsrfContext = Readonly<{
  actorUserId: string
  adminSessionToken: string
  requestUrl: string
  origin: string | null
  secFetchSite: string | null
  operation: string
}>

type CsrfRecord = {
  token: string
  subjectDigest: string
  expiresAt: number
}

const VERIFIED_CSRF = Symbol("SELLER_OS_ADMIN_PRE_RESEARCH_CSRF")

export type SellerOsAdminPreResearchCsrfReceiptV1 = Readonly<{
  actorUserId: string
  operation: string
  instanceId: string
  [VERIFIED_CSRF]: true
}>

export class SellerOsAdminPreResearchErrorV1 extends Error {
  readonly code: string

  constructor(code: string) {
    const safe = /^[A-Z0-9_]{3,160}$/.test(code)
      ? code : "ADMIN_PRE_RESEARCH_FAILED_CLOSED"
    super(safe)
    this.name = "SellerOsAdminPreResearchErrorV1"
    this.code = safe
  }
}

function fail(code: string): never {
  throw new SellerOsAdminPreResearchErrorV1(code)
}

function sha256(parts: readonly string[]) {
  return createHash("sha256").update(parts.join("\n")).digest("hex")
}

function equalText(left: string, right: string) {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort()
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
}

function parseCandidates(value: unknown) {
  if (!Array.isArray(value) || !value.length ||
      value.length > LUNA_PRE_RESEARCH_MAX_BATCH_SIZE_V1) {
    fail("ADMIN_PRE_RESEARCH_REQUEST_REJECTED")
  }
  const candidates = value.map((entry) => {
    const candidate = record(entry)
    if (!candidate || !exactKeys(candidate,
        ["productId", "sku", "variantId"]) ||
        typeof candidate.productId !== "string" ||
        !/^\d{1,30}$/.test(candidate.productId) ||
        typeof candidate.variantId !== "string" ||
        !/^\d{1,30}$/.test(candidate.variantId) ||
        typeof candidate.sku !== "string" ||
        !/^[^\u0000\r\n]{1,160}$/.test(candidate.sku)) {
      fail("ADMIN_PRE_RESEARCH_REQUEST_REJECTED")
    }
    return Object.freeze({ productId: candidate.productId,
      variantId: candidate.variantId, sku: candidate.sku })
  })
  const identities = new Set(candidates.map((candidate) =>
    `${candidate.productId}\u001f${candidate.variantId}\u001f${candidate.sku}`))
  if (identities.size !== candidates.length) {
    fail("ADMIN_PRE_RESEARCH_REQUEST_REJECTED")
  }
  return Object.freeze(candidates) as readonly LunaPreResearchCandidateRequestV1[]
}

export function assertSellerOsOwnerAdminPreResearchV1(
  validation: AdminValidation,
) {
  if (!validation.ok || validation.authenticationMode !== "admin_user" ||
      validation.accessRole !== SELLER_OS_ACCESS_ROLES.owner ||
      !validation.userId || !UUID.test(validation.userId)) {
    fail("ADMIN_PRE_RESEARCH_OWNER_ADMIN_REQUIRED")
  }
  return Object.freeze({
    actorSubject: validation.userId,
    actorClientId: SELLER_OS_ADMIN_PRE_RESEARCH_CONTROLLED_RERUN_V1,
  })
}

export function parseNormalLunaPreResearchAdminRequestV1(value: unknown) {
  const body = record(value)
  if (!body || !exactKeys(body, ["candidates", "snapshotId"]) ||
      typeof body.snapshotId !== "string" || !UUID.test(body.snapshotId)) {
    fail("ADMIN_PRE_RESEARCH_REQUEST_REJECTED")
  }
  return Object.freeze({ snapshotId: body.snapshotId,
    candidates: parseCandidates(body.candidates) })
}

export function parseControlledLunaPreResearchAdminRequestV1(value: unknown) {
  const body = record(value)
  if (!body || !exactKeys(body, ["candidates", "expectedContractVersion",
    "reasonCode", "rerunCohortId", "snapshotId"]) ||
      typeof body.rerunCohortId !== "string" ||
      !UUID.test(body.rerunCohortId) ||
      typeof body.snapshotId !== "string" || !UUID.test(body.snapshotId) ||
      typeof body.reasonCode !== "string" ||
      !REASON_CODE.test(body.reasonCode) ||
      typeof body.expectedContractVersion !== "string") {
    fail("ADMIN_PRE_RESEARCH_RERUN_REQUEST_REJECTED")
  }
  return Object.freeze({ rerunCohortId: body.rerunCohortId,
    snapshotId: body.snapshotId, reasonCode: body.reasonCode,
    expectedContractVersion: body.expectedContractVersion,
    candidates: parseCandidates(body.candidates) })
}

function csrfSubject(input: CsrfContext, instanceId: string,
  requireOrigin: boolean) {
  if (!UUID.test(input.actorUserId) || input.adminSessionToken.length < 32 ||
      input.adminSessionToken.length > 16_384 ||
      !INSTANCE_ID.test(instanceId) || !OPERATIONS.has(input.operation)) {
    fail("ADMIN_PRE_RESEARCH_CSRF_REJECTED")
  }
  const origin = getSellerOsAdminOriginBindingV1({
    requestUrl: input.requestUrl,
    origin: input.origin,
    secFetchSite: input.secFetchSite,
    requireOrigin,
  })
  if (!origin) fail("ADMIN_PRE_RESEARCH_CSRF_REJECTED")
  return sha256(["SELLER_OS_ADMIN_PRE_RESEARCH_CSRF_V1",
    input.actorUserId, sha256(["admin-session", input.adminSessionToken]),
    instanceId, origin, input.operation])
}

export function createSellerOsAdminPreResearchCsrfBoundaryV1(
  options: Readonly<{
    now?: () => number
    random?: (bytes: number) => Buffer
  }> = {},
) {
  const now = options.now ?? Date.now
  const random = options.random ?? randomBytes
  const instanceId = random(16).toString("base64url")
  if (!INSTANCE_ID.test(instanceId)) {
    fail("ADMIN_PRE_RESEARCH_CSRF_ENTROPY_UNAVAILABLE")
  }
  const records = new Map<string, CsrfRecord>()
  const consumed = new Map<string, number>()

  function clean(at: number) {
    for (const [digest, csrf] of records) {
      if (csrf.expiresAt <= at) records.delete(digest)
    }
    for (const [digest, expiresAt] of consumed) {
      if (expiresAt <= at) consumed.delete(digest)
    }
  }

  function issue(input: CsrfContext) {
    const at = now()
    clean(at)
    const subjectDigest = csrfSubject(input, instanceId, false)
    const existing = [...records.values()].find((csrf) =>
      csrf.subjectDigest === subjectDigest && csrf.expiresAt > at)
    if (existing) return Object.freeze({ csrfToken: existing.token,
      expiresAt: new Date(existing.expiresAt).toISOString(),
      singleUse: true as const, adminSessionBound: true as const,
      originBound: true as const })
    const token = `pr1.${random(32).toString("base64url")}`
    if (!CSRF_TOKEN.test(token)) {
      fail("ADMIN_PRE_RESEARCH_CSRF_ENTROPY_UNAVAILABLE")
    }
    const tokenDigest = sha256(["csrf-token", token])
    records.set(tokenDigest, { token, subjectDigest,
      expiresAt: at + SELLER_OS_ADMIN_PRE_RESEARCH_CSRF_TTL_MS })
    return Object.freeze({ csrfToken: token,
      expiresAt: new Date(at + SELLER_OS_ADMIN_PRE_RESEARCH_CSRF_TTL_MS)
        .toISOString(), singleUse: true as const,
      adminSessionBound: true as const, originBound: true as const })
  }

  function consume(input: CsrfContext & Readonly<{
    contentType: string | null
    csrfHeader: string | null
    csrfCookie: string | null
  }>): SellerOsAdminPreResearchCsrfReceiptV1 {
    if (input.contentType?.split(";", 1)[0]?.trim().toLowerCase() !==
        "application/json") fail("ADMIN_PRE_RESEARCH_CSRF_REJECTED")
    const subjectDigest = csrfSubject(input, instanceId, true)
    const header = input.csrfHeader ?? ""
    const cookie = input.csrfCookie ?? ""
    if (!CSRF_TOKEN.test(header) || !CSRF_TOKEN.test(cookie) ||
        !equalText(header, cookie)) fail("ADMIN_PRE_RESEARCH_CSRF_REJECTED")
    const tokenDigest = sha256(["csrf-token", header])
    const at = now()
    if (consumed.has(tokenDigest)) fail("ADMIN_PRE_RESEARCH_CSRF_REUSED")
    const stored = records.get(tokenDigest)
    if (!stored) fail("ADMIN_PRE_RESEARCH_CSRF_REJECTED")
    if (stored.expiresAt <= at) {
      records.delete(tokenDigest)
      fail("ADMIN_PRE_RESEARCH_CSRF_EXPIRED")
    }
    if (!equalText(stored.subjectDigest, subjectDigest)) {
      fail("ADMIN_PRE_RESEARCH_CSRF_SUBJECT_MISMATCH")
    }
    records.delete(tokenDigest)
    consumed.set(tokenDigest, stored.expiresAt)
    return Object.freeze({ actorUserId: input.actorUserId,
      operation: input.operation, instanceId,
      [VERIFIED_CSRF]: true as const })
  }

  return Object.freeze({ issue, consume })
}

const globalCsrfBoundary = createSellerOsAdminPreResearchCsrfBoundaryV1()

export function getSellerOsAdminPreResearchCsrfBoundaryV1() {
  return globalCsrfBoundary
}
