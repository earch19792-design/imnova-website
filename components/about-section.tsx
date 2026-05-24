"use client"

/* 
================================================
MENÚ PRINCIPAL
SECCIÓN: ABOUT / NOSOTROS
COMPONENTE: AboutSection
================================================
*/

import { motion } from "framer-motion"
import { useInView } from "framer-motion"
import { useRef } from "react"

import {
  Sparkles,
  Zap,
  Globe,
} from "lucide-react"
import { PublicStatusStats }
from "@/components/home/public-status-stats"

export function AboutSection() {

  const ref = useRef(null)

  const isInView = useInView(ref, {
    once: true,
    margin: "-100px",
  })

  

  return (
    <section
      id="about"
      ref={ref}
      className="
        relative
        isolate
        overflow-hidden
        bg-gradient-to-b
        from-black
        via-[#050505]
        to-black
        py-44
        md:py-52
      "
    >

      {/* =================================================
      BACKGROUND EFFECTS
      ================================================= */}

      {/* Radial Glow */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(0,255,255,0.08),transparent_50%)]" />

      {/* Ambient Glow Left */}
      <div className="absolute left-0 top-1/3 h-[400px] w-[400px] rounded-full bg-cyan-400/5 blur-3xl" />

      {/* Ambient Glow Right */}
      <div className="absolute right-0 bottom-1/3 h-[400px] w-[400px] rounded-full bg-white/[0.03] blur-3xl" />

      {/* Divider */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

      <div className="relative z-10 mx-auto max-w-7xl px-6">

        <div className="grid items-center gap-24 lg:grid-cols-2">

          {/* =================================================
          LEFT CONTENT
          ================================================= */}

          <motion.div
            initial={{ opacity: 0, x: -50 }}
            animate={isInView ? { opacity: 1, x: 0 } : {}}
            transition={{
              duration: 0.9,
              ease: "easeOut",
            }}
          >

            {/* Badge */}
            <div className="inline-flex items-center rounded-full border border-cyan-400/20 bg-white/[0.04] px-5 py-2 backdrop-blur-2xl">

              <span className="text-xs uppercase tracking-[0.35em] text-cyan-300">
                Ecosistema IMNOVA
              </span>

            </div>

            {/* Title */}
            <h2 className="mt-10 text-5xl font-black leading-[1.02] tracking-[-0.04em] text-white sm:text-6xl lg:text-7xl">

              Innovación Inteligente para el{" "}

              <span className="bg-gradient-to-r from-cyan-200 via-cyan-400 to-white bg-clip-text text-transparent">
                Bienestar del Futuro
              </span>

            </h2>

            {/* Divider */}
            <div className="mt-10 h-[2px] w-28 rounded-full bg-white/10" />

            {/* Description */}
            <div className="mt-10 space-y-7">

              <p className="max-w-2xl text-xl leading-9 text-zinc-300">

                Desarrollamos tecnología de bienestar,
                nutrición funcional y soluciones inteligentes
                diseñadas para impulsar una nueva generación
                de rendimiento, innovación y bienestar moderno.

              </p>

              <p className="max-w-2xl text-lg leading-8 text-zinc-400">

                IMNOVA construye marcas y experiencias premium
                enfocadas en bienestar, innovación funcional
                y tecnología aplicada para consumidores globales
                que buscan una vida más inteligente,
                eficiente y equilibrada.

              </p>

            </div>

            {/* =================================================
            STATS
            ================================================= */}

          <PublicStatusStats />

            {/* =================================================
            BOTTOM INDICATORS
            ================================================= */}

            <div className="mt-16 flex flex-wrap gap-6 text-xs uppercase tracking-[0.3em] text-zinc-600">

              <span>Innovación</span>
              <span>•</span>

              <span>Wellness</span>
              <span>•</span>

              <span>Tecnología Inteligente</span>
              <span>•</span>

              <span>Ecommerce Global</span>

            </div>

          </motion.div>

          {/* =================================================
          RIGHT VISUAL
          ================================================= */}

          <motion.div
            initial={{ opacity: 0, x: 50 }}
            animate={isInView ? { opacity: 1, x: 0 } : {}}
            transition={{
              duration: 0.9,
              delay: 0.2,
              ease: "easeOut",
            }}
            className="relative"
          >

            <div className="relative mx-auto aspect-square max-w-xl">

              {/* =================================================
              CENTRAL GLOW
              ================================================= */}

              <div className="absolute inset-0 rounded-full bg-cyan-400/10 blur-3xl" />

              {/* =================================================
              MAIN CIRCLE
              ================================================= */}

              <div className="absolute inset-0 flex items-center justify-center">

                <div
                  className="
                    relative
                    h-80
                    w-80
                    rounded-full
                    shadow-[0_0_120px_rgba(0,255,255,0.10)]
                  "
                >

                  {/* Outer Glow */}
                  <div className="absolute inset-0 rounded-full bg-gradient-to-br from-cyan-400/20 to-cyan-400/5 animate-pulse-glow" />

                  {/* Ring 1 */}
                  <div className="absolute inset-4 rounded-full border border-cyan-400/20" />

                  {/* Ring 2 */}
                  <div className="absolute inset-10 rounded-full border border-cyan-400/10" />

                  {/* Ring 3 */}
                  <div className="absolute inset-16 rounded-full border border-white/5" />

                  {/* Center */}
                  <div className="absolute inset-0 flex items-center justify-center">

                    <div className="text-center">

                      <div className="bg-gradient-to-br from-white via-cyan-200 to-cyan-400 bg-clip-text text-7xl font-black tracking-[-0.05em] text-transparent">

                        IM

                      </div>

                      <div className="mt-3 text-xs uppercase tracking-[0.45em] text-zinc-500">

                        NOVA

                      </div>

                    </div>

                  </div>

                </div>

              </div>

              {/* =================================================
              ORBITING PARTICLES
              ================================================= */}

              <motion.div
                animate={{ rotate: 360 }}
                transition={{
                  duration: 20,
                  repeat: Infinity,
                  ease: "linear",
                }}
                className="absolute inset-0"
              >

                <div className="absolute left-1/2 top-0 h-4 w-4 -translate-x-1/2 rounded-full bg-cyan-300 shadow-[0_0_30px_rgba(0,255,255,0.8)]" />

              </motion.div>

              <motion.div
                animate={{ rotate: -360 }}
                transition={{
                  duration: 30,
                  repeat: Infinity,
                  ease: "linear",
                }}
                className="absolute inset-10"
              >

                <div className="absolute bottom-0 left-1/2 h-3 w-3 -translate-x-1/2 rounded-full bg-cyan-400/60 blur-[1px]" />

              </motion.div>

              {/* =================================================
              FLOATING CARD 1
              ================================================= */}

              <motion.div
                animate={{ y: [-12, 12, -12] }}
                transition={{
                  duration: 4,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
                className="
                  absolute
                  -right-4
                  -top-4
                  rounded-[28px]
                  border
                  border-white/10
                  bg-white/[0.04]
                  p-6
                  backdrop-blur-2xl
                  shadow-[0_0_60px_rgba(0,255,255,0.05)]
                "
              >

                <div className="flex items-center gap-4">

                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-400/10">

                    <Sparkles className="h-5 w-5 text-cyan-300" />

                  </div>

                  <div>

                    <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                      Innovación
                    </div>

                    <div className="mt-1 text-sm font-semibold text-white">
                      Nueva Generación
                    </div>

                  </div>

                </div>

              </motion.div>

              {/* =================================================
              FLOATING CARD 2
              ================================================= */}

              <motion.div
                animate={{ y: [12, -12, 12] }}
                transition={{
                  duration: 5,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
                className="
                  absolute
                  -bottom-4
                  -left-4
                  rounded-[28px]
                  border
                  border-white/10
                  bg-white/[0.04]
                  p-6
                  backdrop-blur-2xl
                  shadow-[0_0_60px_rgba(0,255,255,0.05)]
                "
              >

                <div className="flex items-center gap-4">

                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-400/10">

                    <Zap className="h-5 w-5 text-cyan-300" />

                  </div>

                  <div>

                    <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                      Tecnología
                    </div>

                    <div className="mt-1 text-sm font-semibold text-white">
                      Expansión Global
                    </div>

                  </div>

                </div>

              </motion.div>

            </div>

          </motion.div>

        </div>

      </div>

    </section>
  )
}