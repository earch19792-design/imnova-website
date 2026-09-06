"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

import { MayelVisualWorkstation } from "@/app/admin/mayel-visual-workstation"
import { validateSellerOsSession } from "@/lib/admin-auth"
import {
  SELLER_OS_ACCESS_ROLES,
  type SellerOsAccessRole,
} from "@/lib/seller-os-access-control"
import type { MayelCommercialIntelligenceV1 } from
  "@/lib/ebay/ebay-mayel-commercial-intelligence-v1"
import type { RemoteLiveOperatorListingV1 } from
  "@/lib/ebay/ebay-remote-live-optimization-operator-v1"
import { supabase } from "@/lib/supabase"

export default function SellerOsMayelPage() {
  const router = useRouter()
  const [role, setRole] = useState<SellerOsAccessRole | null>(null)
  const [failed, setFailed] = useState(false)
  const [commercialIntelligence, setCommercialIntelligence] = useState<
    Record<string, MayelCommercialIntelligenceV1>>({})
  const [livePortfolio, setLivePortfolio] = useState<
    readonly RemoteLiveOperatorListingV1[]>([])

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

  useEffect(() => {
    if (!role) return
    let active = true
    void (async () => {
      const session = await supabase.auth.getSession()
      const token = session.data.session?.access_token
      if (!token) return
      const response = await fetch(
        "/api/admin/ebay/live-optimization-operator", {
          cache: "no-store", headers: { Authorization: `Bearer ${token}` },
        })
      const payload = await response.json() as { success?: boolean
        dashboard?: { listings?: RemoteLiveOperatorListingV1[] } }
      if (!response.ok || payload.success !== true || !active) return
      const listings = payload.dashboard?.listings ?? []
      const entries = listings.flatMap((listing) =>
        typeof listing.ebayItemId === "string" && listing.commercialIntelligence
          ? [[listing.ebayItemId, listing.commercialIntelligence] as const] : [])
      setCommercialIntelligence(Object.fromEntries(entries))
      setLivePortfolio(listings)
    })().catch(() => { /* Visual work remains available when this feed degrades. */ })
    return () => { active = false }
  }, [role])

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
          Trabajo delegado, imágenes y resultados
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[#64675f]">
          Mayel decide y aprueba los cambios visuales dentro de su delegación.
          Seller OS los valida y aplica de forma segura; las decisiones
          comerciales protegidas permanecen fuera de ese alcance.
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
        <MayelVisualWorkstation canOperate={mayel}
          canOwnerAuthorize={owner}
          commercialIntelligenceByItemId={commercialIntelligence}
          livePortfolio={livePortfolio} />
      </section>}
    </div>
  </main>
}
