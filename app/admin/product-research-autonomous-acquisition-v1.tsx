"use client"

import { useEffect, useRef } from "react"
import { usePathname } from "next/navigation"

import { supabase } from "@/lib/supabase"

const ACQUISITION_CADENCE_MS = 60_000
const INITIAL_DELAY_MS = 20_000

type JsonRecord = Record<string, unknown>

async function readAcquisitionState() {
  const session = await supabase.auth.getSession()
  const token = session.data.session?.access_token
  if (!token) return null
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
  if (!response.ok || payload?.success !== true) return null
  return payload.result && typeof payload.result === "object"
    ? payload.result as JsonRecord : null
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
    let interval: number | null = null
    const tick = async () => {
      if (!active || running.current) {
        return
      }
      running.current = true
      try {
        const state = await readAcquisitionState()
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
      }
    }
    const initial = window.setTimeout(() => {
      void tick()
      interval = window.setInterval(() => void tick(),
        ACQUISITION_CADENCE_MS)
    }, INITIAL_DELAY_MS)
    return () => {
      active = false
      window.clearTimeout(initial)
      if (interval !== null) window.clearInterval(interval)
    }
  }, [pathname])

  return null
}
