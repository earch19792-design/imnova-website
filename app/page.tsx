"use client"

/* 
================================================
PÁGINA PRINCIPAL
LANDING PAGE · IMNOVA
MENÚ PRINCIPAL
================================================
*/

import { useState } from "react"

import { Navigation } from "@/components/navigation"
import { HeroSection } from "@/components/hero-section"
import { PromoBanner } from "@/components/promo-banner"
import { AboutSection } from "@/components/about-section"
import { EcosystemSection } from "@/components/ecosystem-section"
import { InnovationsSection } from "@/components/innovations-section"
import { MissionSection } from "@/components/mission-section"
import { TechnologySection } from "@/components/technology-section"
import { FutureSection } from "@/components/future-section"
import { GlobalSection } from "@/components/global-section"
import { PartnersSection } from "@/components/partners-section"
import { ContactSection } from "@/components/contact-section"
import InnovaPopup from "@/components/imnova-popup"
import { Footer } from "@/components/footer"

export default function IMNOVAPage() {

  const [showPopup, setShowPopup] =
    useState(false)

  return (
    <main
      className="
        relative
        isolate
        overflow-hidden
        bg-gradient-to-b
        from-black
        via-[#050505]
        to-black
        text-white
      "
    >

      {/* =================================================
      GLOBAL BACKGROUND EFFECTS
      ================================================= */}

      <div className="pointer-events-none absolute left-1/2 top-0 h-[700px] w-[700px] -translate-x-1/2 rounded-full bg-cyan-400/10 blur-3xl" />

      <div className="pointer-events-none absolute top-[35%] left-1/2 h-[900px] w-[900px] -translate-x-1/2 rounded-full bg-white/[0.03] blur-3xl" />

      <div className="pointer-events-none absolute bottom-0 left-1/2 h-[700px] w-[700px] -translate-x-1/2 rounded-full bg-cyan-400/5 blur-3xl" />

      <div
        className="
          pointer-events-none
          absolute
          inset-0
          opacity-[0.015]
          mix-blend-soft-light
          bg-[url('/noise.png')]
        "
      />

      {/* =================================================
      NAVIGATION
      ================================================= */}
      <Navigation />

      {/* =================================================
      HERO SECTION
      ================================================= */}
      <HeroSection />

      {/* =================================================
      IMNOVA ACCESS CTA
      ================================================= */}

      <section
        className="
          relative
          z-20
          flex
          justify-center
          py-10
        "
      >

        <button
          onClick={() =>
            setShowPopup(true)
          }
          className="
            group
            rounded-full
            border
            border-cyan-400/30
            bg-cyan-400/10
            px-8
            py-4
            text-sm
            font-bold
            uppercase
            tracking-[0.20em]
            text-cyan-100
            transition-all
            duration-500
            hover:scale-105
            hover:border-cyan-300
            hover:bg-cyan-400/20
          "
        >

          🚀 Unirme a la Familia IMNOVA™

        </button>

      </section>

      {/* =================================================
      PROMO BANNER
      ================================================= */}
      <PromoBanner />

      {/* =================================================
      ABOUT SECTION
      ================================================= */}
      <AboutSection />

      {/* =================================================
      ECOSYSTEM SECTION
      ================================================= */}
      <EcosystemSection />

      {/* =================================================
      INNOVATIONS SECTION
      ================================================= */}
      <InnovationsSection />

      {/* =================================================
      MISSION SECTION
      ================================================= */}
      <MissionSection />

      {/* =================================================
      TECHNOLOGY SECTION
      ================================================= */}
      <TechnologySection />

      {/* =================================================
      FUTURE SECTION
      ================================================= */}
      <FutureSection />

      {/* =================================================
      GLOBAL SECTION
      ================================================= */}
      <GlobalSection />

      {/* =================================================
      PARTNERS SECTION
      ================================================= */}
      <PartnersSection />

      {/* =================================================
      CONTACT SECTION
      ================================================= */}
      <ContactSection />

      <InnovaPopup
        isOpen={showPopup}
        onClose={() =>
          setShowPopup(false)
        }
      />

      {/* =================================================
      FOOTER
      ================================================= */}
      <Footer />

    </main>
  )
}