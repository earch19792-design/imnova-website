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
} from "lucide-react"

const heroImages = [
  "/hero/imnova-hero-01.webp",
  "/hero/imnova-hero-02.webp",
  "/hero/imnova-hero-03.webp",
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
      [1, 0.4]
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
            from-black/88
            via-black/58
            to-black/20
          "
        />

        <div
          className="
            absolute
            inset-0
            bg-[radial-gradient(circle_at_left,rgba(0,0,0,0.96),transparent_50%)]
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
          pt-32
          pb-24
          sm:px-8
          lg:px-12
        "
      >

        <div className="max-w-5xl">

          {/* =================================================
          BADGE
          ================================================= */}

          <motion.div
            initial={{
              opacity: 0,
              y: 20,
              filter: "blur(10px)",
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
              mb-8
              inline-flex
              items-center
              gap-3
              rounded-full
              border
              border-white/10
              bg-white/[0.04]
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
                  bg-white/80
                "
              />

            </div>

            <span
              className="
                text-[10px]
                uppercase
                tracking-[0.35em]
                text-white/70
              "
            >

              IMNOVA™ • AI WELLNESS SYSTEM

            </span>

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
              max-w-6xl
              text-5xl
              font-black
              leading-[0.88]
              tracking-[-0.06em]
              text-white
              sm:text-6xl
              md:text-7xl
              lg:text-[5.4rem]
              xl:text-[6.4rem]
            "
          >

            Construimos

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

              Tecnología Humana

            </span>

            <span
              className="
                block
                text-zinc-300
              "
            >

              del Futuro.

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
              mt-10
              max-w-2xl
              text-lg
              leading-8
              text-white/60
              sm:text-xl
            "
          >

            Creamos ecosistemas inteligentes
            donde tecnología, nutrición y
            bienestar evolucionan juntos
            para redefinir la experiencia humana.

          </motion.p>

          {/* =================================================
          BUTTONS
          ================================================= */}

          <motion.div
            initial={{
              opacity: 0,
              y: 20,
            }}
            animate={{
              opacity: 1,
              y: 0,
            }}
            transition={{
              duration: 1,
              delay: 0.4,
            }}
            className="
              mt-12
              flex
              flex-wrap
              gap-4
            "
          >

            <button
              className="
                rounded-2xl
                bg-white
                px-8
                py-4
                text-sm
                font-semibold
                uppercase
                tracking-[0.18em]
                text-black
                transition-all
                duration-300
                hover:scale-[1.02]
                hover:bg-zinc-200
                active:scale-[0.98]
              "
            >

              Explorar Ecosistema

            </button>

            <button
              className="
                rounded-2xl
                border
                border-white/10
                bg-white/[0.03]
                px-8
                py-4
                text-sm
                font-semibold
                uppercase
                tracking-[0.18em]
                text-white
                backdrop-blur-md
                transition-all
                duration-300
                hover:border-white/20
                hover:bg-white/[0.06]
                active:scale-[0.98]
              "
            >

              Ver Tecnología

            </button>

          </motion.div>

          {/* =================================================
          LIVE METRICS
          ================================================= */}

          <motion.div
            initial={{
              opacity: 0,
              y: 20,
            }}
            animate={{
              opacity: 1,
              y: 0,
            }}
            transition={{
              duration: 1,
              delay: 0.55,
            }}
            className="
              mt-16
              flex
              flex-wrap
              gap-6
            "
          >

            {[
              "AI SYSTEMS",
              "WELLNESS",
              "GLOBAL EXPANSION",
            ].map((item) => (

              <div
                key={item}
                className="
                  rounded-full
                  border
                  border-white/10
                  bg-white/[0.03]
                  px-5
                  py-3
                  text-[10px]
                  uppercase
                  tracking-[0.30em]
                  text-white/45
                  backdrop-blur-md
                "
              >

                {item}

              </div>

            ))}

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