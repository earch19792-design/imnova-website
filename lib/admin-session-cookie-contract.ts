export const SELLER_OS_ADMIN_SESSION_COOKIE =
  "seller_os_admin_session" as const

export const SELLER_OS_PUBLICATION_OAUTH_START_SESSION_COOKIE =
  "seller_os_publication_oauth_start_session" as const

export const SELLER_OS_PUBLICATION_OAUTH_START_PATH =
  "/api/admin/ebay/publication-oauth/start" as const

export function sellerOsAdminSessionCookieOptions(
  path: string,
  maxAge: number,
) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path,
    maxAge,
  }
}
