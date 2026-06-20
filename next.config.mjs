/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    cpus: 1,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
