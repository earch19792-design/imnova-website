import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose"

// Reviewed deployment/account binding, not a credential. Never take these
// values (or the JWKS URL) from the caller, token headers, or PREPROD settings.
export const PRODUCTION_STOCK_AUTHORITY_BINDING_V1 = Object.freeze({
  version: "PRODUCTION_CANONICAL_STOCK_AUTHORITY_V1",
  service: "SELLER_OS_PRODUCTION_STOCK_READ_V1",
  projectId: "prj_a6N1XDfeaKAiR5QmmNFYF16Nmqe5",
  project: "imnova-website-z1qh",
  hostname: "imnova-website-z1qh.vercel.app",
  ownerId: "team_IRA6oz1bTjI2WQ3eh23Nnr1r",
  owner: "earch19792-6888s-projects",
  issuer: "https://oidc.vercel.com/earch19792-6888s-projects",
  audience: "https://vercel.com/earch19792-6888s-projects",
  subject: "owner:earch19792-6888s-projects:project:imnova-website-z1qh:environment:production",
  databaseUrl: "https://qsefoxmmypmdtwrrtnry.supabase.co",
  accountAlias: "imnova-ebay-us-primary",
  accountKey: "imnova-ebay-us-primary:cd8fd3dc2b4102d4aff320268c647fa895c6416df01013f9bb06b3a587709e12",
})

const binding = PRODUCTION_STOCK_AUTHORITY_BINDING_V1
const keys = createRemoteJWKSet(new URL(`${binding.issuer}/.well-known/jwks`), {
  timeoutDuration: 3_000, cooldownDuration: 60_000,
})

// Vercel workload federation, not eBay OAuth and not a database service key.
// The issuer owns the signing keys. No token is persisted or echoed. A replay
// can only repeat the bounded read; it cannot create a job or mutate a listing.
export async function verifyProductionStockServiceIdentityV1(assertion: string,
  options: { keyResolver?: JWTVerifyGetKey; currentDate?: Date } = {}) {
  if (!assertion || assertion.length > 8_192) return false
  try {
    const { payload } = await jwtVerify(assertion, options.keyResolver ?? keys, {
      issuer: binding.issuer, audience: binding.audience, subject: binding.subject,
      algorithms: ["RS256"], requiredClaims: ["iat", "nbf", "exp", "sub"],
      maxTokenAge: "1h", clockTolerance: 5, currentDate: options.currentDate,
    })
    return payload.project_id === binding.projectId && payload.project === binding.project &&
      payload.owner_id === binding.ownerId && payload.owner === binding.owner &&
      payload.environment === "production" &&
      typeof payload.iat === "number" && typeof payload.exp === "number" &&
      payload.exp - payload.iat <= 3_600
  } catch { return false }
}

export function productionStockAuthorityConfigurationValidV1(environment: NodeJS.ProcessEnv) {
  const fingerprint = binding.accountKey.slice(binding.accountAlias.length + 1)
  return environment.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") === binding.databaseUrl &&
    (!environment.EBAY_SELLER_ACCOUNT_KEY || environment.EBAY_SELLER_ACCOUNT_KEY === binding.accountAlias ||
      environment.EBAY_SELLER_ACCOUNT_KEY === binding.accountKey) &&
    (!environment.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_ACCOUNT_FINGERPRINT ||
      environment.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_ACCOUNT_FINGERPRINT === fingerprint) &&
    (!environment.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_CREDENTIAL_FINGERPRINT ||
      environment.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_CREDENTIAL_FINGERPRINT === fingerprint) &&
    !environment.SELLER_OS_CLOUD_READ_RELAY_URL &&
    !environment.SELLER_OS_CLOUD_READ_RELAY_SECRET &&
    !environment.SELLER_OS_CLOUD_READ_RELAY_PROTECTION_BYPASS
}
