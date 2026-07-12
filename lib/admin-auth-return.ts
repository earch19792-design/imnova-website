export const DEFAULT_ADMIN_RETURN_PATH = "/admin"

export function getSafeAdminReturnPath(value: string | null | undefined) {
  if (!value) return DEFAULT_ADMIN_RETURN_PATH
  const candidate = value.trim()
  if (!candidate.startsWith("/admin") || candidate.startsWith("//")) {
    return DEFAULT_ADMIN_RETURN_PATH
  }
  try {
    const parsed = new URL(candidate, "https://admin.imnova.local")
    if (parsed.origin !== "https://admin.imnova.local" || !parsed.pathname.startsWith("/admin")) {
      return DEFAULT_ADMIN_RETURN_PATH
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return DEFAULT_ADMIN_RETURN_PATH
  }
}
