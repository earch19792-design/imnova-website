"use client"

/* 
================================================
MENÚ PRINCIPAL
SECCIÓN: INNOVACIONES
COMPONENTE: InnovationsSection
VERSIÓN: CINEMATIC PREMIUM AI
================================================
*/

import Image from "next/image"
import Link from "next/link"

import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
} from "framer-motion"

import {
  Sparkles,
  ArrowUpRight,
} from "lucide-react"

import {
  useEffect,
} from "react"

import products from "../lib/products"

export function InnovationsSection() {

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
      id="innovations"
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
      MOUSE REACTIVE LIGHT
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
          opacity: [0.3, 0.6, 0.3],
          scale: [1, 1.08, 1],
        }}
        transition={{
          duration: 12,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        className="
          pointer-events-none
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
          whileInView={{
            opacity: 1,
            y: 0,
            filter: "blur(0px)",
          }}
          transition={{
            duration: 1,
            ease: [0.22, 1, 0.36, 1],
          }}
          viewport={{ once: true }}
          className="mb-32 text-center"
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
              px-6
              py-3
              backdrop-blur-md
            "
          >

            <Sparkles
              className="
                h-4
                w-4
                text-white/60
              "
            />

            <span
              className="
                text-[10px]
                uppercase
                tracking-[0.40em]
                text-white/60
              "
            >

              IMNOVA ECOSYSTEM

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
              leading-[0.95]
              tracking-[-0.06em]
              text-white
              sm:text-6xl
              lg:text-7xl
            "
          >

            Diseñamos el Futuro

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

              mediante innovación real.

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

            Nutrición funcional, tecnología
            inteligente y sistemas premium
            desarrollados para redefinir la
            evolución humana.

          </p>

        </motion.div>

        {/* =================================================
        PRODUCT GRID
        ================================================= */}

        <div
          className="
            grid
            gap-8
            lg:grid-cols-3
          "
        >

          {products.slice(0, 3).map(
            (
              product,
              index
            ) => (

            <motion.article
              key={product.id}
              initial={{
                opacity: 0,
                y: 60,
                filter: "blur(12px)",
              }}
              whileInView={{
                opacity: 1,
                y: 0,
                filter: "blur(0px)",
              }}
              transition={{
                duration: 0.9,
                delay:
                  index * 0.08,
                ease: [
                  0.22,
                  1,
                  0.36,
                  1,
                ],
              }}
              viewport={{ once: true }}
              whileHover={{
                y: -8,
              }}
              className="
                group
                relative
                overflow-hidden
                rounded-[36px]
                border
                border-white/10
                bg-white/[0.03]
                p-7
                backdrop-blur-md
                transition-all
                duration-500
                hover:border-white/20
                hover:bg-white/[0.05]
              "
            >

              {/* =========================================
              CARD LIGHTING
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
              TOP BAR
              ========================================= */}

              <div
                className="
                  relative
                  z-10
                  mb-6
                  flex
                  items-center
                  justify-between
                "
              >

                {/* CATEGORY */}

                <span
                  className="
                    rounded-full
                    border
                    border-white/10
                    bg-white/[0.03]
                    px-4
                    py-2
                    text-[10px]
                    uppercase
                    tracking-[0.35em]
                    text-white/55
                    backdrop-blur-md
                  "
                >

                  {product.category}

                </span>

                {/* ICON */}

                <Sparkles
                  className="
                    h-5
                    w-5
                    text-white/40
                    transition-all
                    duration-500
                    group-hover:rotate-12
                    group-hover:scale-110
                  "
                />

              </div>

              {/* =========================================
              IMAGE CONTAINER
              ========================================= */}

              <div
                className="
                  relative
                  overflow-hidden
                  rounded-[32px]
                  border
                  border-white/10
                  bg-white/[0.03]
                  p-8
                  backdrop-blur-md
                "
              >

                {/* AMBIENT LIGHT */}

                <div
                  className="
                    absolute
                    inset-0
                    bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.06),transparent_65%)]
                  "
                />

                {/* FLOATING ORB */}

                <motion.div
                  animate={{
                    scale: [1, 1.08, 1],
                    opacity: [0.3, 0.5, 0.3],
                  }}
                  transition={{
                    duration: 6,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }}
                  className="
                    absolute
                    left-1/2
                    top-1/2
                    h-[260px]
                    w-[260px]
                    -translate-x-1/2
                    -translate-y-1/2
                    rounded-full
                    bg-white/[0.04]
                    blur-[100px]
                  "
                />

                {/* IMAGE */}

                <div
                  className="
                    relative
                    flex
                    h-[360px]
                    items-center
                    justify-center
                  "
                >

                  <Image
                    src={product.image}
                    alt={product.name}
                    width={420}
                    height={420}
                    className={`
                      relative
                      z-10
                      h-full
                      w-auto
                      object-contain
                      transition-all
                      duration-700
                      group-hover:-translate-y-2
                      group-hover:scale-105
                      ${
                        product.slug === "mash-coffee"
                          ? "scale-[1.45]"
                          : "scale-100"
                      }
                    `}
                  />

                </div>

              </div>

              {/* =========================================
              CONTENT
              ========================================= */}

              <div
                className="
                  relative
                  z-10
                  mt-8
                  flex
                  flex-col
                "
              >

                {/* PRODUCT NAME */}

                <h3
                  className="
                    text-4xl
                    font-black
                    tracking-[-0.05em]
                    text-white
                  "
                >

                  {product.name}

                </h3>

                {/* DESCRIPTION */}

                <p
                  className="
                    mt-5
                    leading-relaxed
                    text-white/50
                  "
                >

                  {product.description}

                </p>

                {/* CTA */}

                <Link
                  href={`/store/${product.slug}`}
                  className="
                    mt-8
                    inline-flex
                    items-center
                    justify-center
                    gap-3
                    rounded-2xl
                    border
                    border-white/10
                    bg-white/[0.03]
                    px-6
                    py-4
                    text-sm
                    font-semibold
                    uppercase
                    tracking-[0.18em]
                    text-white
                    backdrop-blur-md
                    transition-all
                    duration-300
                    hover:scale-[1.02]
                    hover:border-white/20
                    hover:bg-white/[0.06]
                  "
                >

                  Explorar Innovación

                  <ArrowUpRight
                    className="
                      h-4
                      w-4
                      transition-transform
                      duration-300
                      group-hover:translate-x-1
                      group-hover:-translate-y-1
                    "
                  />

                </Link>

              </div>

            </motion.article>

          ))}

        </div>

        {/* =================================================
        BOTTOM INDICATORS
        ================================================= */}

        <div
          className="
            mt-28
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

          <span>Innovación</span>
          <span>•</span>

          <span>Wellness</span>
          <span>•</span>

          <span>AI Systems</span>
          <span>•</span>

          <span>Expansión Global</span>

        </div>

      </div>

    </section>
  )
}