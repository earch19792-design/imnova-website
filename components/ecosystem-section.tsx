"use client"

/* 
================================================
MENÚ PRINCIPAL
SECCIÓN: ECOSISTEMA
COMPONENTE: EcosystemSection
VERSIÓN: PREMIUM REFINED
================================================
*/

import { motion, useInView } from "framer-motion"
import { useEffect, useRef, useState } from "react"

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
        via-zinc-950
        to-black
        py-36
        md:py-44
      "
    >

      {/* =================================================
      BACKGROUND EFFECTS
      ================================================= */}

      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(0,255,255,0.08),transparent_50%)]" />

      <div
        className="
          absolute
          left-1/2
          top-0
          h-[500px]
          w-[500px]
          -translate-x-1/2
          rounded-full
          bg-cyan-400/5
          blur-3xl
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
            duration: 0.8,
          }}
          className="
            mb-24
            text-center
          "
        >

          {/* =================================================
          LIVE SYSTEM STATUS
          ================================================= */}

          <div
            className="
              mb-8
              inline-flex
              items-center
              gap-3
              rounded-full
              border
              border-cyan-400/15
              bg-cyan-400/[0.04]
              px-5
              py-2.5
              backdrop-blur-xl
              shadow-[0_0_30px_rgba(0,255,255,0.05)]
            "
          >

            {/* LIVE DOT */}

            <span className="relative flex h-2.5 w-2.5">

              <span
                className="
                  absolute
                  inline-flex
                  h-full
                  w-full
                  animate-ping
                  rounded-full
                  bg-cyan-400
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
                  bg-cyan-400
                "
              />

            </span>

            <span
              className="
                text-[10px]
                font-medium
                uppercase
                tracking-[0.35em]
                text-cyan-300
              "
            >

              SISTEMA ACTIVO™ · INNOVACIÓN EN TIEMPO REAL

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
              leading-[0.95]
              tracking-[-0.04em]
              text-white
              md:text-7xl
            "
          >

            EL FUTURO DE LA

            <span
              className="
                block
                text-cyan-400
              "
            >

              NUTRICIÓN

            </span>

          </h2>

          {/* =================================================
          DIVIDER
          ================================================= */}

          <div
            className="
              mx-auto
              mt-8
              h-px
              w-24
              rounded-full
              bg-gradient-to-r
              from-transparent
              via-cyan-400/40
              to-transparent
            "
          />

          {/* =================================================
          DESCRIPTION
          ================================================= */}

          <p
            className="
              mx-auto
              mt-8
              max-w-3xl
              text-base
              leading-relaxed
              text-zinc-400
              md:text-lg
            "
          >

            Una nueva generación de productos
            desarrollados públicamente en tiempo real
            por IMNOVA™.

          </p>

        </motion.div>

        {/* =================================================
        PRODUCTS GRID
        ================================================= */}

        <div
          className="
            grid
            gap-7
            md:grid-cols-2
          "
        >

          {liveProducts.map((product) => (

            <motion.div
              key={product.id}
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
                duration: 0.7,
              }}
              className={`
                relative
                overflow-hidden
                rounded-[32px]
                border
                ${product.theme.border}

                ${
                  product.progress <= 20
                    ? "opacity-70"

                    : product.progress <= 40
                    ? "opacity-80"

                    : product.progress <= 60
                    ? "opacity-90"

                    : "opacity-100"
                }

                bg-white/[0.025]
                p-7
                backdrop-blur-2xl

                ${
                  product.progress <= 20

                    ? "shadow-[0_0_25px_rgba(0,255,255,0.02)]"

                    : product.progress <= 40

                    ? "shadow-[0_0_40px_rgba(0,255,255,0.04)]"

                    : product.progress <= 60

                    ? "shadow-[0_0_60px_rgba(0,255,255,0.06)]"

                    : product.progress <= 80

                    ? "shadow-[0_0_90px_rgba(0,255,255,0.10)]"

                    : "shadow-[0_0_120px_rgba(0,255,255,0.14)]"
                }

                transition-all
                duration-500

                hover:scale-[1.015]
                hover:-translate-y-1
                hover:border-cyan-400/30
              `}
            >

              {/* =================================================
              SCAN LINE
              ================================================= */}

              <div
                className="
                  pointer-events-none
                  absolute
                  inset-0
                  overflow-hidden
                  rounded-[32px]
                "
              >

                <div
                  className="
                    absolute
                    left-0
                    top-0
                    h-px
                    w-full
                    bg-cyan-400/20
                    blur-sm
                    animate-[scan_6s_linear_infinite]
                  "
                />

              </div>

              {/* =================================================
              CATEGORY
              ================================================= */}

              <div
                className={`
                  inline-flex
                  items-center
                  rounded-full
                  border
                  ${product.theme.border}
                  ${product.theme.bg}
                  px-4
                  py-2
                  text-[10px]
                  font-semibold
                  uppercase
                  tracking-[0.28em]
                  ${product.theme.text}
                `}
              >

                {product.category}

              </div>

              {/* =================================================
              LIVE STATUS
              ================================================= */}

              <div
                className={`
                  mt-5
                  inline-flex
                  items-center
                  gap-3
                  rounded-full
                  border
                  px-4
                  py-2
                  text-[10px]
                  font-semibold
                  uppercase
                  tracking-[0.25em]

                  ${
                    product.progress <= 20
                      ? "border-cyan-400/20 bg-cyan-400/10 text-cyan-300"

                      : product.progress <= 40
                      ? "border-orange-400/20 bg-orange-400/10 text-orange-300"

                      : product.progress <= 60
                      ? "border-yellow-400/20 bg-yellow-400/10 text-yellow-300"

                      : product.progress <= 80
                      ? "border-purple-400/20 bg-purple-400/10 text-purple-300"

                      : "border-green-400/20 bg-green-400/10 text-green-300"
                  }
                `}
              >

                <span className="relative flex h-2 w-2">

                  <span
                    className="
                      absolute
                      inline-flex
                      h-full
                      w-full
                      animate-ping
                      rounded-full
                      bg-current
                      opacity-75
                    "
                  />

                  <span
                    className="
                      relative
                      inline-flex
                      h-2
                      w-2
                      rounded-full
                      bg-current
                    "
                  />

                </span>

                {

                  product.progress <= 20
                    ? "💡 CONCEPTO"

                    : product.progress <= 40
                    ? "⚙ EN CONSTRUCCIÓN"

                    : product.progress <= 60
                    ? "🧪 EN PRUEBAS"

                    : product.progress <= 80
                    ? "⚡ OPTIMIZANDO"

                    : "🚀 LANZAMIENTO CERCANO"

                }

              </div>

              {/* =================================================
              PRODUCT NAME
              ================================================= */}

              <h3
                className="
                  mt-6
                  text-3xl
                  font-black
                  tracking-[-0.03em]
                  text-white
                  md:text-4xl
                "
              >

                {product.name}

              </h3>

              {/* =================================================
              DESCRIPTION
              ================================================= */}

              <p
                className="
                  mt-4
                  max-w-lg
                  text-sm
                  leading-relaxed
                  text-zinc-400
                  md:text-base
                "
              >

                {product.phase}

              </p>

              {/* =================================================
              PROGRESS
              ================================================= */}

              <div className="mt-10">

                <div
                  className="
                    mb-3
                    flex
                    items-center
                    justify-between
                  "
                >

                  <span
                    className="
                      text-xs
                      uppercase
                      tracking-[0.2em]
                      text-zinc-500
                    "
                  >

                    Desarrollo Global

                  </span>

                  <span
                    className={`
                      text-sm
                      font-semibold
                      ${product.theme.text}
                    `}
                  >

                    {product.progress}%

                  </span>

                </div>

                <div
                  className="
                    h-2.5
                    overflow-hidden
                    rounded-full
                    bg-white/10
                  "
                >

                  <motion.div
                    animate={{
                      width:
                        `${product.progress}%`,
                    }}
                    transition={{
                      duration: 1,
                    }}
                    className={`
                      h-full
                      rounded-full
                      bg-gradient-to-r
                      ${product.theme.glow}
                    `}
                  />

                </div>

              </div>

              {/* =================================================
              FOOTER
              ================================================= */}

              <div
                className="
                  mt-8
                  flex
                  items-center
                  justify-between
                  border-t
                  border-white/5
                  pt-6
                "
              >

                <div>

                  <p
                    className="
                      text-[10px]
                      uppercase
                      tracking-[0.25em]
                      text-zinc-500
                    "
                  >

                    Estado Público

                  </p>

                  <p
                    className={`
                      mt-2
                      text-sm
                      font-medium
                      ${product.theme.text}
                    `}
                  >

                    {product.status}

                  </p>

                </div>

                <div className="text-right">

                  <p
                    className="
                      text-[10px]
                      uppercase
                      tracking-[0.25em]
                      text-zinc-500
                    "
                  >

                    Próxima Revelación

                  </p>

                  <p
                    className={`
                      mt-2
                      text-sm
                      font-medium
                      ${product.theme.text}
                    `}
                  >

                    {product.nextMilestone}

                  </p>

                </div>

              </div>

            </motion.div>

          ))}

        </div>

      </div>

    </section>

  )
}