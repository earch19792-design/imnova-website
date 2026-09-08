"use client"

import { useEffect, useRef } from "react"
import { usePathname } from "next/navigation"

import { supabase } from "@/lib/supabase"
import {
  createSellerOsBackgroundWorkloadControllerV1,
  sellerOsBackgroundMetricsPublisherV1,
  trySellerOsCrossTabBrowserLeaderV1,
} from "@/lib/seller-os/background-workload-optimization-v1"

const ACQUISITION_CADENCE_MS = 60_000
const INITIAL_DELAY_MS = 20_000

type JsonRecord = Record<string, unknown>

async function readAcquisitionState() {
  const startedAt = performance.now()
  const session = await supabase.auth.getSession()
  const token = session.data.session?.access_token
  if (!token) return { state: null, httpStatus: 401,
    errorCode: "SESSION_REQUIRED", latencyMs: performance.now() - startedAt }
  const response = await fetch(
    "/api/admin/ebay/live-optimization-operator", {
      method: "POST", cache: "no-store",
      headers: { Authorization: `Bearer ${token}`,
        "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "READ_AUTONOMOUS_RESEARCH_ACQUISITION",
      }),
    })
  const payload = await response.json().catch(() => null) as JsonRecord | null
  const latencyMs = performance.now() - startedAt
  if (!response.ok || payload?.success !== true) return {
    state: null, httpStatus: response.status,
    errorCode: typeof payload?.error === "string" ? payload.error :
      "RESEARCH_ACQUISITION_READ_FAILED", latencyMs,
  }
  return { state: payload.result && typeof payload.result === "object"
    ? payload.result as JsonRecord : null,
    httpStatus: response.status, errorCode: null, latencyMs }
}

/**
 * Existing Product Research is a Chrome-session worker, not a server-side
 * browser. The extension-owned control route is the autonomous authority;
 * this bounded discovery remains only a safe compatibility fallback for an
 * already authenticated admin document. Claim and execution still require a
 * fresh extension handshake and durable lease on the dedicated Research route.
 */
export function ProductResearchAutonomousAcquisitionV1() {
  const pathname = usePathname()
  const running = useRef(false)

  useEffect(() => {
    if (pathname.startsWith("/admin/login") ||
        pathname.startsWith("/admin/ebay/opportunity-queue/research") ||
        pathname.startsWith("/admin/ebay/luna-shipping-capture")) return
    let active = true
    let timer: number | null = null
    const controller = createSellerOsBackgroundWorkloadControllerV1({
      producer: "PRODUCT_RESEARCH", storage: window.localStorage,
      publish: sellerOsBackgroundMetricsPublisherV1,
    })
    const schedule = (delayMs: number) => {
      if (!active) return
      if (timer !== null) window.clearTimeout(timer)
      timer = window.setTimeout(() => void tick(), delayMs)
    }
    const tick = async () => {
      if (!active || running.current) {
        return
      }
      running.current = true
      try {
        const leadership = await trySellerOsCrossTabBrowserLeaderV1({
          scope: "PRODUCT_RESEARCH",
          run: async () => {
            const permit = controller.acquirePollPermit()
            if (!permit.allowed) return null
            const read = await readAcquisitionState()
            if (!read.state) {
              controller.recordFailure(read)
              return null
            }
            if (Number(read.state.claimablePlanCount ?? 0) < 1 ||
                Number(read.state.activeClaimCount ?? 0) > 0) {
              controller.recordEmptyPoll(read.latencyMs)
              return read.state
            }
            controller.confirmDurableWorkSignal()
            return read.state
          },
        })
        if (!leadership.acquired) {
          controller.suppressDuplicatePoll()
          return
        }
        const state = leadership.value
        if (!active || Number(state?.claimablePlanCount ?? 0) < 1 ||
            Number(state?.activeClaimCount ?? 0) > 0) return
        const returnTo = `${window.location.pathname}${window.location.search}`
        const target = new URL(
          "/admin/ebay/opportunity-queue/research", window.location.origin)
        target.searchParams.set("mayelResearchWorker", "auto")
        target.searchParams.set("returnTo", returnTo)
        window.location.assign(target.pathname + target.search)
      } finally {
        running.current = false
        schedule(Math.max(ACQUISITION_CADENCE_MS,
          controller.nextDelayMs()))
      }
    }
    const initial = window.setTimeout(() => void tick(), INITIAL_DELAY_MS)
    return () => {
      active = false
      window.clearTimeout(initial)
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [pathname])

  return null
}
