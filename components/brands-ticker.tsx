"use client"

/* 
================================================
MENÚ PRINCIPAL
SECCIÓN: ECOSISTEMA
COMPONENTE: EcosystemSection
================================================
*/

import { motion, useInView } from "framer-motion"
import { useRef } from "react"
import Image from "next/image"

import {
  Droplets,
  Cpu,
  Brain,
  Heart,
  Sparkles,
  Leaf,
  ArrowUpRight,
} from "lucide-react"

const ecosystemItems = [
  {
    icon: Droplets,
    title: "Bebidas Funcionales",
    description:
      "Fórmulas avanzadas enfocadas en energía, bienestar y rendimiento premium.",
    gradient: "from-blue-500/20 to-cyan-500/20",
  },

  {
    icon: Cpu,
    title: "Tecnología Aplicada",
    description:
      "Dispositivos inteligentes y soluciones modernas diseñadas para el futuro.",
    gradient: "from-purple-500/20 to-pink-500/20",
  },

  {
    icon: Brain,
    title: "Soluciones con IA",
    description:
      "Tecnologías impulsadas por inteligencia artificial para automatización, optimización y experiencias inteligentes.",
    gradient: "from-cyan-500/20 to-indigo-500/20",
  },

  {
    icon: Heart,
    title: "Bienestar del Futuro",
    description:
      "Innovaciones enfocadas en salud, lifestyle y experiencias premium orientadas al bienestar moderno.",
    gradient: "from-rose-500/20 to-orange-500/20",
  },

  {
    icon: Sparkles,
    title: "Lifestyle Premium",
    description:
      "Productos y accesorios diseñados para elevar la experiencia cotidiana mediante diseño y funcionalidad.",
    gradient: "from-amber-500/20 to-yellow-500/20",
  },

  {
    icon: Leaf,
    title: "Tecnología Sostenible",
    description:
      "Soluciones eco-friendly orientadas a eficiencia, sostenibilidad y nuevas generaciones de consumo responsable.",
    gradient: "from-green-500/20 to-emerald-500/20",
  },
]

const brandLogos = [
  "/brands-ticker/mashcoffee.png",
  "/brands-ticker/glowcafe.png",
  "/brands-ticker/fitcharge.png",
  "/brands-ticker/roadcharge.png",
  "/brands-ticker/thermoguard.png",
  "/brands-ticker/ecoclean.png",
  "/brands-ticker/safeplug.png",
  "/brands-ticker/smartdry.png",
]

export function EcosystemSection() {

  const ref = useRef(null)

  const isInView = useInView(ref, {
    once: true,
    margin: "-100px",
  })

  return (
    <section
      id="ecosystem"
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

      {/* Ambient Glow */}
      <div className="absolute left-1/2 top-1/2 h-[900px] w-[900px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-400/5 blur-[180px]" />

      {/* Divider */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

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
              Ecosistema Global IMNOVA™
            </span>

          </div>

          {/* Title */}
          <h2 className="mx-auto mt-10 max-w-6xl text-5xl font-black leading-[1.02] tracking-[-0.04em] text-white sm:text-6xl lg:text-7xl">

            Innovaciones diseñadas para{" "}

            <span className="bg-gradient-to-r from-cyan-200 via-cyan-400 to-white bg-clip-text text-transparent">
              retail y distribución global
            </span>

          </h2>

          {/* Divider */}
          <div className="mx-auto mt-10 h-[2px] w-28 rounded-full bg-white/10" />

          {/* Description */}
          <p className="mx-auto mt-10 max-w-4xl text-xl leading-9 text-zinc-300">

            Marcas, productos y tecnologías desarrolladas
            para expansión comercial, licensing internacional
            y nuevas generaciones de innovación orientadas
            al bienestar y rendimiento moderno.

          </p>

        </motion.div>

        {/* =================================================
        PREMIUM LOGO TICKER
        ================================================= */}

        <div
          className="
            relative
            overflow-hidden
            rounded-[40px]
            border
            border-cyan-400/10
            bg-white/[0.04]
            py-16
            md:py-20
            backdrop-blur-2xl
            shadow-[0_0_100px_rgba(0,255,255,0.05)]
            mb-28
          "
        >

          {/* Glow Overlay */}
          <div className="absolute inset-0 bg-cyan-400/[0.03]" />

          {/* Left Fade */}
          <div className="absolute left-0 top-0 z-20 h-full w-44 bg-gradient-to-r from-black to-transparent md:w-56" />

          {/* Right Fade */}
          <div className="absolute right-0 top-0 z-20 h-full w-44 bg-gradient-to-l from-black to-transparent md:w-56" />

          {/* Moving Logos */}
          <motion.div
            animate={{ x: ["0%", "-50%"] }}
            transition={{
              duration: 35,
              repeat: Infinity,
              ease: "linear",
            }}
            className="flex w-max items-center gap-16 whitespace-nowrap md:gap-20"
          >

            {[...brandLogos, ...brandLogos].map((logo, index) => (

              <div
                key={`${logo}-${index}`}
                className="flex min-w-[240px] items-center justify-center md:min-w-[300px]"
              >

                <Image
                  src={logo}
                  alt="Brand Logo"
                  width={320}
                  height={140}
                  className="
                    h-24
                    md:h-32
                    w-auto
                    object-contain
                    opacity-100
                    transition-all
                    duration-500
                    hover:scale-105
                    drop-shadow-[0_0_25px_rgba(0,255,255,0.15)]
                  "
                />

              </div>

            ))}

          </motion.div>

        </div>

        {/* =================================================
        ECOSYSTEM CARDS
        ================================================= */}

        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">

          {ecosystemItems.map((item, index) => (

            <motion.div
              key={item.title}
              initial={{ opacity: 0, y: 40 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{
                duration: 0.7,
                delay: index * 0.1,
              }}
              whileHover={{
                y: -8,
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
                  hover:shadow-[0_0_80px_rgba(0,255,255,0.05)]
                "
              >

                {/* Gradient */}
                <div
                  className={`
                    absolute
                    inset-0
                    bg-gradient-to-br
                    ${item.gradient}
                    opacity-0
                    transition-opacity
                    duration-500
                    group-hover:opacity-100
                  `}
                />

                {/* Glow */}
                <div className="absolute right-0 top-0 h-40 w-40 rounded-full bg-cyan-400/10 blur-3xl opacity-0 transition-opacity duration-500 group-hover:opacity-100" />

                <div className="relative z-10">

                  {/* Icon */}
                  <div
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
                      transition-transform
                      duration-500
                      group-hover:scale-110
                    "
                  >

                    <item.icon className="h-8 w-8 text-cyan-300" />

                  </div>

                  {/* Content */}
                  <h3 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-white">

                    {item.title}

                    <ArrowUpRight
                      className="
                        h-5
                        w-5
                        opacity-0
                        -translate-x-2
                        transition-all
                        duration-300
                        group-hover:translate-x-0
                        group-hover:opacity-100
                      "
                    />

                  </h3>

                  <p className="mt-5 text-base leading-8 text-zinc-400">

                    {item.description}

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

          <span>Retail Global</span>
          <span>•</span>

          <span>Tecnología Inteligente</span>

        </div>

      </div>

    </section>
  )
}