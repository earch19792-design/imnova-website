"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

import { MayelRevenueEngine } from "./revenue-engine"
import { validateSellerOsSession } from "@/lib/admin-auth"
import {
  SELLER_OS_ACCESS_ROLES,
  type SellerOsAccessRole,
} from "@/lib/seller-os-access-control"

export default function SellerOsMayelPage() {
  const router = useRouter()
  const [role, setRole] = useState<SellerOsAccessRole | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    void validateSellerOsSession().then((result) => {
      if (!active) return
      if (!result.authorized || !result.role) {
        router.replace("/admin/login?returnTo=/admin/ebay/mayel")
        return
      }
      setRole(result.role)
    }).catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [router])

  const owner = role === SELLER_OS_ACCESS_ROLES.owner
  const mayel = role ===
    SELLER_OS_ACCESS_ROLES.remoteLiveOptimizationOperator

  return <main className="min-h-screen bg-[#f3eee6] px-4 pb-28 pt-5 text-[#26312d] sm:px-6">
    <div className="mx-auto max-w-6xl">
      <header className="border-b border-[#d9d1c4] pb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#1d5961]">
          Mayel
        </p>
        <h1 className="mt-2 font-serif text-4xl font-semibold">
          Tu próxima decisión comercial
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[#64675f]">
          Mayel analiza el rendimiento, protege tu beneficio y prepara el siguiente paso.
        </p>
      </header>
      {!role && !failed && <p className="mt-6 rounded-2xl border border-[#d9d1c4] bg-white p-5">
        Comprobando delegación…
      </p>}
      {failed && <p role="alert"
        className="mt-6 rounded-2xl border border-[#d6bca8] bg-[#f7e9de] p-5">
        No se pudo comprobar la autoridad. No se ejecutó ninguna acción.
      </p>}
      {(owner || mayel) && <section className="mt-6">
        <MayelRevenueEngine owner={owner} />
      </section>}
    </div>
  </main>
}
