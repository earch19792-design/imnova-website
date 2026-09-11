import { decodeJwt } from "jose"
import { PRODUCTION_STOCK_AUTHORITY_BINDING_V1 as binding } from
  "./ebay-production-stock-authority-binding-v1"

export function stockRequestAuthMetadataV1(headers: Headers) {
  const authorization = headers.get("authorization")
  const apiKey = headers.get("apikey")
  const bearer = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null
  let jwtRole = "NOT_JWT_OR_OPAQUE"
  let jwtIssuerMatch = "NOT_JWT_OR_OPAQUE"
  let jwtAudienceMatch = "NOT_JWT_OR_OPAQUE"
  let jwtProjectMatch = "NOT_JWT_OR_OPAQUE"
  try {
    // Diagnostic claims ONLY. Never used to grant access or replace verification.
    const payload = decodeJwt(bearer ?? "")
    jwtRole = ["service_role", "authenticated", "anon"].includes(String(payload.role))
      ? String(payload.role) : "UNRECOGNIZED"
    jwtIssuerMatch = payload.iss === "supabase" || payload.iss === `${binding.databaseUrl}/auth/v1`
      ? "MATCH" : payload.iss === undefined ? "ABSENT" : "MISMATCH"
    jwtAudienceMatch = payload.aud === undefined ? "ABSENT_LEGACY_CLAIM"
      : (Array.isArray(payload.aud) ? payload.aud : [payload.aud]).includes("authenticated")
        ? "MATCH" : "MISMATCH"
    jwtProjectMatch = payload.ref === undefined ? "ABSENT"
      : payload.ref === "qsefoxmmypmdtwrrtnry" ? "MATCH" : "MISMATCH"
  } catch { /* Opaque modern keys are not assumed invalid. */ }
  return Object.freeze({
    requestAuthMode: bearer && apiKey ? "BEARER_WITH_API_KEY"
      : bearer ? "BEARER_ONLY" : apiKey ? "API_KEY_ONLY" : "NONE",
    authorizationHeaderPresent: Boolean(authorization), apiKeyHeaderPresent: Boolean(apiKey),
    authorizationMatchesApiKey: Boolean(bearer && apiKey && bearer === apiKey),
    jwtRole, jwtIssuerMatch, jwtAudienceMatch, jwtProjectMatch,
    jwtClaimsAreDiagnosticOnly: true,
  })
}

export type StockReadDiagnosticV1 = ReturnType<typeof stockRequestAuthMetadataV1> & {
  table: string; method: string; accountFilterMatches: boolean;
  authHeadersMatchFirstRequest: boolean; httpStatus: number;
  upstreamErrorCode: string | null; permissionDeniedOnRequestedTable: boolean;
  http401Origin: string | null;
}

export async function stockResponseDiagnosticV1(response: Response, table: string) {
  if (response.ok) return { upstreamErrorCode: null,
    permissionDeniedOnRequestedTable: false, http401Origin: null }
  const body = await response.clone().json().catch(() => null)
  const code = typeof body?.code === "string" && /^(?:PGRST\d{3}|[0-9A-Z]{5})$/.test(body.code)
    ? body.code : null
  return {
    upstreamErrorCode: code,
    permissionDeniedOnRequestedTable: body?.message === `permission denied for table ${table}`,
    http401Origin: response.status !== 401 ? null : code === "42501"
      ? "POSTGRES_INSUFFICIENT_PRIVILEGE" : code?.startsWith("PGRST3")
        ? "POSTGREST_JWT_VALIDATION" : "UPSTREAM_UNCLASSIFIED_401",
  }
}
