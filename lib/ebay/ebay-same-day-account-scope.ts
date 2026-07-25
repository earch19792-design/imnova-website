import { probeEbayProductionIdentityReadOnly } from "./ebay-manual-listing-trading-readonly"
import { getEbaySellerAccountScopeConfiguration } from "./ebay-seller-account-scope"

const HEX_FINGERPRINT = /^[0-9a-f]{64}$/

export type SameDayPilotAccountScopeResolution = {
  accountKey: string | null
  source: "CONFIGURED" | "RUNTIME_FALLBACK" | "UNRESOLVED"
  fallbackAttempted: boolean
  scopeResolutionReason: string | null
}

export async function resolveSameDayPilotAccountScope(): Promise<SameDayPilotAccountScopeResolution> {
  const scope = getEbaySellerAccountScopeConfiguration()

  if (scope.accountKey && scope.identity.bound && scope.identity.consistent) {
    return {
      accountKey: scope.accountKey,
      source: "CONFIGURED",
      fallbackAttempted: false,
      scopeResolutionReason: null,
    }
  }

  if (!scope.accountAlias || !/^[A-Za-z0-9._-]{1,80}$/.test(scope.accountAlias)) {
    return {
      accountKey: null,
      source: "UNRESOLVED",
      fallbackAttempted: false,
      scopeResolutionReason: scope.reason,
    }
  }

  // Safety policy: if an expected fingerprint was configured but failed to match,
  // avoid silently overriding it.
  if (scope.identity.expectedAccountFingerprint) {
    return {
      accountKey: null,
      source: "UNRESOLVED",
      fallbackAttempted: false,
      scopeResolutionReason: scope.reason,
    }
  }

  if (!scope.reason) {
    return {
      accountKey: null,
      source: "UNRESOLVED",
      fallbackAttempted: false,
      scopeResolutionReason: "ACCOUNT_SCOPE_RECOVERY_NOT_REQUIRED",
    }
  }

  // Recovery path: derive runtime user fingerprint from read-only identity only
  // when no expected fingerprint is configured.
  try {
    const probe = await probeEbayProductionIdentityReadOnly()
    if (probe.configuredFingerprintPresent) {
      return {
        accountKey: null,
        source: "UNRESOLVED",
        fallbackAttempted: true,
        scopeResolutionReason: scope.reason,
      }
    }
    if (HEX_FINGERPRINT.test(probe.fingerprint ?? "")) {
      return {
        accountKey: `${scope.accountAlias}:${probe.fingerprint}`,
        source: "RUNTIME_FALLBACK",
        fallbackAttempted: true,
        scopeResolutionReason: scope.reason,
      }
    }
  } catch {
    // Keep fail-closed if identity cannot be revalidated at runtime.
  }

  return {
    accountKey: null,
    source: "UNRESOLVED",
    fallbackAttempted: true,
    scopeResolutionReason: scope.reason,
  }
}
