"use client"

import { motion, AnimatePresence } from "framer-motion"
import { useEffect, useState } from "react"

const heroImages = [
  "/hero/imnova-hero-01.webp",
  "/hero/imnova-hero-02.webp",
  "/hero/imnova-hero-03.webp",
]

export function HeroSection() {
  const [currentImage, setCurrentImage] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentImage((prev) => (prev + 1) % heroImages.length)
    }, 8000)

    return () => clearInterval(interval)
  }, [])

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

      {/* =========================================
      BACKGROUND SLIDER
      ========================================= */}

      <div className="absolute inset-0">

        <AnimatePresence mode="wait">

          <motion.div
            key={currentImage}
            initial={{
              opacity: 0,
              scale: 1.05,
            }}
            animate={{
              opacity: 1,
              scale: 1.01,
            }}
            exit={{
              opacity: 0,
            }}
            transition={{
              duration: 1.4,
              ease: "easeInOut",
            }}
            className="
              absolute
              inset-0
              bg-cover
              bg-center
            "
            style={{
              backgroundImage: `url(${heroImages[currentImage]})`,
            }}
          />

        </AnimatePresence>

        {/* DARK OVERLAY */}

        <div
          className="
            absolute
            inset-0
            bg-gradient-to-r
            from-black/75
            via-black/50
            to-transparent
          "
        />

        {/* EXTRA DEPTH */}

        <div
          className="
            absolute
            inset-0
            bg-[radial-gradient(circle_at_left,rgba(0,0,0,0.92),transparent_45%)]
          "
        />

        {/* CYAN GLOW */}

        <div
          className="
            absolute
            inset-0
            bg-[radial-gradient(circle_at_top_right,rgba(0,255,255,0.10),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(59,130,246,0.08),transparent_35%)]
          "
        />

        {/* VIGNETTE */}

        <div
          className="
            absolute
            inset-0
            bg-gradient-to-b
            from-black/10
            via-transparent
            to-black/85
          "
        />

        {/* GRID */}

        <div
          className="
            absolute
            inset-0
            opacity-[0.02]
            bg-[linear-gradient(rgba(255,255,255,0.10)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.10)_1px,transparent_1px)]
            bg-[size:160px_160px]
          "
        />

      </div>

      {/* =========================================
      CONTENT
      ========================================= */}

      <div
        className="
          relative
          z-10
          mx-auto
          flex
          min-h-screen
          max-w-7xl
          items-center
          px-6
          sm:px-8
          lg:px-12
          pt-32
          pb-24
        "
      >

        <div className="max-w-4xl">

          {/* =========================================
          BADGE
          ========================================= */}

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
              duration: 0.8,
            }}
            className="
              mb-8
              inline-flex
              items-center
              gap-3
              rounded-full
              border
              border-cyan-400/20
              bg-white/[0.04]
              px-5
              py-3
              backdrop-blur-xl
            "
          >

            <div className="h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_20px_rgba(0,255,255,0.8)]" />

            <span
              className="
                text-[10px]
                uppercase
                tracking-[0.35em]
                text-cyan-300
              "
            >

              Tecnología y Bienestar del Futuro

            </span>

          </motion.div>

          {/* =========================================
          TITLE
          ========================================= */}

          <motion.h1
            initial={{
              opacity: 0,
              y: 40,
            }}
            animate={{
              opacity: 1,
              y: 0,
            }}
            transition={{
              duration: 1,
              delay: 0.1,
            }}
            className="
              text-5xl
              sm:text-6xl
              md:text-7xl
              lg:text-[5.2rem]
              xl:text-[6rem]
              font-black
              leading-[0.88]
              tracking-[-0.07em]
              text-white
              max-w-5xl
            "
          >

            Tecnología.

            <span
              className="
                block
                bg-gradient-to-r
                from-cyan-200
                via-blue-300
                to-white
                bg-clip-text
                text-transparent
              "
            >

              Nutrición.

            </span>

            <span className="block text-zinc-200">

              Evolución.

            </span>

          </motion.h1>

          {/* =========================================
          DESCRIPTION
          ========================================= */}

          <motion.p
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
              delay: 0.25,
            }}
            className="
              mt-10
              max-w-2xl
              text-lg
              sm:text-xl
              leading-8
              text-zinc-300
            "
          >

            Creamos productos y ecosistemas de nueva generación
            que integran tecnología, bienestar y nutrición funcional.

          </motion.p>

          {/* =========================================
          INDICATORS
          ========================================= */}

          <div className="mt-14 flex gap-3">

            {heroImages.map((_, index) => (
              <div
                key={index}
                className={`
                  h-[4px]
                  rounded-full
                  transition-all
                  duration-700

                  ${
                    currentImage === index
                      ? "w-16 bg-cyan-300"
                      : "w-6 bg-white/20"
                  }
                `}
              />
            ))}

          </div>

        </div>

      </div>

      {/* =========================================
      BOTTOM FADE
      ========================================= */}

      <div className="absolute bottom-0 left-0 right-0 h-40 bg-gradient-to-t from-black to-transparent" />

    </section>
  )
}