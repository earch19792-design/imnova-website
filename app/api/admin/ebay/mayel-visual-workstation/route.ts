export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

import { NextResponse } from "next/server"

import { getEbayProRuntimeBoundary } from
  "@/lib/ebay/environment-boundaries"
import {
  ensureMayelVisualTaskV1,
  readMayelVisualWorkstationV1,
  reviewMayelVisualOutputV1,
  uploadMayelVisualOutputV1,
} from "@/lib/ebay/ebay-mayel-visual-workstation-server-v1"
import {
  readMayelVisualPhaseBPreviewV1,
  rebaseMayelVisualPhaseBPreviewV1,
} from "@/lib/ebay/ebay-mayel-visual-phase-b-server-v1"
import {
  authorizeMayelFullVisualDelegationV1,
  readMayelFullVisualDelegationV1,
  revokeMayelFullVisualDelegationV1,
} from "@/lib/ebay/ebay-mayel-full-visual-delegation-server-v1"
import {
  MAYEL_FULL_VISUAL_DELEGATION_CONFIRMATION,
  MAYEL_FULL_VISUAL_DELEGATION_REVOKE_CONFIRMATION,
} from "@/lib/ebay/ebay-mayel-full-visual-delegation-v1"
import { MAYEL_VISUAL_OUTPUT_ROLES } from
  "@/lib/ebay/ebay-mayel-visual-workstation-v1"
import { getEbaySellerAccountScopeConfiguration } from
  "@/lib/ebay/ebay-seller-account-scope"
import { SELLER_OS_ACCESS_ROLES } from "@/lib/seller-os-access-control"
import { getSupabaseAdminClient, validateSellerOsApiRequest } from
  "@/lib/supabase-admin"

function safeCode(error: unknown) {
  const code = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_]{3,180}$/.test(code)
    ? code : "MAYEL_VISUAL_WORKSTATION_REQUEST_FAILED"
}

function safeOperatorMessage(error: unknown) {
  const code = safeCode(error)
  if (["MAYEL_VISUAL_UPLOAD_CONTRACT_INVALID",
    "MAYEL_VISUAL_MIME_SIGNATURE_MISMATCH",
    "MAYEL_VISUAL_ACTUAL_FILE_SIGNATURE_UNSUPPORTED",
    "MAYEL_VISUAL_FILE_SIZE_INVALID",
    "MAYEL_VISUAL_NORMALIZED_FILE_SIZE_INVALID",
    "MAYEL_VISUAL_PIXEL_DIMENSIONS_INVALID",
    "MAYEL_VISUAL_ASPECT_RATIO_INVALID",
    "MAYEL_VISUAL_FILE_CORRUPT"].includes(code)) {
    return "El archivo no es compatible con la Estación visual. Revisa el formato, el tamaño y que la imagen pueda abrirse."
  }
  if (["MAYEL_VISUAL_TASK_NOT_AVAILABLE",
    "MAYEL_VISUAL_SLOT_BLOCKED_MISSING_EVIDENCE"].includes(code)) {
    return "La tarea visual ya no está vigente para este archivo. Actualiza la pantalla antes de volver a intentarlo."
  }
  if (["MAYEL_VISUAL_QUARANTINE_UPLOAD_FAILED",
    "MAYEL_VISUAL_STAGING_UPLOAD_FAILED"].includes(code)) {
    return "No se pudo guardar el archivo en cuarentena. No quedó un archivo parcial; puedes volver a intentarlo."
  }
  if (code === "MAYEL_VISUAL_OUTPUT_ALREADY_RECEIVED") {
    return "Esta imagen o este tipo de imagen ya fue recibido para la tarea. Actualiza la pantalla para revisarlo."
  }
  if (code === "MAYEL_VISUAL_OUTPUT_LIMIT_REACHED") {
    return "La tarea ya tiene el máximo de seis imágenes. Revisa las imágenes recibidas antes de continuar."
  }
  if (["MAYEL_VISUAL_ASSET_PERSIST_FAILED",
    "MAYEL_VISUAL_TASK_STATE_UPDATE_FAILED"].includes(code)) {
    return "El archivo llegó a cuarentena, pero no pudimos guardar su registro. No quedó un archivo parcial; puedes volver a intentarlo."
  }
  if (code === "MAYEL_VISUAL_HUMAN_QA_INCOMPLETE") {
    return "Completa todas las verificaciones de fidelidad antes de aprobar la imagen."
  }
  if (["MAYEL_VISUAL_STAGING_READ_FAILED",
    "MAYEL_VISUAL_STAGING_READBACK_MISMATCH"].includes(code)) {
    return "No pudimos recuperar de forma íntegra la imagen en cuarentena. Actualiza la pantalla antes de volver a intentarlo."
  }
  if (["MAYEL_VISUAL_CANONICAL_UPLOAD_FAILED",
    "MAYEL_VISUAL_CANONICAL_PATH_CONFLICT"].includes(code)) {
    return "No se pudo crear el recurso canónico de forma segura. La imagen sigue en revisión y puedes volver a intentarlo."
  }
  if (["MAYEL_VISUAL_APPROVAL_PERSIST_FAILED",
    "MAYEL_VISUAL_APPROVAL_READBACK_FAILED",
    "MAYEL_VISUAL_MANIFEST_ASSET_READ_FAILED",
    "MAYEL_VISUAL_MANIFEST_PERSIST_FAILED"].includes(code)) {
    return "No se pudo finalizar la aprobación y preparar la vista del owner. La imagen sigue disponible para volver a intentarlo."
  }
  if (code === "MAYEL_VISUAL_APPROVAL_COMPENSATION_FAILED") {
    return "No pudimos confirmar un estado íntegro de la aprobación. Actualiza la pantalla antes de realizar otra acción."
  }
  if (code === "MAYEL_VISUAL_CURRENT_OFFICIAL_IMAGE_SET_CHANGED" ||
      code === "MAYEL_VISUAL_PHASE_B_PREFLIGHT_DRIFT") {
    return "Las imágenes oficiales cambiaron después de la vista previa. La autorización anterior no puede usarse."
  }
  if (code === "MAYEL_VISUAL_IMAGE_CAPACITY_DECISION_REQUIRED") {
    return "La propuesta supera la capacidad de imágenes de eBay. Revisa qué imágenes conservar antes de autorizar."
  }
  if (code === "MAYEL_VISUAL_MANAGEMENT_MODEL_UNPROVEN") {
    return "Seller OS no pudo demostrar cómo se administra este listing. No se realizó ningún cambio."
  }
  if (["MAYEL_VISUAL_REBASE_EVIDENCE_BINDING_CONFLICT",
    "MAYEL_VISUAL_REBASE_ASSET_ALREADY_OFFICIAL",
    "MAYEL_VISUAL_REBASE_OFFICIAL_IMAGE_SET_INVALID",
    "MAYEL_VISUAL_REBASE_OWNER_AUTHORIZATION_EXISTS",
    "MAYEL_VISUAL_REBASE_STALE_PREVIEW",
    "MAYEL_VISUAL_REBASE_NOT_SAFE",
    "MAYEL_VISUAL_REBASE_PERSISTENCE_CONFLICT",
    "MAYEL_VISUAL_REBASE_DURABLE_READBACK_FAILED"].includes(code)) {
    return "La vista previa cambió y no puede actualizarse automáticamente con seguridad. La imagen aprobada por Mayel permanece intacta."
  }
  if (code ===
      "MAYEL_VISUAL_TRADING_EXECUTOR_EXPLICITLY_GATED_SINGLE_WRITE_CONTRACT") {
    return "Este listing requiere una ruta de imágenes que todavía no cumple el contrato de una sola escritura. No se realizó ningún cambio."
  }
  if (/MAYEL_VISUAL_PHASE_B_(?:OFFICIAL_READBACK|READBACK)/.test(code)) {
    return "eBay recibió la solicitud, pero Seller OS todavía no pudo verificar el conjunto final de imágenes. No se repetirá la escritura automáticamente."
  }
  return "No pudimos completar esta acción visual. No se cambió ningún listing."
}

function uuid(value: unknown) {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value.trim()) ? value.trim() : null
}

function boundaryBlocked(request: Request) {
  return getEbayProRuntimeBoundary({ pathname: new URL(request.url).pathname,
    method: request.method }).runtime !== "seller_os_dedicated_preprod"
}

async function authorize(request: Request) {
  const auth = await validateSellerOsApiRequest(request)
  const roleAllowed = auth.accessRole === SELLER_OS_ACCESS_ROLES.owner ||
    auth.accessRole === SELLER_OS_ACCESS_ROLES.remoteLiveOptimizationOperator
  if (!auth.ok || !auth.userId || !roleAllowed ||
      auth.authenticationMode !== "seller_os_user") return null
  return auth
}

function accountKey() {
  const account = getEbaySellerAccountScopeConfiguration()
  if (!account.accountKey) throw new Error("CANONICAL_ACCOUNT_SCOPE_REQUIRED")
  return account.accountKey
}

function json(payload: Record<string, unknown>, status = 200) {
  return NextResponse.json(payload, { status,
    headers: { "Cache-Control": "private, no-store",
      "X-Seller-OS-Mayel-Visual-Authority":
        "MAYEL_FULL_VISUAL_DELEGATION_V1" } })
}

export async function GET(request: Request) {
  const validation = await validateSellerOsApiRequest(request)
  if (!validation.ok) return json({ success: false,
    error: "MAYEL_VISUAL_WORKSTATION_FORBIDDEN" }, 403)
  if (boundaryBlocked(request)) return json({ success: false,
    error: "MAYEL_VISUAL_WORKSTATION_DEDICATED_PREPROD_ONLY" }, 403)
  try {
    if (validation.authenticationMode === "service_role") {
      const url = new URL(request.url)
      const taskId = uuid(url.searchParams.get("diagnosticTaskId"))
      if (!taskId || url.searchParams.get("mode") !==
          "MANAGEMENT_READBACK_V1") {
        return json({ success: false,
          error: "MAYEL_VISUAL_MANAGEMENT_READBACK_REQUEST_INVALID" }, 400)
      }
      const phaseB = await readMayelVisualPhaseBPreviewV1({
        supabase: getSupabaseAdminClient(), accountKey: accountKey(), taskId,
      })
      return json({ success: true, diagnostic: {
        contractVersion: phaseB.contractVersion,
        managementModel: phaseB.managementModel,
        managementModelAuthority: phaseB.managementModelAuthority,
        managementObservedAt: phaseB.managementObservedAt,
        accountIdentityProven: phaseB.accountIdentityProven,
        listingIdentityProven: phaseB.listingIdentityProven,
        correctEbayApi: phaseB.correctEbayApi,
        correctEbayApiResolved: phaseB.correctEbayApiResolved,
        officialReadStatus: phaseB.officialReadStatus,
        officialReadAuthority: phaseB.officialReadAuthority,
        officialReadFailureClass: phaseB.officialReadFailureClass,
        tradingReadFailureClass: phaseB.tradingReadFailureClass,
        currentImageSetProven: phaseB.currentImageSetProven,
        currentOfficialImageCount: phaseB.currentOfficialImageCount,
        currentOfficialImageSetDigest: phaseB.currentOfficialImageSetDigest,
        mayelManifestValid: phaseB.mayelManifestValid,
        visualOnlyDiff: phaseB.visualOnlyDiff,
        unauthorizedFieldDiffCount: phaseB.unauthorizedFieldDiffCount,
        safeRebaseAvailable: phaseB.safeRebaseAvailable,
        imageSetChangeClassification: phaseB.imageSetChangeClassification,
        mayelAssetPreserved: phaseB.mayelAssetPreserved,
        mayelReworkRequired: phaseB.mayelReworkRequired,
        rebaseBlocker: phaseB.rebaseBlocker,
        safeToExecuteVisualChange: phaseB.safeToExecuteVisualChange,
        readyForMayelPhysicalCanary: phaseB.readyForMayelPhysicalCanary,
        blocker: phaseB.blocker,
        managementDiagnostics: phaseB.managementDiagnostics,
      }, marketplaceWrites: 0 })
    }
    const roleAllowed = validation.accessRole === SELLER_OS_ACCESS_ROLES.owner ||
      validation.accessRole ===
        SELLER_OS_ACCESS_ROLES.remoteLiveOptimizationOperator
    if (!validation.userId || !roleAllowed ||
        validation.authenticationMode !== "seller_os_user") {
      return json({ success: false,
        error: "MAYEL_VISUAL_WORKSTATION_FORBIDDEN" }, 403)
    }
    const auth = validation
    const workstation = await readMayelVisualWorkstationV1({
      supabase: getSupabaseAdminClient(), accountKey: accountKey(),
      actorUserId: auth.userId,
      ownerView: auth.accessRole === SELLER_OS_ACCESS_ROLES.owner })
    const supabase = getSupabaseAdminClient()
    const ownerView = auth.accessRole === SELLER_OS_ACCESS_ROLES.owner
    const delegation = await readMayelFullVisualDelegationV1({ supabase,
      accountKey: accountKey(), ownerAuthenticated: ownerView })
    const currentAccountIdentity =
      delegation.globalAccountIdentityProven === true
    const tasks = ownerView ? await Promise.all(workstation.tasks.map(async (task) => {
      if (task.status !== "OWNER_PREVIEW_READY") return task
      try {
        const phaseB = await readMayelVisualPhaseBPreviewV1({
          supabase, accountKey: accountKey(), taskId: task.visualTaskId,
        })
        return { ...task, phaseB: { ...phaseB,
          accountIdentityCurrent: currentAccountIdentity,
          accountIdentityAuthority: delegation.accountIdentity,
          legacyAccountMismatchSuppressed: false } }
      } catch (error) {
        const errorCode = safeCode(error)
        const staleLegacyMismatch = currentAccountIdentity && errorCode ===
          "EBAY_DRAFT_ONLY_ACCOUNT_IDENTITY_MISMATCH"
        return { ...task, phaseB: { ownerCtaAvailable: false,
          blocker: staleLegacyMismatch
            ? "MAYEL_VISUAL_MANAGEMENT_MODEL_UNPROVEN" : errorCode,
          managementModel: "MANAGEMENT_MODEL_UNPROVEN",
          accountIdentityCurrent: currentAccountIdentity,
          accountIdentityAuthority: delegation.accountIdentity,
          legacyAccountMismatchSuppressed: staleLegacyMismatch,
          historicalBlocker: staleLegacyMismatch ? errorCode : null,
          executorCredentialProfileReady: !staleLegacyMismatch,
          marketplaceWritesOnGet: 0 } }
      }
    })) : workstation.tasks
    const taskAuthorityProjection = tasks.map((task) => {
      const phaseB = "phaseB" in task && task.phaseB &&
        typeof task.phaseB === "object"
        ? task.phaseB as {
          accountIdentityCurrent?: boolean
          managementModel?: string
          legacyAccountMismatchSuppressed?: boolean
        }
        : null
      return {
        visualTaskId: task.visualTaskId,
        accountIdentityCurrent: phaseB?.accountIdentityCurrent === true,
        managementModel: phaseB?.managementModel ?? "NOT_PROJECTED",
        legacyAccountMismatchSuppressed:
          phaseB?.legacyAccountMismatchSuppressed === true,
      }
    })
    console.info("MAYEL_FULL_VISUAL_DELEGATION_READ_MODEL_V1", {
      ownerAuthenticated: ownerView,
      accountIdentityProven: delegation.globalAccountIdentityProven,
      identityFailureClass: delegation.identityFailureClass,
      accountIdentitySource: delegation.accountIdentity?.sourceAuthority,
      accountIdentityLiveReadStatus:
        delegation.accountIdentity?.liveReadStatus,
      accountIdentityLiveReadFailureClass:
        delegation.accountIdentity?.liveReadFailureClass,
      workspaceReady: delegation.predicates.find((predicate) =>
        predicate.code === "MAYEL_WORKSPACE_READY")?.pass === true,
      scopeValid: delegation.predicates.find((predicate) =>
        predicate.code === "DELEGATION_SCOPE_VALID")?.pass === true,
      authorityStorageReady: delegation.authorityStorageReady,
      revocationReady: delegation.revocationReady,
      globalDelegationEligible: delegation.globalDelegationEligible,
      buttonEnabled: delegation.authorizationButtonEnabled,
      authorityCreated: Boolean(delegation.active),
      taskAuthorityProjection,
      marketplaceWrites: 0,
    })
    return json({ success: true, workstation: { ...workstation, tasks },
      delegation,
      accessRole: auth.accessRole,
      phase: "B_OWNER_GATED", marketplaceWrites: 0,
      openAiImageApiCalls: 0 })
  } catch (error) {
    return json({ success: false, error: safeCode(error),
      operatorMessage: "No pudimos cargar la estación visual. No se cambió ningún listing.",
      marketplaceWrites: 0 }, 503)
  }
}

export async function POST(request: Request) {
  const auth = await authorize(request)
  if (!auth) return json({ success: false,
    error: "MAYEL_VISUAL_WORKSTATION_FORBIDDEN" }, 403)
  if (boundaryBlocked(request)) return json({ success: false,
    error: "MAYEL_VISUAL_WORKSTATION_DEDICATED_PREPROD_ONLY" }, 403)
  const contentType = request.headers.get("content-type") ?? ""
  try {
    const mayelRole = auth.accessRole ===
      SELLER_OS_ACCESS_ROLES.remoteLiveOptimizationOperator
    const ownerRole = auth.accessRole === SELLER_OS_ACCESS_ROLES.owner
    if (contentType.startsWith("multipart/form-data")) {
      if (!mayelRole) return json({ success: false,
        error: "MAYEL_VISUAL_OPERATOR_AUTHORITY_REQUIRED" }, 403)
      const form = await request.formData()
      const action = form.get("action")
      const taskId = uuid(form.get("visualTaskId"))
      const role = String(form.get("outputRole") ?? "")
      const file = form.get("file")
      if (action !== "UPLOAD_OUTPUT" || !taskId ||
          !MAYEL_VISUAL_OUTPUT_ROLES.includes(role as never) ||
          !(file instanceof File) || file.size < 1 ||
          form.get("rightsConfirmed") !== "true") {
        return json({ success: false,
          error: "MAYEL_VISUAL_UPLOAD_CONTRACT_INVALID" }, 400)
      }
      const bytes = Buffer.from(await file.arrayBuffer())
      try {
        const asset = await uploadMayelVisualOutputV1({
          supabase: getSupabaseAdminClient(), accountKey: accountKey(),
          actorUserId: auth.userId, taskId,
          role: role as (typeof MAYEL_VISUAL_OUTPUT_ROLES)[number],
          declaredMimeType: file.type, file: bytes, rightsConfirmed: true })
        return json({ success: true, outcome: "PRIVATE_QUARANTINE_CREATED",
          assetId: asset.id, outputSha256: asset.output_sha256,
          qaStatus: asset.qa_result?.automaticStatus ?? "UNPROVEN",
          canonicalAssetCreated: false, marketplaceWrites: 0 })
      } finally {
        bytes.fill(0)
      }
    }
    const body = await request.json().catch(() => null) as
      Record<string, unknown> | null
    const action = typeof body?.action === "string" ? body.action : ""
    if (action === "AUTHORIZE_FULL_VISUAL_DELEGATION") {
      if (!ownerRole) return json({ success: false,
        error: "MAYEL_VISUAL_OWNER_AUTHORITY_REQUIRED" }, 403)
      if (body?.confirmation !== MAYEL_FULL_VISUAL_DELEGATION_CONFIRMATION) {
        return json({ success: false,
          error: "MAYEL_VISUAL_DELEGATION_CONFIRMATION_INVALID" }, 400)
      }
      const outcome = await authorizeMayelFullVisualDelegationV1({
        supabase: getSupabaseAdminClient(), accountKey: accountKey(),
        ownerUserId: auth.userId,
      })
      return json({ success: true,
        outcome: outcome.idempotent
          ? "FULL_VISUAL_DELEGATION_ALREADY_ACTIVE"
          : "FULL_VISUAL_DELEGATION_ACTIVATED",
        delegation: outcome.authority, marketplaceWrites: 0 })
    }
    if (action === "REVOKE_FULL_VISUAL_DELEGATION") {
      if (!ownerRole) return json({ success: false,
        error: "MAYEL_VISUAL_OWNER_AUTHORITY_REQUIRED" }, 403)
      if (body?.confirmation !==
          MAYEL_FULL_VISUAL_DELEGATION_REVOKE_CONFIRMATION) {
        return json({ success: false,
          error: "MAYEL_VISUAL_DELEGATION_REVOCATION_CONFIRMATION_INVALID" },
        400)
      }
      const outcome = await revokeMayelFullVisualDelegationV1({
        supabase: getSupabaseAdminClient(), accountKey: accountKey(),
        ownerUserId: auth.userId,
      })
      return json({ success: true,
        outcome: outcome.idempotent
          ? "FULL_VISUAL_DELEGATION_ALREADY_INACTIVE"
          : "FULL_VISUAL_DELEGATION_REVOKED",
        delegation: outcome.authority, marketplaceWrites: 0 })
    }
    if (action === "REBASE_VISUAL_MANIFEST") {
      if (!ownerRole) return json({ success: false,
        error: "MAYEL_VISUAL_OWNER_AUTHORITY_REQUIRED" }, 403)
      const taskId = uuid(body?.visualTaskId)
      const expectedDigest = typeof body?.expectedVisualManifestDigest ===
        "string" ? body.expectedVisualManifestDigest.trim() : ""
      if (!taskId || !/^sha256:[0-9a-f]{64}$/.test(expectedDigest)) {
        return json({ success: false,
          error: "MAYEL_VISUAL_REBASE_REQUEST_INVALID" }, 400)
      }
      const rebase = await rebaseMayelVisualPhaseBPreviewV1({
        supabase: getSupabaseAdminClient(), accountKey: accountKey(), taskId,
        expectedVisualManifestDigest: expectedDigest,
      })
      return json({ success: true, outcome: "OWNER_PREVIEW_SAFE_REBASED",
        rebase, marketplaceWrites: 0 })
    }
    if (action === "APPLY_VISUAL_MANIFEST") {
      if (!ownerRole) return json({ success: false,
        error: "MAYEL_VISUAL_OWNER_AUTHORITY_REQUIRED" }, 403)
      return json({ success: false,
        error: "MAYEL_VISUAL_LEGACY_PER_LISTING_AUTHORIZATION_DISABLED",
        operatorMessage: "La delegación visual reutilizable reemplaza la autorización por listing. Seller OS ejecutará únicamente cuando el listing tenga una ruta segura demostrada.",
        marketplaceWrites: 0 }, 409)
    }
    if (!mayelRole) return json({ success: false,
      error: "MAYEL_VISUAL_OPERATOR_AUTHORITY_REQUIRED" }, 403)
    if (action === "ENSURE_NEXT_TASK") {
      const result = await ensureMayelVisualTaskV1({
        supabase: getSupabaseAdminClient(), accountKey: accountKey(),
        actorUserId: auth.userId })
      return json({ success: true, outcome: result.created
        ? "VISUAL_TASK_CREATED" : result.canaryAvailable
          ? "EXISTING_VISUAL_TASK_REUSED" : "NO_ELIGIBLE_VISUAL_OPPORTUNITY",
        visualTaskId: result.task?.id ?? null,
        phaseACanaryAvailable: result.canaryAvailable,
        promptGenerationMode: "DETERMINISTIC_TEMPLATE_FIRST",
        openAiTextCallCount: 0, openAiImageApiCallCount: 0,
        marketplaceWrites: 0 })
    }
    if (action === "REVIEW_OUTPUT") {
      const taskId = uuid(body?.visualTaskId)
      const assetId = uuid(body?.assetId)
      const decision = body?.decision === "APPROVE" ||
        body?.decision === "REJECT" ? body.decision : null
      if (!taskId || !assetId || !decision) return json({ success: false,
        error: "MAYEL_VISUAL_REVIEW_CONTRACT_INVALID" }, 400)
      const result = await reviewMayelVisualOutputV1({
        supabase: getSupabaseAdminClient(), accountKey: accountKey(),
        actorUserId: auth.userId, taskId, assetId, decision,
        humanQa: body?.humanQa,
        rejectionReason: typeof body?.rejectionReason === "string"
          ? body.rejectionReason : null })
      return json({ success: true, outcome: decision === "APPROVE"
        ? "CANONICAL_ASSET_CREATED_OWNER_PREVIEW_READY"
        : "MAYEL_OUTPUT_REJECTED",
        assetId: result.asset.id, status: result.asset.status,
        sameDecisionIdempotent: result.idempotent,
        visualManifestDigest:
          (result.manifest as Record<string, unknown> | null)
            ?.visualManifestDigest ?? null,
        ownerApprovalStatus: "PENDING",
        marketplaceWriteCapabilityFromPhaseA: false,
        marketplaceWrites: 0 })
    }
    return json({ success: false,
      error: "MAYEL_VISUAL_ACTION_INVALID" }, 400)
  } catch (error) {
    const errorCode = safeCode(error)
    console.warn("MAYEL_VISUAL_ACTION_FAILED", { errorCode,
      marketplaceWrites: 0 })
    return json({ success: false, error: errorCode,
      operatorMessage: safeOperatorMessage(error),
      marketplaceWrites: 0 }, 409)
  }
}
