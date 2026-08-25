export const LUNA_SHIPPING_EXTENSION_NOT_INSTALLED =
  "LUNA_SHIPPING_EXTENSION_NOT_INSTALLED"

const RETRYABLE_EXTENSION_WAKE_ERRORS = new Set([
  "LUNA_SHIPPING_EXTENSION_DISCONNECTED",
  "LUNA_SHIPPING_EXTENSION_PING_TIMEOUT",
  "LUNA_SHIPPING_EXTENSION_SERVICE_WORKER_UNAVAILABLE",
])

type ExtensionRuntimeDetectionOptionsV1<Runtime> = {
  readRuntime: () => Runtime | undefined
  pingRuntime: (runtime: Runtime) => Promise<void>
  wait: (milliseconds: number) => Promise<void>
  runtimeAttempts?: number
  runtimePollIntervalMs?: number
  pingAttempts?: number
  pingRetryIntervalMs?: number
}

function hasExternalRuntimeCapability(value: unknown) {
  if (!value || typeof value !== "object") return false
  const runtime = value as { connect?: unknown, sendMessage?: unknown }
  return typeof runtime.connect === "function" &&
    typeof runtime.sendMessage === "function"
}

function exactErrorCode(error: unknown) {
  return error instanceof Error && error.message
    ? error.message : "LUNA_SHIPPING_EXTENSION_DISCONNECTED"
}

export async function wakeLunaShippingExtensionV1<Runtime>(runtime: Runtime,
  pingRuntime: (runtime: Runtime) => Promise<void>,
  wait: (milliseconds: number) => Promise<void>, options: {
    pingAttempts?: number
    pingRetryIntervalMs?: number
  } = {}) {
  const pingAttempts = Math.max(1, options.pingAttempts ?? 3)
  const pingRetryIntervalMs = Math.max(0,
    options.pingRetryIntervalMs ?? 500)
  let lastError: unknown = new Error(
    "LUNA_SHIPPING_EXTENSION_DISCONNECTED")
  for (let attempt = 0; attempt < pingAttempts; attempt += 1) {
    try {
      await pingRuntime(runtime)
      return
    } catch (error) {
      lastError = error
      const code = exactErrorCode(error)
      if (!RETRYABLE_EXTENSION_WAKE_ERRORS.has(code) ||
          attempt === pingAttempts - 1) throw error
      await wait(pingRetryIntervalMs)
    }
  }
  throw lastError
}

export async function detectAndWakeLunaShippingExtensionV1<Runtime>(
  options: ExtensionRuntimeDetectionOptionsV1<Runtime>) {
  const runtimeAttempts = Math.max(1, options.runtimeAttempts ?? 20)
  const runtimePollIntervalMs = Math.max(0,
    options.runtimePollIntervalMs ?? 250)
  let runtime: Runtime | undefined
  for (let attempt = 0; attempt < runtimeAttempts; attempt += 1) {
    const candidate = options.readRuntime()
    if (hasExternalRuntimeCapability(candidate)) {
      runtime = candidate
      break
    }
    if (attempt < runtimeAttempts - 1) {
      await options.wait(runtimePollIntervalMs)
    }
  }
  if (!runtime) throw new Error(LUNA_SHIPPING_EXTENSION_NOT_INSTALLED)
  await wakeLunaShippingExtensionV1(runtime, options.pingRuntime,
    options.wait, {
      pingAttempts: options.pingAttempts,
      pingRetryIntervalMs: options.pingRetryIntervalMs,
    })
  return runtime
}
