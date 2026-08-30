"use client"

import { useEffect, useRef, useState } from "react"

import { supabase } from "@/lib/supabase"
import type { LunaChromeShippingJobV1 } from
  "@/lib/ebay/ebay-luna-chrome-shipping-capture-v1"
import type { LunaShippingRuntimeTraceEventV1 } from
  "@/lib/ebay/ebay-luna-chrome-shipping-capture-v1"
import { detectAndWakeLunaShippingExtensionV1,
  wakeLunaShippingExtensionV1 } from
  "@/lib/ebay/ebay-luna-extension-detection-v1"
import { canonicalSellerOsLunaPreviewOriginV1,
  SELLER_OS_LUNA_STABLE_PREVIEW_ORIGIN } from
  "@/lib/ebay/ebay-luna-shipping-preview-origin-v1.mjs"

const PORT_NAME = "SELLER_OS_LUNA_SHIPPING_CAPTURE_V1"
const EXTENSION_ID = "mhpkojahbbfdgodeaecggpjaplllgclk"
const CONTRACT = "LUNA_SHIPPING_QUOTE_CAPTURE_V1"
const EXTENSION_PING = "SELLER_OS_LUNA_SHIPPING_PING"
const EXTENSION_READY = "LUNA_SHIPPING_EXTENSION_READY"
const EXPECTED_EXTENSION_VERSION = "1.0.46"
const SELLER_OS_EXTENSION_ORIGIN = SELLER_OS_LUNA_STABLE_PREVIEW_ORIGIN
const STARTUP_PROBE_CONTRACT = "SELLER_OS_LUNA_EXTENSION_STARTUP_PROBE_V1"
const GET_BINDING_STORAGE_DIAGNOSTIC =
  "SELLER_OS_GET_LUNA_BINDING_STORAGE_DIAGNOSTIC_V1"
const BINDING_STORAGE_DIAGNOSTIC = "LUNA_BINDING_STORAGE_DIAGNOSTIC_V1"
const CANARY_ID =
  "sha256:39f9566e97c230d9fdf9882a802af7dad8a7a0e54ab000999bcc3da779f4ab60"
const CANARY_NAME = "5-in-1 Microcurrent Facial Device for Skin Tightening & Lifting"

function finalCanaryStartEnabled(connected: boolean,
  canonicalBindingStatusReady: boolean, canonicalDestinationBound: boolean,
  canonicalDestinationMismatch: boolean, canaryRunInProgress: boolean) {
  return connected && canonicalBindingStatusReady && canonicalDestinationBound &&
    !canonicalDestinationMismatch && !canaryRunInProgress
}

type ExternalPort = {
  postMessage: (message: unknown) => void
  disconnect: () => void
  onMessage: { addListener: (listener: (message: any) => void) => void }
  onDisconnect: { addListener: (listener: () => void) => void }
}

type ChromeRuntime = {
  connect: (extensionId: string, options: { name: string }) => ExternalPort
  sendMessage: (extensionId: string, message: unknown,
    callback: (response: any) => void) => void
  lastError?: { message?: string }
}

function ensureCanonicalExtensionOrigin() {
  const canonicalOrigin = canonicalSellerOsLunaPreviewOriginV1(
    window.location.origin)
  if (!canonicalOrigin) {
    throw new Error("LUNA_SHIPPING_EXTENSION_ORIGIN_REJECTED")
  }
  if (window.location.origin === canonicalOrigin) return true
  const target = new URL(
    `${window.location.pathname}${window.location.search}${window.location.hash}`,
    canonicalOrigin,
  )
  window.location.replace(target.toString())
  return false
}

async function probeInstalledExtension(): Promise<boolean | null> {
  try {
    const response = await fetch(
      `chrome-extension://${EXTENSION_ID}/startup-probe.json`,
      { cache: "no-store" },
    )
    if (!response.ok) return null
    const payload = await response.json() as Record<string, unknown>
    return payload.contractVersion === STARTUP_PROBE_CONTRACT &&
      payload.extensionId === EXTENSION_ID &&
      payload.extensionVersion === EXPECTED_EXTENSION_VERSION
      ? true : null
  } catch {
    return null
  }
}

declare global {
  interface Window { chrome?: { runtime?: ChromeRuntime } }
}

type Result = {
  candidateId: string
  productName: string
  subtotalUsd: number
  shippingUsd: number
  totalUsd: number
  identityVerified: boolean
  capturePostAccepted: boolean
  captureResultDurable: boolean
  durableReadbackMatch: boolean
  economicsStatus: string
  contributionProfitUsd: number | null
  contributionMarginPercent: number | null
}

type LiveCaptureTarget = {
  ebayItemId: string
  lunaProductId: string
  lunaVariantId: string
  sourceSku: string
}

type BindingStorageDiagnostic = {
  extensionId: string
  expectedExtensionId: string
  extensionVersion: string
  storageAreaUsed: string
  canonicalPrimaryKeyPresent: boolean
  canonicalLegacyKeyPresent: boolean
  canonicalEnvelopePresent: boolean
  canonicalEnvelopeSchemaVersion: string
  canonicalEnvelopeValid: boolean
  canonicalCountryClassPresent: boolean
  canonicalBoundAtPresent: boolean
  canonicalFingerprintPresent: boolean
  storageReadStatus: string
  bindingClassification: string
  writeStorageAuthority: string
  readStorageAuthority: string
  statusStorageAuthority: string
  autoClaimStorageAuthority: string
  authoritiesAligned: boolean
  extensionIdContinuity: boolean
}

type RuntimeTrace = {
  authClassification: string
  noExplicitAuthFailure: boolean
  productIdentityVerified: boolean
  addToCartElementFound: boolean
  addToCartClickDispatched: boolean
  activeJobRecoveredOnCart: boolean
  cartPageDetected: boolean
  cartExpectedProductFound: boolean
  cartExpectedQuantityFound: boolean
  cartSubtotalUsd: number | null
  cartMutationConfirmed: boolean
  bridgeReconnected: boolean
  shippingFlowResumed: boolean
  checkoutNavigationHost: string
  checkoutNavigationOrigin: string
  checkoutHostPermissionMatch: boolean
  checkoutNavigationObserved: boolean
  checkoutInjectionRequested: boolean
  checkoutInjectionApiSucceeded: boolean
  checkoutInjectionFrameId: number | null
  checkoutScriptInjected: boolean
  checkoutScriptBootstrapAck: boolean
  checkoutScriptBootstrapErrorCode: string
  checkoutContentScriptLoaded: boolean
  activeJobRecoveredOnCheckout: boolean
  checkoutPageDetected: boolean
  checkoutPageClassification: string
  checkoutHostClassification: string
  shopPayMarkerOrderSummary: boolean
  shopPayMarkerProduct: boolean
  shopPayMarkerQuantity: boolean
  shopPayMarkerShipTo: boolean
  shopPayMarkerShipping: boolean
  shopPayMarkerSubtotal: boolean
  shopPayMarkerShippingAmount: boolean
  shopPayMarkerTotal: boolean
  shopPayMarkerShippingMethod: boolean
  shopPayMarkerPayment: boolean
  shopPayMarkerPayNow: boolean
  subtotalLabelFound: boolean
  subtotalAmountCandidateFound: boolean
  subtotalCurrencyFound: boolean
  subtotalParsed: boolean
  shippingLabelFound: boolean
  shippingAmountCandidateFound: boolean
  shippingCurrencyFound: boolean
  shippingParsed: boolean
  totalLabelFound: boolean
  totalCurrencyFound: boolean
  totalAmountCandidateFound: boolean
  totalParsed: boolean
  explicitAuthRequired: boolean
  canonicalUsProfileFound: boolean
  shippingAddressAccepted: boolean
  shippingOptionsDetected: boolean
  shippingUsd: number | null
  subtotalUsd: number | null
  totalUsd: number | null
  capturePostAccepted: boolean
  captureResultDurable: boolean
  durableReadbackMatch: boolean
  economicsStatus: string
  authenticatedOperationConfirmed: boolean
}

const EMPTY_RUNTIME_TRACE: RuntimeTrace = Object.freeze({
  authClassification: "NOT_CHECKED",
  noExplicitAuthFailure: false,
  productIdentityVerified: false,
  addToCartElementFound: false,
  addToCartClickDispatched: false,
  activeJobRecoveredOnCart: false,
  cartPageDetected: false,
  cartExpectedProductFound: false,
  cartExpectedQuantityFound: false,
  cartSubtotalUsd: null,
  cartMutationConfirmed: false,
  bridgeReconnected: false,
  shippingFlowResumed: false,
  checkoutNavigationHost: "NOT_OBSERVED",
  checkoutNavigationOrigin: "NOT_OBSERVED",
  checkoutHostPermissionMatch: false,
  checkoutNavigationObserved: false,
  checkoutInjectionRequested: false,
  checkoutInjectionApiSucceeded: false,
  checkoutInjectionFrameId: null,
  checkoutScriptInjected: false,
  checkoutScriptBootstrapAck: false,
  checkoutScriptBootstrapErrorCode: "NOT_CHECKED",
  checkoutContentScriptLoaded: false,
  activeJobRecoveredOnCheckout: false,
  checkoutPageDetected: false,
  checkoutPageClassification: "NOT_CHECKED",
  checkoutHostClassification: "NOT_CHECKED",
  shopPayMarkerOrderSummary: false,
  shopPayMarkerProduct: false,
  shopPayMarkerQuantity: false,
  shopPayMarkerShipTo: false,
  shopPayMarkerShipping: false,
  shopPayMarkerSubtotal: false,
  shopPayMarkerShippingAmount: false,
  shopPayMarkerTotal: false,
  shopPayMarkerShippingMethod: false,
  shopPayMarkerPayment: false,
  shopPayMarkerPayNow: false,
  subtotalLabelFound: false,
  subtotalAmountCandidateFound: false,
  subtotalCurrencyFound: false,
  subtotalParsed: false,
  shippingLabelFound: false,
  shippingAmountCandidateFound: false,
  shippingCurrencyFound: false,
  shippingParsed: false,
  totalLabelFound: false,
  totalCurrencyFound: false,
  totalAmountCandidateFound: false,
  totalParsed: false,
  explicitAuthRequired: false,
  canonicalUsProfileFound: false,
  shippingAddressAccepted: false,
  shippingOptionsDetected: false,
  shippingUsd: null,
  subtotalUsd: null,
  totalUsd: null,
  capturePostAccepted: false,
  captureResultDurable: false,
  durableReadbackMatch: false,
  economicsStatus: "NOT_EVALUATED",
  authenticatedOperationConfirmed: false,
})

async function adminPost(action: string, body: Record<string, unknown>,
  idempotencyKey?: string) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error("LUNA_SHIPPING_ADMIN_SESSION_REQUIRED")
  const response = await fetch("/api/admin/ebay/luna-shipping-capture", {
    method: "POST", cache: "no-store",
    headers: { "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) },
    body: JSON.stringify({ action, ...body }),
  })
  const payload = await response.json() as any
  if (!response.ok || !payload.success) {
    throw new Error(typeof payload.error === "string"
      ? payload.error : "LUNA_SHIPPING_CAPTURE_REQUEST_FAILED")
  }
  return payload
}

function pingExtensionOnce(runtime: ChromeRuntime) {
  return new Promise<void>((resolve, reject) => {
    let settled = false
    const timeout = window.setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error("LUNA_SHIPPING_EXTENSION_PING_TIMEOUT"))
    }, 5_000)
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      if (error) reject(error)
      else resolve()
    }
    try {
      runtime.sendMessage(EXTENSION_ID, { type: EXTENSION_PING }, (response) => {
        const runtimeError = window.chrome?.runtime?.lastError?.message ?? ""
        if (runtimeError) {
          finish(new Error(/receiving end does not exist/i.test(runtimeError)
            ? "LUNA_SHIPPING_EXTENSION_EXTERNAL_LISTENER_UNAVAILABLE"
            : "LUNA_SHIPPING_EXTENSION_SERVICE_WORKER_UNAVAILABLE"))
          return
        }
        if (response?.type !== EXTENSION_READY ||
            response?.extensionId !== EXTENSION_ID ||
            response?.extensionVersion !== EXPECTED_EXTENSION_VERSION ||
            response?.extensionBuildVersion !== EXPECTED_EXTENSION_VERSION ||
            response?.shopAppManifestPermission !== true ||
            response?.shopAppContentScriptMatch !== true ||
            response?.shopAppRuntimeAllowlist !== true ||
            response?.shopAppCheckoutHostClassification !== true ||
            response?.sellerOsOriginValidated !== true) {
          finish(new Error("LUNA_SHIPPING_EXTENSION_HANDSHAKE_INVALID"))
          return
        }
        finish()
      })
    } catch {
      finish(new Error("LUNA_SHIPPING_EXTENSION_DISCONNECTED"))
    }
  })
}

export default function LunaShippingCapturePage() {
  const [status, setStatus] = useState("CONNECTING_EXTENSION")
  const [error, setError] = useState("")
  const [connected, setConnected] = useState(false)
  const [running, setRunning] = useState(false)
  const [lastRuntimeState, setLastRuntimeState] = useState("NOT_STARTED")
  const [runtimeTrace, setRuntimeTrace] = useState<RuntimeTrace>(EMPTY_RUNTIME_TRACE)
  const [results, setResults] = useState<Result[]>([])
  const [canonicalDestinationBound, setCanonicalDestinationBound] = useState(false)
  const [canonicalDestinationMatch, setCanonicalDestinationMatch] = useState(false)
  const [canonicalBindingStatusReady, setCanonicalBindingStatusReady] =
    useState(false)
  const [canonicalDestinationMismatch, setCanonicalDestinationMismatch] =
    useState(false)
  const [bindingStorageDiagnostic, setBindingStorageDiagnostic] =
    useState<BindingStorageDiagnostic | null>(null)
  const [liveTraceEvents, setLiveTraceEvents] =
    useState<LunaShippingRuntimeTraceEventV1[]>([])
  const [traceDurable, setTraceDurable] = useState(false)
  const [liveTarget, setLiveTarget] = useState<LiveCaptureTarget | null>(null)
  const triggerRef = useRef<(() => void) | null>(null)
  const liveTriggerRef = useRef<(() => void) | null>(null)
  const bindDestinationRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    let active = true
    let jobs: LunaChromeShippingJobV1[] = []
    let index = 0
    let mode: "CANARY" | "AUTO" | "LIVE" = "CANARY"
    const params = new URLSearchParams(window.location.search)
    const requestedLiveTarget = {
      ebayItemId: params.get("ebayItemId")?.trim() ?? "",
      lunaProductId: params.get("lunaProductId")?.trim() ?? "",
      lunaVariantId: params.get("lunaVariantId")?.trim() ?? "",
      sourceSku: params.get("sourceSku")?.trim() ?? "",
    }
    const hasExactLiveTarget = /^\d{9,20}$/.test(requestedLiveTarget.ebayItemId) &&
      /^\d{8,24}$/.test(requestedLiveTarget.lunaProductId) &&
      /^\d{8,24}$/.test(requestedLiveTarget.lunaVariantId) &&
      /^[A-Za-z0-9][A-Za-z0-9._:+/ -]{0,159}$/.test(
        requestedLiveTarget.sourceSku)
    if (hasExactLiveTarget) setLiveTarget(requestedLiveTarget)
    let busy = false
    let extensionReady = false
    let canonicalBindingStatusRead = false
    let canonicalDestinationBindingPresent = false
    let activeJobStatusReady = false
    let recoveredActiveJob: LunaChromeShippingJobV1 | null = null
    let initialAutoClaimStarted = false
    let port: ExternalPort | null = null
    let lastProgressState = "NOT_STARTED"
    let reconnecting = false
    let traceEvents: LunaShippingRuntimeTraceEventV1[] = []
    let traceFlushTimer: number | null = null
    let traceFlushChain = Promise.resolve()

    const flushRuntimeTrace = (immediate = false) => {
      if (traceFlushTimer !== null) {
        window.clearTimeout(traceFlushTimer)
        traceFlushTimer = null
      }
      const persist = () => {
        if (!traceEvents.length) return
        const snapshot = [...traceEvents]
        traceFlushChain = traceFlushChain.then(() => adminPost(
          "persist_runtime_trace", { events: snapshot },
          `${snapshot[0].traceId}:${snapshot.length}`,
        ).then((payload) => {
          if (!active) return
          setTraceDurable(payload.result?.traceDurable === true &&
            payload.result?.durableReadbackMatch === true)
        })).catch((traceError) => fail(traceError))
      }
      if (immediate) persist()
      else traceFlushTimer = window.setTimeout(persist, 5_000)
    }

    const acceptRuntimeTraceEvent = (value: unknown) => {
      const event = value && typeof value === "object"
        ? value as LunaShippingRuntimeTraceEventV1 : null
      if (!event || !/^luna-shipping-trace-v1:sha256:[0-9a-f]{64}$/
          .test(event.traceId) || !Number.isInteger(event.sequence) ||
          event.sequence < 1 || event.sequence > 100 ||
          event.purchaseBoundaryEnforced !== true) return
      if (traceEvents[0]?.traceId !== event.traceId) {
        traceEvents = []
        setTraceDurable(false)
      }
      const existing = traceEvents.find((entry) =>
        entry.sequence === event.sequence)
      if (!existing) traceEvents = [...traceEvents, event]
        .sort((left, right) => left.sequence - right.sequence).slice(0, 100)
      setLiveTraceEvents([...traceEvents])
      if (event.state === "CANONICAL_BIND_COMPLETED") {
        canonicalBindingStatusRead = true
        canonicalDestinationBindingPresent = true
        setCanonicalBindingStatusReady(true)
        setCanonicalDestinationBound(true)
        setCanonicalDestinationMatch(true)
        setCanonicalDestinationMismatch(false)
      }
      if (event.state === "FAIL" &&
          event.reasonCode === "CANONICAL_US_SHIPPING_PROFILE_MISMATCH") {
        setCanonicalDestinationMismatch(true)
      }
      const terminal = event.state === "PASS" || event.state === "FAIL"
      flushRuntimeTrace(terminal)
    }

    const fail = (value: unknown) => {
      if (!active) return
      busy = false
      setRunning(false)
      setStatus("FAIL")
      setError(value instanceof Error ? value.message
        : "LUNA_SHIPPING_CAPTURE_FAILED")
    }

    const sendCurrent = () => {
      const job = jobs[index]
      if (!job || !port) return
      setError("")
      setRuntimeTrace(EMPTY_RUNTIME_TRACE)
      setStatus(mode === "CANARY" && index === 0
        ? "CANARY_DISPATCHED" : mode === "LIVE"
          ? "LIVE_LISTING_CAPTURE_DISPATCHED" : "CAPTURING")
      const dispatchState = mode === "AUTO"
        ? "PRODUCTION_JOB_DISPATCHED" : "CANARY_DISPATCHED"
      setLastRuntimeState(dispatchState)
      lastProgressState = dispatchState
      port.postMessage({ type: "START_SHIPPING_JOB", job,
        productionAutoClaim: mode === "AUTO" })
      window.setTimeout(() => {
        if (active && busy) setStatus("CAPTURING")
      }, 0)
    }

    const loadJobs = async (candidateIds: readonly string[] | undefined,
      nextMode: "CANARY" | "AUTO") => {
      const payload = await adminPost("resolve_jobs", { candidateIds })
      const resolved = Array.isArray(payload.jobs) ? payload.jobs : []
      if (resolved.some((job: any) => job?.contractVersion !== CONTRACT)) {
        throw new Error("LUNA_SHIPPING_EXTENSION_JOB_UNAVAILABLE")
      }
      if (!resolved.length) {
        busy = false
        setRunning(false)
        setStatus(nextMode === "AUTO" ? "WORKER_IDLE_NO_ELIGIBLE_JOB" : "PASS")
        return
      }
      jobs = resolved
      index = 0
      mode = nextMode
      busy = true
      setRunning(true)
      sendCurrent()
    }

    const startInitialProductionClaim = () => {
      if (hasExactLiveTarget || !active || initialAutoClaimStarted || !extensionReady ||
          !canonicalBindingStatusRead || !canonicalDestinationBindingPresent ||
          !activeJobStatusReady || busy || !port) {
        return
      }
      initialAutoClaimStarted = true
      setError("")
      setStatus("PRODUCTION_WORKER_READY")
      if (recoveredActiveJob) {
        jobs = [recoveredActiveJob]
        index = 0
        mode = "AUTO"
        busy = true
        setRunning(true)
        setStatus("CAPTURING")
        setLastRuntimeState("PRODUCTION_JOB_CLAIMED")
        lastProgressState = "PRODUCTION_JOB_CLAIMED"
        return
      }
      setStatus("INITIAL_AUTO_CLAIM_STARTED")
      void loadJobs(undefined, "AUTO").catch(fail)
    }

    const beginCanary = () => {
      if (busy || !extensionReady || !canonicalBindingStatusRead ||
          !canonicalDestinationBindingPresent) return
      setError("")
      setResults([])
      setLastRuntimeState("CANARY_DISPATCHED")
      setRuntimeTrace(EMPTY_RUNTIME_TRACE)
      void loadJobs([CANARY_ID], "CANARY").catch(fail)
    }
    triggerRef.current = beginCanary

    const beginLiveCapture = () => {
      if (!hasExactLiveTarget || busy || !extensionReady ||
          !canonicalBindingStatusRead || !canonicalDestinationBindingPresent ||
          !port) return
      busy = true
      setRunning(true)
      setError("")
      setResults([])
      setRuntimeTrace(EMPTY_RUNTIME_TRACE)
      setStatus("RESOLVING_EXACT_CURRENT_LIVE")
      void adminPost("resolve_live_listing_job", {
        target: requestedLiveTarget,
      }).then((payload) => {
        const resolved = Array.isArray(payload.jobs) ? payload.jobs : []
        if (resolved.length !== 1 ||
            resolved[0]?.contractVersion !== CONTRACT) {
          throw new Error("LUNA_SHIPPING_EXTENSION_LIVE_JOB_UNAVAILABLE")
        }
        jobs = resolved
        index = 0
        mode = "LIVE"
        sendCurrent()
      }).catch(fail)
    }
    liveTriggerRef.current = beginLiveCapture

    const bindCanonicalDestination = () => {
      if (!port || !extensionReady || busy) return
      busy = true
      setRunning(true)
      setError("")
      setStatus("BINDING_CANONICAL_DESTINATION")
      void adminPost("resolve_jobs", { candidateIds: [CANARY_ID],
        purpose: "CANONICAL_BIND_BOOTSTRAP" }).then((payload) => {
        const bootstrapJobs = Array.isArray(payload.jobs) ? payload.jobs : []
        const bootstrapJob = bootstrapJobs.length === 1
          ? bootstrapJobs[0] as LunaChromeShippingJobV1 : null
        if (!bootstrapJob || bootstrapJob.contractVersion !== CONTRACT || !port) {
          throw new Error("LUNA_CANONICAL_BIND_BOOTSTRAP_JOB_UNAVAILABLE")
        }
        port.postMessage({ type: "SELLER_OS_BIND_LUNA_CANONICAL_DESTINATION",
          bootstrapJob })
      }).catch(fail)
    }
    bindDestinationRef.current = bindCanonicalDestination

    const handlePortMessage = (message: any) => {
        if (!active) return
        if (message?.type === "LUNA_SHIPPING_RUNTIME_TRACE_EVENT") {
          acceptRuntimeTraceEvent(message.event)
          return
        }
        if (message?.type === BINDING_STORAGE_DIAGNOSTIC) {
          const storageReadStatus = String(
            message.storageReadStatus ?? "UNKNOWN")
          const bindingClassification = String(
            message.bindingClassification ?? "UNKNOWN")
          setBindingStorageDiagnostic({
            extensionId: String(message.extensionId ?? "UNKNOWN"),
            expectedExtensionId: String(message.expectedExtensionId ?? "UNKNOWN"),
            extensionVersion: String(message.extensionVersion ?? "UNKNOWN"),
            storageAreaUsed: String(message.storageAreaUsed ?? "UNKNOWN"),
            canonicalPrimaryKeyPresent:
              message.canonicalPrimaryKeyPresent === true,
            canonicalLegacyKeyPresent:
              message.canonicalLegacyKeyPresent === true,
            canonicalEnvelopePresent: message.canonicalEnvelopePresent === true,
            canonicalEnvelopeSchemaVersion:
              String(message.canonicalEnvelopeSchemaVersion ?? "UNKNOWN"),
            canonicalEnvelopeValid: message.canonicalEnvelopeValid === true,
            canonicalCountryClassPresent:
              message.canonicalCountryClassPresent === true,
            canonicalBoundAtPresent: message.canonicalBoundAtPresent === true,
            canonicalFingerprintPresent:
              message.canonicalFingerprintPresent === true,
            storageReadStatus,
            bindingClassification,
            writeStorageAuthority:
              String(message.writeStorageAuthority ?? "UNKNOWN"),
            readStorageAuthority:
              String(message.readStorageAuthority ?? "UNKNOWN"),
            statusStorageAuthority:
              String(message.statusStorageAuthority ?? "UNKNOWN"),
            autoClaimStorageAuthority:
              String(message.autoClaimStorageAuthority ?? "UNKNOWN"),
            authoritiesAligned: message.authoritiesAligned === true,
            extensionIdContinuity: message.extensionIdContinuity === true,
          })
          const bindingStatusAccepted = storageReadStatus === "READ_OK" &&
            new Set(["NO_BINDING_PRESENT", "PRIMARY_BINDING_VALID"])
              .has(bindingClassification)
          if (!bindingStatusAccepted) {
            canonicalBindingStatusRead = false
            setCanonicalBindingStatusReady(false)
            fail(new Error(storageReadStatus === "READ_OK"
              ? bindingClassification : storageReadStatus))
            return
          }
          canonicalBindingStatusRead = true
          canonicalDestinationBindingPresent =
            bindingClassification === "PRIMARY_BINDING_VALID"
          setCanonicalBindingStatusReady(true)
          setCanonicalDestinationBound(canonicalDestinationBindingPresent)
          setCanonicalDestinationMismatch(false)
          startInitialProductionClaim()
          return
        }
        if (message?.type === "LUNA_CANONICAL_DESTINATION_STATUS") {
          if (typeof message.error === "string") {
            canonicalBindingStatusRead = false
            setCanonicalBindingStatusReady(false)
            fail(new Error(message.error))
            return
          }
          const bound = message.canonicalDestinationBound === true
          canonicalBindingStatusRead = true
          canonicalDestinationBindingPresent = bound
          setCanonicalBindingStatusReady(true)
          setCanonicalDestinationMismatch(false)
          setCanonicalDestinationBound(bound)
          if (bound) {
            setError("")
          } else {
            setCanonicalDestinationMatch(false)
            setStatus("CANONICAL_OPERATOR_BIND_REQUIRED")
            setError("")
          }
          startInitialProductionClaim()
          return
        }
        if (message?.type === "LUNA_SHIPPING_ACTIVE_JOB_STATUS") {
          const candidate = message.active === true &&
              message.job?.contractVersion === CONTRACT
            ? message.job as LunaChromeShippingJobV1 : null
          recoveredActiveJob = candidate
          activeJobStatusReady = true
          startInitialProductionClaim()
          return
        }
        if (message?.type === "LUNA_CANONICAL_DESTINATION_BINDING_RESULT") {
          if (message.success !== true ||
              message.canonicalDestinationBound !== true ||
              message.canonicalDestinationMatch !== true) {
            setCanonicalDestinationMatch(false)
            if (message.error === "CANONICAL_US_SHIPPING_PROFILE_MISMATCH") {
              setCanonicalDestinationMismatch(true)
            }
            fail(new Error(typeof message.error === "string" ? message.error
              : "CANONICAL_US_PROFILE_VALIDATION_UNAVAILABLE"))
            return
          }
          setCanonicalDestinationBound(true)
          canonicalBindingStatusRead = true
          canonicalDestinationBindingPresent = true
          setCanonicalBindingStatusReady(true)
          setCanonicalDestinationMatch(true)
          setCanonicalDestinationMismatch(false)
          busy = false
          setRunning(false)
          setError("")
          setStatus("Benchmark configurado")
          setRuntimeTrace((current) => ({ ...current,
            canonicalUsProfileFound: true,
            shippingAddressAccepted: false,
          }))
          startInitialProductionClaim()
          return
        }
        if (message?.type === "LUNA_SHIPPING_JOB_PROGRESS") {
          const allowed = new Set(["CONTENT_SCRIPT_LOADED",
            "ACTIVE_JOB_REQUESTED", "ACTIVE_JOB_RECOVERED",
            "PRODUCT_PAGE_DOM_READY", "PRODUCT_IDENTITY_CHECK_STARTED",
            "AUTH_EXPLICITLY_FAILED", "AUTH_CHALLENGE_PRESENT",
            "AUTH_NOT_YET_REQUIRED", "AUTHENTICATED_OPERATION_CONFIRMED",
            "PRODUCT_IDENTITY_VERIFIED", "PRODUCT_OOS_CONFIRMED",
            "ADD_TO_CART_ELEMENT_FOUND",
            "AWAITING_CART_CONFIRMATION", "ADD_TO_CART_CLICK_DISPATCHED",
            "ACTIVE_JOB_RECOVERED_ON_CART", "CART_PAGE_DETECTED",
            "CART_EXPECTED_PRODUCT_FOUND", "CART_EXPECTED_QUANTITY_FOUND",
            "CART_MUTATION_CONFIRMED", "BRIDGE_RECONNECTED",
            "SHIPPING_FLOW_RESUMED", "AWAITING_CHECKOUT_SHIPPING",
            "CHECKOUT_NAVIGATION_ARMED", "CHECKOUT_NAVIGATION_TRIGGERED",
            "CHECKOUT_NAVIGATION_TIMEOUT",
            "CHECKOUT_NAVIGATION_OBSERVED", "CHECKOUT_HOST_ALLOWED",
            "CHECKOUT_INJECTION_REQUESTED", "CHECKOUT_INJECTION_API_SUCCEEDED",
            "CHECKOUT_SCRIPT_INJECTED", "CHECKOUT_SCRIPT_BOOTSTRAP_ACK",
            "CHECKOUT_CONTENT_SCRIPT_LOADED",
            "ACTIVE_JOB_RECOVERED_ON_CHECKOUT", "CHECKOUT_CLASSIFIER_STARTED",
            "CHECKOUT_HOST_CLASSIFIED", "SHOP_PAY_DOM_WAITING",
            "SHOP_PAY_DOM_READY", "CHECKOUT_PAGE_CLASSIFIED",
            "CHECKOUT_PAGE_DETECTED", "SHOP_PAY_QUOTE_PARSER_STARTED",
            "NORMAL_GUEST_CHECKOUT",
            "NORMAL_CHECKOUT_WITH_CONTACT_FORM",
            "NORMAL_CHECKOUT_WITH_SHIPPING_FORM", "NORMAL_CHECKOUT_WITH_SHIPPING",
            "SHOP_PAY_DOM_WAITING", "SHOP_PAY_DOM_READY",
            "CHECKOUT_EXPECTED_PRODUCT_VERIFIED", "CHECKOUT_EXPECTED_QUANTITY_VERIFIED",
            "EXPLICIT_LOGIN_PAGE",
            "EXPLICIT_AUTH_CHALLENGE", "SESSION_EXPIRED",
            "UNKNOWN_CHECKOUT_PAGE", "CANONICAL_US_PROFILE_FOUND",
            "SHIPPING_ADDRESS_ACCEPTED", "SHIPPING_OPTIONS_DETECTED",
            "SHIPPING_CAPTURE_STARTED", "SHIPPING_QUOTE_CAPTURED",
            "RESULT_POSTED"])
          if (allowed.has(message.state) &&
              message.candidateId === jobs[index]?.identity.candidateId) {
            setStatus(message.state)
            setLastRuntimeState(message.state)
            lastProgressState = message.state
            setRuntimeTrace((current) => ({ ...current,
              ...(message.state.startsWith("AUTH_")
                ? { authClassification: message.state } : {}),
              ...(message.state === "AUTH_NOT_YET_REQUIRED" ||
                  message.state === "AUTHENTICATED_OPERATION_CONFIRMED"
                ? { noExplicitAuthFailure: true } : {}),
              ...(message.state === "PRODUCT_IDENTITY_VERIFIED"
                ? { productIdentityVerified: true } : {}),
              ...(message.state === "ADD_TO_CART_ELEMENT_FOUND"
                ? { addToCartElementFound: true } : {}),
              ...(message.state === "ADD_TO_CART_CLICK_DISPATCHED"
                ? { addToCartClickDispatched: true } : {}),
              ...(message.state === "ACTIVE_JOB_RECOVERED_ON_CART"
                ? { activeJobRecoveredOnCart: true } : {}),
              ...(message.state === "CART_PAGE_DETECTED"
                ? { cartPageDetected: true } : {}),
              ...(message.state === "CART_EXPECTED_PRODUCT_FOUND"
                ? { cartExpectedProductFound: true } : {}),
              ...(message.state === "CART_EXPECTED_QUANTITY_FOUND"
                ? { cartExpectedQuantityFound: true } : {}),
              ...(Number.isFinite(message.cartSubtotalUsd)
                ? { cartSubtotalUsd: Number(message.cartSubtotalUsd) } : {}),
              ...(Number.isFinite(message.subtotalUsd)
                ? { subtotalUsd: Number(message.subtotalUsd) } : {}),
              ...(Number.isFinite(message.shippingUsd)
                ? { shippingUsd: Number(message.shippingUsd) } : {}),
              ...(Number.isFinite(message.totalUsd)
                ? { totalUsd: Number(message.totalUsd) } : {}),
              ...(message.state === "CART_MUTATION_CONFIRMED"
                ? { cartMutationConfirmed: true } : {}),
              ...(message.state === "BRIDGE_RECONNECTED"
                ? { bridgeReconnected: true } : {}),
              ...(message.state === "SHIPPING_FLOW_RESUMED"
                ? { shippingFlowResumed: true } : {}),
              ...(message.state === "CHECKOUT_CONTENT_SCRIPT_LOADED"
                ? { checkoutContentScriptLoaded: true } : {}),
              ...(message.state === "ACTIVE_JOB_RECOVERED_ON_CHECKOUT"
                ? { activeJobRecoveredOnCheckout: true } : {}),
              ...(typeof message.checkoutNavigationHost === "string"
                ? { checkoutNavigationHost: message.checkoutNavigationHost } : {}),
              ...(typeof message.checkoutNavigationOrigin === "string"
                ? { checkoutNavigationOrigin: message.checkoutNavigationOrigin } : {}),
              ...(message.checkoutHostPermissionMatch === true
                ? { checkoutHostPermissionMatch: true } : {}),
              ...(message.state === "CHECKOUT_NAVIGATION_OBSERVED"
                ? { checkoutNavigationObserved: true } : {}),
              ...(message.state === "CHECKOUT_INJECTION_REQUESTED"
                ? { checkoutInjectionRequested: true } : {}),
              ...(message.state === "CHECKOUT_INJECTION_API_SUCCEEDED"
                ? { checkoutInjectionApiSucceeded: true } : {}),
              ...(message.checkoutInjectionFrameId === 0
                ? { checkoutInjectionFrameId: 0 } : {}),
              ...(message.state === "CHECKOUT_SCRIPT_INJECTED"
                ? { checkoutScriptInjected: true } : {}),
              ...(message.checkoutScriptBootstrapAck === true
                ? { checkoutScriptBootstrapAck: true } : {}),
              ...(typeof message.checkoutScriptBootstrapErrorCode === "string"
                ? { checkoutScriptBootstrapErrorCode:
                    message.checkoutScriptBootstrapErrorCode } : {}),
              ...(message.state === "CHECKOUT_PAGE_DETECTED"
                ? { checkoutPageDetected: true } : {}),
              ...(typeof message.checkoutPageClassification === "string"
                ? { checkoutPageClassification:
                    message.checkoutPageClassification } : {}),
              ...(typeof message.shopPayMarkerOrderSummary === "boolean"
                ? { shopPayMarkerOrderSummary:
                    message.shopPayMarkerOrderSummary } : {}),
              ...(typeof message.shopPayMarkerProduct === "boolean"
                ? { shopPayMarkerProduct: message.shopPayMarkerProduct } : {}),
              ...(typeof message.shopPayMarkerQuantity === "boolean"
                ? { shopPayMarkerQuantity: message.shopPayMarkerQuantity } : {}),
              ...(typeof message.shopPayMarkerShipTo === "boolean"
                ? { shopPayMarkerShipTo: message.shopPayMarkerShipTo } : {}),
              ...(typeof message.shopPayMarkerShipping === "boolean"
                ? { shopPayMarkerShipping: message.shopPayMarkerShipping } : {}),
              ...(typeof message.shopPayMarkerSubtotal === "boolean"
                ? { shopPayMarkerSubtotal: message.shopPayMarkerSubtotal } : {}),
              ...(typeof message.shopPayMarkerShippingAmount === "boolean"
                ? { shopPayMarkerShippingAmount:
                    message.shopPayMarkerShippingAmount } : {}),
              ...(typeof message.shopPayMarkerTotal === "boolean"
                ? { shopPayMarkerTotal: message.shopPayMarkerTotal } : {}),
              ...(typeof message.shopPayMarkerShippingMethod === "boolean"
                ? { shopPayMarkerShippingMethod:
                    message.shopPayMarkerShippingMethod } : {}),
              ...(typeof message.shopPayMarkerPayment === "boolean"
                ? { shopPayMarkerPayment: message.shopPayMarkerPayment } : {}),
              ...(typeof message.shopPayMarkerPayNow === "boolean"
                ? { shopPayMarkerPayNow: message.shopPayMarkerPayNow } : {}),
              ...(typeof message.subtotalLabelFound === "boolean"
                ? { subtotalLabelFound: message.subtotalLabelFound } : {}),
              ...(typeof message.subtotalAmountCandidateFound === "boolean"
                ? { subtotalAmountCandidateFound:
                    message.subtotalAmountCandidateFound } : {}),
              ...(typeof message.subtotalCurrencyFound === "boolean"
                ? { subtotalCurrencyFound: message.subtotalCurrencyFound } : {}),
              ...(typeof message.subtotalParsed === "boolean"
                ? { subtotalParsed: message.subtotalParsed } : {}),
              ...(typeof message.shippingLabelFound === "boolean"
                ? { shippingLabelFound: message.shippingLabelFound } : {}),
              ...(typeof message.shippingAmountCandidateFound === "boolean"
                ? { shippingAmountCandidateFound:
                    message.shippingAmountCandidateFound } : {}),
              ...(typeof message.shippingCurrencyFound === "boolean"
                ? { shippingCurrencyFound: message.shippingCurrencyFound } : {}),
              ...(typeof message.shippingParsed === "boolean"
                ? { shippingParsed: message.shippingParsed } : {}),
              ...(typeof message.totalLabelFound === "boolean"
                ? { totalLabelFound: message.totalLabelFound } : {}),
              ...(typeof message.totalCurrencyFound === "boolean"
                ? { totalCurrencyFound: message.totalCurrencyFound } : {}),
              ...(typeof message.totalAmountCandidateFound === "boolean"
                ? { totalAmountCandidateFound:
                    message.totalAmountCandidateFound } : {}),
              ...(typeof message.totalParsed === "boolean"
                ? { totalParsed: message.totalParsed } : {}),
              ...(new Set(["NORMAL_GUEST_CHECKOUT",
                "NORMAL_CHECKOUT_WITH_CONTACT_FORM",
                "NORMAL_CHECKOUT_WITH_SHIPPING_FORM", "NORMAL_CHECKOUT_WITH_SHIPPING",
                "SHOP_PAY_DOM_WAITING", "SHOP_PAY_DOM_READY",
                "CHECKOUT_EXPECTED_PRODUCT_VERIFIED", "CHECKOUT_EXPECTED_QUANTITY_VERIFIED",
                "EXPLICIT_LOGIN_PAGE",
                "EXPLICIT_AUTH_CHALLENGE", "SESSION_EXPIRED",
                "UNKNOWN_CHECKOUT_PAGE"]).has(message.state)
                ? { checkoutPageClassification: message.state } : {}),
              ...(typeof message.checkoutHostClassification === "string"
                ? { checkoutHostClassification:
                    message.checkoutHostClassification } : {}),
              ...(new Set(["EXPLICIT_LOGIN_PAGE", "EXPLICIT_AUTH_CHALLENGE",
                "SESSION_EXPIRED"]).has(message.state)
                ? { explicitAuthRequired: true } : {}),
              ...(message.state === "CANONICAL_US_PROFILE_FOUND"
                ? { canonicalUsProfileFound: true } : {}),
              ...(message.state === "SHIPPING_ADDRESS_ACCEPTED"
                ? { shippingAddressAccepted: true } : {}),
              ...(message.state === "SHIPPING_OPTIONS_DETECTED"
                ? { shippingOptionsDetected: true } : {}),
              ...(message.state === "AUTHENTICATED_OPERATION_CONFIRMED"
                ? { authenticatedOperationConfirmed: true } : {}),
            }))
          }
          return
        }
        if (!active || message?.type !== "LUNA_SHIPPING_JOB_RESULT") return
        const job = jobs[index]
        if (!job || message.capture?.candidateId !== job.identity.candidateId) {
          fail(new Error("LUNA_SHIPPING_EXTENSION_RESULT_SCOPE_MISMATCH"))
          return
        }
        if (message.success !== true) {
          if (message.error === "CANONICAL_US_SHIPPING_PROFILE_MISMATCH") {
            setCanonicalDestinationMismatch(true)
          }
          if (typeof message.lastRuntimeState === "string") {
            setLastRuntimeState(message.lastRuntimeState)
          }
          fail(new Error(typeof message.error === "string"
            ? message.error : "LUNA_SHIPPING_EXTENSION_JOB_FAILED"))
          return
        }
        if (message.terminalDecision === "REJECT_STOCK" &&
            message.capture?.productOosConfirmed === true &&
            message.capture?.productPageStockStatus === "FRESH_OUT_OF_STOCK") {
          setStatus("REJECTED_STOCK")
          setLastRuntimeState("REJECTED_STOCK")
          const observation = {
            candidateId: message.capture.candidateId,
            lunaProductId: message.capture.lunaProductId,
            lunaVariantId: message.capture.lunaVariantId,
            supplierSku: message.capture.supplierSku,
            quantity: message.capture.quantity,
            productPageStockStatus: message.capture.productPageStockStatus,
            productOosConfirmed: true,
            soldOutMarker: message.capture.soldOutMarker === true,
            outOfStockMarker: message.capture.outOfStockMarker === true,
            observedAt: message.capture.observedAt,
            acquisitionMethod: message.capture.acquisitionMethod,
            evidenceDigest: message.capture.evidenceDigest,
            captureSessionId: message.capture.captureSessionId,
            nonce: message.capture.nonce,
          }
          void adminPost("reject_product_oos", { observation },
            observation.captureSessionId).then(async (payload) => {
            if (!active) return
            const result = payload.result ?? {}
            if (result.productOosConfirmed !== true ||
                result.stockEvidenceReconciled !== true ||
                result.durableReadbackMatch !== true ||
                result.candidateDecision !== "REJECT_STOCK") {
              throw new Error("LUNA_PRODUCT_PAGE_OOS_DURABLE_READBACK_FAILED")
            }
            port?.postMessage({
              type: "SELLER_OS_LUNA_SHIPPING_SERVER_RESULT",
              candidateId: job.identity.candidateId,
              success: true,
              terminalDecision: "REJECT_STOCK",
            })
            setStatus("PRODUCTION_JOB_COMPLETED")
            setLastRuntimeState("AUTO_NEXT")
            index += 1
            if (index < jobs.length) {
              sendCurrent()
              return
            }
            await loadJobs(undefined, "AUTO")
          }).catch((stockError) => {
            port?.postMessage({
              type: "SELLER_OS_LUNA_SHIPPING_SERVER_RESULT",
              candidateId: job.identity.candidateId,
              success: false,
              reasonCode: stockError instanceof Error
                ? stockError.message
                : "LUNA_PRODUCT_PAGE_OOS_DURABLE_WRITE_FAILED",
            })
            fail(stockError)
          })
          return
        }
        setStatus("RESULT_POSTED")
        const capture = {
          candidateId: message.capture.candidateId,
          lunaProductId: message.capture.lunaProductId,
          lunaVariantId: message.capture.lunaVariantId,
          supplierSku: message.capture.supplierSku,
          quantity: message.capture.quantity,
          subtotalUsd: message.capture.subtotalUsd,
          shippingUsd: message.capture.shippingUsd,
          totalUsd: message.capture.totalUsd,
          currency: message.capture.currency,
          observedAt: message.capture.observedAt,
          acquisitionMethod: message.capture.acquisitionMethod,
          evidenceDigest: message.capture.extensionEvidenceDigest,
          captureSessionId: message.capture.captureSessionId,
          nonce: message.capture.nonce,
          ...(message.capture.canonicalDestinationAuthority ===
              "OPERATOR_BOUND_CANONICAL_US_DESTINATION_V1" ? {
            canonicalDestinationAuthority:
              message.capture.canonicalDestinationAuthority,
            canonicalDestinationFingerprint:
              message.capture.canonicalDestinationFingerprint,
            canonicalDestinationMatch:
              message.capture.canonicalDestinationMatch,
            selectedShippingStateProof:
              message.capture.selectedShippingStateProof,
          } : {}),
        }
        const certificationAction = mode === "LIVE"
          ? "certify_live_listing_capture" : "certify_capture"
        const certificationBody = mode === "LIVE"
          ? { capture, target: requestedLiveTarget } : { capture }
        void adminPost(certificationAction, certificationBody,
          capture.captureSessionId)
          .then(async (certified) => {
            if (!active) return
            const result = certified.result ?? {}
            const economics = result.economics ?? {}
            setStatus("RESULT_PERSISTED")
            setResults((current) => [...current, {
              candidateId: job.identity.candidateId,
              productName: String(result.productName ?? job.productName),
              subtotalUsd: Number(result.capture?.subtotalUsd),
              shippingUsd: Number(result.capture?.shippingUsd),
              totalUsd: Number(result.capture?.totalUsd),
              identityVerified: result.quote?.exactLunaIdentity === true,
              capturePostAccepted: result.capturePostAccepted === true,
              captureResultDurable: result.captureResultDurable === true,
              durableReadbackMatch: result.durableReadbackMatch === true,
              economicsStatus: String(economics.status ?? "UNPROVEN"),
              contributionProfitUsd: economics.contributionProfitUsd ?? null,
              contributionMarginPercent:
                economics.contributionMarginPercent ?? null,
            }])
            setRuntimeTrace((current) => ({ ...current,
              subtotalUsd: Number(result.capture?.subtotalUsd),
              shippingUsd: Number(result.capture?.shippingUsd),
              totalUsd: Number(result.capture?.totalUsd),
              capturePostAccepted: result.capturePostAccepted === true,
              captureResultDurable: result.captureResultDurable === true,
              durableReadbackMatch: result.durableReadbackMatch === true,
              economicsStatus: String(economics.status ?? "UNPROVEN"),
            }))
            setStatus("ECONOMICS_EVALUATED")
            port?.postMessage({
              type: "SELLER_OS_LUNA_SHIPPING_SERVER_RESULT",
              candidateId: job.identity.candidateId,
              success: true,
              subtotalUsd: Number(result.capture?.subtotalUsd),
              shippingUsd: Number(result.capture?.shippingUsd),
              totalUsd: Number(result.capture?.totalUsd),
            })
            index += 1
            if (index < jobs.length) {
              sendCurrent()
              return
            }
            if (mode === "LIVE") {
              busy = false
              setRunning(false)
              setStatus("LIVE_LISTING_SHIPPING_EVIDENCE_PERSISTED")
              return
            }
            await loadJobs(undefined, "AUTO")
          }).catch((certificationError) => {
            port?.postMessage({
              type: "SELLER_OS_LUNA_SHIPPING_SERVER_RESULT",
              candidateId: job.identity.candidateId,
              success: false,
              reasonCode: certificationError instanceof Error
                ? certificationError.message
                : "LUNA_SHIPPING_CAPTURE_SERVER_RESULT_FAILED",
            })
            fail(certificationError)
          })
    }

    const start = async () => {
      if (!ensureCanonicalExtensionOrigin()) return
      try {
        const persisted = await adminPost("read_runtime_trace", {})
        const recovered = Array.isArray(persisted.result?.events)
          ? persisted.result.events as LunaShippingRuntimeTraceEventV1[] : []
        if (recovered.length) {
          traceEvents = recovered.slice(0, 100)
          setLiveTraceEvents([...traceEvents])
          setTraceDurable(persisted.result?.traceDurable === true)
        }
      } catch {
        // A missing historical trace must not block the extension connection.
      }
      const wait = (milliseconds: number) => new Promise<void>((resolve) =>
        window.setTimeout(resolve, milliseconds))
      const runtime = await detectAndWakeLunaShippingExtensionV1({
        readRuntime: () => window.chrome?.runtime,
        pingRuntime: pingExtensionOnce,
        probeInstalledExtension,
        wait,
      })
      const phaseForResume = () => {
        if (new Set(["AWAITING_CHECKOUT_SHIPPING", "CHECKOUT_PAGE_DETECTED",
          "CHECKOUT_INJECTION_REQUESTED", "CHECKOUT_INJECTION_API_SUCCEEDED",
          "CHECKOUT_SCRIPT_INJECTED", "CHECKOUT_SCRIPT_BOOTSTRAP_ACK",
          "CHECKOUT_CLASSIFIER_STARTED", "CHECKOUT_HOST_CLASSIFIED",
          "CHECKOUT_PAGE_CLASSIFIED", "SHOP_PAY_QUOTE_PARSER_STARTED",
          "NORMAL_GUEST_CHECKOUT", "NORMAL_CHECKOUT_WITH_CONTACT_FORM",
          "NORMAL_CHECKOUT_WITH_SHIPPING_FORM", "NORMAL_CHECKOUT_WITH_SHIPPING",
          "SHOP_PAY_DOM_WAITING", "SHOP_PAY_DOM_READY",
          "CHECKOUT_EXPECTED_PRODUCT_VERIFIED", "CHECKOUT_EXPECTED_QUANTITY_VERIFIED",
          "CANONICAL_US_PROFILE_FOUND",
          "SHIPPING_ADDRESS_ACCEPTED", "SHIPPING_OPTIONS_DETECTED",
          "SHIPPING_CAPTURE_STARTED"]).has(lastProgressState)) {
          return "AWAITING_CHECKOUT_SHIPPING"
        }
        if (new Set([
        "AWAITING_CART_CONFIRMATION", "ADD_TO_CART_CLICK_DISPATCHED",
        "ACTIVE_JOB_RECOVERED_ON_CART", "CART_PAGE_DETECTED",
        "CART_EXPECTED_PRODUCT_FOUND", "CART_EXPECTED_QUANTITY_FOUND",
        "CART_MUTATION_CONFIRMED", "SHIPPING_FLOW_RESUMED",
        ]).has(lastProgressState)) return "AWAITING_CART_CONFIRMATION"
        return "PRODUCT_PAGE"
      }
      const attachPort = (nextPort: ExternalPort) => {
        port = nextPort
        nextPort.onMessage.addListener(handlePortMessage)
        nextPort.postMessage({ type: GET_BINDING_STORAGE_DIAGNOSTIC })
        nextPort.postMessage({
          type: "SELLER_OS_GET_LUNA_CANONICAL_DESTINATION_STATUS",
        })
        nextPort.postMessage({
          type: "SELLER_OS_GET_ACTIVE_LUNA_SHIPPING_JOB_STATUS",
        })
        nextPort.onDisconnect.addListener(() => {
          if (!active || port !== nextPort) return
          port = null
          setConnected(false)
          if (reconnecting) return
          reconnecting = true
          const jobToResume = busy ? jobs[index] : null
          canonicalBindingStatusRead = false
          canonicalDestinationBindingPresent = false
          setCanonicalBindingStatusReady(false)
          activeJobStatusReady = false
          recoveredActiveJob = null
          if (!busy) {
            initialAutoClaimStarted = false
            setStatus("RECONNECTING_EXTENSION")
          }
          void (async () => {
            let lastError: unknown = new Error(
              "LUNA_SHIPPING_EXTENSION_DISCONNECTED")
            for (let attempt = 0; attempt < 12; attempt += 1) {
              await new Promise((resolve) => window.setTimeout(resolve, 500))
              try {
                await wakeLunaShippingExtensionV1(runtime,
                  pingExtensionOnce, wait)
                if (!active) return
                const resumedPort = runtime.connect(EXTENSION_ID,
                  { name: PORT_NAME })
                attachPort(resumedPort)
                if (jobToResume) {
                  resumedPort.postMessage({
                    type: "RESUME_ACTIVE_LUNA_SHIPPING_JOB",
                    job: jobToResume,
                    phase: phaseForResume(),
                  })
                }
                reconnecting = false
                extensionReady = true
                setConnected(true)
                setStatus("BRIDGE_RECONNECTED")
                setRuntimeTrace((current) => ({ ...current,
                  bridgeReconnected: true }))
                return
              } catch (error) { lastError = error }
            }
            reconnecting = false
            fail(lastError)
          })()
        })
      }
      setStatus("PINGING_EXTENSION")
      if (!active) return
      extensionReady = true
      setConnected(true)
      setStatus("EXTENSION_CONNECTED")
      attachPort(runtime.connect(EXTENSION_ID, { name: PORT_NAME }))
      if (params.get("runShipping") === "1") beginCanary()
    }
    void start().catch(fail)
    return () => {
      active = false
      if (traceFlushTimer !== null) window.clearTimeout(traceFlushTimer)
      triggerRef.current = null
      liveTriggerRef.current = null
      bindDestinationRef.current = null
      port?.disconnect()
    }
  }, [])

  const newestTrace = liveTraceEvents.at(-1) ?? null
  const lastSuccessfulTrace = [...liveTraceEvents].reverse()
    .find((event) => event.success) ?? null
  const traceBlocker = newestTrace?.state === "FAIL"
    ? newestTrace.reasonCode : "NONE"
  const canStartFinalCanary = finalCanaryStartEnabled(connected,
    canonicalBindingStatusReady, canonicalDestinationBound,
    canonicalDestinationMismatch, running)

  return <main className="min-h-screen bg-[#07111a] px-4 py-10 text-white">
    <section className="mx-auto max-w-2xl rounded-3xl border border-white/15 bg-white/[0.05] p-6">
      <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-100">Seller OS · Luna shipping</p>
      <h1 className="mt-3 text-2xl font-black">Captura automática de envío</h1>
      <p className="mt-2 text-sm text-white/65">La extensión usa la sesión normal ya autenticada de Chrome. No lee cookies ni credenciales y nunca completa una compra.</p>
      <button type="button" disabled={!canStartFinalCanary}
        onClick={() => triggerRef.current?.()}
        className="mt-6 w-full rounded-2xl bg-cyan-300 px-5 py-3 font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-40">
        {canonicalDestinationBound
          ? "Ejecutar canary final" : "Ejecutar canary de shipping"}
      </button>
      {liveTarget ? <button type="button" disabled={!canStartFinalCanary}
        onClick={() => liveTriggerRef.current?.()}
        className="mt-3 w-full rounded-2xl bg-emerald-300 px-5 py-3 font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-40">
        Capturar envío del listing LIVE exacto
      </button> : null}
      {liveTarget ? <p className="mt-2 text-xs text-white/60">
        Identidad exacta preparada: Item {liveTarget.ebayItemId} · SKU {liveTarget.sourceSku}.
        Una sola captura; sin compra ni escritura en eBay.
      </p> : null}
      <button type="button"
        disabled={!connected || running || canonicalDestinationBound}
        onClick={() => bindDestinationRef.current?.()}
        className="mt-3 w-full rounded-2xl border border-cyan-200/40 px-5 py-3 font-black text-cyan-100 disabled:cursor-not-allowed disabled:opacity-40">
        Vincular perfil canónico US de Seller OS
      </button>
      <p className="mt-2 text-xs text-white/65">
        Acción explícita única. La extensión guarda sólo el fingerprint del
        perfil US canónico de Seller OS; nunca guarda ni muestra la dirección.
      </p>
      <p className="mt-2 text-xs text-white/50">
        CANONICAL_DESTINATION_BOUND={String(canonicalDestinationBound)} · CANONICAL_DESTINATION_MATCH={String(canonicalDestinationMatch)}
      </p>
      <section className="mt-4 rounded-2xl border border-amber-200/20 bg-amber-200/[0.04] p-4">
        <h2 className="text-sm font-black">Diagnóstico real de storage</h2>
        <p className="mt-2 text-xs text-white/60">
          Sólo muestra metadatos de presencia y validación. Nunca muestra el
          fingerprint ni el destino.
        </p>
        <code className="mt-3 block whitespace-pre-wrap break-all text-xs text-amber-100">
          {bindingStorageDiagnostic
            ? `REAL_BINDING_STORAGE_DIAGNOSTIC:\n` +
              `EXTENSION_ID=${bindingStorageDiagnostic.extensionId}\n` +
              `EXPECTED_EXTENSION_ID=${bindingStorageDiagnostic.expectedExtensionId}\n` +
              `EXTENSION_VERSION=${bindingStorageDiagnostic.extensionVersion}\n` +
              `EXTENSION_ID_CONTINUITY=${bindingStorageDiagnostic.extensionIdContinuity}\n` +
              `STORAGE_AREA_USED=${bindingStorageDiagnostic.storageAreaUsed}\n` +
              `CANONICAL_PRIMARY_KEY_PRESENT=${bindingStorageDiagnostic.canonicalPrimaryKeyPresent}\n` +
              `CANONICAL_LEGACY_KEY_PRESENT=${bindingStorageDiagnostic.canonicalLegacyKeyPresent}\n` +
              `CANONICAL_ENVELOPE_PRESENT=${bindingStorageDiagnostic.canonicalEnvelopePresent}\n` +
              `CANONICAL_ENVELOPE_SCHEMA_VERSION=${bindingStorageDiagnostic.canonicalEnvelopeSchemaVersion}\n` +
              `CANONICAL_ENVELOPE_VALID=${bindingStorageDiagnostic.canonicalEnvelopeValid}\n` +
              `CANONICAL_COUNTRY_CLASS_PRESENT=${bindingStorageDiagnostic.canonicalCountryClassPresent}\n` +
              `CANONICAL_BOUND_AT_PRESENT=${bindingStorageDiagnostic.canonicalBoundAtPresent}\n` +
              `CANONICAL_FINGERPRINT_PRESENT=${bindingStorageDiagnostic.canonicalFingerprintPresent}\n` +
              `STORAGE_READ_STATUS=${bindingStorageDiagnostic.storageReadStatus}\n` +
              `BINDING_CLASSIFICATION=${bindingStorageDiagnostic.bindingClassification}\n` +
              `WRITE_STORAGE_AUTHORITY=${bindingStorageDiagnostic.writeStorageAuthority}\n` +
              `READ_STORAGE_AUTHORITY=${bindingStorageDiagnostic.readStorageAuthority}\n` +
              `STATUS_STORAGE_AUTHORITY=${bindingStorageDiagnostic.statusStorageAuthority}\n` +
              `AUTO_CLAIM_STORAGE_AUTHORITY=${bindingStorageDiagnostic.autoClaimStorageAuthority}\n` +
              `AUTHORITIES_ALIGNED=${bindingStorageDiagnostic.authoritiesAligned}`
            : "REAL_BINDING_STORAGE_DIAGNOSTIC=PENDING"}
        </code>
      </section>
      <p className="mt-2 text-xs text-white/50">Certificación inicial: {CANARY_NAME}</p>
      <section className="mt-6 rounded-2xl border border-cyan-200/20 bg-cyan-200/[0.04] p-4">
        <h2 className="text-sm font-black">Monitor de ejecución</h2>
        <code className="mt-3 block whitespace-pre-wrap break-all text-xs text-cyan-100">
          {`TRACE_ID=${newestTrace?.traceId ?? "NONE"}\n` +
            `CURRENT_STATE=${newestTrace?.state ?? "NOT_STARTED"}\n` +
            `LAST_SUCCESSFUL_STATE=${lastSuccessfulTrace?.state ?? "NONE"}\n` +
            `CURRENT_BLOCKER=${traceBlocker}\n` +
            `TRACE_DURABLE=${traceDurable}\n` +
            `PURCHASE_BOUNDARY_ENFORCED=true`}
        </code>
        <ol className="mt-4 max-h-80 space-y-2 overflow-y-auto text-xs">
          {[...liveTraceEvents].reverse().map((event) =>
            <li key={`${event.traceId}:${event.sequence}`}
              className="rounded-xl border border-white/10 bg-black/20 p-3">
              <span className="font-mono text-cyan-100">#{event.sequence}</span>
              {" · "}{event.state}{" · "}
              <span className={event.success ? "text-emerald-200" : "text-rose-200"}>
                {event.success ? "PASS" : "FAIL"}
              </span>
              {event.reasonCode !== "NONE" ? ` · ${event.reasonCode}` : ""}
              <time className="mt-1 block text-white/40">{event.timestamp}</time>
            </li>)}
        </ol>
      </section>
      <div className="mt-6 rounded-2xl border border-white/10 bg-black/25 p-4">
        <p className="text-xs uppercase tracking-widest text-white/50">Estado</p>
        <p className="mt-2 text-lg font-black">{status}</p>
        <code className="mt-2 block break-all text-xs text-cyan-100">
          LAST_RUNTIME_STATE={lastRuntimeState}
        </code>
        <code className="mt-2 block whitespace-pre-wrap text-xs text-cyan-100">
          {`AUTH_CLASSIFICATION=${runtimeTrace.authClassification}\n` +
            `NO_EXPLICIT_AUTH_FAILURE=${runtimeTrace.noExplicitAuthFailure}\n` +
            `PRODUCT_IDENTITY_VERIFIED=${runtimeTrace.productIdentityVerified}\n` +
            `ADD_TO_CART_ELEMENT_FOUND=${runtimeTrace.addToCartElementFound}\n` +
            `ADD_TO_CART_CLICK_DISPATCHED=${runtimeTrace.addToCartClickDispatched}\n` +
            `ACTIVE_JOB_RECOVERED_ON_CART=${runtimeTrace.activeJobRecoveredOnCart}\n` +
            `CART_PAGE_DETECTED=${runtimeTrace.cartPageDetected}\n` +
            `CART_EXPECTED_PRODUCT_FOUND=${runtimeTrace.cartExpectedProductFound}\n` +
            `CART_EXPECTED_QUANTITY_FOUND=${runtimeTrace.cartExpectedQuantityFound}\n` +
            `CART_SUBTOTAL_USD=${runtimeTrace.cartSubtotalUsd ?? "UNAVAILABLE"}\n` +
            `CART_MUTATION_CONFIRMED=${runtimeTrace.cartMutationConfirmed}\n` +
            `BRIDGE_RECONNECTED=${runtimeTrace.bridgeReconnected}\n` +
            `SHIPPING_FLOW_RESUMED=${runtimeTrace.shippingFlowResumed}\n` +
            `CHECKOUT_NAVIGATION_OBSERVED=${runtimeTrace.checkoutNavigationObserved}\n` +
            `CHECKOUT_ACTUAL_ORIGIN=${runtimeTrace.checkoutNavigationOrigin}\n` +
            `CHECKOUT_NAVIGATION_HOST=${runtimeTrace.checkoutNavigationHost}\n` +
            `CHECKOUT_HOST_PERMISSION_MATCH=${runtimeTrace.checkoutHostPermissionMatch}\n` +
            `CHECKOUT_INJECTION_REQUESTED=${runtimeTrace.checkoutInjectionRequested}\n` +
            `CHECKOUT_INJECTION_API_SUCCEEDED=${runtimeTrace.checkoutInjectionApiSucceeded}\n` +
            `CHECKOUT_INJECTION_FRAME_ID=${runtimeTrace.checkoutInjectionFrameId ?? "UNAVAILABLE"}\n` +
            `CHECKOUT_SCRIPT_INJECTED=${runtimeTrace.checkoutScriptInjected}\n` +
            `CHECKOUT_SCRIPT_BOOTSTRAP_ACK=${runtimeTrace.checkoutScriptBootstrapAck}\n` +
            `CHECKOUT_SCRIPT_BOOTSTRAP_ERROR_CODE=${runtimeTrace.checkoutScriptBootstrapErrorCode}\n` +
            `CHECKOUT_CONTENT_SCRIPT_LOADED=${runtimeTrace.checkoutContentScriptLoaded}\n` +
            `ACTIVE_JOB_RECOVERED_ON_CHECKOUT=${runtimeTrace.activeJobRecoveredOnCheckout}\n` +
            `CHECKOUT_PAGE_DETECTED=${runtimeTrace.checkoutPageDetected}\n` +
            `CHECKOUT_PAGE_CLASSIFICATION=${runtimeTrace.checkoutPageClassification}\n` +
            `CHECKOUT_HOST_CLASSIFICATION=${runtimeTrace.checkoutHostClassification}\n` +
            `SHOP_PAY_MARKER_ORDER_SUMMARY=${runtimeTrace.shopPayMarkerOrderSummary}\n` +
            `SHOP_PAY_MARKER_PRODUCT=${runtimeTrace.shopPayMarkerProduct}\n` +
            `SHOP_PAY_MARKER_QUANTITY=${runtimeTrace.shopPayMarkerQuantity}\n` +
            `SHOP_PAY_MARKER_SHIP_TO=${runtimeTrace.shopPayMarkerShipTo}\n` +
            `SHOP_PAY_MARKER_SHIPPING=${runtimeTrace.shopPayMarkerShipping}\n` +
            `SHOP_PAY_MARKER_SUBTOTAL=${runtimeTrace.shopPayMarkerSubtotal}\n` +
            `SHOP_PAY_MARKER_SHIPPING_AMOUNT=${runtimeTrace.shopPayMarkerShippingAmount}\n` +
            `SHOP_PAY_MARKER_TOTAL=${runtimeTrace.shopPayMarkerTotal}\n` +
            `SHOP_PAY_MARKER_SHIPPING_METHOD=${runtimeTrace.shopPayMarkerShippingMethod}\n` +
            `SHOP_PAY_MARKER_PAYMENT=${runtimeTrace.shopPayMarkerPayment}\n` +
            `SHOP_PAY_MARKER_PAY_NOW=${runtimeTrace.shopPayMarkerPayNow}\n` +
            `SUBTOTAL_LABEL_FOUND=${runtimeTrace.subtotalLabelFound}\n` +
            `SUBTOTAL_AMOUNT_CANDIDATE_FOUND=${runtimeTrace.subtotalAmountCandidateFound}\n` +
            `SUBTOTAL_CURRENCY_FOUND=${runtimeTrace.subtotalCurrencyFound}\n` +
            `SUBTOTAL_PARSED=${runtimeTrace.subtotalParsed}\n` +
            `SHIPPING_LABEL_FOUND=${runtimeTrace.shippingLabelFound}\n` +
            `SHIPPING_AMOUNT_CANDIDATE_FOUND=${runtimeTrace.shippingAmountCandidateFound}\n` +
            `SHIPPING_CURRENCY_FOUND=${runtimeTrace.shippingCurrencyFound}\n` +
            `SHIPPING_PARSED=${runtimeTrace.shippingParsed}\n` +
            `TOTAL_LABEL_FOUND=${runtimeTrace.totalLabelFound}\n` +
            `TOTAL_CURRENCY_FOUND=${runtimeTrace.totalCurrencyFound}\n` +
            `TOTAL_AMOUNT_CANDIDATE_FOUND=${runtimeTrace.totalAmountCandidateFound}\n` +
            `TOTAL_PARSED=${runtimeTrace.totalParsed}\n` +
            `EXPLICIT_AUTH_REQUIRED=${runtimeTrace.explicitAuthRequired}\n` +
            `CANONICAL_US_PROFILE_FOUND=${runtimeTrace.canonicalUsProfileFound}\n` +
            `SHIPPING_ADDRESS_ACCEPTED=${runtimeTrace.shippingAddressAccepted}\n` +
            `SHIPPING_OPTIONS_DETECTED=${runtimeTrace.shippingOptionsDetected}\n` +
            `SHIPPING_USD=${runtimeTrace.shippingUsd ?? "UNAVAILABLE"}\n` +
            `SUBTOTAL_USD=${runtimeTrace.subtotalUsd ?? "UNAVAILABLE"}\n` +
            `TOTAL_USD=${runtimeTrace.totalUsd ?? "UNAVAILABLE"}\n` +
            `CAPTURE_POST_ACCEPTED=${runtimeTrace.capturePostAccepted}\n` +
            `CAPTURE_RESULT_DURABLE=${runtimeTrace.captureResultDurable}\n` +
            `DURABLE_READBACK_MATCH=${runtimeTrace.durableReadbackMatch}\n` +
            `ECONOMICS_STATUS=${runtimeTrace.economicsStatus}\n` +
            `AUTHENTICATED_OPERATION_CONFIRMED=${runtimeTrace.authenticatedOperationConfirmed}\n` +
            `PURCHASE_BOUNDARY_ENFORCED=true`}
        </code>
        {error && <code className="mt-3 block break-all text-sm text-rose-100">
          FINAL_BLOCKER={error}
        </code>}
      </div>
      {results.map((result) => <dl key={`${result.candidateId}:${result.shippingUsd}`}
        className="mt-4 grid grid-cols-2 gap-2 rounded-2xl border border-emerald-200/20 p-4 text-sm">
        <div className="col-span-2"><dt className="text-white/50">Producto</dt><dd className="font-bold">{result.productName}</dd></div>
        <div><dt className="text-white/50">Subtotal</dt><dd>${result.subtotalUsd.toFixed(2)}</dd></div>
        <div><dt className="text-white/50">Envío</dt><dd>${result.shippingUsd.toFixed(2)}</dd></div>
        <div><dt className="text-white/50">Total</dt><dd>${result.totalUsd.toFixed(2)}</dd></div>
        <div><dt className="text-white/50">Identidad</dt><dd>{result.identityVerified ? "VERIFICADA" : "NO PROBADA"}</dd></div>
        <div><dt className="text-white/50">Persistencia</dt><dd>{result.capturePostAccepted && result.captureResultDurable && result.durableReadbackMatch ? "DURABLE" : "NO PROBADA"}</dd></div>
        <div><dt className="text-white/50">Economía</dt><dd>{result.economicsStatus}</dd></div>
        <div><dt className="text-white/50">Contribución</dt><dd>{result.contributionProfitUsd === null ? "N/D" : `$${result.contributionProfitUsd.toFixed(2)}`}</dd></div>
        <div><dt className="text-white/50">Margen</dt><dd>{result.contributionMarginPercent === null ? "N/D" : `${result.contributionMarginPercent.toFixed(2)}%`}</dd></div>
      </dl>)}
    </section>
  </main>
}
