/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["playwright"],
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    cpus: 1,
  },
  outputFileTracingIncludes: {
    "/api/cron/ebay-same-day-pilot": ["./public/fonts/DejaVuSans.ttf"],
    "/api/admin/ebay/images": ["./public/fonts/DejaVuSans.ttf"],
    "/api/admin/ebay/same-day-pilot": ["./public/fonts/DejaVuSans.ttf"],
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
