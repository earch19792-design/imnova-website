"use client"

/* 
================================================
MENÚ PRINCIPAL
SECCIÓN: ECOSISTEMA
COMPONENTE: EcosystemSection
VERSIÓN: CINEMATIC AI PREMIUM
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
  useState,
} from "react"

import { products } from "@/data/products"

/* =================================================
LIVE PRODUCT TYPE
================================================= */

type Product = {
  id: number
  name: string
  category: string
  status: string
  progress: number
  phase: string
  nextMilestone: string

  theme: {
    glow: string
    border: string
    text: string
    bg: string
  }
}

export function EcosystemSection() {

  const ref = useRef(null)

  const [
    liveProducts,
    setLiveProducts,
  ] = useState<Product[]>(products)

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
  LOAD LIVE DATA
  ================================================= */

  useEffect(() => {

    const loadProducts = () => {

      const updatedProducts =
        products.map((product) => {

          const saved =
            localStorage.getItem(
              `product-${product.id}`
            )

          if (saved) {

            const parsed =
              JSON.parse(saved)

            return {

              ...product,

              status:
                parsed.status,

              progress:
                parsed.progress,

              phase:
                parsed.phase,

              nextMilestone:
                parsed.nextMilestone,

            }

          }

          return product

        })

      setLiveProducts(
        updatedProducts
      )

    }

    loadProducts()

    window.addEventListener(
      "productsUpdated",
      loadProducts as EventListener
    )

    return () => {

      window.removeEventListener(
        "productsUpdated",
        loadProducts as EventListener
      )

    }

  }, [])

  /* =================================================
  MOUSE TRACKING
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
        bg-black
        py-36
        md:py-44
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
            rgba(255,255,255,0.06),
            transparent 35%)`,
        }}
        className="
          pointer-events-none
          absolute
          inset-0
          opacity-70
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
          bg-[size:120px_120px]
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
            y: 30,
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

          {/* =================================================
          LIVE SYSTEM STATUS
          ================================================= */}

          <div
            className="
              mb-10
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

            <span className="relative flex h-2.5 w-2.5">

              <span
                className="
                  absolute
                  inline-flex
                  h-full
                  w-full
                  animate-ping
                  rounded-full
                  bg-green-400
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
                  bg-green-400
                "
              />

            </span>

            <span
              className="
                text-[10px]
                font-medium
                uppercase
                tracking-[0.35em]
                text-white/60
              "
            >

              AI ECOSYSTEM • LIVE SYSTEM ACTIVE

            </span>

          </div>

          {/* =================================================
          TITLE
          ================================================= */}

          <h2
            className="
              mx-auto
              max-w-5xl
              text-5xl
              font-black
              leading-[0.92]
              tracking-[-0.05em]
              text-white
              md:text-7xl
            "
          >

            El Futuro de la

            <span
              className="
                block
                bg-gradient-to-r
                from-white
                via-zinc-200
                to-zinc-400
                bg-clip-text
                text-transparent
              "
            >

              Nutrición Inteligente

            </span>

          </h2>

          {/* =================================================
          DIVIDER
          ================================================= */}

          <div
            className="
              mx-auto
              mt-10
              h-px
              w-24
              rounded-full
              bg-gradient-to-r
              from-transparent
              via-white/30
              to-transparent
            "
          />

          {/* =================================================
          DESCRIPTION
          ================================================= */}

          <p
            className="
              mx-auto
              mt-10
              max-w-3xl
              text-lg
              leading-relaxed
              text-white/50
            "
          >

            Una nueva generación de productos
            desarrollados en tiempo real mediante
            tecnología, automatización e innovación
            evolutiva.

          </p>

        </motion.div>

        {/* =================================================
        PRODUCTS GRID
        ================================================= */}

        <div
          className="
            grid
            gap-8
            md:grid-cols-2
          "
        >

          {liveProducts.map(
            (
              product,
              index
            ) => (

            <motion.div
              key={product.id}
              initial={{
                opacity: 0,
                y: 60,
                filter: "blur(12px)",
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
              className="
                group
                relative
                overflow-hidden
                rounded-[36px]
                border
                border-white/10
                bg-white/[0.03]
                p-8
                backdrop-blur-md
                transition-all
                duration-500
                hover:-translate-y-1
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
                  bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.04),transparent_60%)]
                "
              />

              {/* =========================================
              TOP BAR
              ========================================= */}

              <div
                className="
                  relative
                  z-10
                  flex
                  items-center
                  justify-between
                "
              >

                <div
                  className="
                    inline-flex
                    items-center
                    gap-3
                    rounded-full
                    border
                    border-white/10
                    bg-white/[0.03]
                    px-4
                    py-2
                    text-[10px]
                    uppercase
                    tracking-[0.30em]
                    text-white/50
                  "
                >

                  <div className="h-2 w-2 rounded-full bg-green-400" />

                  LIVE PRODUCT

                </div>

                <div
                  className="
                    text-[10px]
                    uppercase
                    tracking-[0.30em]
                    text-white/35
                  "
                >

                  {product.progress}% SYNCED

                </div>

              </div>

              {/* =========================================
              PRODUCT NAME
              ========================================= */}

              <h3
                className="
                  relative
                  z-10
                  mt-8
                  text-4xl
                  font-black
                  leading-none
                  tracking-[-0.05em]
                  text-white
                "
              >

                {product.name}

              </h3>

              {/* =========================================
              PHASE
              ========================================= */}

              <p
                className="
                  relative
                  z-10
                  mt-5
                  max-w-lg
                  leading-relaxed
                  text-white/55
                "
              >

                {product.phase}

              </p>

              {/* =========================================
              PROGRESS
              ========================================= */}

              <div
                className="
                  relative
                  z-10
                  mt-10
                "
              >

                <div
                  className="
                    mb-4
                    flex
                    items-center
                    justify-between
                  "
                >

                  <span
                    className="
                      text-[10px]
                      uppercase
                      tracking-[0.30em]
                      text-white/35
                    "
                  >

                    DEVELOPMENT

                  </span>

                  <span
                    className="
                      text-sm
                      font-semibold
                      text-white/65
                    "
                  >

                    {product.progress}%

                  </span>

                </div>

                <div
                  className="
                    h-[8px]
                    overflow-hidden
                    rounded-full
                    bg-white/5
                  "
                >

                  <motion.div
                    animate={{
                      width:
                        `${product.progress}%`,
                    }}
                    transition={{
                      duration: 1.2,
                    }}
                    className="
                      h-full
                      rounded-full
                      bg-white/70
                    "
                  />

                </div>

              </div>

              {/* =========================================
              FOOTER
              ========================================= */}

              <div
                className="
                  relative
                  z-10
                  mt-10
                  grid
                  grid-cols-2
                  gap-5
                "
              >

                <div
                  className="
                    rounded-[28px]
                    border
                    border-white/10
                    bg-white/[0.03]
                    p-5
                  "
                >

                  <div
                    className="
                      text-[10px]
                      uppercase
                      tracking-[0.30em]
                      text-white/35
                    "
                  >

                    STATUS

                  </div>

                  <div
                    className="
                      mt-3
                      text-sm
                      font-medium
                      text-white
                    "
                  >

                    {product.status}

                  </div>

                </div>

                <div
                  className="
                    rounded-[28px]
                    border
                    border-white/10
                    bg-white/[0.03]
                    p-5
                  "
                >

                  <div
                    className="
                      text-[10px]
                      uppercase
                      tracking-[0.30em]
                      text-white/35
                    "
                  >

                    NEXT PHASE

                  </div>

                  <div
                    className="
                      mt-3
                      text-sm
                      font-medium
                      text-white
                    "
                  >

                    {product.nextMilestone}

                  </div>

                </div>

              </div>

            </motion.div>

          ))}

        </div>

      </div>

    </section>

  )
}