"use client"

import {
  useEffect,
  useState,
} from "react"

import {
  ArrowUpRight,
  Gift,
  CheckCircle2,
  MessageCircle,
  Radio,
  Sparkles,
  UsersRound,
  Vote,
} from "lucide-react"

import { Footer } from "@/components/footer"
import { GlobalSection } from "@/components/global-section"
import { HeroSection } from "@/components/hero-section"
import { ImnovaGuidesSection } from "@/components/imnova-guides-section"
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

  const openCommunity =
    () => {
      setShowPopup(true)
    }

  const closePopup =
    () => {
      setShowPopup(false)
    }

  useEffect(
    () => {
      const timeouts: number[] = []

      const scrollToHash =
        () => {
          const targetId =
            window.location.hash.replace(
              "#",
              ""
            )

          if (!targetId) {
            return
          }

          const target =
            document.getElementById(targetId)

          if (!target) {
            return
          }

          target.scrollIntoView({
            behavior: "smooth",
            block: "start",
          })
        }

      const scheduleHashScroll =
        () => {
          ;[
            80,
            350,
            900,
          ].forEach(delay => {
            const timeout =
              window.setTimeout(
                scrollToHash,
                delay
              )

            timeouts.push(timeout)
          })
        }

      scheduleHashScroll()

      window.addEventListener(
        "hashchange",
        scheduleHashScroll
      )

      return () => {
        timeouts.forEach(timeout => {
          window.clearTimeout(timeout)
        })

        window.removeEventListener(
          "hashchange",
          scheduleHashScroll
        )
      }
    },
    []
  )

  return (
    <main className="relative isolate overflow-hidden bg-gradient-to-b from-black via-[#050505] to-black text-white">
      <div className="pointer-events-none absolute left-1/2 top-0 h-[700px] w-[700px] -translate-x-1/2 rounded-full bg-cyan-400/10 blur-3xl" />
      <div className="pointer-events-none absolute top-[35%] left-1/2 h-[900px] w-[900px] -translate-x-1/2 rounded-full bg-white/[0.03] blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 left-1/2 h-[700px] w-[700px] -translate-x-1/2 rounded-full bg-cyan-400/5 blur-3xl" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.015] mix-blend-soft-light bg-[url('/noise.png')]" />

      <Navigation />
      <HeroSection />

      <PromoBanner />
      <ImnovaGuidesSection
        onJoinFamily={openCommunity}
      />
      <GlobalSection />
      <InnovationsSection />
      <WorkingSection />

      <section
        id="contact"
        className="relative z-20 overflow-hidden bg-black px-6 py-24 md:py-32"
      >
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/20 to-transparent" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_45%_0%,rgba(34,211,238,0.14),transparent_42%),radial-gradient(circle_at_85%_55%,rgba(251,191,36,0.09),transparent_34%)]" />
        <div className="pointer-events-none absolute inset-0 opacity-[0.02] bg-[linear-gradient(rgba(255,255,255,0.18)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.18)_1px,transparent_1px)] bg-[size:90px_90px]" />

        <div className="relative mx-auto max-w-7xl overflow-hidden rounded-[34px] border border-cyan-200/15 bg-white/[0.035] shadow-[0_30px_140px_rgba(34,211,238,0.10)] backdrop-blur-2xl">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.18),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(251,191,36,0.12),transparent_44%)]" />
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/35 to-transparent" />

          <div className="relative z-10 grid gap-0 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="p-8 md:p-12 lg:p-14">
              <div className="inline-flex items-center gap-3 rounded-full border border-cyan-200/20 bg-cyan-300/[0.08] px-5 py-3">
                <UsersRound className="h-4 w-4 text-cyan-100" />
                <span className="text-[10px] uppercase tracking-[0.30em] text-cyan-100/70">
                  Comunidad IMNOVA
                </span>
              </div>

              <h2 className="mt-8 max-w-4xl text-4xl font-black leading-[1.02] tracking-[-0.045em] text-white md:text-6xl lg:text-7xl">
                Votá los próximos lanzamientos de IMNOVA.
              </h2>

              <p className="mt-7 max-w-3xl text-base leading-8 text-zinc-400 md:text-lg">
                Únete como miembro fundador, elige tus intereses y participa en
                encuestas que ayudan a decidir qué productos avanzan, se ajustan
                o llegan al mercado.
              </p>

              <div className="mt-9 grid gap-3 sm:grid-cols-3">
                {[
                  {
                    icon: Vote,
                    label: "Votá antes de fabricar",
                    text: "Tu señal ayuda a decidir qué ideas merecen avanzar.",
                  },
                  {
                    icon: MessageCircle,
                    label: "Encuestas relevantes",
                    text: "Recibí avances según los temas que elegís.",
                  },
                  {
                    icon: Gift,
                    label: "Acceso anticipado",
                    text: "Enterate primero de pruebas, lanzamientos y beneficios.",
                  },
                ].map(item => (
                  <div
                    key={item.label}
                    className="rounded-3xl border border-white/10 bg-black/35 p-5 transition-all duration-300 hover:border-cyan-200/25 hover:bg-cyan-300/[0.06]"
                  >
                    <item.icon className="h-5 w-5 text-cyan-100" />
                    <p className="mt-4 text-xs font-semibold uppercase leading-6 tracking-[0.14em] text-white/70">
                      {item.label}
                    </p>
                    <p className="mt-3 text-sm leading-6 text-zinc-500">
                      {item.text}
                    </p>
                  </div>
                ))}
              </div>

              <div className="mt-10 flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={openCommunity}
                  className="group inline-flex items-center justify-center gap-3 rounded-3xl border border-cyan-200/45 bg-gradient-to-r from-cyan-200 to-white px-8 py-5 text-xs font-black uppercase tracking-[0.18em] text-black shadow-[0_0_45px_rgba(34,211,238,0.22)] transition-all duration-500 hover:-translate-y-0.5 hover:border-white hover:shadow-[0_0_65px_rgba(34,211,238,0.34)]"
                >
                  Únete como miembro fundador
                  <ArrowUpRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </button>

                <a
                  href="#innovations"
                  className="inline-flex items-center justify-center gap-3 rounded-3xl border border-white/10 bg-white/[0.035] px-8 py-5 text-xs font-black uppercase tracking-[0.18em] text-white/70 transition-all duration-500 hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.07] hover:text-white"
                >
                  Ver ideas activas
                  <Sparkles className="h-4 w-4" />
                </a>
              </div>

              <p className="mt-5 max-w-2xl text-xs uppercase leading-6 tracking-[0.18em] text-zinc-600">
                Sin spam. Solo avances, encuestas y oportunidades conectadas a
                tus intereses.
              </p>
            </div>

            <div className="relative border-t border-white/10 bg-black/25 p-8 md:p-12 lg:border-l lg:border-t-0">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_25%,rgba(34,211,238,0.18),transparent_38%)]" />

              <div className="relative z-10 grid h-full content-center gap-5">
                <div className="rounded-[28px] border border-cyan-200/15 bg-cyan-300/[0.07] p-6">
                  <p className="text-[10px] uppercase tracking-[0.28em] text-cyan-100/60">
                    Cómo participa la comunidad
                  </p>

                  <div className="mt-6 grid gap-4">
                    {[
                      "Elegís hasta 5 intereses que realmente te importan.",
                      "IMNOVA te envía encuestas y pruebas conectadas a esos temas.",
                      "Tu señal ayuda a decidir si un producto avanza, se ajusta o se pausa.",
                    ].map((item, index) => (
                      <div
                        key={item}
                        className="flex gap-4 rounded-2xl border border-white/10 bg-black/30 p-4"
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-cyan-200/20 bg-cyan-300/[0.10] text-xs font-black text-cyan-100">
                          {index + 1}
                        </span>
                        <p className="text-sm leading-6 text-zinc-300">
                          {item}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-[28px] border border-white/10 bg-black/35 p-6">
                  <p className="text-[10px] uppercase tracking-[0.24em] text-cyan-100/55">
                    Intereses que podés elegir
                  </p>
                  <div className="mt-5 flex flex-wrap gap-2">
                    {[
                      "Energía y enfoque",
                      "Fitness",
                      "Nutrición inteligente",
                      "Belleza funcional",
                      "Bienestar diario",
                      "Innovación",
                    ].map(item => (
                      <span
                        key={item}
                        className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/60"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    {
                      icon: Radio,
                      label: "Señales reales",
                      value: "Encuestas + redes",
                    },
                    {
                      icon: CheckCircle2,
                      label: "Decisión IMNOVA",
                      value: "Avanzar o ajustar",
                    },
                  ].map(item => (
                    <div
                      key={item.label}
                      className="rounded-[26px] border border-white/10 bg-black/35 p-5"
                    >
                      <item.icon className="h-5 w-5 text-cyan-100" />
                      <p className="mt-5 text-[10px] uppercase tracking-[0.22em] text-zinc-500">
                        {item.label}
                      </p>
                      <p className="mt-2 text-lg font-black text-white">
                        {item.value}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <button
        type="button"
        onClick={openCommunity}
        className="
          fixed
          bottom-4
          left-4
          right-4
          z-40
          inline-flex
          items-center
          justify-center
          gap-3
          rounded-3xl
          border
          border-cyan-200/45
          bg-gradient-to-r
          from-cyan-200
          to-white
          px-5
          py-4
          text-[11px]
          font-black
          uppercase
          tracking-[0.16em]
          text-black
          shadow-[0_0_55px_rgba(34,211,238,0.28)]
          transition-all
          duration-500
          hover:-translate-y-0.5
          hover:shadow-[0_0_75px_rgba(34,211,238,0.38)]
          sm:left-auto
          sm:right-6
          sm:w-auto
          sm:px-6
        "
      >

        <span
          className="
            rounded-full
            border
            border-black/10
            bg-black/[0.08]
            px-2.5
            py-1
            text-[9px]
            tracking-[0.14em]
          "
        >
          Miembro fundador
        </span>

        Votá lanzamientos

        <ArrowUpRight className="h-4 w-4" />

      </button>

      <InnovaPopup
        isOpen={showPopup}
        onClose={closePopup}
      />

      <Footer />
    </main>
  )
}
