/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        source: "/seller-os-tools/ebay-product-research-capture-extension-v1.2.28.zip",
        headers: [
          {
            key: "Content-Disposition",
            value: 'attachment; filename="ebay-product-research-capture-extension.zip"',
          },
        ],
      },
    ]
  },
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
