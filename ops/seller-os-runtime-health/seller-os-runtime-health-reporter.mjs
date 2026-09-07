#!/usr/bin/env node

const MCP_URL = "http://127.0.0.1:3000/api/seller-os/assistant/mcp"
const ATTESTATION_URL =
  "https://imnova-seller-os-preprod.vercel.app/api/runtime/health-attestation"
const secret = process.env.SELLER_OS_CLOUD_READ_RELAY_SECRET?.trim()
const protectionBypass =
  process.env.SELLER_OS_CLOUD_READ_RELAY_PROTECTION_BYPASS?.trim()

async function reportRuntimeHealth() {
  if (!secret) return "SELLER_OS_RUNTIME_HEALTH_REPORTER_SECRET_UNAVAILABLE"
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    const local = await fetch(MCP_URL, { method: "POST",
      signal: controller.signal,
      headers: { "accept": "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": "2025-06-18" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call",
        params: { name: "seller_os_get_runtime_health", arguments: {} } }) })
    if (!local.ok) {
      return `SELLER_OS_RUNTIME_HEALTH_LOCAL_MCP_${local.status}`
    }
    const rpc = await local.json()
    const runtimeHealth = rpc?.result?.structuredContent?.result
    if (runtimeHealth?.contractVersion !== "SELLER_OS_RUNTIME_HEALTH_V1") {
      return "SELLER_OS_RUNTIME_HEALTH_LOCAL_CONTRACT_INVALID"
    }
    const remote = await fetch(ATTESTATION_URL, { method: "POST",
      signal: controller.signal,
      headers: { authorization: `Bearer ${secret}`,
        ...(protectionBypass
          ? { "x-vercel-protection-bypass": protectionBypass }
          : {}),
        "content-type": "application/json" },
      body: JSON.stringify({ runtimeHealth }) })
    if (!remote.ok) {
      return `SELLER_OS_RUNTIME_HEALTH_ATTESTATION_${remote.status}`
    }
    return "SELLER_OS_RUNTIME_HEALTH_REPORTER_POSTED"
  } catch (error) {
    return error?.name === "AbortError"
      ? "SELLER_OS_RUNTIME_HEALTH_REPORTER_TIMEOUT"
      : "SELLER_OS_RUNTIME_HEALTH_REPORTER_FAILED"
  } finally {
    clearTimeout(timeout)
  }
}

console.error(await reportRuntimeHealth())
