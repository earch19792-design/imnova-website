export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

import { NextResponse } from "next/server"

import {
  parseManualListingRegistrationInput,
  reusableListingDefaultFields,
} from "@/lib/ebay/ebay-manual-listing-domain"
import {
  getManualListingRegistrationConfiguration,
  isSafeManualListingErrorCode,
  listManualEbayListingRegistrations,
  registerManualEbayListing,
} from "@/lib/ebay/ebay-manual-listing-service"
import {
  getSupabaseAdminClient,
  validateAdminApiRequest,
} from "@/lib/supabase-admin"

function safeErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : ""
  return isSafeManualListingErrorCode(message)
    ? message
    : "MANUAL_LISTING_REQUEST_FAILED"
}

function errorStatus(code: string) {
  if (code.endsWith("_NOT_FOUND")) return 404
  if (
    code === "MANUAL_LISTING_ACCOUNT_KEY_REQUIRED" ||
    code === "MANUAL_LISTING_OFFICIAL_ACCOUNT_IDENTITY_REQUIRED" ||
    code === "MANUAL_LISTING_OFFICIAL_ACCOUNT_IDENTITY_INCONSISTENT"
  ) return 503
  if (
    code.endsWith("_ALREADY_LINKED") ||
    code.endsWith("_MISMATCH")
  ) return 409
  if (
    code.endsWith("_INVALID") ||
    code.endsWith("_REQUIRED") ||
    code === "MANUAL_LISTING_UNSAFE_DEFAULT_FIELD"
  ) return 400
  if (
    code.endsWith("_READ_FAILED") ||
    code.endsWith("_WRITE_FAILED")
  ) return 503
  return 502
}

function failure(code: string, status: number) {
  return NextResponse.json(
    {
      success: false,
      error: code,
      safety: {
        ebayWriteUsed: false,
        canPublish: false,
        verifiedFailClosed: true,
      },
    },
    { status },
  )
}

async function authenticate(req: Request) {
  try {
    return await validateAdminApiRequest(req)
  } catch {
    return {
      ok: false,
      status: 503,
      error: "admin_auth_unavailable",
      userId: null,
    }
  }
}

export async function GET(req: Request) {
  const auth = await authenticate(req)
  if (!auth.ok) {
    return failure(
      auth.error ?? "admin_forbidden",
      auth.status || 403,
    )
  }

  try {
    const requestedLimit = Number(
      new URL(req.url).searchParams.get("limit") ?? 50,
    )
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(100, Math.max(1, Math.trunc(requestedLimit)))
      : 50
    const configuration = getManualListingRegistrationConfiguration()
    const result = configuration.accountScopeConfigured
      ? await listManualEbayListingRegistrations(
          getSupabaseAdminClient(),
          limit,
        )
      : {
          accountKey: null,
          registrations: [],
          templates: [],
        }
    return NextResponse.json({
      success: true,
      ...result,
      configuration,
      reusableDefaultsPolicy: {
        allowedFields: reusableListingDefaultFields,
        forbiddenContent: [
          "title",
          "description",
          "images",
          "brand",
          "model",
          "claims",
          "competitorContent",
          "aspectValues",
        ],
        templatesRequireVerifiedOwnership: true,
      },
      safety: {
        ebayWriteUsed: false,
        canPublish: false,
        verifiedFailClosed: true,
      },
    })
  } catch (error) {
    const code = safeErrorCode(error)
    return failure(code, errorStatus(code))
  }
}

export async function POST(req: Request) {
  const auth = await authenticate(req)
  if (!auth.ok) {
    return failure(
      auth.error ?? "admin_forbidden",
      auth.status || 403,
    )
  }
  if (!auth.userId) {
    return failure("MANUAL_LISTING_HUMAN_ADMIN_REQUIRED", 403)
  }

  const contentLength = Number(req.headers.get("content-length") ?? 0)
  if (Number.isFinite(contentLength) && contentLength > 32_768) {
    return failure("MANUAL_LISTING_REQUEST_TOO_LARGE", 413)
  }

  try {
    const parsedInput = parseManualListingRegistrationInput(await req.json())
    const input = {
      ...parsedInput,
      // Product identity is resolved from the opportunity and its bound handoff.
      // A browser-declared supplier SKU is never an accepted identity source.
      supplierSku: null,
    }
    const supabase = getSupabaseAdminClient()
    const result = await registerManualEbayListing(
      supabase,
      input,
      auth.userId,
    )
    return NextResponse.json({
      success: true,
      ...result,
      configuration: getManualListingRegistrationConfiguration(),
      safety: {
        ebayWriteUsed: false,
        canPublish: false,
        verifiedFailClosed: true,
        productSkuIdentitySource:
          "CANONICAL_PACKAGE_OR_BOUND_MANUAL_HANDOFF",
        reusableContentRestrictedToSellerOperationalDefaults: true,
      },
    })
  } catch (error) {
    const code = safeErrorCode(error)
    return failure(code, errorStatus(code))
  }
}
