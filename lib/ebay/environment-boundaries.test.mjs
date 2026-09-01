import assert from "node:assert/strict"
import test from "node:test"

import {
  getEbayDraftWriteEnvironmentBoundary,
  getEbayPublicationOAuthEnvironmentBoundary,
  getEbayProRuntimeBoundary,
  getSellerOsStockGuardRuntimeBoundary,
  SELLER_OS_DEDICATED_PREPROD_CLASSIFICATION,
} from "./environment-boundaries.ts"

const dedicatedPreprod = {
  vercelEnv: "production",
  vercelTargetEnv: "production",
  vercelSystem: "1",
  vercelProjectId: "prj_XvOpSg1jhmLLG1yOCFhAbiLEn222",
  vercelProjectProductionUrl: "imnova-seller-os-preprod.vercel.app",
  ebayProRuntime: "staging",
  supabaseUrl: "https://vsfthqydfrdzulldbfbe.supabase.co",
}

function workspaceBoundary(overrides = {}) {
  return getEbayProRuntimeBoundary({
    ...dedicatedPreprod,
    pathname: "/admin/ebay-seller-os",
    method: "GET",
    ...overrides,
  })
}

test("dedicated preprod plus staging DB and staging runtime allows Workspace", () => {
  const boundary = workspaceBoundary()

  assert.equal(
    boundary.boundaryClassification,
    SELLER_OS_DEDICATED_PREPROD_CLASSIFICATION,
  )
  assert.equal(boundary.dedicatedPreprod.certified, true)
  assert.equal(boundary.isProductionRuntime, false)
  assert.equal(boundary.blocked, false)
  assert.equal(boundary.ebayProAllowed, true)
})

test("customer Production behavior remains blocked", () => {
  const boundary = workspaceBoundary({
    vercelProjectId: "prj_customerProductionHistorical",
    vercelProjectProductionUrl: "imnova-website-z1qh.vercel.app",
    ebayProRuntime: "production_core",
    supabaseUrl: "https://qsefoxmmypmdtwrrtnry.supabase.co",
  })

  assert.equal(boundary.boundaryClassification, "PRODUCTION_CORE")
  assert.equal(boundary.dedicatedPreprod.certified, false)
  assert.equal(boundary.isProductionRuntime, true)
  assert.equal(boundary.blocked, true)
})

test("dedicated project with Production DB fails closed", () => {
  const boundary = workspaceBoundary({
    supabaseUrl: "https://qsefoxmmypmdtwrrtnry.supabase.co",
  })

  assert.equal(boundary.dedicatedPreprod.failedSignal, "stagingSupabaseProject")
  assert.equal(boundary.boundaryClassification, "PRODUCTION_CORE")
  assert.equal(boundary.blocked, true)
})

test("staging DB with the wrong Vercel project fails closed", () => {
  const boundary = workspaceBoundary({
    vercelProjectId: "prj_wrongProjectIdentity",
  })

  assert.equal(boundary.dedicatedPreprod.failedSignal, "vercelProjectId")
  assert.equal(boundary.boundaryClassification, "PRODUCTION_CORE")
  assert.equal(boundary.blocked, true)
})

test("staging runtime intent alone cannot open Vercel Production", () => {
  const boundary = getEbayProRuntimeBoundary({
    vercelEnv: "production",
    ebayProRuntime: "staging",
    pathname: "/admin/ebay-seller-os",
    method: "GET",
  })

  assert.equal(boundary.dedicatedPreprod.certified, false)
  assert.equal(boundary.boundaryClassification, "PRODUCTION_CORE")
  assert.equal(boundary.blocked, true)
})

test("every missing dedicated-preprod identity signal fails closed", () => {
  for (const key of [
    "vercelSystem",
    "vercelTargetEnv",
    "vercelProjectId",
    "vercelProjectProductionUrl",
    "ebayProRuntime",
    "supabaseUrl",
  ]) {
    const boundary = workspaceBoundary({ [key]: "" })
    assert.equal(boundary.dedicatedPreprod.certified, false, key)
    assert.equal(boundary.boundaryClassification, "PRODUCTION_CORE", key)
    assert.equal(boundary.blocked, true, key)
  }
})

test("Preview behavior remains unchanged", () => {
  const preview = getEbayProRuntimeBoundary({
    vercelEnv: "preview",
    pathname: "/admin/ebay-seller-os",
    method: "GET",
  })
  const stagingPreview = getEbayProRuntimeBoundary({
    vercelEnv: "preview",
    ebayProRuntime: "staging",
    pathname: "/admin/ebay-seller-os",
    method: "GET",
  })

  assert.equal(preview.runtime, "preview")
  assert.equal(preview.blocked, false)
  assert.equal(stagingPreview.runtime, "staging")
  assert.equal(stagingPreview.blocked, false)
})

test("dedicated preprod classification alone does not enable marketplace writes", () => {
  const boundary = getEbayDraftWriteEnvironmentBoundary({
    ...dedicatedPreprod,
    draftTarget: "PRODUCTION",
    draftMasterEnabled: false,
    draftProductionEnabled: false,
    allowedProductionBranch: "feature/seller-os-dedicated-preprod-boundary-v1",
    vercelGitCommitRef: "feature/seller-os-dedicated-preprod-boundary-v1",
  })

  assert.equal(boundary.productionDeploymentBlocked, false)
  assert.equal(boundary.productionDedicatedPreprodBound, true)
  assert.equal(boundary.environmentAllowed, true)
  assert.equal(boundary.targetEnabled, false)
  assert.equal(boundary.writeAllowed, false)
})

test("certified dedicated preprod allows the isolated Production publisher only with exact branch and both flags", () => {
  const boundary = getEbayDraftWriteEnvironmentBoundary({
    ...dedicatedPreprod,
    draftTarget: "PRODUCTION",
    draftMasterEnabled: true,
    draftProductionEnabled: true,
    allowedProductionBranch: "feature/seller-os-dedicated-preprod-boundary-v1",
    vercelGitCommitRef: "feature/seller-os-dedicated-preprod-boundary-v1",
  })

  assert.equal(boundary.productionDedicatedPreprodBound, true)
  assert.equal(boundary.environmentAllowed, true)
  assert.equal(boundary.targetEnabled, true)
  assert.equal(boundary.writeAllowed, true)
})

test("Customer Production cannot enable the isolated publisher with branch and flags", () => {
  const boundary = getEbayDraftWriteEnvironmentBoundary({
    ...dedicatedPreprod,
    vercelProjectId: "prj_customerProductionHistorical",
    vercelProjectProductionUrl: "imnova-website-z1qh.vercel.app",
    ebayProRuntime: "production_core",
    supabaseUrl: "https://qsefoxmmypmdtwrrtnry.supabase.co",
    draftTarget: "PRODUCTION",
    draftMasterEnabled: true,
    draftProductionEnabled: true,
    allowedProductionBranch: "feature/seller-os-dedicated-preprod-boundary-v1",
    vercelGitCommitRef: "feature/seller-os-dedicated-preprod-boundary-v1",
  })

  assert.equal(boundary.productionDedicatedPreprodBound, false)
  assert.equal(boundary.environmentAllowed, false)
  assert.equal(boundary.targetEnabled, false)
  assert.equal(boundary.writeAllowed, false)
})

test("every missing dedicated-preprod identity signal blocks the isolated publisher", () => {
  for (const key of [
    "vercelSystem",
    "vercelTargetEnv",
    "vercelProjectId",
    "vercelProjectProductionUrl",
    "ebayProRuntime",
    "supabaseUrl",
  ]) {
    const boundary = getEbayDraftWriteEnvironmentBoundary({
      ...dedicatedPreprod,
      [key]: "",
      draftTarget: "PRODUCTION",
      draftMasterEnabled: true,
      draftProductionEnabled: true,
      allowedProductionBranch: "feature/seller-os-dedicated-preprod-boundary-v1",
      vercelGitCommitRef: "feature/seller-os-dedicated-preprod-boundary-v1",
    })
    assert.equal(boundary.productionDedicatedPreprodBound, false, key)
    assert.equal(boundary.writeAllowed, false, key)
  }
})

test("publication OAuth is allowed on certified dedicated preprod only with an explicit exact branch", () => {
  const allowed = getEbayPublicationOAuthEnvironmentBoundary({
    ...dedicatedPreprod,
    allowedProductionBranch: "feature/seller-os-dedicated-preprod-boundary-v1",
    vercelGitCommitRef: "feature/seller-os-dedicated-preprod-boundary-v1",
    legacyPreviewBranch: "feature/centralize-ebay-mobile-command-center",
  })
  const implicitLegacy = getEbayPublicationOAuthEnvironmentBoundary({
    ...dedicatedPreprod,
    allowedProductionBranch: "",
    vercelGitCommitRef: "feature/centralize-ebay-mobile-command-center",
    legacyPreviewBranch: "feature/centralize-ebay-mobile-command-center",
  })

  assert.equal(allowed.dedicatedPreprod, true)
  assert.equal(allowed.explicitlyBoundBranch, true)
  assert.equal(allowed.environmentAllowed, true)
  assert.equal(implicitLegacy.dedicatedPreprod, true)
  assert.equal(implicitLegacy.explicitlyBoundBranch, false)
  assert.equal(implicitLegacy.environmentAllowed, false)
})

test("publication OAuth preserves the legacy Preview branch but blocks Customer Production", () => {
  const preview = getEbayPublicationOAuthEnvironmentBoundary({
    vercelEnv: "preview",
    vercelGitCommitRef: "feature/centralize-ebay-mobile-command-center",
    legacyPreviewBranch: "feature/centralize-ebay-mobile-command-center",
  })
  const customerProduction = getEbayPublicationOAuthEnvironmentBoundary({
    ...dedicatedPreprod,
    vercelProjectId: "prj_customerProductionHistorical",
    vercelProjectProductionUrl: "imnova-website-z1qh.vercel.app",
    ebayProRuntime: "production_core",
    supabaseUrl: "https://qsefoxmmypmdtwrrtnry.supabase.co",
    allowedProductionBranch: "feature/seller-os-dedicated-preprod-boundary-v1",
    vercelGitCommitRef: "feature/seller-os-dedicated-preprod-boundary-v1",
    legacyPreviewBranch: "feature/centralize-ebay-mobile-command-center",
  })

  assert.equal(preview.preview, true)
  assert.equal(preview.environmentAllowed, true)
  assert.equal(customerProduction.dedicatedPreprod, false)
  assert.equal(customerProduction.environmentAllowed, false)
})

test("dedicated preprod plus staging DB enables only the StockGuard runtime", () => {
  const boundary = getSellerOsStockGuardRuntimeBoundary(dedicatedPreprod)

  assert.equal(boundary.boundaryClassification,
    SELLER_OS_DEDICATED_PREPROD_CLASSIFICATION)
  assert.equal(boundary.historicalPreviewAllowed, false)
  assert.equal(boundary.dedicatedPreprodAllowed, true)
  assert.equal(boundary.authorized, true)
})

test("Customer Production remains blocked from the StockGuard runtime", () => {
  const boundary = getSellerOsStockGuardRuntimeBoundary({
    ...dedicatedPreprod,
    vercelProjectId: "prj_customerProductionHistorical",
    vercelProjectProductionUrl: "imnova-website-z1qh.vercel.app",
    ebayProRuntime: "production_core",
    supabaseUrl: "https://qsefoxmmypmdtwrrtnry.supabase.co",
  })

  assert.equal(boundary.boundaryClassification, "PRODUCTION_CORE")
  assert.equal(boundary.authorized, false)
})

test("dedicated preprod with the wrong DB blocks StockGuard", () => {
  const boundary = getSellerOsStockGuardRuntimeBoundary({
    ...dedicatedPreprod,
    supabaseUrl: "https://qsefoxmmypmdtwrrtnry.supabase.co",
  })

  assert.equal(boundary.failedDedicatedPreprodSignal,
    "stagingSupabaseProject")
  assert.equal(boundary.dedicatedPreprodAllowed, false)
  assert.equal(boundary.authorized, false)
})

test("every missing dedicated-preprod signal blocks StockGuard", () => {
  for (const key of [
    "vercelSystem",
    "vercelTargetEnv",
    "vercelProjectId",
    "vercelProjectProductionUrl",
    "ebayProRuntime",
    "supabaseUrl",
  ]) {
    const boundary = getSellerOsStockGuardRuntimeBoundary({
      ...dedicatedPreprod,
      [key]: "",
    })
    assert.equal(boundary.dedicatedPreprodAllowed, false, key)
    assert.equal(boundary.authorized, false, key)
  }
})

test("historical Preview StockGuard behavior remains allowed", () => {
  const boundary = getSellerOsStockGuardRuntimeBoundary({
    vercelEnv: "preview",
  })

  assert.equal(boundary.historicalPreviewAllowed, true)
  assert.equal(boundary.dedicatedPreprodAllowed, false)
  assert.equal(boundary.authorized, true)
})
