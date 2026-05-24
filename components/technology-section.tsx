"use client"

/* 
================================================
MENÚ PRINCIPAL
SECCIÓN: TECHNOLOGY
COMPONENTE: TechnologySection
ESTILO: ULTRA PREMIUM · FUTURISTA · CINEMÁTICO
================================================
*/

import { motion, useInView } from "framer-motion"
import { useRef } from "react"

import {
  Globe,
  Rocket,
  Sparkles,
  Orbit,
  Layers3,
  Cpu,
  Stars,
} from "lucide-react"

const techMetrics = [
  {
    label: "Marca en Expansión",
    value: "1+",
    icon: Rocket,
  },

  {
    label: "Productos en Desarrollo",
    value: "5",
    icon: Layers3,
  },

  {
    label: "Innovación Estratégica",
    value: "Activa",
    icon: Sparkles,
  },

  {
    label: "Presencia Internacional",
    value: "Global",
    icon: Globe,
  },
]

const researchAreas = [
  "Bebidas Funcionales Premium",
  "Innovación Wellness",
  "Productos Inteligentes",
  "Experiencias Modernas",
  "Tecnología Lifestyle",
  "Expansión Internacional",
  "Marcas Premium",
  "Soluciones Sostenibles",
]

export function TechnologySection() {

  const ref = useRef(null)

  const isInView = useInView(ref, {
    once: true,
    margin: "-100px",
  })

  return (
    <section
      id="technology"
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

      {/* Main Glow */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(0,255,255,0.08),transparent_50%)]" />

      {/* Ambient Glow Top */}
      <div className="absolute left-1/2 top-0 h-[900px] w-[900px] -translate-x-1/2 rounded-full bg-cyan-400/8 blur-[200px]" />

      {/* Ambient Glow Left */}
      <div className="absolute left-0 top-1/3 h-[500px] w-[500px] rounded-full bg-cyan-400/5 blur-[140px]" />

      {/* Ambient Glow Right */}
      <div className="absolute bottom-0 right-0 h-[600px] w-[600px] rounded-full bg-blue-500/5 blur-[160px]" />

      {/* Grid */}
      <div className="absolute inset-0 opacity-[0.02] bg-[linear-gradient(rgba(0,255,255,0.10)_1px,transparent_1px),linear-gradient(90deg,rgba(0,255,255,0.10)_1px,transparent_1px)] bg-[size:90px_90px]" />

      {/* Divider */}
      <div className="absolute left-0 right-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

      {/* =================================================
      CONTENT
      ================================================= */}

      <div className="relative z-10 mx-auto max-w-7xl px-6">

        {/* =================================================
        HEADER
        ================================================= */}

        <motion.div
          initial={{
            opacity: 0,
            y: 40,
          }}
          animate={
            isInView
              ? {
                  opacity: 1,
                  y: 0,
                }
              : {}
          }
          transition={{
            duration: 0.9,
          }}
          className="mb-28 text-center"
        >

          {/* Badge */}
          <div
            className="
              inline-flex
              items-center
              gap-3
              rounded-full
              border
              border-cyan-400/20
              bg-white/[0.04]
              px-6
              py-3
              backdrop-blur-2xl
            "
          >

            <Stars className="h-4 w-4 text-cyan-300" />

            <span
              className="
                text-xs
                uppercase
                tracking-[0.35em]
                text-cyan-300
              "
            >

              Ecosistema de Innovación

            </span>

          </div>

          {/* Title */}
          <h2
            className="
              mx-auto
              mt-10
              max-w-6xl
              text-5xl
              font-black
              leading-[1.02]
              tracking-[-0.04em]
              text-white
              sm:text-6xl
              lg:text-7xl
            "
          >

            Diseñando el futuro del{" "}

            <span className="bg-gradient-to-r from-cyan-200 via-cyan-400 to-white bg-clip-text text-transparent">

              consumo moderno

            </span>

          </h2>

          {/* Divider */}
          <div className="mx-auto mt-10 h-[2px] w-28 rounded-full bg-white/10" />

          {/* Description */}
          <p
            className="
              mx-auto
              mt-10
              max-w-4xl
              text-xl
              leading-9
              text-zinc-300
            "
          >

            IMNOVA desarrolla tecnologías,
            marcas y experiencias inteligentes
            orientadas al bienestar moderno,
            la innovación funcional
            y la expansión global.

          </p>

        </motion.div>

        {/* =================================================
        MAIN GRID
        ================================================= */}

        <div className="grid gap-8 lg:grid-cols-3">

          {/* =================================================
          LEFT PANEL
          ================================================= */}

          <motion.div
            initial={{
              opacity: 0,
              x: -40,
            }}
            animate={
              isInView
                ? {
                    opacity: 1,
                    x: 0,
                  }
                : {}
            }
            transition={{
              duration: 0.8,
            }}
            className="
              relative
              overflow-hidden
              rounded-[40px]
              border
              border-white/10
              bg-white/[0.04]
              p-8
              backdrop-blur-2xl
              shadow-[0_0_120px_rgba(0,255,255,0.05)]
            "
          >

            {/* Glow */}
            <div className="absolute inset-0 bg-gradient-to-br from-cyan-400/[0.05] via-transparent to-transparent" />

            {/* Ambient Orb */}
            <div className="absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-cyan-400/10 blur-[120px]" />

            <div className="relative z-10">

              {/* Top */}
              <div className="mb-10 flex items-center gap-4">

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

                  <Cpu className="h-7 w-7 text-cyan-300" />

                </div>

                <div>

                  <span className="text-xs uppercase tracking-[0.35em] text-cyan-300">

                    Tecnología

                  </span>

                  <h3 className="mt-2 text-3xl font-black tracking-[-0.03em] text-white">

                    Innovación Estratégica

                  </h3>

                </div>

              </div>

              {/* Metrics */}
              <div className="space-y-5">

                {techMetrics.map((metric, index) => (

                  <motion.div
                    key={metric.label}
                    initial={{
                      opacity: 0,
                      y: 20,
                    }}
                    animate={
                      isInView
                        ? {
                            opacity: 1,
                            y: 0,
                          }
                        : {}
                    }
                    transition={{
                      duration: 0.5,
                      delay: 0.2 + index * 0.1,
                    }}
                    whileHover={{
                      y: -4,
                    }}
                    className="
                      group
                      relative
                      overflow-hidden
                      rounded-[28px]
                      border
                      border-white/10
                      bg-white/[0.04]
                      p-5
                      backdrop-blur-xl
                      transition-all
                      duration-500
                      hover:border-cyan-400/20
                      hover:bg-white/[0.05]
                      hover:shadow-[0_0_50px_rgba(0,255,255,0.08)]
                    "
                  >

                    {/* Hover Glow */}
                    <div className="absolute inset-0 opacity-0 transition duration-500 group-hover:opacity-100 bg-gradient-to-r from-cyan-400/[0.05] via-transparent to-cyan-400/[0.05]" />

                    <div className="relative flex items-center justify-between">

                      {/* Left */}
                      <div className="flex items-center gap-4">

                        <div
                          className="
                            flex
                            h-14
                            w-14
                            items-center
                            justify-center
                            rounded-2xl
                            border
                            border-cyan-400/20
                            bg-cyan-400/10
                          "
                        >

                          <metric.icon className="h-6 w-6 text-cyan-300" />

                        </div>

                        <span className="text-sm text-zinc-400">

                          {metric.label}

                        </span>

                      </div>

                      {/* Value */}
                      <span className="text-3xl font-black tracking-[-0.03em] text-cyan-300">

                        {metric.value}

                      </span>

                    </div>

                  </motion.div>

                ))}

              </div>

            </div>

          </motion.div>

          {/* =================================================
          RIGHT PANEL
          ================================================= */}

          <motion.div
            initial={{
              opacity: 0,
              y: 40,
            }}
            animate={
              isInView
                ? {
                    opacity: 1,
                    y: 0,
                  }
                : {}
            }
            transition={{
              duration: 0.9,
              delay: 0.2,
            }}
            className="
              relative
              overflow-hidden
              rounded-[40px]
              border
              border-white/10
              bg-white/[0.04]
              p-8
              backdrop-blur-2xl
              shadow-[0_0_120px_rgba(0,255,255,0.05)]
              lg:col-span-2
            "
          >

            {/* Glow */}
            <div className="absolute inset-0 bg-gradient-to-br from-cyan-400/[0.04] via-transparent to-transparent" />

            {/* Ambient Orb */}
            <div className="absolute left-1/2 top-1/2 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-400/5 blur-[140px]" />

            <div className="relative z-10">

              {/* Header */}
              <div className="mb-10 flex items-center gap-4">

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

                  <Orbit className="h-7 w-7 text-cyan-300" />

                </div>

                <div>

                  <span className="text-xs uppercase tracking-[0.35em] text-cyan-300">

                    IMNOVA Core

                  </span>

                  <h3 className="mt-2 text-3xl font-black tracking-[-0.03em] text-white">

                    Centro de Innovación

                  </h3>

                </div>

              </div>

              {/* =================================================
              CORE VISUAL
              ================================================= */}

              <div
                className="
                  relative
                  aspect-[16/9]
                  overflow-hidden
                  rounded-[36px]
                  border
                  border-white/10
                  bg-black/30
                "
              >

                {/* Grid */}
                <div className="absolute inset-0 opacity-[0.02] bg-[linear-gradient(rgba(0,255,255,0.10)_1px,transparent_1px),linear-gradient(90deg,rgba(0,255,255,0.10)_1px,transparent_1px)] bg-[size:40px_40px]" />

                {/* Glow */}
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(0,255,255,0.12),transparent_70%)]" />

                {/* Floating Orb */}
                <div className="absolute left-1/2 top-1/2 h-[400px] w-[400px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-400/10 blur-[120px]" />

                {/* =================================================
                CENTRAL SYSTEM
                ================================================= */}

                <div className="absolute inset-0 flex items-center justify-center">

                  {/* Outer Ring */}
                  <motion.div
                    animate={{
                      rotate: 360,
                    }}
                    transition={{
                      duration: 45,
                      repeat: Infinity,
                      ease: "linear",
                    }}
                    className="
                      absolute
                      h-[340px]
                      w-[340px]
                      rounded-full
                      border
                      border-cyan-400/20
                    "
                  />

                  {/* Middle Ring */}
                  <motion.div
                    animate={{
                      rotate: -360,
                    }}
                    transition={{
                      duration: 30,
                      repeat: Infinity,
                      ease: "linear",
                    }}
                    className="
                      absolute
                      h-[260px]
                      w-[260px]
                      rounded-full
                      border
                      border-dashed
                      border-cyan-400/15
                      opacity-40
                    "
                  />

                  {/* Inner Ring */}
                  <motion.div
                    animate={{
                      rotate: 360,
                    }}
                    transition={{
                      duration: 22,
                      repeat: Infinity,
                      ease: "linear",
                    }}
                    className="
                      absolute
                      h-[180px]
                      w-[180px]
                      rounded-full
                      border
                      border-cyan-400/10
                    "
                  />

                  {/* Nodes */}
                  {[0, 60, 120, 180, 240, 300].map(
                    (angle, i) => (

                      <motion.div
                        key={angle}
                        style={{
                          position: "absolute",
                          top: "50%",
                          left: "50%",
                          transform: `rotate(${angle}deg) translateY(-170px) rotate(-${angle}deg)`,
                        }}
                        animate={{
                          scale: [1, 1.4, 1],
                          opacity: [0.6, 1, 0.6],
                        }}
                        transition={{
                          duration: 2.5,
                          repeat: Infinity,
                          delay: i * 0.25,
                        }}
                        className="
                          h-4
                          w-4
                          -ml-2
                          -mt-2
                          rounded-full
                          bg-cyan-300
                          shadow-[0_0_30px_rgba(0,255,255,1)]
                        "
                      />

                    )
                  )}

                  {/* Core */}
                  <motion.div
                    animate={{
                      scale: [1, 1.03, 1],
                    }}
                    transition={{
                      duration: 3,
                      repeat: Infinity,
                    }}
                    className="
                      relative
                      flex
                      h-36
                      w-36
                      items-center
                      justify-center
                      rounded-full
                      border
                      border-cyan-400/20
                      bg-gradient-to-br
                      from-cyan-400/20
                      to-cyan-400/5
                      backdrop-blur-2xl
                      shadow-[0_0_120px_rgba(0,255,255,0.35)]
                    "
                  >

                    {/* Inner Glow */}
                    <div className="absolute inset-0 rounded-full bg-cyan-400/10 blur-3xl" />

                    <Layers3 className="relative z-10 h-14 w-14 text-cyan-300" />

                  </motion.div>

                </div>

                {/* =================================================
                FLOATING BADGES
                ================================================= */}

                <motion.div
                  animate={{
                    y: [-5, 5, -5],
                  }}
                  transition={{
                    duration: 4,
                    repeat: Infinity,
                  }}
                  className="
                    absolute
                    left-6
                    top-6
                    rounded-2xl
                    border
                    border-cyan-400/20
                    bg-black/50
                    px-5
                    py-3
                    text-xs
                    uppercase
                    tracking-[0.2em]
                    text-cyan-200
                    backdrop-blur-2xl
                    shadow-[0_0_40px_rgba(0,255,255,0.08)]
                  "
                >

                  ● Innovación Activa

                </motion.div>

                <motion.div
                  animate={{
                    y: [5, -5, 5],
                  }}
                  transition={{
                    duration: 3.5,
                    repeat: Infinity,
                  }}
                  className="
                    absolute
                    right-6
                    top-6
                    rounded-2xl
                    border
                    border-cyan-400/20
                    bg-black/50
                    px-5
                    py-3
                    text-xs
                    uppercase
                    tracking-[0.2em]
                    text-cyan-200
                    backdrop-blur-2xl
                    shadow-[0_0_40px_rgba(0,255,255,0.08)]
                  "
                >

                  ● Visión Global

                </motion.div>

                <motion.div
                  animate={{
                    y: [-6, 6, -6],
                  }}
                  transition={{
                    duration: 4.5,
                    repeat: Infinity,
                  }}
                  className="
                    absolute
                    bottom-6
                    right-6
                    rounded-2xl
                    border
                    border-cyan-400/20
                    bg-black/50
                    px-5
                    py-3
                    text-xs
                    uppercase
                    tracking-[0.2em]
                    text-cyan-200
                    backdrop-blur-2xl
                    shadow-[0_0_40px_rgba(0,255,255,0.08)]
                  "
                >

                  ● Ecosistema Inteligente

                </motion.div>

              </div>

              {/* =================================================
              STRATEGIC AREAS
              ================================================= */}

              <div className="mt-12">

                <h4 className="mb-6 text-sm uppercase tracking-[0.3em] text-zinc-500">

                  Áreas Estratégicas

                </h4>

                <div className="flex flex-wrap gap-4">

                  {researchAreas.map((area, i) => (

                    <motion.span
                      key={area}
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
                        delay: 0.5 + i * 0.08,
                      }}
                      whileHover={{
                        y: -3,
                      }}
                      className="
                        rounded-full
                        border
                        border-cyan-400/20
                        bg-cyan-400/10
                        px-5
                        py-3
                        text-sm
                        text-cyan-200
                        backdrop-blur-xl
                        transition-all
                        duration-300
                        hover:border-cyan-300/40
                        hover:bg-cyan-400/15
                        hover:shadow-[0_0_30px_rgba(0,255,255,0.10)]
                      "
                    >

                      {area}

                    </motion.span>

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

          <span>Tecnología Inteligente</span>
          <span>•</span>

          <span>Wellness</span>
          <span>•</span>

          <span>Expansión Global</span>

        </div>

      </div>

    </section>
  )
}