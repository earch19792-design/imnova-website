export const SELLER_OS_LUNA_STABLE_PREVIEW_ORIGIN =
  "https://imnova-website-z1qh-canonical-preview.vercel.app"

const SELLER_OS_PREVIEW_DEPLOYMENT_PREFIX = "imnova-website-z1qh-"
const SELLER_OS_PREVIEW_DEPLOYMENT_SUFFIX =
  "-earch19792-6888s-projects.vercel.app"
const VERCEL_DEPLOYMENT_TOKEN = /^[a-z0-9]{9}$/

export function canonicalSellerOsLunaPreviewOriginV1(value) {
  let url
  try { url = new URL(String(value ?? "")) } catch { return null }
  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    return null
  }
  if (url.origin === SELLER_OS_LUNA_STABLE_PREVIEW_ORIGIN) {
    return SELLER_OS_LUNA_STABLE_PREVIEW_ORIGIN
  }
  const { hostname } = url
  if (!hostname.startsWith(SELLER_OS_PREVIEW_DEPLOYMENT_PREFIX) ||
      !hostname.endsWith(SELLER_OS_PREVIEW_DEPLOYMENT_SUFFIX)) return null
  const token = hostname.slice(SELLER_OS_PREVIEW_DEPLOYMENT_PREFIX.length,
    -SELLER_OS_PREVIEW_DEPLOYMENT_SUFFIX.length)
  return VERCEL_DEPLOYMENT_TOKEN.test(token)
    ? SELLER_OS_LUNA_STABLE_PREVIEW_ORIGIN : null
}
