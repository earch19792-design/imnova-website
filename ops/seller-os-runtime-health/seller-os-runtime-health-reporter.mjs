#!/usr/bin/env node

const MCP_URL = "http://127.0.0.1:3000/api/seller-os/assistant/mcp"
const ATTESTATION_URL =
  "https://imnova-seller-os-preprod.vercel.app/api/runtime/health-attestation"
const secret = process.env.SELLER_OS_CLOUD_READ_RELAY_SECRET?.trim()
if (!secret) process.exit(0)

const controller = new AbortController()
const timeout = setTimeout(() => controller.abort(), 15_000)
try {
  const local = await fetch(MCP_URL, { method: "POST", signal: controller.signal,
    headers: { "accept": "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2025-06-18" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name: "seller_os_get_runtime_health", arguments: {} } }) })
  if (!local.ok) process.exit(0)
  const rpc = await local.json()
  const runtimeHealth = rpc?.result?.structuredContent?.result
  if (runtimeHealth?.contractVersion !== "SELLER_OS_RUNTIME_HEALTH_V1") {
    process.exit(0)
  }
  const remote = await fetch(ATTESTATION_URL, { method: "POST",
    signal: controller.signal,
    headers: { authorization: `Bearer ${secret}`,
      "content-type": "application/json" },
    body: JSON.stringify({ runtimeHealth }) })
  if (!remote.ok) process.exit(0)
} catch {
  process.exit(0)
} finally {
  clearTimeout(timeout)
}
