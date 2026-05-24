"use client"

/* 
================================================
MENÚ PRINCIPAL
SECCIÓN: GLOBAL / EXPANSIÓN INTERNACIONAL
COMPONENTE: GlobalSection
================================================
*/

import { motion, useInView } from "framer-motion"
import { useRef, useState } from "react"

import {
  Globe,
  Rocket,
  Sparkles,
  Orbit,
  Layers3,
} from "lucide-react"

const locations = [
  { name: "Norteamérica", x: 18, y: 45, size: "md" },
  { name: "Latinoamérica", x: 32, y: 65, size: "sm" },
  { name: "Europa", x: 50, y: 30, size: "md" },
  { name: "Medio Oriente", x: 60, y: 42, size: "sm" },
  { name: "Asia Pacífico", x: 78, y: 40, size: "lg" },
]

const stats = [
  {
    label: "Expansión Internacional",
    value: "1+",
    icon: Globe,
  },

  {
    label: "Lanzamientos",
    value: "1+",
    icon: Rocket,
  },

  {
    label: "Innovaciones",
    value: "5",
    icon: Sparkles,
  },

  {
    label: "Presencia Internacional",
    value: "Global",
    icon: Orbit,
  },
]

export function GlobalSection() {

  const ref = useRef(null)

  const isInView = useInView(ref, {
    once: true,
    margin: "-100px",
  })

  const [activeLocation, setActiveLocation] =
    useState<number | null>(null)

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
              Expansión Internacional
            </span>

          </div>

          {/* Title */}
          <h2 className="mx-auto mt-10 max-w-6xl text-5xl font-black leading-[1.02] tracking-[-0.04em] text-white sm:text-6xl lg:text-7xl">

            Diseñando marcas para una{" "}

            <span className="bg-gradient-to-r from-cyan-200 via-cyan-400 to-white bg-clip-text text-transparent">
              nueva generación global
            </span>

          </h2>

          {/* Divider */}
          <div className="mx-auto mt-10 h-[2px] w-28 rounded-full bg-white/10" />

          {/* Description */}
          <p className="mx-auto mt-10 max-w-4xl text-xl leading-9 text-zinc-300">

            IMNOVA desarrolla marcas, tecnologías
            y experiencias premium diseñadas para
            expansión global, innovación funcional
            y nuevas generaciones de consumo inteligente.

          </p>

        </motion.div>

        {/* =================================================
        MAP CONTAINER
        ================================================= */}

        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={isInView ? { opacity: 1, scale: 1 } : {}}
          transition={{ duration: 1 }}
          className="
            relative
            aspect-[2/1]
            overflow-hidden
            rounded-[48px]
            border
            border-cyan-400/10
            bg-white/[0.04]
            p-8
            backdrop-blur-2xl
            shadow-[0_0_120px_rgba(0,255,255,0.08)]
          "
        >

          {/* =================================================
          MAP BACKGROUND
          ================================================= */}

          <div className="absolute inset-0 opacity-40">

            <svg
              viewBox="0 0 100 50"
              className="h-full w-full"
              preserveAspectRatio="xMidYMid slice"
            >

              {/* Decorative Path */}
              <path
                d="M10,25 Q15,20 20,22 Q25,24 30,20 Q35,18 40,22 Q45,26 50,24 Q55,22 60,25 Q65,28 70,25 Q75,22 80,26 Q85,30 90,28"
                stroke="rgba(0,255,255,0.25)"
                strokeWidth="0.25"
                fill="none"
              />

              {/* America */}
              <ellipse
                cx="22"
                cy="40"
                rx="12"
                ry="18"
                fill="rgba(0,255,255,0.05)"
                stroke="rgba(0,255,255,0.18)"
                strokeWidth="0.12"
              />

              {/* Europe */}
              <ellipse
                cx="50"
                cy="38"
                rx="10"
                ry="15"
                fill="rgba(0,255,255,0.05)"
                stroke="rgba(0,255,255,0.18)"
                strokeWidth="0.12"
              />

              {/* Asia */}
              <ellipse
                cx="78"
                cy="40"
                rx="15"
                ry="20"
                fill="rgba(0,255,255,0.05)"
                stroke="rgba(0,255,255,0.18)"
                strokeWidth="0.12"
              />

            </svg>

          </div>

          {/* =================================================
          GRID
          ================================================= */}

          <div className="absolute inset-0 bg-[linear-gradient(rgba(0,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(0,255,255,0.03)_1px,transparent_1px)] bg-[size:5%_10%]" />

          {/* =================================================
          CENTER CORE
          ================================================= */}

          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">

            {/* Ring 1 */}
            <motion.div
              animate={{ rotate: 360 }}
              transition={{
                duration: 35,
                repeat: Infinity,
                ease: "linear",
              }}
              className="
                absolute
                h-56
                w-56
                rounded-full
                border
                border-cyan-400/20
              "
            />

            {/* Ring 2 */}
            <motion.div
              animate={{ rotate: -360 }}
              transition={{
                duration: 25,
                repeat: Infinity,
                ease: "linear",
              }}
              className="
                absolute
                h-40
                w-40
                rounded-full
                border
                border-cyan-400/10
              "
            />

            {/* Core */}
            <div
              className="
                relative
                flex
                h-28
                w-28
                items-center
                justify-center
                rounded-full
                border
                border-cyan-400/20
                bg-cyan-400/10
                shadow-[0_0_80px_rgba(0,255,255,0.35)]
                backdrop-blur-2xl
                animate-pulse
              "
            >

              {/* Inner Glow */}
              <div className="absolute inset-0 rounded-full bg-cyan-400/10 blur-2xl" />

              <Layers3 className="relative z-10 h-10 w-10 text-cyan-300" />

            </div>

          </div>

          {/* =================================================
          LOCATIONS
          ================================================= */}

          {locations.map((location, index) => (

            <motion.div
              key={location.name}
              initial={{ scale: 0, opacity: 0 }}
              animate={
                isInView
                  ? { scale: 1, opacity: 1 }
                  : {}
              }
              transition={{
                duration: 0.5,
                delay: 0.5 + index * 0.1,
              }}
              style={{
                left: `${location.x}%`,
                top: `${location.y}%`,
              }}
              className="
                absolute
                -translate-x-1/2
                -translate-y-1/2
                cursor-pointer
              "
              onMouseEnter={() =>
                setActiveLocation(index)
              }
              onMouseLeave={() =>
                setActiveLocation(null)
              }
            >

              {/* Pulse */}
              <motion.div
                animate={{
                  scale: [1, 1.8, 1],
                  opacity: [0.7, 0, 0.7],
                }}
                transition={{
                  duration: 2.8,
                  repeat: Infinity,
                  delay: index * 0.2,
                }}
                className={`
                  absolute
                  inset-0
                  rounded-full
                  bg-cyan-400
                  ${
                    location.size === "lg"
                      ? "h-10 w-10 -m-5"
                      : location.size === "md"
                      ? "h-8 w-8 -m-4"
                      : "h-6 w-6 -m-3"
                  }
                `}
              />

              {/* Point */}
              <div
                className={`
                  relative
                  rounded-full
                  bg-cyan-300
                  shadow-[0_0_35px_rgba(0,255,255,0.95)]
                  transition-all
                  duration-500
                  ${
                    location.size === "lg"
                      ? "h-6 w-6"
                      : location.size === "md"
                      ? "h-5 w-5"
                      : "h-4 w-4"
                  }
                  ${
                    activeLocation === index
                      ? "scale-150"
                      : ""
                  }
                `}
              />

              {/* Tooltip */}
              {activeLocation === index && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="
                    absolute
                    left-1/2
                    top-full
                    z-20
                    mt-4
                    -translate-x-1/2
                    whitespace-nowrap
                    rounded-2xl
                    border
                    border-cyan-400/20
                    bg-black/80
                    px-5
                    py-3
                    text-xs
                    uppercase
                    tracking-[0.25em]
                    text-cyan-200
                    backdrop-blur-2xl
                    shadow-[0_0_40px_rgba(0,255,255,0.12)]
                  "
                >

                  {location.name}

                </motion.div>
              )}

            </motion.div>

          ))}

          {/* =================================================
          STATS
          ================================================= */}

          <div className="absolute bottom-8 left-8 right-8 grid gap-5 md:grid-cols-4">

            {stats.map((stat, index) => {

              const Icon = stat.icon

              return (
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, y: 20 }}
                  animate={
                    isInView
                      ? { opacity: 1, y: 0 }
                      : {}
                  }
                  transition={{
                    duration: 0.6,
                    delay: 1.3 + index * 0.1,
                  }}
                  className="
                    rounded-[28px]
                    border
                    border-white/10
                    bg-white/[0.04]
                    p-6
                    text-center
                    backdrop-blur-xl
                    transition-all
                    duration-500
                    hover:-translate-y-2
                    hover:border-cyan-400/20
                    hover:bg-white/[0.05]
                  "
                >

                  {/* Icon */}
                  <div className="mb-5 flex justify-center">

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
                        shadow-[0_0_30px_rgba(0,255,255,0.15)]
                      "
                    >

                      <Icon className="h-6 w-6 text-cyan-300" />

                    </div>

                  </div>

                  {/* Value */}
                  <div className="text-4xl font-black tracking-tight text-white sm:text-5xl">

                    {stat.value}

                  </div>

                  {/* Label */}
                  <div className="mt-3 text-xs uppercase tracking-[0.25em] text-zinc-500">

                    {stat.label}

                  </div>

                </motion.div>
              )
            })}

          </div>

        </motion.div>

        {/* =================================================
        BOTTOM INDICATORS
        ================================================= */}

        <div className="mt-20 flex flex-wrap items-center justify-center gap-6 text-center text-xs uppercase tracking-[0.3em] text-zinc-600">

          <span>Innovación</span>
          <span>•</span>

          <span>Retail Global</span>
          <span>•</span>

          <span>Wellness</span>
          <span>•</span>

          <span>Tecnología Inteligente</span>

        </div>

      </div>

    </section>
  )
}