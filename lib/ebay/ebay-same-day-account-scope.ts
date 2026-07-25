import { probeEbayProductionIdentityReadOnly } from "./ebay-manual-listing-trading-readonly"
import { getEbaySellerAccountScopeConfiguration } from "./ebay-seller-account-scope"

const HEX_FINGERPRINT = /^[0-9a-f]{64}$/

export type SameDayPilotAccountScopeResolution = {
  accountKey: string | null
  source: "CONFIGURED" | "RUNTIME_FALLBACK" | "UNRESOLVED"
  fallbackAttempted: boolean
  scopeResolutionReason: string | null
}

function isRuntimeAccountScopeRescueEnabled() {
  const override = process.env.EBAY_SAME_DAY_PILOT_SCOPE_RECOVERY?.trim().toLowerCase()
  if (override === "disabled") return false
  if (override === "enabled") return true
  return process.env.VERCEL_ENV === "preview" || process.env.NODE_ENV === "development"
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

  // Safety policy: only fallback to runtime identity when explicitly
  // enabled for this environment. This is a Same-Day emergency lane.
  if (!isRuntimeAccountScopeRescueEnabled() && scope.identity.expectedAccountFingerprint) {
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
  // when fingerprint recovery mode is enabled.
  try {
    const probe = await probeEbayProductionIdentityReadOnly(undefined, {
      allowConfiguredFingerprintMismatch: true,
      bypassIdentityConsistencyForRescue: true,
    })
    const probeReason = reasonFromProbe(probe)
    if (probe.configuredFingerprintPresent) {
      console.warn(
        "SAME_DAY_PILOT_SCOPE_RESCUE_RUNTIME_FALLBACK",
        JSON.stringify({
          accountAlias: scope.accountAlias,
          recoveryReason: probeReason,
          fallbackFingerprintSource: probe.identityBindingStatus,
          fallbackAttempted: true,
        }),
      )
    }
    if (HEX_FINGERPRINT.test(probe.fingerprint ?? "")) {
      return {
        accountKey: `${scope.accountAlias}:${probe.fingerprint}`,
        source: "RUNTIME_FALLBACK",
        fallbackAttempted: true,
        scopeResolutionReason: scope.reason ?? probeReason,
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

function reasonFromProbe(probe: { configuredFingerprintMatches?: boolean }) {
  return probe.configuredFingerprintMatches === true
    ? "ACCOUNT_SCOPE_MATCHED_RUNTIME_FINGERPRINT"
    : "ACCOUNT_SCOPE_RUNTIME_FINGERPRINT_DERIVED"
}
