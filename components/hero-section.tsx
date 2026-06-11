"use client"

import {
  motion,
  AnimatePresence,
  useScroll,
  useTransform,
  useMotionValue,
  useSpring,
} from "framer-motion"

import {
  useEffect,
  useState,
} from "react"

import {
  ChevronDown,
  MapPin,
  ShoppingBag,
  Sparkles,
  UsersRound,
} from "lucide-react"

const heroImages = [
  "/hero/imnova-hero-01.webp",
  "/hero/imnova-hero-02.webp",
  "/hero/imnova-hero-03.webp",
]

const officialPillars = [
  {
    label: "Quiénes somos",
    text:
      "IMNOVA es un ecosistema de tecnología, nutrición funcional y bienestar creado para desarrollar soluciones útiles para la vida diaria.",
  },
  {
    label: "Nuestro objetivo",
    text:
      "Ayudar a las personas a vivir mejor, rendir más y construir una rutina simple, saludable y equilibrada.",
  },
  {
    label: "Cómo evoluciona",
    text:
      "Cada producto avanza por validación comunitaria, producción, disponibilidad, canales de compra y experiencia de uso.",
  },
]

const heroJourney = [
  {
    label: "Quiénes somos",
    title: "IMNOVA",
    text: "Tecnología, nutrición y bienestar aplicados a soluciones reales para la rutina diaria.",
    href: "#hero",
    icon: Sparkles,
  },
  {
    label: "Compra hoy",
    title: "Lanzamientos",
    text: "Productos disponibles con presentación clara, precio y acceso directo a compra.",
    href: "#available-now",
    icon: ShoppingBag,
  },
  {
    label: "Dónde comprar",
    title: "Canales",
    text: "Encuentra store, marketplaces o distribuidores autorizados cerca de ti.",
    href: "#where-to-buy",
    icon: MapPin,
  },
  {
    label: "Lo que viene",
    title: "Comunidad",
    text: "Participa en ideas que se validan antes de convertirse en productos IMNOVA.",
    href: "#innovations",
    icon: UsersRound,
  },
]

export function HeroSection() {

  const [
    currentImage,
    setCurrentImage,
  ] = useState(0)

  /* =================================================
  SCROLL SYSTEM
  ================================================= */

  const { scrollY } =
    useScroll()

  const y =
    useTransform(
      scrollY,
      [0, 700],
      [0, 180]
    )

  const opacity =
    useTransform(
      scrollY,
      [0, 400],
      [1, 0.94]
    )

  /* =================================================
  MOUSE REACTIVE LIGHT
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
  IMAGE ROTATION
  ================================================= */

  useEffect(() => {

    const interval =
      setInterval(() => {

        setCurrentImage(
          (prev) =>
            (prev + 1) %
            heroImages.length
        )

      }, 8000)

    return () =>
      clearInterval(interval)

  }, [])

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
      id="hero"
      className="
        relative
        isolate
        min-h-screen
        overflow-hidden
        bg-black
      "
    >

      {/* =================================================
      BACKGROUND SLIDER
      ================================================= */}

      <div className="absolute inset-0">

        <AnimatePresence mode="wait">

          <motion.div
            key={currentImage}
            initial={{
              opacity: 0,
              scale: 1.12,
            }}
            animate={{
              opacity: 1,
              scale: 1.02,
            }}
            exit={{
              opacity: 0,
            }}
            transition={{
              duration: 2,
              ease: [0.22, 1, 0.36, 1],
            }}
            className="
              absolute
              inset-0
              bg-cover
              bg-center
              will-change-transform
            "
            style={{
              backgroundImage:
                `url(${heroImages[currentImage]})`,
            }}
          />

        </AnimatePresence>

        {/* =================================================
        CINEMATIC OVERLAYS
        ================================================= */}

        <div
          className="
            absolute
            inset-0
            bg-gradient-to-r
            from-black/82
            via-black/52
            to-black/16
          "
        />

        <div
          className="
            absolute
            inset-0
            bg-[radial-gradient(circle_at_left,rgba(0,0,0,0.88),transparent_54%)]
          "
        />

        <div
          className="
            absolute
            inset-0
            bg-gradient-to-b
            from-black/10
            via-transparent
            to-black
          "
        />

        {/* =================================================
        REACTIVE LIGHT
        ================================================= */}

        <motion.div
          style={{
            background:
              `radial-gradient(circle at ${glowX} ${glowY},
              rgba(255,255,255,0.08),
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
        AMBIENT ORBS
        ================================================= */}

        <motion.div
          animate={{
            opacity: [0.25, 0.45, 0.25],
            scale: [1, 1.08, 1],
          }}
          transition={{
            duration: 10,
            repeat: Infinity,
            ease: "easeInOut",
          }}
          className="
            absolute
            left-1/2
            top-0
            h-[700px]
            w-[700px]
            -translate-x-1/2
            rounded-full
            bg-white/[0.03]
            blur-[180px]
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
            bg-[size:160px_160px]
          "
        />

      </div>

      {/* =================================================
      FLOATING AI ORBS
      ================================================= */}

      <motion.div
        animate={{
          y: [-10, 10, -10],
        }}
        transition={{
          duration: 6,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        className="
          absolute
          right-[8%]
          top-[22%]
          hidden
          h-36
          w-36
          rounded-full
          border
          border-white/10
          bg-white/[0.03]
          backdrop-blur-xl
          lg:block
        "
      >

        <div
          className="
            absolute
            inset-0
            rounded-full
            bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_65%)]
          "
        />

      </motion.div>

      <motion.div
        animate={{
          y: [10, -10, 10],
        }}
        transition={{
          duration: 8,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        className="
          absolute
          bottom-[18%]
          right-[16%]
          hidden
          h-20
          w-20
          rounded-full
          border
          border-white/10
          bg-white/[0.03]
          backdrop-blur-xl
          lg:block
        "
      />

      {/* =================================================
      CONTENT
      ================================================= */}

      <motion.div
        style={{
          y,
          opacity,
        }}
        className="
          relative
          z-10
          mx-auto
          flex
          min-h-screen
          max-w-7xl
          items-center
          px-6
          pt-28
          pb-36
          sm:px-8
          sm:pt-36
          sm:pb-24
          lg:px-12
        "
      >

        <div className="grid w-full gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(340px,0.58fr)] lg:items-center">

          <div>

            <motion.div
              initial={{
                opacity: 0,
                y: 24,
                filter: "blur(8px)",
              }}
              animate={{
                opacity: 1,
                y: 0,
                filter: "blur(0px)",
              }}
              transition={{
                duration: 1,
                ease: [0.22, 1, 0.36, 1],
              }}
              className="
                mb-6
                inline-flex
                rounded-full
                border
                border-cyan-200/25
                bg-cyan-300/[0.10]
                px-5
                py-3
                text-[10px]
                font-semibold
                uppercase
                tracking-[0.26em]
                text-cyan-50
                backdrop-blur-xl
              "
            >
              IMNOVA · Tecnología · Nutrición · Bienestar
            </motion.div>

            {/* =================================================
            TITLE
            ================================================= */}

            <motion.h1
              initial={{
                opacity: 0,
                y: 50,
                filter: "blur(12px)",
              }}
              animate={{
                opacity: 1,
                y: 0,
                filter: "blur(0px)",
              }}
              transition={{
                duration: 1.2,
                delay: 0.1,
                ease: [0.22, 1, 0.36, 1],
              }}
              className="
                max-w-5xl
                text-4xl
                font-black
                leading-[0.96]
                tracking-[-0.05em]
                text-white
                min-[390px]:text-5xl
                sm:text-6xl
                md:text-7xl
                lg:text-[5.3rem]
              "
            >

              IMNOVA

              <span
                className="
                  block
                  max-w-4xl
                  bg-gradient-to-r
                  from-white
                  via-cyan-100
                  to-zinc-300
                  bg-clip-text
                  pt-3
                  text-[2.35rem]
                  leading-[1.02]
                  tracking-[-0.035em]
                  text-transparent
                  min-[390px]:text-4xl
                  sm:text-5xl
                  md:text-6xl
                "
              >

                Tecnología, nutrición y bienestar para vivir mejor.

              </span>

            </motion.h1>

            {/* =================================================
            DESCRIPTION
            ================================================= */}

            <motion.p
              initial={{
                opacity: 0,
                y: 30,
                filter: "blur(10px)",
              }}
              animate={{
                opacity: 1,
                y: 0,
                filter: "blur(0px)",
              }}
              transition={{
                duration: 1.2,
                delay: 0.25,
                ease: [0.22, 1, 0.36, 1],
              }}
              className="
                mt-7
                max-w-2xl
                text-base
                leading-8
                text-white/78
                sm:text-lg
              "
            >

              Creamos soluciones inteligentes que integran
              tecnología, nutrición y bienestar para ayudar
              a las personas a vivir mejor, rendir más y
              construir una rutina diaria más simple,
              saludable y equilibrada.

            </motion.p>

            <motion.div
              initial={{
                opacity: 0,
                y: 18,
              }}
              animate={{
                opacity: 1,
                y: 0,
              }}
              transition={{
                duration: 1,
                delay: 0.52,
              }}
              className="relative z-30 mt-8 flex flex-wrap gap-3 pb-2"
            >
              <a
                href="#available-now"
                className="inline-flex items-center justify-center rounded-2xl border border-cyan-200/25 bg-cyan-300/[0.14] px-6 py-4 text-[11px] font-black uppercase tracking-[0.18em] text-cyan-50 transition hover:border-cyan-200/45 hover:bg-cyan-300/[0.20]"
              >
                Ver productos
              </a>

              <a
                href="#imnova-guides"
                className="inline-flex items-center justify-center rounded-2xl border border-white/15 bg-white/[0.06] px-6 py-4 text-[11px] font-black uppercase tracking-[0.18em] text-white/82 transition hover:border-white/25 hover:bg-white/[0.09] hover:text-white"
              >
                Ideas de uso
              </a>

              <a
                href="#innovations"
                className="inline-flex items-center justify-center rounded-2xl border border-amber-200/20 bg-amber-200/[0.10] px-6 py-4 text-[11px] font-black uppercase tracking-[0.18em] text-amber-50 transition hover:border-amber-200/40 hover:bg-amber-200/[0.16]"
              >
                Participar
              </a>
            </motion.div>

            <motion.div
              initial={{
                opacity: 0,
                y: 24,
              }}
              animate={{
                opacity: 1,
                y: 0,
              }}
              transition={{
                duration: 1,
                delay: 0.64,
              }}
              className="mt-7 grid max-w-5xl gap-3 sm:grid-cols-2 xl:grid-cols-4"
            >
              {heroJourney.map(item => {
                const Icon =
                  item.icon

                return (
                  <a
                    key={item.title}
                    href={item.href}
                    className="group rounded-[22px] border border-white/10 bg-black/48 p-4 text-left shadow-[0_22px_80px_rgba(0,0,0,0.22)] backdrop-blur-2xl transition hover:-translate-y-0.5 hover:border-cyan-200/25 hover:bg-white/[0.055]"
                  >
                    <div className="flex items-center gap-3">
                      <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-cyan-200/15 bg-cyan-300/[0.10] text-cyan-100 transition group-hover:border-cyan-200/35 group-hover:bg-cyan-300/[0.16]">
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="text-[9px] font-black uppercase tracking-[0.24em] text-cyan-100/65">
                        {item.label}
                      </span>
                    </div>

                    <p className="mt-4 text-sm font-black uppercase tracking-[0.12em] text-white">
                      {item.title}
                    </p>
                    <p className="mt-2 text-xs leading-5 text-white/58">
                      {item.text}
                    </p>
                  </a>
                )
              })}
            </motion.div>

          </div>

          <motion.div
            initial={{
              opacity: 0,
              x: 34,
              filter: "blur(10px)",
            }}
            animate={{
              opacity: 1,
              x: 0,
              filter: "blur(0px)",
            }}
            transition={{
              duration: 1.1,
              delay: 0.38,
              ease: [0.22, 1, 0.36, 1],
            }}
            className="grid gap-3"
          >
            {officialPillars.map(
              pillar => (
                <div
                  key={pillar.label}
                  className="
                    rounded-[26px]
                    border
                    border-white/12
                    bg-black/55
                    p-5
                    shadow-[0_24px_90px_rgba(0,0,0,0.28)]
                    backdrop-blur-2xl
                  "
                >
                  <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-100">
                    {pillar.label}
                  </p>
                  <p className="mt-4 text-sm leading-7 text-white/74">
                    {pillar.text}
                  </p>
                </div>
              )
            )}
          </motion.div>

        </div>

      </motion.div>

      {/* =================================================
      SCROLL INDICATOR
      ================================================= */}

      <motion.div
        animate={{
          y: [0, 10, 0],
        }}
        transition={{
          duration: 2,
          repeat: Infinity,
        }}
        className="
          absolute
          bottom-10
          left-1/2
          z-20
          -translate-x-1/2
        "
      >

        <div
          className="
            flex
            flex-col
            items-center
            gap-3
            text-white/35
          "
        >

          <span
            className="
              text-[10px]
              uppercase
              tracking-[0.35em]
            "
          >

            Scroll

          </span>

          <ChevronDown
            className="
              h-5
              w-5
            "
          />

        </div>

      </motion.div>

    </section>
  )
}

