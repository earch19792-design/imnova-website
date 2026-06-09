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
  useState,
} from "react"

import {
  getProducts,
  getProductStates,
} from "@/lib/products-service"

import { supabase } from "@/lib/supabase"

type Product = {
  id: string
  state_id: string | null
  name: string
  category?: string
  description?: string
  slug?: string
  image_url?: string | null
}

type ProductState = {
  id: string
  name: string
}

const initialVisibleItems = 9
const visibleItemsStep = 9

function getDevelopmentBenefit(
  product: Product
) {

  const text =
    [
      product.name,
      product.category,
      product.description,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()

  if (
    text.includes("coffee") ||
    text.includes("café") ||
    text.includes("cafe")
  ) {

    return "Creado para acompañar enfoque, energía limpia y rendimiento diario, integrando nutrición funcional en una experiencia práctica y moderna."

  }

  if (
    text.includes("pancake") ||
    text.includes("waffle") ||
    text.includes("nutri") ||
    text.includes("prote")
  ) {

    return "Pensado para nutrir mejor cada rutina, con una opción práctica que apoya saciedad, energía y bienestar sin complicar el día."

  }

  if (
    text.includes("wellness") ||
    text.includes("bienestar")
  ) {

    return "Diseñado para elevar hábitos cotidianos con una experiencia premium enfocada en equilibrio, vitalidad y bienestar sostenible."

  }

  if (
    text.includes("ai") ||
    text.includes("ia") ||
    text.includes("tech") ||
    text.includes("tecnolog")
  ) {

    return "Desarrollado para simplificar decisiones, potenciar productividad y conectar tecnología inteligente con beneficios reales para la vida diaria."

  }

  return "Diseñado para aportar valor real al bienestar humano, combinando funcionalidad, experiencia premium e innovación lista para escalar."

}

export function InnovationsSection() {

  const [
    commercialProducts,
    setCommercialProducts,
  ] = useState<Product[]>([])

  const [
    developmentProducts,
    setDevelopmentProducts,
  ] = useState<Product[]>([])

  const [
    upcomingSlots,
    setUpcomingSlots,
  ] = useState<number[]>([])

  const [
    visibleItems,
    setVisibleItems,
  ] = useState(initialVisibleItems)

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

  const totalInnovationItems =
    commercialProducts.length +
    developmentProducts.length +
    upcomingSlots.length

  const visibleCommercialProducts =
    commercialProducts.slice(
      0,
      visibleItems
    )

  const remainingAfterCommercial =
    Math.max(
      visibleItems -
        visibleCommercialProducts.length,
      0
    )

  const visibleDevelopmentProducts =
    developmentProducts.slice(
      0,
      remainingAfterCommercial
    )

  const remainingAfterDevelopment =
    Math.max(
      remainingAfterCommercial -
        visibleDevelopmentProducts.length,
      0
    )

  const visibleUpcomingSlots =
    upcomingSlots.slice(
      0,
      remainingAfterDevelopment
    )

  const hasMoreItems =
    visibleItems < totalInnovationItems

  /* =================================================
  LOAD PRODUCTS
  ================================================= */

  useEffect(() => {

    async function loadProducts() {

      const products =
        await getProducts()

      const states =
        await getProductStates()

      const stateMap =
        new Map(
          (states as ProductState[]).map(
            (state) => [
              state.id,
              state.name,
            ]
          )
        )

      const getStateName =
        (product: Product) =>
          product.state_id
            ? stateMap.get(
                product.state_id
              ) || ""
            : ""

      const commercial =
        (products as Product[]).filter(
          (product) =>
            getStateName(product).includes(
              "Comercialización"
            )
        )

      const development =
        (products as Product[]).filter(
          (product) => {

            const stateName =
              getStateName(product)

            return (
              stateName.includes(
                "Desarrollo"
              ) ||
              stateName.includes(
                "Testing"
              ) ||
              stateName.includes(
                "Producción"
              )
            )

          }
        )

      const pendingCount =
        Math.max(
          (products as Product[]).length -
            commercial.length -
            development.length,
          commercial.length === 0 &&
            development.length === 0
            ? 3
            : 0
        )

      setCommercialProducts(
        commercial
      )

      setDevelopmentProducts(
        development
      )

      setVisibleItems(
        initialVisibleItems
      )

      setUpcomingSlots(
        Array.from(
          {
            length:
              pendingCount,
          },
          (_, index) => index
        )
      )

    }

    loadProducts()

    const channel =
      supabase
        .channel(
          "innovations-products"
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "products",
          },
          loadProducts
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table:
              "product_states",
          },
          loadProducts
        )
        .subscribe()

    return () => {

      supabase.removeChannel(channel)

    }

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
            auto-rows-fr
            gap-6
            md:grid-cols-2
            xl:grid-cols-3
          "
        >

          {visibleCommercialProducts.map(
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
                flex
                min-h-[620px]
                flex-col
                overflow-hidden
                rounded-[30px]
                border
                border-white/10
                bg-white/[0.035]
                p-6
                backdrop-blur-md
                transition-all
                duration-500
                hover:border-cyan-200/25
                hover:bg-white/[0.055]
              "
            >

              <div
                className="
                  pointer-events-none
                  absolute
                  inset-0
                  bg-[radial-gradient(circle_at_top,rgba(125,245,255,0.09),transparent_55%)]
                  opacity-0
                  transition-opacity
                  duration-500
                  group-hover:opacity-100
                "
              />

              <div
                className="
                  relative
                  z-10
                  mb-5
                  flex
                  items-center
                  justify-between
                  gap-4
                "
              >

                <span
                  className="
                    rounded-full
                    border
                    border-cyan-200/20
                    bg-cyan-300/[0.08]
                    px-4
                    py-2
                    text-[10px]
                    uppercase
                    tracking-[0.28em]
                    text-cyan-100/80
                    backdrop-blur-md
                  "
                >

                  En comercialización

                </span>

                <span
                  className="
                    text-[10px]
                    uppercase
                    tracking-[0.28em]
                    text-white/35
                  "
                >

                  Live

                </span>

              </div>

              <div
                className="
                  relative
                  overflow-hidden
                  rounded-[26px]
                  border
                  border-white/10
                  bg-black/35
                  p-6
                "
              >

                <div
                  className="
                    absolute
                    inset-0
                    bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.08),transparent_62%)]
                  "
                />

                <div
                  className="
                    relative
                    flex
                    aspect-[4/3]
                    items-center
                    justify-center
                  "
                >

                  <Image
                    src={product.image_url || "/placeholder.jpg"}
                    alt={product.name}
                    width={520}
                    height={420}
                    className="
                      relative
                      z-10
                      h-full
                      w-full
                      object-contain
                      transition-all
                      duration-700
                      group-hover:-translate-y-2
                      group-hover:scale-105
                    "
                  />

                </div>

              </div>

              <div
                className="
                  relative
                  z-10
                  mt-7
                  flex
                  flex-1
                  flex-col
                "
              >

                <p
                  className="
                    text-[10px]
                    uppercase
                    tracking-[0.32em]
                    text-white/35
                  "
                >

                  {product.category || "IMNOVA Product"}

                </p>

                <h3
                  className="
                    mt-4
                    text-3xl
                    font-black
                    leading-tight
                    tracking-[-0.04em]
                    text-white
                    md:text-4xl
                  "
                >

                  {product.name}

                </h3>

                <p
                  className="
                    mt-5
                    line-clamp-3
                    leading-relaxed
                    text-white/50
                  "
                >

                  {product.description ||
                    "Producto funcional IMNOVA en fase comercial."}

                </p>

                <Link
                  href={
                    product.slug
                      ? `/store/${product.slug}`
                      : "/store"
                  }
                  className="
                    mt-auto
                    inline-flex
                    items-center
                    justify-center
                    gap-3
                    rounded-2xl
                    border
                    border-white/10
                    bg-white/[0.04]
                    px-6
                    py-4
                    text-xs
                    font-semibold
                    uppercase
                    tracking-[0.18em]
                    text-white
                    backdrop-blur-md
                    transition-all
                    duration-300
                    hover:scale-[1.02]
                    hover:border-cyan-200/25
                    hover:bg-cyan-300/[0.08]
                  "
                >

                  Ver producto

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

          {visibleDevelopmentProducts.map(
            (
              product,
              index
            ) => (

            <motion.article
              key={`development-${product.id}`}
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
                  (visibleCommercialProducts.length + index) * 0.08,
                ease: [
                  0.22,
                  1,
                  0.36,
                  1,
                ],
              }}
              viewport={{ once: true }}
              whileHover={{
                y: -7,
              }}
              className="
                group
                relative
                flex
                min-h-[620px]
                flex-col
                overflow-hidden
                rounded-[30px]
                border
                border-white/10
                bg-white/[0.025]
                p-6
                backdrop-blur-md
                transition-all
                duration-500
                hover:border-white/25
                hover:bg-white/[0.045]
              "
            >

              <div
                className="
                  pointer-events-none
                  absolute
                  inset-0
                  bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.09),transparent_56%)]
                  opacity-60
                  transition-opacity
                  duration-500
                  group-hover:opacity-100
                "
              />

              <div
                className="
                  relative
                  z-10
                  mb-5
                  flex
                  items-center
                  justify-between
                  gap-4
                "
              >

                <span
                  className="
                    rounded-full
                    border
                    border-white/10
                    bg-white/[0.045]
                    px-4
                    py-2
                    text-[10px]
                    uppercase
                    tracking-[0.28em]
                    text-white/70
                    backdrop-blur-md
                  "
                >

                  En desarrollo

                </span>

                <span
                  className="
                    text-[10px]
                    uppercase
                    tracking-[0.28em]
                    text-white/35
                  "
                >

                  Preview

                </span>

              </div>

              <div
                className="
                  relative
                  overflow-hidden
                  rounded-[26px]
                  border
                  border-white/10
                  bg-black/35
                  p-6
                "
              >

                <div
                  className="
                    absolute
                    inset-0
                    bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.10),transparent_62%)]
                  "
                />

                <div
                  className="
                    relative
                    flex
                    aspect-[4/3]
                    items-center
                    justify-center
                  "
                >

                  <Image
                    src={product.image_url || "/placeholder.jpg"}
                    alt={product.name}
                    width={520}
                    height={420}
                    className="
                      relative
                      z-10
                      h-full
                      w-full
                      object-contain
                      opacity-90
                      transition-all
                      duration-700
                      group-hover:-translate-y-2
                      group-hover:scale-105
                      group-hover:opacity-100
                    "
                  />

                </div>

              </div>

              <div
                className="
                  relative
                  z-10
                  mt-7
                  flex
                  flex-1
                  flex-col
                "
              >

                <p
                  className="
                    text-[10px]
                    uppercase
                    tracking-[0.32em]
                    text-white/35
                  "
                >

                  {product.category || "IMNOVA Product"}

                </p>

                <h3
                  className="
                    mt-4
                    text-3xl
                    font-black
                    leading-tight
                    tracking-[-0.04em]
                    text-white/90
                    md:text-4xl
                  "
                >

                  {product.name}

                </h3>

                <p
                  className="
                    mt-5
                    leading-relaxed
                    text-white/50
                  "
                >

                  {getDevelopmentBenefit(
                    product
                  )}

                </p>

                <div
                  className="
                    mt-auto
                    rounded-2xl
                    border
                    border-white/10
                    bg-white/[0.025]
                    px-6
                    py-4
                    text-center
                    text-xs
                    font-semibold
                    uppercase
                    tracking-[0.18em]
                    text-white/55
                    backdrop-blur-md
                  "
                >

                  Lanzamiento en preparación

                </div>

              </div>

            </motion.article>

          ))}

          {visibleUpcomingSlots.map(
            (
              slot,
              index
            ) => (

            <motion.article
              key={`upcoming-${slot}`}
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
                  (
                    visibleCommercialProducts.length +
                    visibleDevelopmentProducts.length +
                    index
                  ) * 0.08,
                ease: [
                  0.22,
                  1,
                  0.36,
                  1,
                ],
              }}
              viewport={{ once: true }}
              whileHover={{
                y: -6,
              }}
              className="
                group
                relative
                flex
                min-h-[620px]
                flex-col
                overflow-hidden
                rounded-[30px]
                border
                border-white/10
                bg-white/[0.018]
                p-6
                backdrop-blur-md
                transition-all
                duration-500
                hover:border-white/20
                hover:bg-white/[0.035]
              "
            >

              <div
                className="
                  pointer-events-none
                  absolute
                  inset-0
                  bg-[linear-gradient(135deg,rgba(255,255,255,0.08),transparent_35%,rgba(125,245,255,0.05))]
                  opacity-50
                "
              />

              <div
                className="
                  relative
                  z-10
                  mb-5
                  flex
                  items-center
                  justify-between
                  gap-4
                "
              >

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
                    tracking-[0.28em]
                    text-white/45
                    backdrop-blur-md
                  "
                >

                  Próximamente

                </span>

                <Sparkles
                  className="
                    h-5
                    w-5
                    text-white/25
                    transition-all
                    duration-500
                    group-hover:rotate-12
                    group-hover:text-white/45
                  "
                />

              </div>

              <div
                className="
                  relative
                  flex
                  flex-1
                  items-center
                  justify-center
                  overflow-hidden
                  rounded-[26px]
                  border
                  border-dashed
                  border-white/10
                  bg-black/30
                  p-8
                "
              >

                <motion.div
                  animate={{
                    opacity: [0.28, 0.55, 0.28],
                    scale: [1, 1.04, 1],
                  }}
                  transition={{
                    duration: 5,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }}
                  className="
                    absolute
                    h-56
                    w-56
                    rounded-full
                    border
                    border-white/10
                    bg-white/[0.025]
                    blur-sm
                  "
                />

                <div
                  className="
                    relative
                    z-10
                    text-center
                  "
                >

                  <div
                    className="
                      mx-auto
                      flex
                      h-16
                      w-16
                      items-center
                      justify-center
                      rounded-2xl
                      border
                      border-white/10
                      bg-white/[0.04]
                    "
                  >

                    <Sparkles className="h-6 w-6 text-white/40" />

                  </div>

                  <h3
                    className="
                      mt-8
                      text-4xl
                      font-black
                      tracking-[-0.04em]
                      text-white/85
                    "
                  >

                    Próximamente

                  </h3>

                  <p
                    className="
                      mx-auto
                      mt-5
                      max-w-xs
                      text-sm
                      leading-relaxed
                      text-white/45
                    "
                  >

                    Una nueva pieza del ecosistema IMNOVA está por activarse.
                    Pronto revelaremos lo que sigue.

                  </p>

                </div>

              </div>

            </motion.article>

          ))}

        </div>

        {hasMoreItems && (

          <div
            className="
              mt-12
              flex
              justify-center
            "
          >

            <button
              type="button"
              onClick={() =>
                setVisibleItems(
                  (current) =>
                    current +
                    visibleItemsStep
                )
              }
              className="
                rounded-2xl
                border
                border-white/10
                bg-white/[0.035]
                px-7
                py-4
                text-xs
                font-semibold
                uppercase
                tracking-[0.18em]
                text-white/75
                backdrop-blur-md
                transition-all
                duration-300
                hover:border-white/20
                hover:bg-white/[0.06]
                hover:text-white
              "
            >

              Ver más innovaciones

              <span
                className="
                  ml-3
                  text-white/35
                "
              >
                {Math.min(
                  visibleItems,
                  totalInnovationItems
                )}
                /{totalInnovationItems}
              </span>

            </button>

          </div>

        )}

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
