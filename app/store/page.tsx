"use client"

/*
================================================
SECCION: TIENDA
COMPONENTE: StorePage
OBJETIVO: MARKETPLACE CLARO
================================================
*/

import Image from "next/image"
import Link from "next/link"
import {
  useEffect,
  useMemo,
  useState,
} from "react"

import {
  ArrowUpRight,
  ArrowLeft,
  BadgeCheck,
  MapPin,
  Minus,
  PackageCheck,
  Plus,
  Search,
  ShieldCheck,
  ShoppingBag,
  X,
} from "lucide-react"

import {
  getProducts,
  getProductStates,
} from "@/lib/products-service"

type Product = {
  id: string
  name: string
  slug?: string | null
  state_id?: string | null
  status?: string | null
  description?: string | null
  image_url?: string | null
  image?: string | null
  price?: string | number | null
  currency?: string | null
  category?: string | null
  main_benefit?: string | null
  bullets?: string[] | null
}

type ProductState = {
  id: string
  name: string
}

type CartItem = {
  id: string
  qty: number
  product: Product
}

const storeImagesBySlug: Record<string, string> = {
  "mash-coffee":
    "/images/products/store/mash-coffee/mash-coffee-lata-250ml-frontal.webp",
  "mash-coffee-6pack":
    "/images/products/store/mash-coffee/mash-coffee-6-pack-frontal.webp",
  "mash-coffee-12pack":
    "/images/products/store/mash-coffee/mash-coffee-12-pack-frontal.webp",
  "mash-nutri-pancake":
    "/images/products/store/mash-nutri-pancake/mash-nutri-pancake-150g-frontal.webp",
  "mash-nutri-pan":
    "/images/products/store/mash-nutri-pan/mash-nutra-pan-proteinico-200g-frontal.webp",
}

function getStoreImage(product: Product) {
  const slug =
    product.slug || ""

  return (
    storeImagesBySlug[slug] ||
    product.image_url ||
    product.image ||
    "/placeholder.jpg"
  )
}

function formatPrice(
  price?: string | number | null,
  currency = "USD"
) {
  const amount =
    Number(price || 0)

  return new Intl.NumberFormat(
    "en-US",
    {
      style: "currency",
      currency:
        currency || "USD",
    }
  ).format(
    Number.isFinite(amount)
      ? amount
      : 0
  )
}

function normalizeText(value?: string | null) {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
}

function getProductStateName(
  product: Product,
  statesById: Map<string, string>
) {
  if (
    product.state_id &&
    statesById.has(product.state_id)
  ) {
    return statesById.get(product.state_id) || ""
  }

  return product.status || ""
}

const trustCards = [
  {
    icon: ShieldCheck,
    title: "Compra clara",
    text:
      "Precio, presentación y beneficios visibles antes de agregar al carrito.",
  },
  {
    icon: PackageCheck,
    title: "Lanzamiento curado",
    text:
      "Cada producto disponible pasa por el flujo IMNOVA antes de llegar a tienda.",
  },
  {
    icon: MapPin,
    title: "Canales autorizados",
    text:
      "La compra puede conectar con store, marketplace o distribución física.",
  },
]

export default function StorePage() {
  const [
    cart,
    setCart,
  ] = useState<CartItem[]>([])

  const [
    products,
    setProducts,
  ] = useState<Product[]>([])

  const [
    productStates,
    setProductStates,
  ] = useState<ProductState[]>([])

  const [
    loading,
    setLoading,
  ] = useState(true)

  const [
    openCart,
    setOpenCart,
  ] = useState(false)

  const [
    activeCategory,
    setActiveCategory,
  ] = useState("Todos")

  const [
    searchTerm,
    setSearchTerm,
  ] = useState("")

  useEffect(() => {
    async function loadProducts() {
      const [
        data,
        states,
      ] =
        await Promise.all([
          getProducts(),
          getProductStates(),
        ])

      console.log(
        "STORE PRODUCTS:",
        data
      )

      setProducts(
        (data || []) as Product[]
      )

      setProductStates(
        (states || []) as ProductState[]
      )

      setLoading(false)
    }

    loadProducts()
  }, [])

  useEffect(() => {
    if (
      loading ||
      typeof window === "undefined" ||
      !window.location.hash
    ) {
      return
    }

    const target =
      document.querySelector(
        window.location.hash
      )

    target?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    })
  }, [
    loading,
    products,
  ])

  function addToCart(product: Product) {
    const existing =
      cart.find(
        item =>
          item.id === product.id
      )

    if (existing) {
      setCart(
        current =>
          current.map(
            item =>
              item.id === product.id
                ? {
                    ...item,
                    qty:
                      item.qty + 1,
                  }
                : item
          )
      )
    } else {
      setCart(
        current => [
          ...current,
          {
            id:
              product.id,
            qty:
              1,
            product,
          },
        ]
      )
    }

    setOpenCart(true)
  }

  function increaseQty(id: string) {
    setCart(
      current =>
        current.map(
          item =>
            item.id === id
              ? {
                  ...item,
                  qty:
                    item.qty + 1,
                }
              : item
        )
    )
  }

  function decreaseQty(id: string) {
    setCart(
      current =>
        current
          .map(
            item =>
              item.id === id
                ? {
                    ...item,
                    qty:
                      item.qty - 1,
                  }
                : item
          )
          .filter(
            item =>
              item.qty > 0
          )
    )
  }

  const totalItems =
    useMemo(
      () =>
        cart.reduce(
          (
            total,
            item
          ) =>
            total + item.qty,
          0
        ),
      [cart]
    )

  const subtotal =
    useMemo(
      () =>
        cart.reduce(
          (
            total,
            item
          ) =>
            total +
            Number(
              item.product.price || 0
            ) *
              item.qty,
          0
        ),
      [cart]
    )

  const availableProducts =
    useMemo(
      () => {
        const statesById =
          new Map(
            productStates.map(state => [
              state.id,
              state.name,
            ])
          )

        return products.filter(product =>
          normalizeText(
            getProductStateName(
              product,
              statesById
            )
          ).includes("disponible")
        )
      },
      [
        productStates,
        products,
      ]
    )

  const categories =
    useMemo(
      () => [
        "Todos",
        ...Array.from(
          new Set(
            availableProducts
              .map(
                product =>
                  product.category?.trim()
              )
              .filter(
                Boolean
              ) as string[]
          )
        ),
      ],
      [availableProducts]
    )

  const visibleProducts =
    useMemo(
      () => {
        const normalizedSearch =
          searchTerm
            .trim()
            .toLowerCase()

        return availableProducts.filter(
          product => {
            const matchesCategory =
              activeCategory ===
                "Todos" ||
              product.category?.trim() ===
                activeCategory

            const searchableText = [
              product.name,
              product.description,
              product.category,
              ...(product.bullets || []),
            ]
              .filter(Boolean)
              .join(" ")
              .toLowerCase()

            const matchesSearch =
              !normalizedSearch ||
              searchableText.includes(
                normalizedSearch
              )

            return (
              matchesCategory &&
              matchesSearch
            )
          }
        )
      },
      [
        activeCategory,
        availableProducts,
        searchTerm,
      ]
    )

  const featuredProduct =
    useMemo(
      () =>
        visibleProducts[0] ||
        availableProducts[0] ||
        null,
      [
        availableProducts,
        visibleProducts,
      ]
    )

  if (loading) {
    return (
      <main className="min-h-screen bg-[#f8f8f5] text-zinc-950">
        <div className="mx-auto flex min-h-screen max-w-7xl items-center justify-center px-6">
          <div className="rounded-[28px] border border-zinc-200 bg-white px-8 py-6 text-sm font-semibold text-zinc-600 shadow-sm">
            Cargando tienda IMNOVA...
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[#f8f8f5] text-zinc-950">
      <section className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-7xl px-6 py-10">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
            >
              <ArrowLeft className="h-4 w-4" />
              Volver
            </Link>

            <button
              type="button"
              onClick={() =>
                setOpenCart(true)
              }
              className="relative inline-flex items-center justify-center gap-3 rounded-full bg-zinc-950 px-7 py-4 text-sm font-black uppercase tracking-[0.2em] text-white shadow-[0_20px_60px_rgba(15,23,42,0.20)] transition hover:-translate-y-0.5 hover:bg-zinc-800"
            >
              <ShoppingBag className="h-5 w-5" />
              Carrito

              {totalItems > 0 && (
                <span className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full bg-cyan-400 text-xs text-zinc-950">
                  {totalItems}
                </span>
              )}
            </button>
          </div>

          <div className="mx-auto mt-12 max-w-5xl text-center">
            <p className="text-xs font-black uppercase tracking-[0.34em] text-cyan-700">
              Marketplace IMNOVA
            </p>

            <div className="relative mt-6 overflow-hidden rounded-[36px] border border-zinc-200 bg-[#f8f8f5] bg-[url('/images/store/imnova-concept-banner.svg')] bg-cover bg-center px-6 py-10 shadow-[0_24px_80px_rgba(15,23,42,0.08)] md:px-12 md:py-14">
              <div className="absolute inset-0 bg-white/58 backdrop-blur-[1px]" />
              <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-white/70 to-transparent" />

              <div className="relative z-10">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-cyan-200 bg-white/85 text-cyan-700 shadow-sm backdrop-blur">
                  <BadgeCheck className="h-7 w-7" />
                </div>

                <h1 className="mx-auto mt-7 max-w-4xl text-4xl font-black leading-[1.02] tracking-[-0.035em] text-zinc-950 md:text-6xl">
                  Soluciones inteligentes para vivir mejor.
                </h1>

                <p className="mx-auto mt-6 max-w-4xl text-lg leading-8 text-zinc-700 md:text-xl md:leading-9">
                  Creamos soluciones inteligentes que integran tecnología,
                  nutrición y bienestar para ayudar a las personas a vivir mejor,
                  rendir más y construir una rutina diaria más simple, saludable y
                  equilibrada.
                </p>

                <div className="mt-8 flex flex-wrap justify-center gap-3">
                  {[
                    "Tecnología",
                    "Nutrición funcional",
                    "Bienestar diario",
                  ].map(label => (
                    <span
                      key={label}
                      className="rounded-full border border-zinc-200 bg-white/85 px-5 py-3 text-xs font-black uppercase tracking-[0.18em] text-zinc-700 shadow-sm backdrop-blur"
                    >
                      {label}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-28 pt-10">
        {availableProducts.length === 0 ? (
          <div className="rounded-[32px] border border-zinc-200 bg-white p-10 text-center shadow-sm">
            <p className="text-sm font-black uppercase tracking-[0.24em] text-zinc-400">
              Todavía no hay productos disponibles
            </p>
            <p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-zinc-600">
              La tienda solo muestra productos listos para comprar. Las ideas,
              productos en producción y validaciones comunitarias permanecen en
              la web principal hasta entrar en estado Disponible.
            </p>
          </div>
        ) : (
          <>
            {featuredProduct && (
              <section className="mb-8 overflow-hidden rounded-[36px] border border-zinc-200 bg-white shadow-[0_30px_100px_rgba(15,23,42,0.10)]">
                <div className="grid gap-0 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
                  <div className="relative flex min-h-[420px] items-center justify-center overflow-hidden bg-gradient-to-br from-[#fbfbf7] via-white to-[#edf7f4] p-8 md:p-12">
                    <div className="absolute left-6 top-6 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-emerald-700">
                      Disponible
                    </div>

                    <div className="absolute bottom-6 left-6 right-6 rounded-[24px] border border-white bg-white/82 p-4 shadow-sm backdrop-blur">
                      <p className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">
                        Lanzamiento oficial
                      </p>
                      <p className="mt-1 text-sm font-semibold text-zinc-700">
                        Presentación lista para compra directa y canales
                        autorizados.
                      </p>
                    </div>

                    <div className="relative h-[320px] w-full max-w-[460px]">
                      <Image
                        src={getStoreImage(featuredProduct)}
                        alt={featuredProduct.name}
                        fill
                        priority
                        sizes="(min-width: 1024px) 45vw, 100vw"
                        className="object-contain drop-shadow-[0_28px_50px_rgba(15,23,42,0.18)]"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col justify-center p-7 md:p-10 lg:p-12">
                    <p className="text-xs font-black uppercase tracking-[0.30em] text-cyan-700">
                      Producto protagonista
                    </p>

                    <h2 className="mt-4 max-w-2xl text-4xl font-black leading-[1.02] tracking-[-0.035em] text-zinc-950 md:text-6xl">
                      {featuredProduct.name}
                    </h2>

                    <p className="mt-6 max-w-2xl text-base leading-8 text-zinc-600 md:text-lg">
                      {featuredProduct.main_benefit ||
                        featuredProduct.description ||
                        "Producto IMNOVA disponible para apoyar una rutina diaria más simple, saludable y equilibrada."}
                    </p>

                    <div className="mt-8 grid gap-3 sm:grid-cols-3">
                      {trustCards.map(card => {
                        const Icon =
                          card.icon

                        return (
                          <div
                            key={card.title}
                            className="rounded-[22px] border border-zinc-200 bg-[#f8f8f5] p-4"
                          >
                            <Icon className="h-5 w-5 text-cyan-700" />
                            <p className="mt-4 text-sm font-black text-zinc-950">
                              {card.title}
                            </p>
                            <p className="mt-2 text-xs leading-5 text-zinc-500">
                              {card.text}
                            </p>
                          </div>
                        )
                      })}
                    </div>

                    <div className="mt-9 flex flex-col gap-4 border-t border-zinc-200 pt-8 sm:flex-row sm:items-end sm:justify-between">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400">
                          Desde
                        </p>
                        <p className="mt-1 text-5xl font-black tracking-tight text-zinc-950">
                          {formatPrice(
                            featuredProduct.price,
                            featuredProduct.currency ||
                              "USD"
                          )}
                        </p>
                      </div>

                      <div className="flex flex-col gap-3 sm:min-w-56">
                        <button
                          type="button"
                          onClick={() =>
                            addToCart(featuredProduct)
                          }
                          className="rounded-full bg-zinc-950 px-7 py-4 text-sm font-black uppercase tracking-[0.16em] text-white transition hover:-translate-y-0.5 hover:bg-cyan-900"
                        >
                          Comprar ahora
                        </button>

                        <Link
                          href={
                            featuredProduct.slug
                              ? `/store/${featuredProduct.slug}`
                              : "/store"
                          }
                          className="inline-flex items-center justify-center gap-2 rounded-full border border-zinc-200 bg-white px-7 py-4 text-sm font-black uppercase tracking-[0.16em] text-zinc-800 transition hover:border-zinc-300 hover:bg-zinc-50"
                        >
                          Ver detalle
                          <ArrowUpRight className="h-4 w-4" />
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            )}

            <div className="mb-8 overflow-hidden rounded-[32px] border border-zinc-200 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.07)]">
              <div className="grid gap-6 p-6 md:grid-cols-[1fr_0.9fr] md:p-8">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.28em] text-cyan-700">
                    Catálogo oficial
                  </p>

                  <h2 className="mt-3 text-3xl font-black leading-tight tracking-[-0.03em] text-zinc-950 md:text-5xl">
                    Productos IMNOVA listos para comprar.
                  </h2>

                  <p className="mt-4 max-w-2xl text-sm leading-7 text-zinc-600 md:text-base">
                    Explora productos disponibles, compara presentaciones y
                    agrega al carrito sin perder claridad. La tienda queda
                    preparada para crecer con nuevas líneas y categorías.
                  </p>
                </div>

                <div className="flex flex-col justify-between gap-4">
                  <label className="relative block">
                    <Search className="pointer-events-none absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-400" />
                    <input
                      type="search"
                      value={searchTerm}
                      onChange={event =>
                        setSearchTerm(
                          event.target.value
                        )
                      }
                      placeholder="Buscar producto, beneficio o categoría"
                      className="h-14 w-full rounded-full border border-zinc-200 bg-[#f8f8f5] pl-14 pr-5 text-sm font-semibold text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-cyan-500 focus:bg-white focus:ring-4 focus:ring-cyan-100"
                    />
                  </label>

                  <div className="flex flex-wrap gap-2">
                    {categories.map(
                      category => (
                        <button
                          key={category}
                          type="button"
                          onClick={() =>
                            setActiveCategory(
                              category
                            )
                          }
                          className={`rounded-full border px-4 py-2 text-xs font-black uppercase tracking-[0.14em] transition ${
                            activeCategory ===
                            category
                              ? "border-zinc-950 bg-zinc-950 text-white"
                              : "border-zinc-200 bg-white text-zinc-600 hover:border-cyan-300 hover:text-zinc-950"
                          }`}
                        >
                          {category}
                        </button>
                      )
                    )}
                  </div>

                  <div className="grid grid-cols-3 overflow-hidden rounded-[24px] border border-zinc-200 bg-[#f8f8f5]">
                    {[
                      [
                        availableProducts.length,
                        "Productos",
                      ],
                      [
                        categories.length - 1,
                        "Categorías",
                      ],
                      [
                        totalItems,
                        "En carrito",
                      ],
                    ].map(
                      item => (
                        <div
                          key={item[1]}
                          className="border-r border-zinc-200 p-4 last:border-r-0"
                        >
                          <p className="text-2xl font-black text-zinc-950">
                            {item[0]}
                          </p>
                          <p className="mt-1 text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
                            {item[1]}
                          </p>
                        </div>
                      )
                    )}
                  </div>
                </div>
              </div>
            </div>

            {visibleProducts.length === 0 ? (
              <div className="rounded-[32px] border border-zinc-200 bg-white p-10 text-center shadow-sm">
                <p className="text-sm font-black uppercase tracking-[0.24em] text-zinc-400">
                  No encontramos productos con ese filtro
                </p>
              </div>
            ) : (
              <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
                {visibleProducts.map(
              product => {
                const image =
                  getStoreImage(
                    product
                  )

                return (
                  <article
                    key={product.id}
                    id={
                      product.slug
                        ? `product-${product.slug}`
                        : `product-${product.id}`
                    }
                    className="group flex scroll-mt-28 flex-col overflow-hidden rounded-[28px] border border-zinc-200 bg-white shadow-sm transition hover:-translate-y-1 hover:border-cyan-200 hover:shadow-[0_24px_80px_rgba(15,23,42,0.12)]"
                  >
                    <Link
                      href={
                        product.slug
                          ? `/store/${product.slug}`
                          : "/store"
                      }
                      className="relative flex aspect-[4/3] items-center justify-center bg-gradient-to-br from-white via-[#fbfbf7] to-[#eef6f3] p-8"
                    >
                      <div className="absolute left-5 top-5 rounded-full border border-white bg-white/90 px-3 py-1 text-xs font-black uppercase tracking-[0.16em] text-zinc-700 shadow-sm backdrop-blur">
                        IMNOVA
                      </div>

                      <div className="absolute right-5 top-5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-black uppercase tracking-[0.16em] text-emerald-700">
                        Disponible
                      </div>

                      <Image
                        src={image}
                        alt={product.name}
                        fill
                        sizes="(min-width: 1280px) 33vw, (min-width: 640px) 50vw, 100vw"
                        className="object-contain p-10 transition duration-500 group-hover:scale-[1.04]"
                      />
                    </Link>

                    <div className="flex flex-1 flex-col p-6">
                      <p className="text-xs font-black uppercase tracking-[0.22em] text-cyan-700">
                        {product.category ||
                          "Producto funcional"}
                      </p>

                      <h2 className="mt-3 text-2xl font-black leading-tight text-zinc-950">
                        {product.name}
                      </h2>

                      <p className="mt-4 min-h-20 text-sm leading-6 text-zinc-600">
                        {product.description ||
                          "Producto IMNOVA diseñado para bienestar, nutrición inteligente y rendimiento diario."}
                      </p>

                      <div className="mt-5 flex flex-wrap gap-2">
                        {(product.bullets || [])
                          .slice(
                            0,
                            3
                          )
                          .map(
                            bullet => (
                              <span
                                key={bullet}
                                className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs font-semibold text-zinc-600"
                              >
                                {bullet}
                              </span>
                            )
                          )}
                      </div>

                      <div className="mt-auto pt-7">
                        <div className="flex items-end justify-between gap-4">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400">
                              Precio
                            </p>
                            <p className="mt-1 text-3xl font-black tracking-tight text-zinc-950">
                              {formatPrice(
                                product.price,
                                product.currency ||
                                  "USD"
                              )}
                            </p>
                          </div>

                          <BadgeCheck className="h-7 w-7 text-cyan-700" />
                        </div>

                        <div className="mt-6 grid gap-3">
                          <button
                            type="button"
                            onClick={() =>
                              addToCart(
                                product
                              )
                            }
                            className="rounded-full bg-zinc-950 px-6 py-4 text-sm font-black uppercase tracking-[0.16em] text-white transition hover:bg-cyan-900"
                          >
                            Comprar ahora
                          </button>

                          <Link
                            href={
                              product.slug
                                ? `/store/${product.slug}`
                                : "/store"
                            }
                            className="inline-flex items-center justify-center gap-2 rounded-full border border-zinc-200 bg-white px-6 py-4 text-center text-sm font-black uppercase tracking-[0.16em] text-zinc-800 transition hover:border-zinc-300 hover:bg-zinc-50"
                          >
                            Ver detalle
                            <ArrowUpRight className="h-4 w-4" />
                          </Link>
                        </div>
                      </div>
                    </div>
                  </article>
                )
              }
                )}
              </div>
            )}
          </>
        )}
      </section>

      <aside
        className={`
          fixed right-0 top-0 z-[100] h-full w-full max-w-md transform border-l border-zinc-200 bg-white shadow-2xl transition-transform duration-500
          ${
            openCart
              ? "translate-x-0"
              : "translate-x-full"
          }
        `}
      >
        <div className="flex items-center justify-between border-b border-zinc-200 p-6">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.28em] text-cyan-700">
              Tu selección
            </p>
            <h2 className="mt-2 text-3xl font-black text-zinc-950">
              Carrito
            </h2>
          </div>

          <button
            type="button"
            onClick={() =>
              setOpenCart(false)
            }
            className="rounded-full border border-zinc-200 p-3 text-zinc-700 transition hover:bg-zinc-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex h-[calc(100%-220px)] flex-col gap-4 overflow-y-auto p-6">
          {cart.length === 0 ? (
            <div className="mt-20 text-center">
              <ShoppingBag className="mx-auto h-14 w-14 text-zinc-300" />
              <p className="mt-6 text-zinc-500">
                Tu carrito está vacío.
              </p>
            </div>
          ) : (
            cart.map(
              item => (
                <div
                  key={item.id}
                  className="rounded-[24px] border border-zinc-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex gap-4">
                    <div className="relative h-24 w-24 overflow-hidden rounded-2xl bg-[#f8f8f5]">
                      <Image
                        src={getStoreImage(
                          item.product
                        )}
                        alt={item.product.name}
                        fill
                        className="object-contain p-3"
                      />
                    </div>

                    <div className="flex flex-1 flex-col justify-between">
                      <div>
                        <h3 className="font-black leading-tight text-zinc-950">
                          {item.product.name}
                        </h3>
                        <p className="mt-2 text-sm text-zinc-500">
                          {formatPrice(
                            item.product.price,
                            item.product.currency ||
                              "USD"
                          )}
                        </p>
                      </div>

                      <div className="mt-4 flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() =>
                            decreaseQty(
                              item.id
                            )
                          }
                          className="rounded-full border border-zinc-200 p-2 text-zinc-700 hover:bg-zinc-50"
                        >
                          <Minus className="h-4 w-4" />
                        </button>

                        <span className="font-bold text-zinc-950">
                          {item.qty}
                        </span>

                        <button
                          type="button"
                          onClick={() =>
                            increaseQty(
                              item.id
                            )
                          }
                          className="rounded-full border border-zinc-200 p-2 text-zinc-700 hover:bg-zinc-50"
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )
            )
          )}
        </div>

        <div className="absolute bottom-0 left-0 w-full border-t border-zinc-200 bg-white p-6">
          <div className="flex items-center justify-between">
            <span className="text-zinc-500">
              Subtotal
            </span>
            <span className="text-3xl font-black text-zinc-950">
              {formatPrice(
                subtotal,
                "USD"
              )}
            </span>
          </div>

          <button
            type="button"
            className="mt-6 w-full rounded-full bg-cyan-700 px-6 py-4 text-sm font-black uppercase tracking-[0.16em] text-white transition hover:bg-cyan-800"
          >
            Finalizar compra
          </button>
        </div>
      </aside>
    </main>
  )
}
