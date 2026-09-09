"use client"

import { useEffect, useState } from "react"

import { validateAdminSession } from "@/lib/admin-auth"
import { MayelMarketRevalidationRunner } from
  "./mayel-market-revalidation-runner"

type GateState = "CHECKING" | "AUTHORIZED" | "DENIED"

/**
 * Minimal OWNER_ADMIN gate for the dedicated Product Research browser worker.
 * It deliberately owns no polling, claims, commercial reads, or database
 * authority. Once authorized it mounts the existing Phase A V2 runner.
 */
export function ResearchWorkerControlOwnerGateV1() {
  const [state, setState] = useState<GateState>("CHECKING")

  useEffect(() => {
    let active = true
    void validateAdminSession().then((result) => {
      if (active) setState(result.isAdmin ? "AUTHORIZED" : "DENIED")
    }).catch(() => {
      if (active) setState("DENIED")
    })
    return () => { active = false }
  }, [])

  if (state === "AUTHORIZED") {
    return <main data-seller-os-isolated-research-worker-control="v1">
      <MayelMarketRevalidationRunner />
    </main>
  }

  return <main
    data-seller-os-isolated-research-worker-control="v1"
    data-owner-admin-auth={state.toLowerCase()}
    className="min-h-screen bg-[#07111d] text-slate-100"
  >
    <div className="grid min-h-screen place-items-center px-5">
      <p role="status" className="text-sm text-slate-300">
        {state === "CHECKING"
          ? "Validando sesión OWNER_ADMIN…"
          : "OWNER_ADMIN_REQUIRED"}
      </p>
    </div>
  </main>
}
