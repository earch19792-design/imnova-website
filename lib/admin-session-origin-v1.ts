const SELLER_OS_LOOPBACK_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "[::1]",
])

function effectivePort(url: URL) {
  if (url.port) return url.port
  if (url.protocol === "http:") return "80"
  if (url.protocol === "https:") return "443"
  return ""
}

function parseBrowserOrigin(value: string) {
  if (!value || value === "null" || value !== value.trim()) return null
  try {
    const parsed = new URL(value)
    if (parsed.origin !== value || parsed.username || parsed.password ||
        parsed.pathname !== "/" || parsed.search || parsed.hash ||
        !new Set(["http:", "https:"]).has(parsed.protocol)) return null
    return parsed
  } catch {
    return null
  }
}

function originBinding(url: URL) {
  return SELLER_OS_LOOPBACK_HOSTS.has(url.hostname)
    ? `${url.protocol}//seller-os-loopback:${effectivePort(url)}`
    : url.origin
}

export function getSellerOsAdminOriginBindingV1(input: Readonly<{
  requestUrl: string
  origin: string | null
  secFetchSite: string | null
  requireOrigin?: boolean
}>) {
  const fetchSite = input.secFetchSite?.trim().toLowerCase() ?? ""
  if (fetchSite && fetchSite !== "same-origin") return null

  let target: URL
  try { target = new URL(input.requestUrl) } catch { return null }
  if (!new Set(["http:", "https:"]).has(target.protocol) ||
      target.username || target.password) return null

  if (!input.origin) {
    return input.requireOrigin ? null : originBinding(target)
  }

  const source = parseBrowserOrigin(input.origin)
  if (!source) return null
  if (source.origin === target.origin) return originBinding(target)

  if (source.protocol !== target.protocol ||
      effectivePort(source) !== effectivePort(target) ||
      !SELLER_OS_LOOPBACK_HOSTS.has(source.hostname) ||
      !SELLER_OS_LOOPBACK_HOSTS.has(target.hostname)) return null

  return originBinding(target)
}

export function isSameSellerOsAdminOriginV1(input: Readonly<{
  requestUrl: string
  origin: string | null
  secFetchSite: string | null
}>) {
  return getSellerOsAdminOriginBindingV1({
    ...input,
    requireOrigin: false,
  }) !== null
}
