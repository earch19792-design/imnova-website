import path from "node:path"
import { fileURLToPath } from "node:url"

const serviceRoot = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(serviceRoot, "../..")

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  outputFileTracingRoot: repositoryRoot,
  experimental: {
    cpus: 1,
    externalDir: true,
  },
}

export default nextConfig
