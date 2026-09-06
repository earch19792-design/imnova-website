import { createHash } from "node:crypto"

export const MAYEL_FULL_VISUAL_DELEGATION_VERSION =
  "MAYEL_FULL_VISUAL_DELEGATION_V1" as const
export const MAYEL_VISUAL_EXECUTION_BOUNDARY_VERSION =
  "MAYEL_VISUAL_EXECUTION_BOUNDARY_V1" as const
export const MAYEL_FULL_VISUAL_DELEGATION_CONFIRMATION =
  "AUTORIZAR MAYEL CONTROL VISUAL" as const
export const MAYEL_FULL_VISUAL_DELEGATION_REVOKE_CONFIRMATION =
  "REVOCAR DELEGACION VISUAL DE MAYEL" as const

export const MAYEL_FULL_VISUAL_ALLOWED_ACTIONS = Object.freeze([
  "MAIN_IMAGE",
  "SECONDARY_IMAGES",
  "IMAGE_REPLACEMENT",
  "IMAGE_REMOVAL",
  "IMAGE_REORDER",
  "CROP",
  "BACKGROUND",
  "LIGHTING",
  "COLOR_CORRECTION",
  "QUALITY_ENHANCEMENT",
  "DETAIL_IMAGES",
  "SCALE_IMAGES",
  "LIFESTYLE_IMAGES",
  "PACKAGE_CONTENT_IMAGES",
  "VISUAL_SEQUENCE_OPTIMIZATION",
  "LIVE_LISTING_VISUAL_OPTIMIZATION",
] as const)

export const MAYEL_FULL_VISUAL_FORBIDDEN_ACTIONS = Object.freeze([
  "PRICE",
  "QUANTITY",
  "CATEGORY",
  "CONDITION",
  "BUSINESS_POLICIES",
  "PRODUCT_IDENTITY",
  "UNPROVEN_PRODUCT_FACTS",
  "SUPPLIER",
  "OFFER_IDENTITY",
  "SKU",
  "PUBLISH_NEW_LISTING",
  "END_LISTING",
  "BUYER_MESSAGES",
  "REFUNDS",
  "RETURNS",
  "ORDERS",
  "CREDENTIALS",
  "INFRASTRUCTURE",
  "PAID_PROMOTION",
  "SPEND",
] as const)

export type MayelDelegationPredicateCode =
  | "OWNER_AUTHENTICATED"
  | "MAYEL_WORKSPACE_READY"
  | "ACCOUNT_IDENTITY_PROVEN"
  | "DELEGATION_SCOPE_VALID"
  | "AUTHORITY_STORAGE_READY"
  | "REVOCATION_READY"

export type MayelDelegationPredicateV1 = Readonly<{
  code: MayelDelegationPredicateCode
  pass: boolean | null
  requiredForDelegation: boolean
  humanMessage: string
}>

const REQUIRED_DELEGATION_PREDICATES = Object.freeze([
  "OWNER_AUTHENTICATED",
  "MAYEL_WORKSPACE_READY",
  "ACCOUNT_IDENTITY_PROVEN",
  "DELEGATION_SCOPE_VALID",
  "AUTHORITY_STORAGE_READY",
  "REVOCATION_READY",
] as const)

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, stable(entry)]))
}

export function mayelFullVisualDelegationDigestV1(value: unknown) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(stable(value))).digest("hex")}`
}

export function mayelFullVisualDelegationMaterialV1(input: {
  authorityId: string
  ownerUserId: string
  accountKey: string
  marketplaceId?: "EBAY_US"
  ownerConfirmedAt: string
}) {
  return Object.freeze({
    authorityId: input.authorityId,
    ownerUserId: input.ownerUserId,
    marketplaceAccountKey: input.accountKey,
    marketplaceId: input.marketplaceId ?? "EBAY_US",
    scope: "FULL_VISUAL_CONTROL" as const,
    contractVersion: MAYEL_FULL_VISUAL_DELEGATION_VERSION,
    allowedActions: MAYEL_FULL_VISUAL_ALLOWED_ACTIONS,
    forbiddenActions: MAYEL_FULL_VISUAL_FORBIDDEN_ACTIONS,
    mainImageAuthority: true as const,
    ownerPerImageApproval: false as const,
    ownerPerListingVisualApproval: false as const,
    sourceAuthority: "OWNER_ONE_TIME_FULL_VISUAL_DELEGATION" as const,
    accountIdentityAuthority: "EBAY_OFFICIAL_IDENTITY_BOUND" as const,
    executionBoundaryVersion: MAYEL_VISUAL_EXECUTION_BOUNDARY_VERSION,
    ownerConfirmedAt: input.ownerConfirmedAt,
  })
}

const messages: Record<MayelDelegationPredicateCode, string> = {
  OWNER_AUTHENTICATED: "Inicia sesión como owner para conceder esta delegación.",
  MAYEL_WORKSPACE_READY: "La estación visual de Mayel todavía no está disponible.",
  ACCOUNT_IDENTITY_PROVEN: "Falta comprobar la cuenta eBay vinculada.",
  DELEGATION_SCOPE_VALID:
    "El alcance de control visual no coincide con el contrato seguro vigente.",
  AUTHORITY_STORAGE_READY:
    "La persistencia durable de la delegación todavía no está disponible.",
  REVOCATION_READY:
    "La revocación segura de la delegación todavía no está disponible.",
}

export function buildMayelFullVisualDelegationPredicatesV1(input: {
  ownerAuthenticated: boolean
  workspaceReady: boolean
  accountIdentityProven: boolean
  delegationScopeValid: boolean
  authorityStorageReady: boolean
  revocationReady: boolean
}) {
  const values: Record<MayelDelegationPredicateCode, boolean | null> = {
    OWNER_AUTHENTICATED: input.ownerAuthenticated,
    MAYEL_WORKSPACE_READY: input.workspaceReady,
    ACCOUNT_IDENTITY_PROVEN: input.accountIdentityProven,
    DELEGATION_SCOPE_VALID: input.delegationScopeValid,
    AUTHORITY_STORAGE_READY: input.authorityStorageReady,
    REVOCATION_READY: input.revocationReady,
  }
  const required = new Set<string>(REQUIRED_DELEGATION_PREDICATES)
  const predicates = (Object.keys(values) as MayelDelegationPredicateCode[])
    .map((code) => Object.freeze({ code, pass: values[code],
      requiredForDelegation: required.has(code),
      humanMessage: messages[code] }))
  const firstBlockingPredicate = predicates.find((predicate) =>
    predicate.requiredForDelegation && predicate.pass !== true) ?? null
  return Object.freeze({
    predicates: Object.freeze(predicates),
    buttonEnabled: firstBlockingPredicate === null,
    firstBlockingPredicate: firstBlockingPredicate?.code ?? null,
    disableReason: firstBlockingPredicate?.humanMessage ?? null,
  })
}

export function mayelFullVisualScopeContractValidV1() {
  return MAYEL_FULL_VISUAL_ALLOWED_ACTIONS.length === 16
    && MAYEL_FULL_VISUAL_FORBIDDEN_ACTIONS.length === 20
    && MAYEL_FULL_VISUAL_ALLOWED_ACTIONS.includes("MAIN_IMAGE")
    && !MAYEL_FULL_VISUAL_ALLOWED_ACTIONS.some((action) =>
      (MAYEL_FULL_VISUAL_FORBIDDEN_ACTIONS as readonly string[])
        .includes(action))
}
