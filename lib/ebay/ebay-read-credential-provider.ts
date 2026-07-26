import { getEbayTradingReadOnlyAccessToken } from "./ebay-manual-listing-trading-readonly"

export const EBAY_READ_CREDENTIAL_PROVIDER_VERSION =
  "EBAY_READ_CREDENTIAL_PROVIDER_V1" as const

export type EbayReadCredentialPurpose =
  | "trading.active_listing.preflight"
  | "trading.active_listing.readback"
  | "commercial_monitor.read"

const READ_CREDENTIAL_BRAND: unique symbol = Symbol("EBAY_READ_CREDENTIAL")
const READ_TOKEN: unique symbol = Symbol("EBAY_READ_TOKEN")

export type EbayReadCredential<P extends EbayReadCredentialPurpose =
  EbayReadCredentialPurpose> = {
  readonly [READ_CREDENTIAL_BRAND]: true
  readonly [READ_TOKEN]: string
  readonly purpose: P
  readonly providerVersion: typeof EBAY_READ_CREDENTIAL_PROVIDER_VERSION
  readonly scopes: readonly ["https://api.ebay.com/oauth/api_scope"]
}

export async function getEbayReadCredential<P extends EbayReadCredentialPurpose>(
  purpose: P,
  fetchImpl: typeof fetch = fetch,
): Promise<EbayReadCredential<P>> {
  const token = await getEbayTradingReadOnlyAccessToken(fetchImpl)
  return {
    [READ_CREDENTIAL_BRAND]: true,
    [READ_TOKEN]: token,
    purpose,
    providerVersion: EBAY_READ_CREDENTIAL_PROVIDER_VERSION,
    scopes: ["https://api.ebay.com/oauth/api_scope"],
  }
}

export function useEbayReadCredential<P extends EbayReadCredentialPurpose>(
  credential: EbayReadCredential,
  purpose: P,
) {
  if (credential?.[READ_CREDENTIAL_BRAND] !== true ||
    credential.purpose !== purpose ||
    !credential[READ_TOKEN]) {
    throw new Error("EBAY_READ_CREDENTIAL_PURPOSE_MISMATCH")
  }
  return credential[READ_TOKEN]
}
