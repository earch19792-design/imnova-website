"use client"

/* 
================================================
MENÚ PRINCIPAL
SECCIÓN: FUTURE / VISIÓN DE FUTURO
COMPONENTE: FutureSection
VERSIÓN: AI CINEMATIC PREMIUM
================================================
*/

import {
  motion,
  useInView,
  useMotionValue,
  useSpring,
  useTransform,
} from "framer-motion"

import {
  useEffect,
  useRef,
} from "react"

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

  /* =================================================
  MOUSE REACTIVE LIGHTING
  ================================================= */

  const mouseX =
    useMotionValue(0)

  const mouseY =
    useMotionValue(0)

  const smoothMouseX =
    useSpring(mouseX, {
      stiffness: 120,
      damping: 20,
    })

  const smoothMouseY =
    useSpring(mouseY, {
      stiffness: 120,
      damping: 20,
    })

  const glowX =
    useTransform(
      smoothMouseX,
      [-500, 500],
      ["45%", "55%"]
    )

  const glowY =
    useTransform(
      smoothMouseY,
      [-500, 500],
      ["45%", "55%"]
    )

  /* =================================================
  GLOBAL MOUSE TRACKING
  ================================================= */

  useEffect(() => {

    const handleMouseMove =
      (e: MouseEvent) => {

        const centerX =
          window.innerWidth / 2

        const centerY =
          window.innerHeight / 2

        mouseX.set(
          e.clientX - centerX
        )

        mouseY.set(
          e.clientY - centerY
        )

      }

    window.addEventListener(
      "mousemove",
      handleMouseMove
    )

    return () => {

      window.removeEventListener(
        "mousemove",
        handleMouseMove
      )

    }

  }, [mouseX, mouseY])

  return (

    <section
      id="future"
      ref={ref}
      className="
        relative
        isolate
        overflow-hidden
        bg-black
        py-44
        md:py-52
      "
    >

      {/* =================================================
      BASE BACKGROUND
      ================================================= */}

      <div className="absolute inset-0 bg-black" />

      {/* =================================================
      REACTIVE LIGHT
      ================================================= */}

      <motion.div
        style={{
          background:
            `radial-gradient(circle at ${glowX} ${glowY},
            rgba(255,255,255,0.05),
            transparent 35%)`,
        }}
        className="
          pointer-events-none
          absolute
          inset-0
          opacity-80
          blur-3xl
        "
      />

      {/* =================================================
      AMBIENT LIGHTING
      ================================================= */}

      <motion.div
        animate={{
          opacity: [0.25, 0.5, 0.25],
          scale: [1, 1.08, 1],
        }}
        transition={{
          duration: 14,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        className="
          absolute
          left-1/2
          top-0
          h-[800px]
          w-[800px]
          -translate-x-1/2
          rounded-full
          bg-white/[0.03]
          blur-[180px]
        "
      />

      {/* =================================================
      SECONDARY ORB
      ================================================= */}

      <motion.div
        animate={{
          x: [0, 60, 0],
          y: [0, -40, 0],
        }}
        transition={{
          duration: 20,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        className="
          absolute
          right-[-100px]
          top-[20%]
          h-[400px]
          w-[400px]
          rounded-full
          bg-white/[0.02]
          blur-[140px]
        "
      />

      {/* =================================================
      GRID
      ================================================= */}

      <div
        className="
          absolute
          inset-0
          opacity-[0.015]
          bg-[linear-gradient(rgba(255,255,255,0.10)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.10)_1px,transparent_1px)]
          bg-[size:120px_120px]
        "
      />

      {/* =================================================
      TOP DIVIDER
      ================================================= */}

      <div
        className="
          absolute
          left-0
          right-0
          top-0
          h-px
          bg-gradient-to-r
          from-transparent
          via-white/10
          to-transparent
        "
      />

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
            filter: "blur(10px)",
          }}
          animate={
            isInView
              ? {
                  opacity: 1,
                  y: 0,
                  filter: "blur(0px)",
                }
              : {}
          }
          transition={{
            duration: 1,
            ease: [0.22, 1, 0.36, 1],
          }}
          className="
            mb-28
            text-center
          "
        >

          {/* BADGE */}

          <div
            className="
              inline-flex
              items-center
              gap-3
              rounded-full
              border
              border-white/10
              bg-white/[0.03]
              px-5
              py-3
              backdrop-blur-md
            "
          >

            <div
              className="
                relative
                flex
                h-2.5
                w-2.5
              "
            >

              <span
                className="
                  absolute
                  inline-flex
                  h-full
                  w-full
                  animate-ping
                  rounded-full
                  bg-white/70
                  opacity-75
                "
              />

              <span
                className="
                  relative
                  inline-flex
                  h-2.5
                  w-2.5
                  rounded-full
                  bg-white
                "
              />

            </div>

            <span
              className="
                text-[10px]
                uppercase
                tracking-[0.35em]
                text-white/60
              "
            >

              FUTURE VISION • AI WELLNESS

            </span>

          </div>

          {/* TITLE */}

          <h2
            className="
              mx-auto
              mt-12
              max-w-6xl
              text-5xl
              font-black
              leading-[0.92]
              tracking-[-0.06em]
              text-white
              sm:text-6xl
              lg:text-7xl
            "
          >

            Innovación Inteligente

            <span
              className="
                block
                bg-gradient-to-r
                from-white
                via-zinc-200
                to-zinc-500
                bg-clip-text
                text-transparent
              "
            >

              para el Futuro Humano

            </span>

          </h2>

          {/* DIVIDER */}

          <div
            className="
              mx-auto
              mt-10
              h-px
              w-28
              rounded-full
              bg-gradient-to-r
              from-transparent
              via-white/20
              to-transparent
            "
          />

          {/* DESCRIPTION */}

          <p
            className="
              mx-auto
              mt-10
              max-w-4xl
              text-xl
              leading-relaxed
              text-white/50
            "
          >

            Creamos tecnología, nutrición funcional
            y sistemas inteligentes diseñados para
            impulsar bienestar, rendimiento y una
            nueva generación de experiencias premium.

          </p>

        </motion.div>

        {/* =================================================
        FUTURE GRID
        ================================================= */}

        <div
          className="
            grid
            gap-8
            md:grid-cols-2
            lg:grid-cols-3
          "
        >

          {futureVisions.map(
            (
              vision,
              index
            ) => (

            <motion.div
              key={vision.title}
              initial={{
                opacity: 0,
                y: 50,
                filter: "blur(10px)",
              }}
              animate={
                isInView
                  ? {
                      opacity: 1,
                      y: 0,
                      filter: "blur(0px)",
                    }
                  : {}
              }
              transition={{
                duration: 0.8,
                delay:
                  index * 0.08,
                ease: [
                  0.22,
                  1,
                  0.36,
                  1,
                ],
              }}
              whileHover={{
                y: -6,
              }}
              className="
                group
                relative
              "
            >

              <div
                className="
                  relative
                  h-full
                  overflow-hidden
                  rounded-[36px]
                  border
                  border-white/10
                  bg-white/[0.03]
                  p-8
                  backdrop-blur-md
                  transition-all
                  duration-500
                  hover:border-white/20
                  hover:bg-white/[0.05]
                "
              >

                {/* =========================================
                CARD LIGHT
                ========================================= */}

                <div
                  className="
                    pointer-events-none
                    absolute
                    inset-0
                    bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.05),transparent_60%)]
                  "
                />

                {/* =========================================
                FLOATING LIGHT
                ========================================= */}

                <div
                  className="
                    absolute
                    right-0
                    top-0
                    h-40
                    w-40
                    rounded-full
                    bg-white/[0.03]
                    blur-3xl
                    opacity-0
                    transition-opacity
                    duration-500
                    group-hover:opacity-100
                  "
                />

                <div className="relative z-10">

                  {/* ICON */}

                  <motion.div
                    whileHover={{
                      scale: 1.05,
                      rotate: 4,
                    }}
                    className="
                      mb-8
                      flex
                      h-16
                      w-16
                      items-center
                      justify-center
                      rounded-[24px]
                      border
                      border-white/10
                      bg-white/[0.03]
                      backdrop-blur-md
                    "
                  >

                    <vision.icon
                      className="
                        h-7
                        w-7
                        text-white/70
                      "
                    />

                  </motion.div>

                  {/* TITLE */}

                  <h3
                    className="
                      text-3xl
                      font-black
                      leading-tight
                      tracking-[-0.04em]
                      text-white
                    "
                  >

                    {vision.title}

                  </h3>

                  {/* DESCRIPTION */}

                  <p
                    className="
                      mt-6
                      leading-relaxed
                      text-white/50
                    "
                  >

                    {vision.description}

                  </p>

                </div>

              </div>

            </motion.div>

          ))}

        </div>

        {/* =================================================
        BOTTOM INDICATORS
        ================================================= */}

        <div
          className="
            mt-24
            flex
            flex-wrap
            items-center
            justify-center
            gap-6
            text-center
            text-[10px]
            uppercase
            tracking-[0.35em]
            text-white/30
          "
        >

          <span>AI SYSTEMS</span>
          <span>•</span>

          <span>WELLNESS</span>
          <span>•</span>

          <span>PERFORMANCE</span>
          <span>•</span>

          <span>GLOBAL EXPANSION</span>

        </div>

      </div>

    </section>

  )

}