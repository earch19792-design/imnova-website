"use client"

/* 
================================================
MENÚ PRINCIPAL
SECCIÓN: FUTURE / VISIÓN DE FUTURO
COMPONENTE: FutureSection
================================================
*/

import { motion } from "framer-motion"
import { useInView } from "framer-motion"
import { useRef } from "react"

import {
  Home,
  Wifi,
  Heart,
  Building2,
  Zap,
  Users,
} from "lucide-react"

const futureVisions = [
  {
    icon: Heart,
    title: "Bienestar Inteligente",
    description:
      "Soluciones modernas enfocadas en energía, rendimiento y bienestar integral para una nueva generación.",
  },

  {
    icon: Zap,
    title: "Nutrición Funcional",
    description:
      "Productos diseñados para potenciar enfoque, bienestar y rendimiento diario mediante innovación funcional.",
  },

  {
    icon: Wifi,
    title: "Experiencias Conectadas",
    description:
      "Tecnología integrada para experiencias de consumo más inteligentes, fluidas y modernas.",
  },

  {
    icon: Users,
    title: "Innovación Humana",
    description:
      "Desarrollamos productos orientados a mejorar la experiencia humana mediante tecnología y funcionalidad aplicada.",
  },

  {
    icon: Building2,
    title: "Expansión Global",
    description:
      "Marcas preparadas para competir en mercados internacionales, ecommerce y distribución global.",
  },

  {
    icon: Home,
    title: "Estilo de Vida Premium",
    description:
      "Creamos experiencias y productos alineados al bienestar moderno y estilos de vida de alto rendimiento.",
  },
]

export function FutureSection() {

  const ref = useRef(null)

  const isInView = useInView(ref, {
    once: true,
    margin: "-100px",
  })

  return (
    <section
      id="future"
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

      {/* Animated Orb 1 */}
      <motion.div
        animate={{
          x: [0, 100, 0],
          y: [0, -50, 0],
        }}
        transition={{
          duration: 20,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        className="
          absolute
          left-1/4
          top-1/4
          h-72
          w-72
          rounded-full
          bg-cyan-400/10
          blur-[120px]
        "
      />

      {/* Animated Orb 2 */}
      <motion.div
        animate={{
          x: [0, -80, 0],
          y: [0, 60, 0],
        }}
        transition={{
          duration: 25,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        className="
          absolute
          bottom-1/4
          right-1/4
          h-96
          w-96
          rounded-full
          bg-cyan-400/5
          blur-[150px]
        "
      />

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
              Visión de Futuro
            </span>

          </div>

          {/* Title */}
          <h2 className="mx-auto mt-10 max-w-6xl text-5xl font-black leading-[1.02] tracking-[-0.04em] text-white sm:text-6xl lg:text-7xl">

            Innovación Inteligente para el{" "}

            <span className="bg-gradient-to-r from-cyan-200 via-cyan-400 to-white bg-clip-text text-transparent">
              Bienestar del Futuro
            </span>

          </h2>

          {/* Divider */}
          <div className="mx-auto mt-10 h-[2px] w-28 rounded-full bg-white/10" />

          {/* Description */}
          <p className="mx-auto mt-10 max-w-4xl text-xl leading-9 text-zinc-300">

            Creamos tecnología de bienestar,
            nutrición funcional y soluciones inteligentes
            diseñadas para impulsar una nueva generación
            de innovación, rendimiento y bienestar moderno.

          </p>

        </motion.div>

        {/* =================================================
        FUTURE GRID
        ================================================= */}

        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">

          {futureVisions.map((vision, index) => (

            <motion.div
              key={vision.title}
              initial={{ opacity: 0, y: 40 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{
                duration: 0.7,
                delay: index * 0.1,
              }}
              whileHover={{
                y: -10,
                transition: { duration: 0.3 },
              }}
              className="group relative"
            >

              <div
                className="
                  relative
                  h-full
                  overflow-hidden
                  rounded-[32px]
                  border
                  border-white/10
                  bg-white/[0.04]
                  p-8
                  backdrop-blur-2xl
                  transition-all
                  duration-500
                  hover:border-cyan-400/20
                  hover:bg-white/[0.05]
                  hover:shadow-[0_0_80px_rgba(0,255,255,0.06)]
                "
              >

                {/* Hover Gradient */}
                <div className="absolute inset-0 bg-gradient-to-br from-cyan-400/[0.08] via-transparent to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />

                {/* Glow Orb */}
                <div className="absolute right-0 top-0 h-40 w-40 rounded-full bg-cyan-400/10 blur-3xl opacity-0 transition-opacity duration-500 group-hover:opacity-100" />

                <div className="relative z-10">

                  {/* Icon */}
                  <motion.div
                    whileHover={{
                      scale: 1.08,
                      rotate: 4,
                    }}
                    className="
                      mb-8
                      flex
                      h-16
                      w-16
                      items-center
                      justify-center
                      rounded-3xl
                      bg-gradient-to-br
                      from-cyan-400/20
                      to-cyan-400/5
                    "
                  >

                    <vision.icon className="h-8 w-8 text-cyan-300" />

                  </motion.div>

                  {/* Title */}
                  <h3 className="text-2xl font-bold tracking-tight text-white">

                    {vision.title}

                  </h3>

                  {/* Description */}
                  <p className="mt-5 text-base leading-8 text-zinc-400">

                    {vision.description}

                  </p>

                </div>

                {/* Border Glow */}
                <div className="absolute inset-0 rounded-[32px] border border-cyan-400/0 transition-colors duration-500 group-hover:border-cyan-400/20" />

              </div>

            </motion.div>

          ))}

        </div>

        {/* =================================================
        BOTTOM INDICATORS
        ================================================= */}

        <div className="mt-20 flex flex-wrap items-center justify-center gap-6 text-center text-xs uppercase tracking-[0.3em] text-zinc-600">

          <span>Innovación</span>
          <span>•</span>

          <span>Wellness</span>
          <span>•</span>

          <span>Rendimiento</span>
          <span>•</span>

          <span>Tecnología Inteligente</span>

        </div>

      </div>

    </section>
  )
}