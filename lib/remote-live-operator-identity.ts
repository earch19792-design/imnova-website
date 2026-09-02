export const REMOTE_LIVE_OPERATOR_INTERNAL_EMAIL =
  "remote-live-optimization-operator@auth.imnova.invalid" as const

export const REMOTE_LIVE_OPERATOR_USERNAME_MIN_LENGTH = 3
export const REMOTE_LIVE_OPERATOR_USERNAME_MAX_LENGTH = 32

const REMOTE_OPERATOR_USERNAME_PATTERN =
  /^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])?$/

export function normalizeRemoteLiveOperatorUsername(value: unknown) {
  if (typeof value !== "string") return null
  const normalized = value.trim().toLowerCase()
  if (normalized.length < REMOTE_LIVE_OPERATOR_USERNAME_MIN_LENGTH ||
      normalized.length > REMOTE_LIVE_OPERATOR_USERNAME_MAX_LENGTH ||
      !REMOTE_OPERATOR_USERNAME_PATTERN.test(normalized)) return null
  return normalized
}

function appMetadata(user: unknown) {
  return user && typeof user === "object" && "app_metadata" in user &&
    user.app_metadata && typeof user.app_metadata === "object"
    ? user.app_metadata as Record<string, unknown>
    : null
}

export function remoteLiveOperatorUsernameFromUser(user: unknown) {
  return normalizeRemoteLiveOperatorUsername(
    appMetadata(user)?.operator_username,
  )
}

export function sellerOsPasswordLoginIdentity(identifier: unknown) {
  if (typeof identifier !== "string") return null
  const trimmed = identifier.trim()
  if (!trimmed) return null
  if (trimmed.includes("@")) return Object.freeze({
    email: trimmed.toLowerCase(),
    remoteUsername: null,
  })
  const remoteUsername = normalizeRemoteLiveOperatorUsername(trimmed)
  if (!remoteUsername) return null
  return Object.freeze({
    email: REMOTE_LIVE_OPERATOR_INTERNAL_EMAIL,
    remoteUsername,
  })
}
