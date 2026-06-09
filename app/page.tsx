"use client"

import { useState } from "react"

import { ContactSection } from "@/components/contact-section"
import { Footer } from "@/components/footer"
import { FutureSection } from "@/components/future-section"
import { GlobalSection } from "@/components/global-section"
import { HeroSection } from "@/components/hero-section"
import { InnovationTracker } from "@/components/innovation-tracker"
import { InnovationsSection } from "@/components/innovations-section"
import InnovaPopup from "@/components/imnova-popup"
import { MissionSection } from "@/components/mission-section"
import { Navigation } from "@/components/navigation"
import { PartnersSection } from "@/components/partners-section"
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
      <InnovationTracker />
      <WorkingSection />
      <GlobalSection />

      <section className="relative z-20 flex justify-center bg-black px-6 py-16">
        <button
          type="button"
          onClick={() =>
            setShowPopup(true)
          }
          className="group rounded-full border border-cyan-400/30 bg-cyan-400/10 px-8 py-4 text-sm font-bold uppercase tracking-[0.20em] text-cyan-100 transition-all duration-500 hover:scale-105 hover:border-cyan-300 hover:bg-cyan-400/20"
        >
          Unirme a la Familia IMNOVA
        </button>
      </section>

      {/*
        HOME V2 - moved out of homepage
        <MissionSection />
        <FutureSection />
        <PartnersSection />
        <ContactSection />
      */}

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
