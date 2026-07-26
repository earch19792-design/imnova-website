import { createHash } from "node:crypto"

import { getEbayProRuntimeBoundary } from "./environment-boundaries"

export const EBAY_PRODUCTION_CAPABILITY_POLICY_VERSION =
  "EBAY_PRODUCTION_CAPABILITY_POLICY_V1_2026_07_26" as const

export const EBAY_PRODUCTION_CAPABILITIES = [
  "commercial_monitor.read",
  "commercial_monitor.run_readonly",
  "commercial_alert.dispatch",
  "commercial_improvement.prepare",
  "confirmed_sold_price.apply",
  "promotion.apply",
  "out_of_stock.end",
  "active_title.apply",
  "active_images.apply",
  "draft.create",
  "listing.publish",
] as const

export type EbayProductionCapability =
  typeof EBAY_PRODUCTION_CAPABILITIES[number]

export const EBAY_EBAY_WRITE_CAPABILITIES = [
  "confirmed_sold_price.apply",
  "promotion.apply",
  "out_of_stock.end",
  "active_title.apply",
  "active_images.apply",
  "draft.create",
  "listing.publish",
] as const satisfies readonly EbayProductionCapability[]

export type EbayWriteCapability =
  typeof EBAY_EBAY_WRITE_CAPABILITIES[number]

type CapabilityActor = "admin_user" | "cron" | "admin_or_cron"
type CapabilityEffect = "read" | "internal_prepare" | "provider_write" | "ebay_write"

type CapabilityDefinition = {
  effect: CapabilityEffect
  actor: CapabilityActor
  environmentFlag: string
  requiresResource: boolean
  requiresIdempotency: boolean
  requiresHumanConfirmation: boolean
  requiresPolicyBinding: boolean
  requiredScopes: readonly string[]
}

const BASE_SCOPE = "https://api.ebay.com/oauth/api_scope"
const MARKETING_SCOPE = "https://api.ebay.com/oauth/api_scope/sell.marketing"
const INVENTORY_SCOPE = "https://api.ebay.com/oauth/api_scope/sell.inventory"

export const EBAY_PRODUCTION_CAPABILITY_REGISTRY = {
  "commercial_monitor.read": {
    effect: "read",
    actor: "admin_user",
    environmentFlag: "EBAY_PRODUCTION_CAPABILITY_COMMERCIAL_MONITOR_READ_ENABLED",
    requiresResource: false,
    requiresIdempotency: false,
    requiresHumanConfirmation: false,
    requiresPolicyBinding: false,
    requiredScopes: [],
  },
  "commercial_monitor.run_readonly": {
    effect: "read",
    actor: "admin_or_cron",
    environmentFlag: "EBAY_PRODUCTION_CAPABILITY_COMMERCIAL_MONITOR_RUN_READONLY_ENABLED",
    requiresResource: false,
    requiresIdempotency: true,
    requiresHumanConfirmation: false,
    requiresPolicyBinding: false,
    requiredScopes: [BASE_SCOPE],
  },
  "commercial_alert.dispatch": {
    effect: "provider_write",
    actor: "cron",
    environmentFlag: "EBAY_PRODUCTION_CAPABILITY_COMMERCIAL_ALERT_DISPATCH_ENABLED",
    requiresResource: false,
    requiresIdempotency: true,
    requiresHumanConfirmation: false,
    requiresPolicyBinding: true,
    requiredScopes: [],
  },
  "commercial_improvement.prepare": {
    effect: "internal_prepare",
    actor: "admin_user",
    environmentFlag: "EBAY_PRODUCTION_CAPABILITY_COMMERCIAL_IMPROVEMENT_PREPARE_ENABLED",
    requiresResource: true,
    requiresIdempotency: true,
    requiresHumanConfirmation: false,
    requiresPolicyBinding: true,
    requiredScopes: [],
  },
  "confirmed_sold_price.apply": {
    effect: "ebay_write",
    actor: "admin_user",
    environmentFlag: "EBAY_PRODUCTION_CAPABILITY_CONFIRMED_SOLD_PRICE_APPLY_ENABLED",
    requiresResource: true,
    requiresIdempotency: true,
    requiresHumanConfirmation: true,
    requiresPolicyBinding: true,
    requiredScopes: [BASE_SCOPE],
  },
  "promotion.apply": {
    effect: "ebay_write",
    actor: "admin_user",
    environmentFlag: "EBAY_PRODUCTION_CAPABILITY_PROMOTION_APPLY_ENABLED",
    requiresResource: true,
    requiresIdempotency: true,
    requiresHumanConfirmation: true,
    requiresPolicyBinding: true,
    requiredScopes: [BASE_SCOPE, MARKETING_SCOPE],
  },
  "out_of_stock.end": {
    effect: "ebay_write",
    actor: "admin_user",
    environmentFlag: "EBAY_PRODUCTION_CAPABILITY_OUT_OF_STOCK_END_ENABLED",
    requiresResource: true,
    requiresIdempotency: true,
    requiresHumanConfirmation: true,
    requiresPolicyBinding: true,
    requiredScopes: [BASE_SCOPE],
  },
  "active_title.apply": {
    effect: "ebay_write",
    actor: "admin_user",
    environmentFlag: "EBAY_PRODUCTION_CAPABILITY_ACTIVE_TITLE_APPLY_ENABLED",
    requiresResource: true,
    requiresIdempotency: true,
    requiresHumanConfirmation: true,
    requiresPolicyBinding: true,
    requiredScopes: [BASE_SCOPE],
  },
  "active_images.apply": {
    effect: "ebay_write",
    actor: "admin_user",
    environmentFlag: "EBAY_PRODUCTION_CAPABILITY_ACTIVE_IMAGES_APPLY_ENABLED",
    requiresResource: true,
    requiresIdempotency: true,
    requiresHumanConfirmation: true,
    requiresPolicyBinding: true,
    requiredScopes: [BASE_SCOPE],
  },
  "draft.create": {
    effect: "ebay_write",
    actor: "admin_user",
    environmentFlag: "EBAY_PRODUCTION_CAPABILITY_DRAFT_CREATE_ENABLED",
    requiresResource: true,
    requiresIdempotency: true,
    requiresHumanConfirmation: true,
    requiresPolicyBinding: true,
    requiredScopes: [BASE_SCOPE, INVENTORY_SCOPE],
  },
  "listing.publish": {
    effect: "ebay_write",
    actor: "admin_user",
    environmentFlag: "EBAY_PRODUCTION_CAPABILITY_LISTING_PUBLISH_ENABLED",
    requiresResource: true,
    requiresIdempotency: true,
    requiresHumanConfirmation: true,
    requiresPolicyBinding: true,
    requiredScopes: [BASE_SCOPE, INVENTORY_SCOPE],
  },
} as const satisfies Record<EbayProductionCapability, CapabilityDefinition>

export type EbayProductionCapabilityContext<C extends EbayProductionCapability =
  EbayProductionCapability> = {
  capability: C
  stage: "route" | "service" | "effect"
  invocation: "interactive" | "cron"
  authenticationMode: "admin_user" | "service_role" | "cron"
  userId?: string | null
  cronPrincipal?: string | null
  accountKey: string
  marketplace: string
  resourceKey?: string | null
  idempotencyKey?: string | null
  policyVersion?: string | null
  proposalHash?: string | null
  confirmedHumanAction?: boolean
  preflightPassed?: boolean
  preflightObservedAt?: string | null
}

export type EbayProductionCapabilityEvaluation<C extends EbayProductionCapability =
  EbayProductionCapability> = {
  allowed: boolean
  capability: C
  status: "enabled" | "blocked" | "preview_only"
  blockerCodes: string[]
  policyVersion: typeof EBAY_PRODUCTION_CAPABILITY_POLICY_VERSION
  evaluatedAt: string
  expiresAt: string | null
  production: boolean
}

export type EbayProductionCapabilityEnvironment = {
  vercelEnv?: string | null
  nodeEnv?: string | null
  ebayProRuntime?: string | null
  masterEnabled?: boolean
  capabilityEnabled?: boolean
  accountAllowlist?: readonly string[]
  resourceAllowlist?: readonly string[]
  proposalHashAllowlist?: readonly string[]
  enabledPolicyVersion?: string | null
  expiresAt?: string | null
  now?: Date
}

const CAPABILITY_GRANT_BRAND: unique symbol = Symbol(
  "EBAY_PRODUCTION_CAPABILITY_GRANT",
)

export type EbayProductionCapabilityGrant<C extends EbayProductionCapability =
  EbayProductionCapability> = {
  readonly [CAPABILITY_GRANT_BRAND]: true
  readonly capability: C
  readonly stage: "route" | "service" | "effect"
  readonly invocation: "interactive" | "cron"
  readonly authenticationMode: "admin_user" | "cron"
  readonly actorKey: string
  readonly accountKey: string
  readonly marketplace: string
  readonly resourceKey: string | null
  readonly policyVersion: string | null
  readonly proposalHash: string | null
  readonly idempotencyKeyHash: string | null
  readonly issuedAt: string
  readonly expiresAt: string
  readonly evaluationHash: string
}

export class EbayProductionCapabilityError extends Error {
  readonly blockerCodes: readonly string[]
  readonly evaluation: EbayProductionCapabilityEvaluation

  constructor(evaluation: EbayProductionCapabilityEvaluation) {
    super(evaluation.blockerCodes[0] ?? "EBAY_PRODUCTION_CAPABILITY_BLOCKED")
    this.name = "EbayProductionCapabilityError"
    this.blockerCodes = evaluation.blockerCodes
    this.evaluation = evaluation
  }
}

function normalized(value: string | null | undefined) {
  return value?.trim() ?? ""
}

function list(value: string | undefined) {
  return (value ?? "").split(",").map((entry) => entry.trim()).filter(Boolean)
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

function actorKey(context: EbayProductionCapabilityContext) {
  return context.authenticationMode === "admin_user"
    ? normalized(context.userId)
    : context.authenticationMode === "cron"
      ? normalized(context.cronPrincipal)
      : ""
}

function validAdminUser(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value)
}

function validCronPrincipal(value: string) {
  return /^[A-Za-z0-9._:-]{3,120}$/.test(value)
}

function validBinding(value: string) {
  return value.length >= 8 && value.length <= 300 &&
    /^[A-Za-z0-9._:@/-]+$/.test(value)
}

function productionConfiguration(
  capability: EbayProductionCapability,
  override: EbayProductionCapabilityEnvironment,
) {
  const definition = EBAY_PRODUCTION_CAPABILITY_REGISTRY[capability]
  const prefix = definition.environmentFlag.replace(/_ENABLED$/, "")
  return {
    masterEnabled: override.masterEnabled ??
      process.env.EBAY_SELLER_OS_PRODUCTION_CAPABILITIES_ENABLED === "true",
    capabilityEnabled: override.capabilityEnabled ??
      process.env[definition.environmentFlag] === "true",
    accountAllowlist: override.accountAllowlist ??
      list(process.env.EBAY_SELLER_OS_PRODUCTION_ACCOUNT_ALLOWLIST),
    resourceAllowlist: override.resourceAllowlist ??
      list(process.env[`${prefix}_RESOURCE_ALLOWLIST`]),
    proposalHashAllowlist: override.proposalHashAllowlist ??
      list(process.env[`${prefix}_PROPOSAL_HASH_ALLOWLIST`]),
    enabledPolicyVersion: normalized(
      override.enabledPolicyVersion ?? process.env[`${prefix}_POLICY_VERSION`],
    ),
    expiresAt: normalized(
      override.expiresAt ?? process.env[`${prefix}_EXPIRES_AT`],
    ),
  }
}

function priorGrantBlockers(
  context: EbayProductionCapabilityContext,
  priorGrant: EbayProductionCapabilityGrant | undefined,
  now: Date,
) {
  if (context.stage === "route") return []
  if (!priorGrant || priorGrant[CAPABILITY_GRANT_BRAND] !== true) {
    return ["EBAY_CAPABILITY_ROUTE_GRANT_REQUIRED"]
  }
  const blockers: string[] = []
  if (priorGrant.capability !== context.capability) {
    blockers.push("EBAY_CAPABILITY_GRANT_PURPOSE_MISMATCH")
  }
  if (priorGrant.accountKey !== normalized(context.accountKey) ||
    priorGrant.marketplace !== normalized(context.marketplace).toUpperCase() ||
    priorGrant.resourceKey !== (normalized(context.resourceKey) || null) ||
    priorGrant.actorKey !== actorKey(context)) {
    blockers.push("EBAY_CAPABILITY_GRANT_CONTEXT_MISMATCH")
  }
  if (Date.parse(priorGrant.expiresAt) <= now.getTime()) {
    blockers.push("EBAY_CAPABILITY_GRANT_EXPIRED")
  }
  return blockers
}

export function evaluateEbayProductionCapability<
  C extends EbayProductionCapability,
>(
  context: EbayProductionCapabilityContext<C>,
  environment: EbayProductionCapabilityEnvironment = {},
  priorGrant?: EbayProductionCapabilityGrant<C>,
): EbayProductionCapabilityEvaluation<C> {
  const definition = EBAY_PRODUCTION_CAPABILITY_REGISTRY[context.capability]
  const now = environment.now ?? new Date()
  const accountKey = normalized(context.accountKey)
  const marketplace = normalized(context.marketplace).toUpperCase()
  const resourceKey = normalized(context.resourceKey)
  const actor = actorKey(context)
  const runtime = getEbayProRuntimeBoundary({
    pathname: "/",
    method: "GET",
    vercelEnv: environment.vercelEnv,
    nodeEnv: environment.nodeEnv,
    ebayProRuntime: environment.ebayProRuntime,
  })
  const blockers = priorGrantBlockers(context, priorGrant, now)

  if (!accountKey || !marketplace) {
    blockers.push("EBAY_CAPABILITY_ACCOUNT_SCOPE_REQUIRED")
  }
  const actorAllowed =
    definition.actor === "admin_user"
      ? context.authenticationMode === "admin_user" && validAdminUser(actor)
      : definition.actor === "cron"
        ? context.authenticationMode === "cron" && validCronPrincipal(actor)
        : (context.authenticationMode === "admin_user" && validAdminUser(actor)) ||
          (context.authenticationMode === "cron" && validCronPrincipal(actor))
  if (!actorAllowed || context.authenticationMode === "service_role") {
    blockers.push("EBAY_INTERACTIVE_ADMIN_OR_DEDICATED_CRON_REQUIRED")
  }
  if (definition.requiresResource && !validBinding(resourceKey)) {
    blockers.push("EBAY_CAPABILITY_EXACT_RESOURCE_REQUIRED")
  }
  if (definition.requiresIdempotency &&
    !validBinding(normalized(context.idempotencyKey))) {
    blockers.push("EBAY_CAPABILITY_IDEMPOTENCY_REQUIRED")
  }
  if (definition.requiresHumanConfirmation &&
    context.confirmedHumanAction !== true) {
    blockers.push("EBAY_CAPABILITY_HUMAN_CONFIRMATION_REQUIRED")
  }
  if (definition.requiresPolicyBinding &&
    !validBinding(normalized(context.policyVersion))) {
    blockers.push("EBAY_CAPABILITY_POLICY_VERSION_REQUIRED")
  }
  if (context.stage === "effect" && definition.effect === "ebay_write") {
    if (!/^[0-9a-f]{64}$/i.test(normalized(context.proposalHash))) {
      blockers.push("EBAY_CAPABILITY_PROPOSAL_HASH_REQUIRED")
    }
    const observedAt = Date.parse(normalized(context.preflightObservedAt))
    if (context.preflightPassed !== true || !Number.isFinite(observedAt) ||
      observedAt > now.getTime() + 30_000 ||
      observedAt < now.getTime() - 5 * 60_000) {
      blockers.push("EBAY_CAPABILITY_EFFECT_PREFLIGHT_REQUIRED")
    }
  }

  let expiresAt: string | null = null
  if (runtime.isProductionRuntime) {
    const config = productionConfiguration(context.capability, environment)
    if (!config.masterEnabled) {
      blockers.push("EBAY_PRODUCTION_MASTER_CAPABILITY_GATE_DISABLED")
    }
    if (!config.capabilityEnabled) {
      blockers.push("EBAY_PRODUCTION_CAPABILITY_DISABLED")
    }
    if (!config.accountAllowlist.includes(accountKey)) {
      blockers.push("EBAY_PRODUCTION_ACCOUNT_NOT_ALLOWLISTED")
    }
    if (definition.requiresResource &&
      !config.resourceAllowlist.includes(resourceKey)) {
      blockers.push("EBAY_PRODUCTION_RESOURCE_NOT_ALLOWLISTED")
    }
    const configuredExpiry = Date.parse(config.expiresAt)
    if (!Number.isFinite(configuredExpiry) || configuredExpiry <= now.getTime()) {
      blockers.push("EBAY_PRODUCTION_CAPABILITY_GRANT_EXPIRED")
    } else {
      expiresAt = new Date(configuredExpiry).toISOString()
    }
    if (definition.requiresPolicyBinding &&
      config.enabledPolicyVersion !== normalized(context.policyVersion)) {
      blockers.push("EBAY_PRODUCTION_POLICY_VERSION_MISMATCH")
    }
    if (context.stage === "effect" && definition.effect === "ebay_write" &&
      !config.proposalHashAllowlist.includes(normalized(context.proposalHash))) {
      blockers.push("EBAY_PRODUCTION_PROPOSAL_NOT_ALLOWLISTED")
    }
  } else {
    expiresAt = new Date(now.getTime() + 5 * 60_000).toISOString()
  }

  const uniqueBlockers = [...new Set(blockers)]
  return {
    allowed: uniqueBlockers.length === 0,
    capability: context.capability,
    status: uniqueBlockers.length
      ? "blocked"
      : runtime.isProductionRuntime
        ? "enabled"
        : "preview_only",
    blockerCodes: uniqueBlockers,
    policyVersion: EBAY_PRODUCTION_CAPABILITY_POLICY_VERSION,
    evaluatedAt: now.toISOString(),
    expiresAt,
    production: runtime.isProductionRuntime,
  }
}

export function assertEbayProductionCapability<
  C extends EbayProductionCapability,
>(
  context: EbayProductionCapabilityContext<C>,
  priorGrant?: EbayProductionCapabilityGrant<C>,
  environment: EbayProductionCapabilityEnvironment = {},
): EbayProductionCapabilityGrant<C> {
  const evaluation = evaluateEbayProductionCapability(
    context,
    environment,
    priorGrant,
  )
  if (!evaluation.allowed || !evaluation.expiresAt) {
    throw new EbayProductionCapabilityError(evaluation)
  }
  const issuedAt = evaluation.evaluatedAt
  const idempotencyKeyHash = normalized(context.idempotencyKey)
    ? sha256(normalized(context.idempotencyKey))
    : null
  const grantPayload = {
    capability: context.capability,
    stage: context.stage,
    invocation: context.invocation,
    authenticationMode: context.authenticationMode === "admin_user"
      ? "admin_user" as const
      : "cron" as const,
    actorKey: actorKey(context),
    accountKey: normalized(context.accountKey),
    marketplace: normalized(context.marketplace).toUpperCase(),
    resourceKey: normalized(context.resourceKey) || null,
    policyVersion: normalized(context.policyVersion) || null,
    proposalHash: normalized(context.proposalHash) || null,
    idempotencyKeyHash,
    issuedAt,
    expiresAt: evaluation.expiresAt,
  }
  return {
    [CAPABILITY_GRANT_BRAND]: true,
    ...grantPayload,
    evaluationHash: sha256(JSON.stringify(grantPayload)),
  }
}

export function assertEbayCapabilityGrantPurpose<
  C extends EbayProductionCapability,
>(
  grant: EbayProductionCapabilityGrant,
  capability: C,
  requiredStage?: "route" | "service" | "effect",
): asserts grant is EbayProductionCapabilityGrant<C> {
  if (grant?.[CAPABILITY_GRANT_BRAND] !== true ||
    grant.capability !== capability ||
    (requiredStage && grant.stage !== requiredStage) ||
    Date.parse(grant.expiresAt) <= Date.now()) {
    throw new Error("EBAY_CAPABILITY_GRANT_PURPOSE_MISMATCH")
  }
}
