export const SELLER_OS_LUNA_BROWSER_CONTEXT_RECOVERY_GATE_VERSION =
  "SELLER_OS_LUNA_BROWSER_CONTEXT_RECOVERY_GATE_V1" as const

export function resolveSellerOsLunaBrowserContextRecoveryGateV1(input:
Readonly<{
  protectedSessionStatus: string | null | undefined
  browserContextActive: boolean
  ceremonyActive: boolean
}>) {
  const sessionReady = input.protectedSessionStatus === "SESSION_READY"
  const recoveryRequired = sessionReady && !input.browserContextActive
  const startAllowed = !input.ceremonyActive &&
    (!sessionReady || !input.browserContextActive)

  return Object.freeze({
    contractVersion: SELLER_OS_LUNA_BROWSER_CONTEXT_RECOVERY_GATE_VERSION,
    sessionReady,
    browserContextActive: input.browserContextActive,
    recoveryRequired,
    startAllowed,
    startMode: recoveryRequired
      ? "RECOVER_BROWSER_CONTEXT" as const
      : startAllowed
        ? "INITIAL_OR_REAUTHENTICATION" as const
        : "SUPPRESSED_ACTIVE_CONTEXT" as const,
  })
}
