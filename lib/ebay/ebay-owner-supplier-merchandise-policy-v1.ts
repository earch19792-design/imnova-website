import { createHash } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

export const OWNER_SUPPLIER_MERCHANDISE_POLICY_V1 =
  "OWNER_SUPPLIER_MERCHANDISE_POLICY_V1" as const
export const OWNER_SUPPLIER_POLICY_APPLICATION_V1 =
  "OWNER_SUPPLIER_POLICY_APPLICATION_V1" as const
export const LUNA_PORTEX_SUPPLIER_CODE = "LUNA_PORTEX" as const
export const LUNA_ALL_MERCHANDISE_NEW_POLICY =
  "LUNA_ALL_MERCHANDISE_NEW" as const
export const LUNA_ALL_MERCHANDISE_NEW_POLICY_VERSION =
  "LUNA_ALL_MERCHANDISE_NEW_V1" as const
export const LUNA_ALL_MERCHANDISE_NEW_STATEMENT =
  "LUNA PORTEX SOLO VENDE PRODUCTOS NUEVOS." as const

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function text(value: unknown, maximum = 500) {
  return typeof value === "string" && value.trim()
    ? value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ").trim().slice(0, maximum)
    : null
}

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`
}

export function lunaNewMerchandisePolicyDigestV1() {
  return sha256([
    OWNER_SUPPLIER_MERCHANDISE_POLICY_V1,
    LUNA_PORTEX_SUPPLIER_CODE,
    LUNA_ALL_MERCHANDISE_NEW_POLICY,
    LUNA_ALL_MERCHANDISE_NEW_POLICY_VERSION,
    LUNA_ALL_MERCHANDISE_NEW_STATEMENT,
    "New",
    "EXACT_SUPPLIER_LINEAGE_REQUIRED=true",
    "PRODUCT_IDENTITY_EXACT_REQUIRED=true",
  ].join("\n"))
}

export type LunaNewMerchandisePolicyV1 = Readonly<{
  id: string
  marketplaceAccountKey: string
  evidenceDigest: string
  certifiedAt: string
  authorizationReferenceDigest: string
}>

export function validateLunaNewMerchandisePolicyRowV1(
  value: unknown,
  accountKey: string,
): LunaNewMerchandisePolicyV1 | null {
  const row = record(value)
  const payload = record(row.policy_payload)
  const certifiedAt = text(row.certified_at, 80)
  const authorizationReferenceDigest = text(
    row.authorization_reference_digest, 80)
  const valid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(String(row.id ?? ""))
    && row.marketplace_account_key === accountKey
    && row.marketplace === "EBAY_US"
    && row.supplier_code === LUNA_PORTEX_SUPPLIER_CODE
    && row.policy_code === LUNA_ALL_MERCHANDISE_NEW_POLICY
    && row.policy_version === LUNA_ALL_MERCHANDISE_NEW_POLICY_VERSION
    && row.decision === "CERTIFIED"
    && row.revoked_at === null
    && payload.statement === LUNA_ALL_MERCHANDISE_NEW_STATEMENT
    && payload.conditionLabel === "New"
    && payload.exactSupplierLineageRequired === true
    && payload.productIdentityExactRequired === true
    && row.evidence_digest === lunaNewMerchandisePolicyDigestV1()
    && /^sha256:[0-9a-f]{64}$/.test(authorizationReferenceDigest ?? "")
    && Boolean(certifiedAt && Number.isFinite(Date.parse(certifiedAt)))
  return valid ? Object.freeze({
    id: String(row.id), marketplaceAccountKey: accountKey,
    evidenceDigest: String(row.evidence_digest),
    certifiedAt: certifiedAt!,
    authorizationReferenceDigest: authorizationReferenceDigest!,
  }) : null
}

export async function readLunaNewMerchandisePolicyV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
}>) {
  const read = await input.supabase
    .from("seller_os_owner_supplier_policies_v1")
    .select("id,marketplace_account_key,marketplace,supplier_code,policy_code,policy_version,decision,policy_payload,evidence_digest,authorization_reference_digest,certified_at,revoked_at")
    .eq("marketplace_account_key", input.accountKey)
    .eq("marketplace", "EBAY_US")
    .eq("supplier_code", LUNA_PORTEX_SUPPLIER_CODE)
    .eq("policy_code", LUNA_ALL_MERCHANDISE_NEW_POLICY)
    .eq("policy_version", LUNA_ALL_MERCHANDISE_NEW_POLICY_VERSION)
    .eq("decision", "CERTIFIED")
    .is("revoked_at", null)
    .order("certified_at", { ascending: false })
    .limit(1).maybeSingle()
  if (read.error) throw new Error("OWNER_SUPPLIER_POLICY_READ_FAILED")
  return validateLunaNewMerchandisePolicyRowV1(read.data, input.accountKey)
}

export type OwnerSupplierPolicyApplicationV1 = Readonly<{
  contractVersion: typeof OWNER_SUPPLIER_POLICY_APPLICATION_V1
  policyId: string
  policyDigest: string
  authorizationReferenceDigest: string
  supplier: typeof LUNA_PORTEX_SUPPLIER_CODE
  policyCode: typeof LUNA_ALL_MERCHANDISE_NEW_POLICY
  policyVersion: typeof LUNA_ALL_MERCHANDISE_NEW_POLICY_VERSION
  conditionLabel: "New"
  lunaProductId: string
  lunaVariantId: string
  supplierSku: string
  exactSupplierLineageCertified: true
  productIdentityExact: true
  policyAppliedAt: string
  applicationDigest: string
  factInvented: false
}>

function applicationCore(input: Readonly<{
  policy: LunaNewMerchandisePolicyV1
  lunaProductId: string
  lunaVariantId: string
  supplierSku: string
  appliedAt: string
}>) {
  return {
    contractVersion: OWNER_SUPPLIER_POLICY_APPLICATION_V1,
    policyId: input.policy.id,
    policyDigest: input.policy.evidenceDigest,
    authorizationReferenceDigest: input.policy.authorizationReferenceDigest,
    supplier: LUNA_PORTEX_SUPPLIER_CODE,
    policyCode: LUNA_ALL_MERCHANDISE_NEW_POLICY,
    policyVersion: LUNA_ALL_MERCHANDISE_NEW_POLICY_VERSION,
    conditionLabel: "New" as const,
    lunaProductId: input.lunaProductId,
    lunaVariantId: input.lunaVariantId,
    supplierSku: input.supplierSku,
    exactSupplierLineageCertified: true as const,
    productIdentityExact: true as const,
    policyAppliedAt: new Date(input.appliedAt).toISOString(),
    factInvented: false as const,
  }
}

export function buildOwnerSupplierPolicyApplicationV1(input: Readonly<{
  policy: LunaNewMerchandisePolicyV1
  lunaProductId: string
  lunaVariantId: string
  supplierSku: string
  exactSupplierLineageCertified: boolean
  productIdentityExact: boolean
  appliedAt?: string
}>): OwnerSupplierPolicyApplicationV1 | null {
  const lunaProductId = text(input.lunaProductId, 30)
  const lunaVariantId = text(input.lunaVariantId, 30)
  const supplierSku = text(input.supplierSku, 120)
  const appliedAt = input.appliedAt ?? new Date().toISOString()
  if (input.exactSupplierLineageCertified !== true
      || input.productIdentityExact !== true
      || !/^\d{1,30}$/.test(lunaProductId ?? "")
      || !/^\d{1,30}$/.test(lunaVariantId ?? "") || !supplierSku
      || !Number.isFinite(Date.parse(appliedAt))) return null
  const core = applicationCore({ policy: input.policy,
    lunaProductId: lunaProductId!, lunaVariantId: lunaVariantId!,
    supplierSku, appliedAt })
  return Object.freeze({ ...core,
    applicationDigest: sha256(JSON.stringify(core)) })
}

export function validateOwnerSupplierPolicyApplicationV1(
  value: unknown,
  expected: Readonly<{
    lunaProductId: unknown
    lunaVariantId: unknown
    supplierSku: unknown
  }>,
): value is OwnerSupplierPolicyApplicationV1 {
  const application = record(value)
  const core = { ...application }
  delete core.applicationDigest
  return application.contractVersion === OWNER_SUPPLIER_POLICY_APPLICATION_V1
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(String(application.policyId ?? ""))
    && application.supplier === LUNA_PORTEX_SUPPLIER_CODE
    && application.policyCode === LUNA_ALL_MERCHANDISE_NEW_POLICY
    && application.policyVersion === LUNA_ALL_MERCHANDISE_NEW_POLICY_VERSION
    && application.conditionLabel === "New"
    && application.lunaProductId === expected.lunaProductId
    && application.lunaVariantId === expected.lunaVariantId
    && application.supplierSku === expected.supplierSku
    && application.exactSupplierLineageCertified === true
    && application.productIdentityExact === true
    && application.factInvented === false
    && typeof application.policyAppliedAt === "string"
    && Number.isFinite(Date.parse(application.policyAppliedAt))
    && application.policyDigest === lunaNewMerchandisePolicyDigestV1()
    && /^sha256:[0-9a-f]{64}$/.test(String(
      application.authorizationReferenceDigest ?? ""))
    && /^sha256:[0-9a-f]{64}$/.test(String(application.applicationDigest ?? ""))
    && application.applicationDigest === sha256(JSON.stringify(core))
}
