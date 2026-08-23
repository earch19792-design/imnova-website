export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"

import {
  buildSellerOsLunaAutomationPrerequisitesStatusV1,
} from "@/lib/ebay/ebay-luna-automation-prerequisites-v1"
import {
  SELLER_OS_LUNA_BROWSER_CEREMONY_VERSION,
  SELLER_OS_LUNA_CEREMONY_CSRF_COOKIE,
  SELLER_OS_LUNA_CEREMONY_CSRF_TTL_MS,
  SELLER_OS_LUNA_CEREMONY_STATE_COOKIE,
  SELLER_OS_LUNA_CEREMONY_TTL_MS,
  SellerOsLunaBrowserCeremonyError,
  getSellerOsLunaCeremonyCsrfBoundaryV1,
} from "@/lib/ebay/ebay-luna-protected-session-ceremony-v1"
import {
  auditSellerOsLunaCanonicalBrowserRuntimeV1,
  getSellerOsLunaBrowserCeremonyCoordinatorV1,
} from "@/lib/ebay/ebay-luna-canonical-browser-worker-server-v1"
import {
  resolveSellerOsLunaBrowserContextRecoveryGateV1,
} from "@/lib/ebay/ebay-luna-browser-context-recovery-gate-v1"
import { auditSellerOsLunaProtectedSessionV1 } from
  "@/lib/ebay/ebay-luna-protected-session-server-v1"
import { validateAdminApiRequest } from "@/lib/supabase-admin"

const HEADERS = {
  "Cache-Control": "private, no-store, no-cache, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
}
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function protectedCookieOptions(request: NextRequest, maxAge: number) {
  const forwarded = request.headers.get("x-forwarded-proto")
  return {
    httpOnly: true,
    secure: forwarded === "https" || request.nextUrl.protocol === "https:",
    sameSite: "strict" as const,
    path: "/api/admin/ebay/luna-protected-session",
    maxAge,
    priority: "high" as const,
  }
}

function stateCookieOptions(request: NextRequest) {
  return protectedCookieOptions(request,
    Math.floor(SELLER_OS_LUNA_CEREMONY_TTL_MS / 1_000))
}

function csrfCookieOptions(request: NextRequest) {
  return protectedCookieOptions(request,
    Math.floor(SELLER_OS_LUNA_CEREMONY_CSRF_TTL_MS / 1_000))
}

function bearerToken(request: NextRequest) {
  const match = /^Bearer\s+(\S+)$/i.exec(
    request.headers.get("authorization")?.trim() ?? "",
  )
  return match?.[1] ?? ""
}

function safeError(cause: unknown) {
  if (cause instanceof SellerOsLunaBrowserCeremonyError) return cause.code
  const code = cause instanceof Error ? cause.message : ""
  return /^[A-Z0-9_]{3,160}$/.test(code)
    ? code : "LUNA_CEREMONY_FAILED_CLOSED"
}

function mutationAdmin(auth: Awaited<ReturnType<typeof validateAdminApiRequest>>) {
  return auth.ok && auth.authenticationMode === "admin_user" &&
    Boolean(auth.userId && UUID.test(auth.userId))
}

async function readAction(request: NextRequest) {
  const text = await request.text()
  if (!text || text.length > 96) {
    throw new SellerOsLunaBrowserCeremonyError(
      "LUNA_CEREMONY_CALLER_INPUT_REJECTED",
    )
  }
  let value: unknown
  try { value = JSON.parse(text) } catch {
    throw new SellerOsLunaBrowserCeremonyError(
      "LUNA_CEREMONY_CALLER_INPUT_REJECTED",
    )
  }
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).join(",") !== "action") {
    throw new SellerOsLunaBrowserCeremonyError(
      "LUNA_CEREMONY_CALLER_INPUT_REJECTED",
    )
  }
  const action = (value as { action?: unknown }).action
  if (!new Set(["START", "COMPLETE", "CANCEL"]).has(String(action))) {
    throw new SellerOsLunaBrowserCeremonyError(
      "LUNA_CEREMONY_CALLER_INPUT_REJECTED",
    )
  }
  return action as "START" | "COMPLETE" | "CANCEL"
}

export async function GET(request: NextRequest) {
  const auth = await validateAdminApiRequest(request)
  if (!auth.ok) {
    return NextResponse.json({
      success: false,
      error: auth.error ?? "admin_forbidden",
    }, { status: auth.status || 403, headers: HEADERS })
  }
  const [session, browserRuntime] = await Promise.all([
    auditSellerOsLunaProtectedSessionV1({ vaultSchemaApplied: true }),
    auditSellerOsLunaCanonicalBrowserRuntimeV1(),
  ])
  const prerequisites = buildSellerOsLunaAutomationPrerequisitesStatusV1({
    session,
  })
  const coordinator = getSellerOsLunaBrowserCeremonyCoordinatorV1()
  let ceremony = null
  let clearStateCookie = false
  let stateToken: string | null = request.cookies.get(
    SELLER_OS_LUNA_CEREMONY_STATE_COOKIE,
  )?.value ?? null
  if (stateToken && auth.userId && UUID.test(auth.userId)) {
    try {
      ceremony = await coordinator.status(stateToken, auth.userId)
    } catch (cause) {
      ceremony = Object.freeze({
        phase: "FAILED" as const,
        failureCode: safeError(cause),
        stateReturned: false as const,
        credentialsIncluded: false as const,
        cookiesIncluded: false as const,
      })
      stateToken = null
      clearStateCookie = true
    }
  }
  let csrf: ReturnType<ReturnType<
    typeof getSellerOsLunaCeremonyCsrfBoundaryV1>["issue"]> | null = null
  if (mutationAdmin(auth)) {
    csrf = getSellerOsLunaCeremonyCsrfBoundaryV1().issue({
      actorUserId: auth.userId as string,
      adminSessionToken: bearerToken(request),
      ceremonyInstanceId: coordinator.instanceId,
      requestUrl: request.url,
      origin: request.headers.get("origin"),
      secFetchSite: request.headers.get("sec-fetch-site"),
      stateToken,
    })
  }
  const ceremonyActive = Boolean(ceremony &&
    ["LAUNCHING", "AWAITING_HUMAN_LOGIN", "COMPLETING"]
      .includes(ceremony.phase))
  const recoveryGate = resolveSellerOsLunaBrowserContextRecoveryGateV1({
    protectedSessionStatus: prerequisites.lunaProtectedSessionStatus,
    browserContextActive: browserRuntime.browserContextActive,
    ceremonyActive,
  })
  const response = NextResponse.json({
    success: true,
    prerequisites,
    browserRuntime,
    ceremony,
    operatorAction: Object.freeze({
      status: recoveryGate.recoveryRequired
        ? "BROWSER_CONTEXT_RECOVERY_REQUIRED"
        : session.humanBootstrapRequired
          ? "HUMAN_BOOTSTRAP_REQUIRED" : "NO_ACTION_REQUIRED",
      path: session.bootstrapPath,
      instructionCode: recoveryGate.recoveryRequired
        ? "RECOVER_CANONICAL_BACKEND_CONTROLLED_LUNA_BROWSER_CONTEXT"
        : session.humanBootstrapRequired
          ? "START_CANONICAL_BACKEND_CONTROLLED_LUNA_BROWSER"
          : null,
      acceptsCallerCredentials: false,
      acceptsCallerCookies: false,
      acceptsCallerUrls: false,
      controlledBrowserWorkerActivated: ceremonyActive,
      browserContextRecoveryRequired: recoveryGate.recoveryRequired,
      ceremonyStartAllowed: recoveryGate.startAllowed,
      ceremonyReady: browserRuntime.status === "READY" &&
        session.status !== "SOURCE_UNAVAILABLE" &&
        session.status !== "AUTH_FAILED",
      csrfReadyForCurrentAdmin: Boolean(csrf),
      csrfToken: csrf?.csrfToken ?? null,
      csrfExpiresAt: csrf?.expiresAt ?? null,
      csrfSingleUse: csrf?.singleUse ?? null,
      csrfAdminSessionBound: csrf?.adminSessionBound ?? null,
      csrfCeremonyInstanceBound: csrf?.ceremonyInstanceBound ?? null,
      csrfOriginBound: csrf?.originBound ?? null,
      csrfCeremonyStateBound: csrf?.ceremonyStateBound ?? null,
      productionPreflightExecuted: false,
    }),
    safety: Object.freeze({
      productionLunaPolling: 0,
      lunaStockJobsCreated: 0,
      certifiedOosProduced: false,
      lunaMutations: 0,
      marketplaceWrites: 0,
      credentialsIncluded: false,
      cookiesIncluded: false,
      environmentValuesIncluded: false,
      buyerPiiIncluded: false,
    }),
  }, { status: 200, headers: HEADERS })
  if (csrf) {
    response.cookies.set(SELLER_OS_LUNA_CEREMONY_CSRF_COOKIE,
      csrf.csrfToken, csrfCookieOptions(request))
  }
  if (clearStateCookie) {
    response.cookies.set(SELLER_OS_LUNA_CEREMONY_STATE_COOKIE, "", {
      ...stateCookieOptions(request), maxAge: 0,
    })
  }
  return response
}

export async function POST(request: NextRequest) {
  const auth = await validateAdminApiRequest(request)
  if (!mutationAdmin(auth)) {
    return NextResponse.json({ success: false,
      error: auth.ok ? "admin_user_required" :
        auth.error ?? "admin_forbidden" }, {
      status: auth.ok ? 403 : auth.status || 403,
      headers: HEADERS,
    })
  }
  let csrfConsumed = false
  try {
    const action = await readAction(request)
    const actorUserId = auth.userId as string
    const stateToken = request.cookies.get(
      SELLER_OS_LUNA_CEREMONY_STATE_COOKIE,
    )?.value ?? null
    const coordinator = getSellerOsLunaBrowserCeremonyCoordinatorV1()
    getSellerOsLunaCeremonyCsrfBoundaryV1().consume({
      action,
      actorUserId,
      adminSessionToken: bearerToken(request),
      ceremonyInstanceId: coordinator.instanceId,
      requestUrl: request.url,
      origin: request.headers.get("origin"),
      secFetchSite: request.headers.get("sec-fetch-site"),
      contentType: request.headers.get("content-type"),
      csrfHeader: request.headers.get("x-seller-os-csrf"),
      csrfCookie: request.cookies.get(
        SELLER_OS_LUNA_CEREMONY_CSRF_COOKIE,
      )?.value ?? null,
      stateToken,
    })
    csrfConsumed = true
    if (action === "START") {
      const [browserRuntime, vaultSession] = await Promise.all([
        auditSellerOsLunaCanonicalBrowserRuntimeV1(),
        auditSellerOsLunaProtectedSessionV1({ vaultSchemaApplied: true }),
      ])
      if (browserRuntime.status !== "READY") {
        throw new SellerOsLunaBrowserCeremonyError(
          "LUNA_CEREMONY_BROWSER_RUNTIME_UNAVAILABLE",
        )
      }
      if (["SOURCE_UNAVAILABLE", "AUTH_FAILED"].includes(
        vaultSession.status,
      )) {
        throw new SellerOsLunaBrowserCeremonyError(
          "LUNA_CEREMONY_VAULT_RUNTIME_UNAVAILABLE",
        )
      }
      const started = await coordinator.start(actorUserId)
      const response = NextResponse.json({
        success: true,
        action,
        ceremony: started.ceremony,
        stateReturned: false,
        credentialsIncluded: false,
        cookiesIncluded: false,
      }, { status: 201, headers: HEADERS })
      response.cookies.set(SELLER_OS_LUNA_CEREMONY_STATE_COOKIE,
        started.stateToken, stateCookieOptions(request))
      response.cookies.set(SELLER_OS_LUNA_CEREMONY_CSRF_COOKIE, "", {
        ...csrfCookieOptions(request), maxAge: 0,
      })
      return response
    }
    if (!stateToken) {
      throw new SellerOsLunaBrowserCeremonyError(
        "LUNA_CEREMONY_WRONG_STATE",
      )
    }
    const ceremony = action === "COMPLETE"
      ? await coordinator.complete(stateToken, actorUserId)
      : await coordinator.cancel(stateToken, actorUserId)
    const response = NextResponse.json({
      success: true,
      action,
      ceremony,
      stateReturned: false,
      credentialsIncluded: false,
      cookiesIncluded: false,
      authenticatedLunaRead: action === "COMPLETE" ? "PASS" : "NOT_RUN",
    }, { status: 200, headers: HEADERS })
    response.cookies.set(SELLER_OS_LUNA_CEREMONY_STATE_COOKIE, "", {
      ...stateCookieOptions(request), maxAge: 0,
    })
    response.cookies.set(SELLER_OS_LUNA_CEREMONY_CSRF_COOKIE, "", {
      ...csrfCookieOptions(request), maxAge: 0,
    })
    return response
  } catch (cause) {
    const response = NextResponse.json({
      success: false,
      error: safeError(cause),
      contractVersion: SELLER_OS_LUNA_BROWSER_CEREMONY_VERSION,
      credentialsIncluded: false,
      cookiesIncluded: false,
    }, { status: 409, headers: HEADERS })
    if (csrfConsumed) {
      response.cookies.set(SELLER_OS_LUNA_CEREMONY_CSRF_COOKIE, "", {
        ...csrfCookieOptions(request), maxAge: 0,
      })
    }
    return response
  }
}
