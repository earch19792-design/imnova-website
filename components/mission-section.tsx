"use client"

/* 
================================================
MENÚ PRINCIPAL
SECCIÓN: MISIÓN Y VISIÓN
COMPONENTE: MissionSection
================================================
*/

import { motion, useInView } from "framer-motion"
import { useRef } from "react"

import {
  Target,
  Eye,
  Sparkles,
  Globe,
} from "lucide-react"

export function MissionSection() {

  const ref = useRef(null)

  const isInView = useInView(ref, {
    once: true,
    margin: "-100px",
  })

  const values = [
    "Innovación Inteligente",
    "Wellness Premium",
    "Tecnología Aplicada",
    "Expansión Global",
  ]

  return (
    <section
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

      {/* Main Radial Glow */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(0,255,255,0.08),transparent_50%)]" />

      {/* Ambient Glow Left */}
      <div className="absolute left-0 top-1/3 h-[500px] w-[500px] rounded-full bg-cyan-400/5 blur-[140px]" />

      {/* Ambient Glow Right */}
      <div className="absolute right-0 bottom-1/3 h-[500px] w-[500px] rounded-full bg-cyan-400/5 blur-[160px]" />

      {/* Divider */}
      <div className="absolute left-0 right-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

      <div className="relative z-10 mx-auto max-w-7xl px-6">

        {/* =================================================
        HEADER
        ================================================= */}

        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.9 }}
          className="mb-24 text-center"
        >

          {/* Badge */}
          <div className="inline-flex items-center rounded-full border border-cyan-400/20 bg-white/[0.04] px-5 py-2 backdrop-blur-2xl">

            <span className="text-xs uppercase tracking-[0.35em] text-cyan-300">
              Filosofía IMNOVA
            </span>

          </div>

          {/* Title */}
          <h2 className="mx-auto mt-10 max-w-6xl text-5xl font-black leading-[1.02] tracking-[-0.04em] text-white sm:text-6xl lg:text-7xl">

            Construimos el futuro mediante{" "}

            <span className="bg-gradient-to-r from-cyan-200 via-cyan-400 to-white bg-clip-text text-transparent">

              innovación inteligente.

            </span>

          </h2>

          {/* Divider */}
          <div className="mx-auto mt-10 h-[2px] w-28 rounded-full bg-white/10" />

          {/* Description */}
          <p className="mx-auto mt-10 max-w-4xl text-xl leading-9 text-zinc-300">

            Diseñamos marcas, experiencias y tecnologías
            enfocadas en bienestar moderno, rendimiento humano
            e innovación funcional para una nueva generación global.

          </p>

        </motion.div>

        {/* =================================================
        CARDS GRID
        ================================================= */}

        <div className="grid gap-10 lg:grid-cols-2">

          {/* =================================================
          MISSION CARD
          ================================================= */}

          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={isInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.8 }}
            whileHover={{
              y: -10,
            }}
            className="group relative"
          >

            <div
              className="
                relative
                h-full
                overflow-hidden
                rounded-[40px]
                border
                border-white/10
                bg-white/[0.04]
                p-10
                backdrop-blur-2xl
                shadow-[0_0_120px_rgba(0,255,255,0.05)]
                transition-all
                duration-700
                hover:border-cyan-400/20
                hover:bg-white/[0.05]
              "
            >

              {/* Hover Glow */}
              <div className="absolute inset-0 bg-gradient-to-br from-cyan-400/[0.08] via-transparent to-transparent opacity-0 transition-opacity duration-700 group-hover:opacity-100" />

              {/* Ambient Orb */}
              <div className="absolute -bottom-20 -right-20 h-64 w-64 rounded-full bg-cyan-400/10 blur-[120px]" />

              <div className="relative z-10">

                {/* Top */}
                <div className="mb-10 flex items-center gap-5">

                  {/* Icon */}
                  <div
                    className="
                      flex
                      h-16
                      w-16
                      items-center
                      justify-center
                      rounded-3xl
                      border
                      border-cyan-400/20
                      bg-cyan-400/10
                      shadow-[0_0_40px_rgba(0,255,255,0.15)]
                    "
                  >

                    <Target className="h-8 w-8 text-cyan-300" />

                  </div>

                  {/* Title */}
                  <div>

                    <span className="text-xs uppercase tracking-[0.35em] text-cyan-300">

                      Nuestra

                    </span>

                    <h3 className="mt-2 text-4xl font-black tracking-[-0.03em] text-white">

                      Misión

                    </h3>

                  </div>

                </div>

                {/* Text */}
                <div className="max-w-xl space-y-7">

                  <p className="text-xl leading-9 text-zinc-300">

                    Impulsar una nueva generación
                    de innovación inteligente mediante
                    tecnología de bienestar,
                    nutrición funcional y soluciones premium
                    diseñadas para mejorar
                    la experiencia humana.

                  </p>

                  <p className="text-lg leading-9 text-zinc-400">

                    Creamos marcas y experiencias
                    orientadas al bienestar moderno,
                    combinando diseño, funcionalidad
                    y tecnología aplicada para transformar
                    la vida cotidiana de manera más inteligente,
                    eficiente y conectada.

                  </p>

                </div>

              </div>

            </div>

          </motion.div>

          {/* =================================================
          VISION CARD
          ================================================= */}

          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={isInView ? { opacity: 1, y: 0 } : {}}
            transition={{
              duration: 0.8,
              delay: 0.2,
            }}
            whileHover={{
              y: -10,
            }}
            className="group relative"
          >

            <div
              className="
                relative
                h-full
                overflow-hidden
                rounded-[40px]
                border
                border-white/10
                bg-white/[0.04]
                p-10
                backdrop-blur-2xl
                shadow-[0_0_120px_rgba(0,255,255,0.05)]
                transition-all
                duration-700
                hover:border-cyan-400/20
                hover:bg-white/[0.05]
              "
            >

              {/* Hover Glow */}
              <div className="absolute inset-0 bg-gradient-to-br from-cyan-400/[0.08] via-transparent to-transparent opacity-0 transition-opacity duration-700 group-hover:opacity-100" />

              {/* Ambient Orb */}
              <div className="absolute -top-20 -left-20 h-64 w-64 rounded-full bg-cyan-400/10 blur-[120px]" />

              <div className="relative z-10">

                {/* Top */}
                <div className="mb-10 flex items-center gap-5">

                  {/* Icon */}
                  <div
                    className="
                      flex
                      h-16
                      w-16
                      items-center
                      justify-center
                      rounded-3xl
                      border
                      border-cyan-400/20
                      bg-cyan-400/10
                      shadow-[0_0_40px_rgba(0,255,255,0.15)]
                    "
                  >

                    <Eye className="h-8 w-8 text-cyan-300" />

                  </div>

                  {/* Title */}
                  <div>

                    <span className="text-xs uppercase tracking-[0.35em] text-cyan-300">

                      Nuestra

                    </span>

                    <h3 className="mt-2 text-4xl font-black tracking-[-0.03em] text-white">

                      Visión

                    </h3>

                  </div>

                </div>

                {/* Text */}
                <div className="max-w-xl">

                  <p className="text-xl leading-9 text-zinc-300">

                    Construir un ecosistema global
                    de innovación reconocido
                    por desarrollar tecnologías,
                    productos y experiencias premium
                    que definan el futuro del bienestar,
                    el rendimiento humano
                    y el consumo inteligente.

                  </p>

                </div>

                {/* =================================================
                VALUES
                ================================================= */}

                <div className="mt-12 flex flex-wrap gap-4">

                  {values.map((value, index) => (

                    <motion.div
                      key={value}
                      initial={{
                        opacity: 0,
                        scale: 0.9,
                      }}
                      animate={
                        isInView
                          ? {
                              opacity: 1,
                              scale: 1,
                            }
                          : {}
                      }
                      transition={{
                        duration: 0.4,
                        delay: 0.5 + index * 0.1,
                      }}
                      className="
                        inline-flex
                        items-center
                        gap-3
                        rounded-full
                        border
                        border-cyan-400/20
                        bg-cyan-400/10
                        px-5
                        py-3
                        backdrop-blur-xl
                      "
                    >

                      <div className="h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_15px_rgba(0,255,255,0.8)]" />

                      <span className="text-xs uppercase tracking-[0.25em] text-cyan-200">

                        {value}

                      </span>

                    </motion.div>

                  ))}

                </div>

              </div>

            </div>

          </motion.div>

        </div>

        {/* =================================================
        BOTTOM INDICATORS
        ================================================= */}

        <div className="mt-24 flex flex-wrap items-center justify-center gap-6 text-center text-xs uppercase tracking-[0.3em] text-zinc-600">

          <span>Innovación</span>
          <span>•</span>

          <span>Wellness</span>
          <span>•</span>

          <span>Tecnología Inteligente</span>
          <span>•</span>

          <span>Expansión Global</span>

        </div>

      </div>

    </section>
  )
}