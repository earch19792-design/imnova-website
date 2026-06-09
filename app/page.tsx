"use client"

import { useState } from "react"

import {
  ArrowUpRight,
  UsersRound,
} from "lucide-react"

import { Footer } from "@/components/footer"
import { GlobalSection } from "@/components/global-section"
import { HeroSection } from "@/components/hero-section"
import { ImnovaGuidesSection } from "@/components/imnova-guides-section"
import { InnovationTracker } from "@/components/innovation-tracker"
import { InnovationsSection } from "@/components/innovations-section"
import InnovaPopup from "@/components/imnova-popup"
import { Navigation } from "@/components/navigation"
import { PromoBanner } from "@/components/promo-banner"
import { WorkingSection } from "@/components/working-section"

export default function IMNOVAPage() {
  const [
    showPopup,
    setShowPopup,
  ] = useState(false)

  return (
    <main className="relative isolate overflow-hidden bg-gradient-to-b from-black via-[#050505] to-black text-white">
      <div className="pointer-events-none absolute left-1/2 top-0 h-[700px] w-[700px] -translate-x-1/2 rounded-full bg-cyan-400/10 blur-3xl" />
      <div className="pointer-events-none absolute top-[35%] left-1/2 h-[900px] w-[900px] -translate-x-1/2 rounded-full bg-white/[0.03] blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 left-1/2 h-[700px] w-[700px] -translate-x-1/2 rounded-full bg-cyan-400/5 blur-3xl" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.015] mix-blend-soft-light bg-[url('/noise.png')]" />

      <Navigation />
      <HeroSection
        onJoinFamily={() =>
          setShowPopup(true)
        }
      />

      <PromoBanner />
      <InnovationsSection />
      <ImnovaGuidesSection
        onJoinFamily={() =>
          setShowPopup(true)
        }
      />
      <InnovationTracker />
      <WorkingSection />
      <GlobalSection />

      <section className="relative z-20 overflow-hidden bg-black px-6 py-20 md:py-28">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/20 to-transparent" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(34,211,238,0.12),transparent_44%)]" />

        <div className="relative mx-auto max-w-6xl overflow-hidden rounded-[28px] border border-cyan-200/15 bg-white/[0.035] p-8 shadow-[0_30px_140px_rgba(34,211,238,0.10)] backdrop-blur-2xl md:p-12">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.16),transparent_36%),radial-gradient(circle_at_bottom_right,rgba(251,191,36,0.10),transparent_44%)]" />
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/35 to-transparent" />

          <div className="relative z-10 grid gap-10 lg:grid-cols-[1fr_auto] lg:items-center">
            <div className="max-w-3xl">
              <div className="flex h-14 w-14 items-center justify-center rounded-3xl border border-cyan-200/20 bg-cyan-300/[0.08]">
                <UsersRound className="h-6 w-6 text-cyan-100" />
              </div>

              <p className="mt-8 text-[10px] uppercase tracking-[0.30em] text-cyan-100/60">
                Comunidad IMNOVA
              </p>

              <h2 className="mt-4 text-4xl font-black leading-tight tracking-[-0.04em] text-white md:text-6xl">
                Únete a la familia IMNOVA
              </h2>

              <p className="mt-6 max-w-2xl text-base leading-8 text-zinc-400 md:text-lg">
                Recibe lanzamientos, avances exclusivos y participa en el
                desarrollo de próximas innovaciones.
              </p>
            </div>

            <div className="grid gap-5 lg:min-w-[360px]">
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
                {[
                  "Lanzamientos",
                  "Avances exclusivos",
                  "Decisiones de producto",
                ].map(item => (
                  <div
                    key={item}
                    className="rounded-3xl border border-white/10 bg-black/35 px-5 py-4 text-xs font-semibold uppercase tracking-[0.16em] text-white/65"
                  >
                    {item}
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={() =>
                  setShowPopup(true)
                }
                className="group inline-flex items-center justify-center gap-3 rounded-3xl border border-cyan-200/25 bg-cyan-300/[0.10] px-7 py-5 text-xs font-black uppercase tracking-[0.18em] text-cyan-50 transition-all duration-500 hover:-translate-y-0.5 hover:border-cyan-200/45 hover:bg-cyan-300/[0.16]"
              >
                Unirme a la comunidad
                <ArrowUpRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </button>
            </div>
          </div>
        </div>
      </section>

      <InnovaPopup
        isOpen={showPopup}
        onClose={() =>
          setShowPopup(false)
        }
      />

      <Footer />
    </main>
  )
}
