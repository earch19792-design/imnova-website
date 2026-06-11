"use client"

import Link from "next/link"

import { motion } from "framer-motion"

import {
  useEffect,
  useState,
} from "react"

import {
  ArrowUpRight,
  Sparkles,
} from "lucide-react"

import {
  getAvailableProducts,
} from "@/lib/products-service"

import { supabase } from "@/lib/supabase"

type Product = {
  id: string
  state_id: string | null
  name: string
  category?: string
  description?: string
  slug?: string
  image?: string | null
  image_url?: string | null
  price?: number | string | null
  currency?: string | null
  direct_url?: string | null
  amazon_url?: string | null
  ebay_url?: string | null
  tiktok_url?: string | null
}

const MAX_LAUNCH_PRODUCTS = 12

function getProductImage(
  product: Product
) {

  return (
    product.image_url ||
    product.image ||
    "/placeholder.jpg"
  )

}

function getPurchaseHref(
  product: Product
) {

  return (
    (
      product.slug
        ? `/store#product-${product.slug}`
        : "/store"
    )
  )

}

function isExternalUrl(
  href: string
) {

  return href.startsWith("http")

}

function getLaunchBenefit(
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

    return "Café funcional premium con vitaminas, colágeno marino y extractos herbales, diseñado para apoyar energía natural del café, bienestar diario y una rutina sin azúcar."

  }

  if (
    text.includes("pancake") ||
    text.includes("waffle") ||
    text.includes("nutri") ||
    text.includes("prote")
  ) {

    return "Nutrición práctica para apoyar saciedad, energía diaria y mejores hábitos desde la primera comida."

  }

  if (
    text.includes("wellness") ||
    text.includes("bienestar")
  ) {

    return "Una experiencia premium creada para elevar equilibrio, vitalidad y bienestar cotidiano."

  }

  return (
    product.description ||
    "Innovación funcional lista para integrarse a una rutina más inteligente, práctica y premium."
  )

}

function getPriceDisplay(
  product: Product
) {

  if (
    product.price === null ||
    product.price === undefined ||
    product.price === ""
  ) {

    return null

  }

  const rawPrice =
    String(product.price).trim()

  const amount =
    rawPrice
      .replace(
        /^(usd|us\$|\$)\s*/i,
        ""
      )
      .trim()

  const currency =
    (
      product.currency ||
      "USD"
    )
      .trim()
      .toUpperCase()

  const isUsd =
    currency === "USD" ||
    currency === "$" ||
    currency === "US$"

  return {
    amount,
    currencyLabel:
      isUsd
        ? "USD"
        : currency,
    symbol:
      isUsd
        ? "$"
        : "",
  }

}

export function PromoBanner() {

  const [
    products,
    setProducts,
  ] = useState<Product[]>([])

  const [
    activeIndex,
    setActiveIndex,
  ] = useState(0)

  const [
    hasLoadedProducts,
    setHasLoadedProducts,
  ] = useState(false)

  useEffect(() => {

    async function loadProducts() {

      const availableProducts =
        await getAvailableProducts(
          {
            limit:
              MAX_LAUNCH_PRODUCTS,
          }
        )

      setProducts(
        availableProducts as Product[]
      )
      setActiveIndex(0)
      setHasLoadedProducts(true)

    }

    loadProducts()

    const channel =
      supabase
        .channel(
          "promo-available-products"
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

  useEffect(() => {

    if (products.length <= 1) {

      return

    }

    const interval =
      window.setInterval(
        () => {

          setActiveIndex(
            (current) =>
              (current + 1) %
              products.length
          )

        },
        6000
      )

    return () =>
      window.clearInterval(interval)

  }, [products.length])

  if (!hasLoadedProducts) {

    return (
      <section
        id="available-now"
        className="relative overflow-hidden py-28 md:py-36"
      >
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-black via-[#050505] to-black" />
          <div className="absolute left-0 top-0 h-[560px] w-[560px] rounded-full bg-amber-500/10 blur-[160px]" />
          <div className="absolute bottom-0 right-0 h-[560px] w-[560px] rounded-full bg-orange-500/10 blur-[160px]" />
        </div>

        <div className="relative z-10 mx-auto max-w-7xl px-6">
          <div className="max-w-3xl rounded-[32px] border border-amber-300/15 bg-white/[0.035] p-8 backdrop-blur-2xl md:p-10">
            <div className="inline-flex items-center gap-3 rounded-full border border-amber-400/25 bg-amber-400/10 px-5 py-3">
              <Sparkles className="h-4 w-4 text-amber-300" />
              <span className="text-xs uppercase tracking-[0.28em] text-amber-300">
                Producto disponible
              </span>
            </div>

            <h2 className="mt-8 text-4xl font-black leading-tight tracking-[-0.04em] text-white md:text-6xl">
              Cargando disponibilidad
            </h2>

            <p className="mt-5 max-w-2xl text-base leading-8 text-zinc-400">
              Estamos preparando el producto activo, su precio y el acceso a la
              Store oficial.
            </p>
          </div>
        </div>
      </section>
    )

  }

  if (products.length === 0) {

    return null

  }

  const activeProduct =
    products[
      activeIndex %
        products.length
    ]

  const purchaseHref =
    getPurchaseHref(activeProduct)

  const isExternal =
    isExternalUrl(purchaseHref)

  const activePrice =
    getPriceDisplay(activeProduct)

  return (
    <section
      id="available-now"
      className="relative overflow-hidden py-36 md:py-44"
    >

      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-black via-[#050505] to-black" />
        <div className="absolute left-0 top-0 h-[700px] w-[700px] rounded-full bg-amber-500/10 blur-[180px]" />
        <div className="absolute bottom-0 right-0 h-[700px] w-[700px] rounded-full bg-orange-500/10 blur-[180px]" />
        <div className="absolute inset-0 opacity-[0.02] bg-[linear-gradient(rgba(251,191,36,0.10)_1px,transparent_1px),linear-gradient(90deg,rgba(251,191,36,0.10)_1px,transparent_1px)] bg-[size:90px_90px]" />
      </div>

      <div className="relative z-10 mx-auto max-w-7xl px-6">

        <motion.div
          initial={{
            opacity: 0,
            y: 36,
          }}
          whileInView={{
            opacity: 1,
            y: 0,
          }}
          transition={{
            duration: 0.9,
          }}
          viewport={{ once: true }}
          className="mb-14 max-w-4xl"
        >

          <div
            className="
              inline-flex
              items-center
              gap-3
              rounded-full
              border
              border-amber-400/30
              bg-amber-400/10
              px-5
              py-3
              backdrop-blur-xl
            "
          >

            <Sparkles className="h-4 w-4 text-amber-300" />

            <span
              className="
                text-xs
                uppercase
                tracking-[0.38em]
                text-amber-300
              "
            >
              Producto disponible
            </span>

          </div>

          <h2
            className="
              mt-10
              text-5xl
              font-black
              leading-[0.95]
              tracking-[-0.05em]
              text-white
              sm:text-7xl
            "
          >
            Ya disponible
            <span className="block bg-gradient-to-r from-amber-300 via-orange-400 to-orange-500 bg-clip-text text-transparent">
              en el mercado
            </span>
          </h2>

          <p
            className="
              mt-8
              max-w-3xl
              text-xl
              leading-9
              text-zinc-300
            "
          >
            Producto IMNOVA disponible para compra. Revisa precio, beneficio
            principal y acceso directo a la Store oficial.
          </p>

        </motion.div>

        <motion.article
          key={activeProduct.id}
          initial={{
            opacity: 0,
            y: 36,
            filter: "blur(12px)",
          }}
          animate={{
            opacity: 1,
            y: 0,
            filter: "blur(0px)",
          }}
          transition={{
            duration: 0.7,
            ease: [0.22, 1, 0.36, 1],
          }}
          className="
            group
            relative
            overflow-hidden
            rounded-[42px]
            border
            border-amber-300/15
            bg-black/45
            p-6
            shadow-[0_30px_140px_rgba(0,0,0,0.42)]
            backdrop-blur-2xl
            md:p-8
          "
        >

          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.18),transparent_36%),radial-gradient(circle_at_bottom_right,rgba(249,115,22,0.16),transparent_42%)]" />
          <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/70 to-black/85" />
          <div className="absolute inset-0 opacity-[0.02] bg-[url('/noise.png')]" />

          <div
            className="
              relative
              z-10
              grid
              gap-10
              lg:grid-cols-[1.05fr_0.95fr]
              lg:items-center
            "
          >

            <div>

              <div className="flex flex-wrap items-center gap-3">

                <span
                  className="
                    rounded-full
                    border
                    border-amber-300/25
                    bg-amber-300/10
                    px-4
                    py-2
                    text-[10px]
                    uppercase
                    tracking-[0.26em]
                    text-amber-200
                  "
                >
                  Disponible ahora
                </span>

                <span
                  className="
                    rounded-full
                    bg-gradient-to-r
                    from-amber-300
                    to-orange-500
                    px-4
                    py-2
                    text-[10px]
                    font-black
                    uppercase
                    tracking-[0.16em]
                    text-black
                  "
                >
                  Oferta de lanzamiento
                </span>

              </div>

              <p
                className="
                  mt-8
                  text-[10px]
                  uppercase
                  tracking-[0.34em]
                  text-amber-200/60
                "
              >
                {activeProduct.category || "IMNOVA Launch"}
              </p>

              <h3
                className="
                  mt-4
                  text-5xl
                  font-black
                  leading-[0.92]
                  tracking-[-0.055em]
                  text-white
                  md:text-7xl
                "
              >
                {activeProduct.name}
              </h3>

              <p
                className="
                  mt-7
                  max-w-2xl
                  text-xl
                  leading-9
                  text-zinc-300
                "
              >
                {getLaunchBenefit(activeProduct)}
              </p>

              <div
                className="
                  mt-9
                  grid
                  gap-4
                  md:grid-cols-[1fr_auto]
                  md:items-stretch
                "
              >

                <div
                  className="
                    rounded-[30px]
                    border
                    border-amber-300/15
                    bg-black/35
                    p-6
                  "
                >

                  <p
                    className="
                      text-[10px]
                      uppercase
                      tracking-[0.30em]
                      text-amber-300
                    "
                  >
                    Promoción de lanzamiento
                  </p>

                  <p
                    className="
                      mt-3
                      text-5xl
                      font-black
                      leading-none
                      tracking-[-0.04em]
                      text-white
                    "
                  >
                    10% - 15% OFF
                  </p>

                  <p className="mt-4 text-sm leading-relaxed text-zinc-400">
                    Oferta por tiempo limitado o hasta agotar existencias.
                  </p>

                </div>

                {activePrice && (
                  <div
                    className="
                      flex
                      min-w-[230px]
                      flex-col
                      justify-center
                      rounded-[30px]
                      border
                      border-white/10
                      bg-black/35
                      p-6
                      text-center
                    "
                  >
                    <span className="text-sm text-zinc-400">
                      Desde
                    </span>
                    <div
                      className="
                        mt-3
                        flex
                        items-end
                        justify-center
                        gap-2
                        text-amber-300
                      "
                    >
                      <span
                        className="
                          pb-1.5
                          text-sm
                          font-black
                          uppercase
                          tracking-[0.18em]
                          text-amber-200/80
                        "
                      >
                        {activePrice.currencyLabel}
                      </span>
                      {activePrice.symbol && (
                        <span
                          className="
                            text-4xl
                            font-black
                            leading-none
                            tracking-[-0.02em]
                            text-amber-300
                          "
                        >
                          {activePrice.symbol}
                        </span>
                      )}
                      <span
                        className="
                          text-5xl
                          font-black
                          leading-none
                          tracking-[-0.04em]
                          text-amber-300
                        "
                      >
                        {activePrice.amount}
                      </span>
                    </div>
                  </div>
                )}

              </div>

              <div
                className="
                  mt-9
                  flex
                  flex-col
                  gap-4
                  sm:flex-row
                  sm:items-center
                "
              >

                <Link
                  href={purchaseHref}
                  target={
                    isExternal
                      ? "_blank"
                      : undefined
                  }
                  rel={
                    isExternal
                      ? "noreferrer"
                      : undefined
                  }
                  className="
                    inline-flex
                    items-center
                    justify-center
                    gap-3
                    rounded-3xl
                    bg-gradient-to-r
                    from-amber-400
                    to-orange-500
                    px-8
                    py-5
                    text-sm
                    font-black
                    uppercase
                    tracking-[0.18em]
                    text-black
                    shadow-[0_0_60px_rgba(251,191,36,0.25)]
                    transition-all
                    duration-500
                    hover:scale-[1.02]
                    hover:shadow-[0_0_90px_rgba(251,191,36,0.40)]
                  "
                >
                  Comprar ahora
                  <ArrowUpRight className="h-4 w-4" />
                </Link>

                <div
                  className="
                    rounded-3xl
                    border
                    border-amber-300/15
                    bg-amber-300/[0.05]
                    px-6
                    py-4
                    text-xs
                    font-semibold
                    uppercase
                    tracking-[0.16em]
                    text-amber-100/80
                  "
                >
                  Lanzamiento activo
                </div>

              </div>

            </div>

            <div
              className="
                relative
                min-h-[420px]
                overflow-hidden
                rounded-[34px]
                border
                border-white/10
                bg-black/45
                p-8
              "
            >

              <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(251,191,36,0.18),transparent_62%)]" />

              <motion.img
                key={getProductImage(activeProduct)}
                src={getProductImage(activeProduct)}
                alt={activeProduct.name}
                initial={{
                  opacity: 0,
                  scale: 0.92,
                  y: 18,
                }}
                animate={{
                  opacity: 1,
                  scale: 1,
                  y: 0,
                }}
                transition={{
                  duration: 0.7,
                }}
                className="
                  relative
                  z-10
                  h-full
                  min-h-[360px]
                  w-full
                  object-contain
                  drop-shadow-[0_0_90px_rgba(255,140,0,0.32)]
                "
              />

            </div>

          </div>

          {products.length > 1 && (

            <div
              className="
                relative
                z-10
                mt-8
                flex
                flex-wrap
                items-center
                justify-center
                gap-3
              "
            >

              {products.map(
                (product, index) => (

                <button
                  key={product.id}
                  type="button"
                  onClick={() =>
                    setActiveIndex(index)
                  }
                  aria-label={`Ver lanzamiento ${product.name}`}
                  className={`
                    h-2.5
                    rounded-full
                    transition-all
                    duration-300
                    ${
                      index === activeIndex
                        ? "w-10 bg-amber-300"
                        : "w-2.5 bg-white/20 hover:bg-white/40"
                    }
                  `}
                />

              ))}

            </div>

          )}

        </motion.article>

      </div>

    </section>
  )

}

export default PromoBanner
