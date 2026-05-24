"use client"

/* 
================================================
MENÚ PRINCIPAL
SECCIÓN: TIENDA
COMPONENTE: StorePage
VERSIÓN: PREMIUM STORE + CARRITO LATERAL
================================================
*/

import Image from "next/image"
import Link from "next/link"
import { useMemo, useState } from "react"

import {
  ShoppingBag,
  X,
  Plus,
  Minus,
} from "lucide-react"

import products from "../../lib/products"

function formatPrice(
  price: string,
  currency = "USD"
) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(Number(price))
}

export default function StorePage() {

  const [cart, setCart] = useState<any[]>([])
  const [openCart, setOpenCart] = useState(false)

  /* =================================================
  CART FUNCTIONS
  ================================================= */

  function addToCart(product: any) {

    const existing = cart.find(
      (i) => i.id === product.id
    )

    if (existing) {

      setCart((prev) =>
        prev.map((i) =>
          i.id === product.id
            ? {
                ...i,
                qty: i.qty + 1,
              }
            : i
        )
      )

    } else {

      setCart((prev) => [
        ...prev,
        {
          id: product.id,
          qty: 1,
          product,
        },
      ])

    }
  }

  function increaseQty(id: number) {

    setCart((prev) =>
      prev.map((i) =>
        i.id === id
          ? {
              ...i,
              qty: i.qty + 1,
            }
          : i
      )
    )
  }

  function decreaseQty(id: number) {

    setCart((prev) =>
      prev
        .map((i) =>
          i.id === id
            ? {
                ...i,
                qty: i.qty - 1,
              }
            : i
        )
        .filter((i) => i.qty > 0)
    )
  }

  /* =================================================
  CALCULATIONS
  ================================================= */

  const totalItems = useMemo(
    () =>
      cart.reduce(
        (acc, item) => acc + item.qty,
        0
      ),
    [cart]
  )

  const subtotal = useMemo(
    () =>
      cart.reduce(
        (acc, item) =>
          acc +
          Number(item.product.price) *
            item.qty,
        0
      ),
    [cart]
  )

  return (
    <div
      className="
        min-h-screen
        overflow-hidden
        bg-gradient-to-b
        from-[#050505]
        via-black
        to-[#050505]
        pb-32
        text-white
      "
    >

      {/* =================================================
      BACK BUTTON
      ================================================= */}

      <button
        onClick={() =>
          window.history.back()
        }
        className="
          fixed
          left-5
          top-6
          z-50
          rounded-full
          border
          border-white/10
          bg-white/[0.05]
          px-5
          py-3
          text-sm
          font-semibold
          text-white
          backdrop-blur-2xl
          transition-all
          duration-500
          hover:bg-white/[0.08]
          hover:shadow-[0_0_40px_rgba(255,255,255,0.08)]
        "
      >
        ← Regresar
      </button>

      {/* =================================================
      CART BUTTON
      ================================================= */}

      <button
        onClick={() =>
          setOpenCart(true)
        }
        className="
          group
          fixed
          right-5
          top-6
          z-50
          overflow-hidden
          rounded-full
          border
          border-white/10
          bg-gradient-to-br
          from-white/[0.10]
          to-white/[0.03]
          px-6
          py-4
          backdrop-blur-3xl
          transition-all
          duration-500
          hover:scale-[1.03]
          hover:border-amber-400/30
          hover:shadow-[0_0_80px_rgba(251,191,36,0.18)]
        "
      >

        {/* Glow */}
        <div className="absolute inset-0 bg-gradient-to-r from-amber-400/[0.06] via-transparent to-orange-500/[0.05] opacity-0 transition-opacity duration-500 group-hover:opacity-100" />

        {/* Content */}
        <div className="relative z-10 flex items-center gap-4">

          {/* Icon Container */}
          <div
            className="
              relative
              flex
              h-12
              w-12
              items-center
              justify-center
              rounded-2xl
              border
              border-amber-400/20
              bg-amber-400/[0.08]
              transition-all
              duration-500
              group-hover:scale-110
              group-hover:bg-amber-400/[0.14]
            "
          >

            {/* Glow */}
            <div className="absolute inset-0 rounded-2xl bg-amber-400/20 blur-xl opacity-0 transition-opacity duration-500 group-hover:opacity-100" />

            {/* Counter */}
            {totalItems > 0 && (
              <div
                className="
                  absolute
                  -right-1
                  -top-1
                  flex
                  h-6
                  w-6
                  items-center
                  justify-center
                  rounded-full
                  bg-amber-400
                  text-[10px]
                  font-black
                  text-black
                  shadow-[0_0_25px_rgba(251,191,36,0.6)]
                "
              >
                {totalItems}
              </div>
            )}

            {/* Icon */}
            <ShoppingBag
              className="
                relative
                z-10
                h-6
                w-6
                text-white
                transition-all
                duration-500
                group-hover:text-amber-200
              "
            />

          </div>

          {/* Text */}
          <div className="flex flex-col items-start">

            <span
              className="
                text-[10px]
                uppercase
                tracking-[0.35em]
                text-amber-300
              "
            >
              IMNOVA STORE
            </span>

            <span
              className="
                text-2xl
                font-black
                tracking-[-0.03em]
                text-white
              "
            >
              Carrito
            </span>

          </div>

        </div>

      </button>

      {/* =================================================
      HERO
      ================================================= */}

      <section
        className="
          relative
          isolate
          overflow-hidden
          border-b
          border-white/10
          px-6
          pb-32
          pt-36
        "
      >

        {/* Background */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#0a0a0a] via-black to-black" />

        {/* Glow */}
        <div className="absolute left-1/2 top-0 h-[500px] w-[500px] -translate-x-1/2 rounded-full bg-amber-400/15 blur-3xl" />

        <div className="relative z-10 mx-auto max-w-7xl text-center">

          {/* Badge */}
          <div className="inline-flex items-center rounded-full border border-amber-400/20 bg-amber-400/10 px-5 py-2 backdrop-blur-xl">

            <span className="text-xs uppercase tracking-[0.35em] text-amber-300">

              EXPERIENCIA PREMIUM · IMNOVA

            </span>

          </div>

          {/* Title */}
          <h1
            className="
              mt-10
              text-5xl
              font-black
              leading-[0.92]
              tracking-[-0.05em]
              text-white
              sm:text-6xl
              md:text-7xl
              lg:text-8xl
            "
          >

            Bienvenido a

            <span className="mt-3 block bg-gradient-to-r from-amber-300 to-orange-500 bg-clip-text text-transparent">

              Tienda IMNOVA

            </span>

          </h1>

          {/* Divider */}
          <div className="mx-auto mt-10 h-[2px] w-28 rounded-full bg-white/10" />

          {/* Description */}
          <p
            className="
              mx-auto
              mt-10
              max-w-3xl
              text-lg
              leading-9
              text-zinc-300
              sm:text-xl
            "
          >

            Descubre productos funcionales diseñados para energía limpia,
            bienestar integral, nutrición inteligente y rendimiento diario.

          </p>

        </div>

      </section>

      {/* =================================================
      PRODUCTS
      ================================================= */}

      <section
        className="
          mx-auto
          mt-24
          grid
          max-w-7xl
          gap-10
          px-6
          lg:grid-cols-2
        "
      >

        {products.map((product: any) => (

          <div
            key={product.id}
            className="
              group
              relative
              overflow-hidden
              rounded-[40px]
              border
              border-white/10
              bg-white/[0.03]
              backdrop-blur-2xl
              transition-all
              duration-500
              hover:-translate-y-2
              hover:border-amber-400/20
              hover:bg-white/[0.04]
              hover:shadow-[0_0_80px_rgba(251,191,36,0.08)]
            "
          >

            {/* Glow */}
            <div className="absolute inset-0 bg-gradient-to-br from-amber-400/[0.03] via-transparent to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />

            {/* IMAGE */}
            <div className="relative z-0 h-[480px] overflow-hidden">

              <div className="absolute inset-0 bg-amber-400/5 blur-3xl" />

              <Image
                src={product.image}
                alt={product.name}
                fill
                className="
                  pointer-events-none
                  object-contain
                  p-10
                  transition-all
                  duration-700
                  group-hover:scale-105
                "
              />

            </div>

            {/* CONTENT */}
            <div className="relative z-20 p-10">

              <h2 className="text-4xl font-black tracking-[-0.03em] text-white">

                {product.name}

              </h2>

              <p className="mt-5 text-lg leading-8 text-zinc-400">

                {product.description}

              </p>

              <div className="mt-8 text-5xl font-black tracking-tight text-amber-300">

                {formatPrice(
                  product.price,
                  product.currency
                )}

              </div>

              {/* Buttons */}
              <div className="relative z-50 mt-10 flex flex-wrap gap-4">

                <button
                  type="button"
                  onClick={() =>
                    addToCart(product)
                  }
                  className="
                    rounded-2xl
                    bg-gradient-to-r
                    from-amber-400
                    to-orange-500
                    px-7
                    py-4
                    text-base
                    font-black
                    text-black
                    transition-all
                    duration-500
                    hover:scale-[1.03]
                    hover:shadow-[0_0_60px_rgba(251,191,36,0.35)]
                  "
                >

                  Añadir al carrito

                </button>

                <Link
                  href={`/store/${product.slug}`}
                  className="
                    rounded-2xl
                    border
                    border-white/10
                    bg-white/[0.04]
                    px-7
                    py-4
                    text-base
                    font-semibold
                    text-white
                    backdrop-blur-xl
                    transition-all
                    duration-500
                    hover:bg-white/[0.08]
                    hover:border-white/20
                  "
                >

                  Ver Producto

                </Link>

              </div>

            </div>

          </div>

        ))}

      </section>

      {/* =================================================
      CART SIDEBAR
      ================================================= */}

      <div
        className={`
          fixed
          top-0
          right-0
          z-[100]
          h-full
          w-full
          max-w-md
          transform
          border-l
          border-white/10
          bg-black/90
          backdrop-blur-2xl
          transition-transform
          duration-500
          ${
            openCart
              ? "translate-x-0"
              : "translate-x-full"
          }
        `}
      >

        {/* HEADER */}
        <div className="flex items-center justify-between border-b border-white/10 p-6">

          <div>

            <p className="text-xs uppercase tracking-[0.3em] text-amber-300">

              Tu Selección

            </p>

            <h2 className="mt-2 text-3xl font-black">

              Carrito

            </h2>

          </div>

          <button
            onClick={() =>
              setOpenCart(false)
            }
            className="
              rounded-full
              border
              border-white/10
              p-3
              transition-all
              duration-300
              hover:bg-white/10
            "
          >

            <X className="h-5 w-5" />

          </button>

        </div>

        {/* ITEMS */}
        <div className="flex h-[calc(100%-220px)] flex-col gap-5 overflow-y-auto p-6">

          {cart.length === 0 ? (

            <div className="mt-20 text-center">

              <ShoppingBag className="mx-auto h-14 w-14 text-zinc-700" />

              <p className="mt-6 text-zinc-500">

                Tu carrito está vacío.

              </p>

            </div>

          ) : (

            cart.map((item) => (

              <div
                key={item.id}
                className="
                  rounded-[28px]
                  border
                  border-white/10
                  bg-white/[0.03]
                  p-5
                "
              >

                <div className="flex gap-4">

                  <div className="relative h-24 w-24 overflow-hidden rounded-2xl bg-white/[0.03]">

                    <Image
                      src={item.product.image}
                      alt={item.product.name}
                      fill
                      className="object-contain p-3"
                    />

                  </div>

                  <div className="flex flex-1 flex-col justify-between">

                    <div>

                      <h3 className="font-black">

                        {item.product.name}

                      </h3>

                      <p className="mt-2 text-sm text-zinc-500">

                        {formatPrice(
                          item.product.price,
                          item.product.currency
                        )}

                      </p>

                    </div>

                    {/* QTY */}
                    <div className="mt-4 flex items-center gap-3">

                      <button
                        onClick={() =>
                          decreaseQty(item.id)
                        }
                        className="
                          rounded-full
                          border
                          border-white/10
                          p-2
                          hover:bg-white/10
                        "
                      >

                        <Minus className="h-4 w-4" />

                      </button>

                      <span className="font-bold">

                        {item.qty}

                      </span>

                      <button
                        onClick={() =>
                          increaseQty(item.id)
                        }
                        className="
                          rounded-full
                          border
                          border-white/10
                          p-2
                          hover:bg-white/10
                        "
                      >

                        <Plus className="h-4 w-4" />

                      </button>

                    </div>

                  </div>

                </div>

              </div>

            ))

          )}

        </div>

        {/* FOOTER */}
        <div className="absolute bottom-0 left-0 w-full border-t border-white/10 bg-black/80 p-6 backdrop-blur-2xl">

          <div className="flex items-center justify-between">

            <span className="text-zinc-400">

              Subtotal

            </span>

            <span className="text-3xl font-black text-amber-300">

              {formatPrice(String(subtotal))}

            </span>

          </div>

          <button
            className="
              mt-6
              w-full
              rounded-2xl
              bg-gradient-to-r
              from-amber-400
              to-orange-500
              px-6
              py-4
              text-lg
              font-black
              text-black
              transition-all
              duration-500
              hover:scale-[1.02]
              hover:shadow-[0_0_60px_rgba(251,191,36,0.35)]
            "
          >

            Finalizar Compra

          </button>

        </div>

      </div>

      {/* =================================================
      BOTTOM INDICATORS
      ================================================= */}

      <section className="mt-24 px-6">

        <div className="flex flex-wrap items-center justify-center gap-6 text-center text-xs uppercase tracking-[0.3em] text-zinc-600">

          <span>Wellness</span>
          <span>•</span>

          <span>Nutrición Funcional</span>
          <span>•</span>

          <span>Innovación Global</span>
          <span>•</span>

          <span>Performance</span>

        </div>

      </section>

    </div>
  )
}