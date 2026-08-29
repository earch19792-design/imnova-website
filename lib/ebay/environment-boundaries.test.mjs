import assert from "node:assert/strict"
import test from "node:test"

import {
  getEbayDraftWriteEnvironmentBoundary,
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

test("dedicated preprod classification does not enable marketplace writes", () => {
  const boundary = getEbayDraftWriteEnvironmentBoundary({
    ...dedicatedPreprod,
    draftTarget: "PRODUCTION",
    draftMasterEnabled: true,
    draftProductionEnabled: true,
    allowedProductionBranch: "feature/seller-os-dedicated-preprod-boundary-v1",
    vercelGitCommitRef: "feature/seller-os-dedicated-preprod-boundary-v1",
  })

  assert.equal(boundary.productionDeploymentBlocked, false)
  assert.equal(boundary.environmentAllowed, false)
  assert.equal(boundary.targetEnabled, false)
  assert.equal(boundary.writeAllowed, false)
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
