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
  if (code === "MAYEL_VISUAL_DUPLICATE_ROLE_OR_HASH") {
    return "Esta imagen o este tipo de imagen ya fue recibido para la tarea. Actualiza la pantalla para revisarlo."
  }
  if (code === "MAYEL_VISUAL_OUTPUT_LIMIT_REACHED") {
    return "La tarea ya tiene el máximo de seis imágenes. Revisa las imágenes recibidas antes de continuar."
  }
  if (["MAYEL_VISUAL_ASSET_PERSIST_FAILED",
    "MAYEL_VISUAL_TASK_STATE_UPDATE_FAILED"].includes(code)) {
    return "El archivo llegó a cuarentena, pero no pudimos guardar su registro. No quedó un archivo parcial; puedes volver a intentarlo."
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
      "X-Seller-OS-Mayel-Visual-Phase": "A_NO_EBAY_WRITES" } })
}

export async function GET(request: Request) {
  const auth = await authorize(request)
  if (!auth) return json({ success: false,
    error: "MAYEL_VISUAL_WORKSTATION_FORBIDDEN" }, 403)
  if (boundaryBlocked(request)) return json({ success: false,
    error: "MAYEL_VISUAL_WORKSTATION_DEDICATED_PREPROD_ONLY" }, 403)
  try {
    const workstation = await readMayelVisualWorkstationV1({
      supabase: getSupabaseAdminClient(), accountKey: accountKey(),
      actorUserId: auth.userId,
      ownerView: auth.accessRole === SELLER_OS_ACCESS_ROLES.owner })
    return json({ success: true, workstation,
      accessRole: auth.accessRole,
      phase: "A", marketplaceWrites: 0, openAiImageApiCalls: 0 })
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
  const mayelRole = auth.accessRole ===
    SELLER_OS_ACCESS_ROLES.remoteLiveOptimizationOperator
  if (!mayelRole) return json({ success: false,
    error: "MAYEL_VISUAL_OPERATOR_AUTHORITY_REQUIRED" }, 403)
  const contentType = request.headers.get("content-type") ?? ""
  try {
    if (contentType.startsWith("multipart/form-data")) {
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
