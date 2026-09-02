export const SELLER_OS_ACCESS_ROLES = Object.freeze({
  owner: "OWNER_ADMIN",
  remoteLiveOptimizationOperator: "REMOTE_LIVE_OPTIMIZATION_OPERATOR",
} as const)

export type SellerOsAccessRole =
  typeof SELLER_OS_ACCESS_ROLES[keyof typeof SELLER_OS_ACCESS_ROLES]

function appMetadata(user: unknown) {
  return user && typeof user === "object" && "app_metadata" in user &&
    user.app_metadata && typeof user.app_metadata === "object"
    ? user.app_metadata as Record<string, unknown>
    : null
}

export function sellerOsAccessRoleFromUser(
  user: unknown,
): SellerOsAccessRole | null {
  const metadata = appMetadata(user)
  if (metadata?.is_admin === true || metadata?.role === "admin") {
    return SELLER_OS_ACCESS_ROLES.owner
  }
  return metadata?.role ===
      SELLER_OS_ACCESS_ROLES.remoteLiveOptimizationOperator
    ? SELLER_OS_ACCESS_ROLES.remoteLiveOptimizationOperator
    : null
}

export function isSellerOsOwnerRole(role: SellerOsAccessRole | null) {
  return role === SELLER_OS_ACCESS_ROLES.owner
}

export function isRemoteLiveOptimizationOperatorRole(
  role: SellerOsAccessRole | null,
) {
  return role === SELLER_OS_ACCESS_ROLES.remoteLiveOptimizationOperator
}
