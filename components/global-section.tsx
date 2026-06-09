"use client"

import {
  motion,
  useInView,
} from "framer-motion"

import {
  Building2,
  Globe2,
  MapPin,
  Rocket,
  Search,
  ShoppingBag,
  Store,
} from "lucide-react"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import {
  getProductStates,
} from "@/lib/products-service"

import { supabase } from "@/lib/supabase"

type DistributionChannel = {
  id: string
  country?: string
  city?: string
  type: string
  name: string
  location: string
  status: string
  url?: string
  note?: string
}

type Product = {
  id: string
  state_id: string | null
  name: string
  category?: string
  image?: string | null
  image_url?: string | null
  distribution_channels?: DistributionChannel[]
}

type ProductState = {
  id: string
  name: string
}

type DistributionItem = DistributionChannel & {
  productId: string
  productName: string
  productCategory?: string
  productImage?: string | null
}

const distributionPageSize = 12

const channelIcons: Record<string, typeof Store> = {
  marketplace: ShoppingBag,
  mercado: Building2,
  establecimiento: Store,
  producto: Rocket,
}

function getChannelIcon(
  type: string
) {

  return (
    channelIcons[type.toLowerCase()] ||
    Store
  )

}

function getChannelLocation(
  item: {
    city?: string
    country?: string
    location?: string
  }
) {

  const structured =
    [
      item.city,
      item.country,
    ]
      .filter(Boolean)
      .join(", ")

  return (
    structured ||
    item.location ||
    "Ubicación en preparación"
  )

}

export function GlobalSection() {

  const ref =
    useRef(null)

  const productsCountRef =
    useRef(0)

  const isInView =
    useInView(ref, {
      once: true,
      margin: "-100px",
    })

  const [
    products,
    setProducts,
  ] = useState<Product[]>([])

  const [
    isLoading,
    setIsLoading,
  ] = useState(false)

  const [
    hasMore,
    setHasMore,
  ] = useState(false)

  const [
    activeCountry,
    setActiveCountry,
  ] = useState("Todos")

  const [
    activeCity,
    setActiveCity,
  ] = useState("Todas")

  const [
    activeType,
    setActiveType,
  ] = useState("Todos")

  const [
    searchTerm,
    setSearchTerm,
  ] = useState("")

  const loadDistribution =
    useCallback(
      async (
        reset = false
      ) => {

        setIsLoading(true)

        const states =
          await getProductStates()

        const commercialStateIds =
          (states as ProductState[])
            .filter((state) =>
              state.name.includes(
                "Comercialización"
              )
            )
            .map(
              (state) =>
                state.id
            )

        if (
          commercialStateIds.length === 0
        ) {

          productsCountRef.current = 0
          setProducts([])
          setHasMore(false)
          setIsLoading(false)

          return

        }

        const from =
          reset
            ? 0
            : productsCountRef.current

        const to =
          from +
          distributionPageSize -
          1

        const {
          data,
          error,
          count,
        } =
          await supabase
            .from("products")
            .select(
              "*",
              {
                count: "exact",
              }
            )
            .in(
              "state_id",
              commercialStateIds
            )
            .order(
              "created_at",
              {
                ascending: false,
              }
            )
            .range(
              from,
              to
            )

        if (error) {

          console.error(
            "GET DISTRIBUTION PRODUCTS ERROR:",
            {
              message: error.message,
              details: error.details,
              hint: error.hint,
              code: error.code,
            }
          )

          setIsLoading(false)

          return

        }

        const nextProducts =
          (data || []) as Product[]

        productsCountRef.current =
          reset
            ? nextProducts.length
            : productsCountRef.current +
              nextProducts.length

        setProducts(
          currentProducts =>
            reset
              ? nextProducts
              : [
                  ...currentProducts,
                  ...nextProducts,
                ]
        )

        setHasMore(
          from +
            nextProducts.length <
            (count || 0)
        )

        setIsLoading(false)

      },
      []
    )

  useEffect(() => {

    loadDistribution(true)

    const channel =
      supabase
        .channel(
          "global-distribution"
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "products",
          },
          () =>
            loadDistribution(true)
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "product_states",
          },
          () =>
            loadDistribution(true)
        )
        .subscribe()

    return () => {

      supabase.removeChannel(channel)

    }

  }, [loadDistribution])

  const distribution =
    useMemo<DistributionItem[]>(
      () =>
        products.flatMap(
          (product) => {

            const channels =
              product.distribution_channels ||
              []

            if (channels.length === 0) {

              return [
                {
                  id: product.id,
                  productId: product.id,
                  type: "Producto",
                  name: "Canales en preparación",
                  location:
                    "Activación comercial pendiente",
                  status: "Configurando",
                  productName:
                    product.name,
                  productCategory:
                    product.category,
                  productImage:
                    product.image_url ||
                    product.image ||
                    null,
                },
              ]

            }

            return channels.map(
              (channel) => ({
                ...channel,
                productId:
                  product.id,
                productName:
                  product.name,
                productCategory:
                  product.category,
                productImage:
                  product.image_url ||
                  product.image ||
                  null,
              })
            )

          }
        ),
      [products]
    )

  const countries =
    useMemo(
      () => [
        "Todos",
        ...Array.from(
          new Set(
            distribution
              .map(
                item =>
                  item.country
              )
              .filter(Boolean) as string[]
          )
        ),
      ],
      [distribution]
    )

  const cities =
    useMemo(
      () => [
        "Todas",
        ...Array.from(
          new Set(
            distribution
              .filter(
                item =>
                  activeCountry ===
                    "Todos" ||
                  item.country ===
                    activeCountry
              )
              .map(
                item =>
                  item.city
              )
              .filter(Boolean) as string[]
          )
        ),
      ],
      [
        activeCountry,
        distribution,
      ]
    )

  const types =
    useMemo(
      () => [
        "Todos",
        ...Array.from(
          new Set(
            distribution.map(
              item =>
                item.type
            )
          )
        ),
      ],
      [distribution]
    )

  const filteredDistribution =
    useMemo(
      () => {

        const normalizedSearch =
          searchTerm
            .trim()
            .toLowerCase()

        return distribution.filter(
          (item) => {

            const matchesCountry =
              activeCountry ===
                "Todos" ||
              item.country ===
                activeCountry

            const matchesCity =
              activeCity ===
                "Todas" ||
              item.city ===
                activeCity

            const matchesType =
              activeType ===
                "Todos" ||
              item.type ===
                activeType

            const searchable =
              [
                item.productName,
                item.name,
                item.country,
                item.city,
                item.type,
                item.location,
              ]
                .filter(Boolean)
                .join(" ")
                .toLowerCase()

            return (
              matchesCountry &&
              matchesCity &&
              matchesType &&
              searchable.includes(
                normalizedSearch
              )
            )

          }
        )

      },
      [
        activeCountry,
        activeCity,
        activeType,
        distribution,
        searchTerm,
      ]
    )

  const activeCountriesCount =
    countries.length > 1
      ? countries.length - 1
      : 0

  const marketplaceCount =
    distribution.filter(
      item =>
        item.type === "Marketplace"
    ).length

  const physicalCount =
    distribution.filter(
      item =>
        item.type === "Mercado" ||
        item.type === "Establecimiento" ||
        item.type === "Tienda de conveniencia"
    ).length

  return (
    <section
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

      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.10),transparent_44%)]" />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/20 to-transparent" />
      <div className="absolute inset-0 opacity-[0.018] bg-[linear-gradient(rgba(255,255,255,0.12)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.12)_1px,transparent_1px)] bg-[size:76px_76px]" />

      <div className="relative z-10 mx-auto max-w-7xl px-6">

        <motion.div
          initial={{
            opacity: 0,
            y: 36,
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
            duration: 0.9,
          }}
          className="mx-auto max-w-5xl text-center"
        >

          <div className="inline-flex items-center gap-3 rounded-full border border-cyan-300/20 bg-cyan-300/[0.06] px-5 py-3 backdrop-blur-2xl">
            <Rocket className="h-4 w-4 text-cyan-300" />
            <span className="text-xs uppercase tracking-[0.35em] text-cyan-200">
              Distribution command center
            </span>
          </div>

          <h2 className="mx-auto mt-10 max-w-6xl text-5xl font-black leading-[1.02] tracking-[-0.04em] text-white sm:text-6xl lg:text-7xl">
            Dónde se vende
            <span className="block bg-gradient-to-r from-cyan-200 via-cyan-400 to-white bg-clip-text text-transparent">
              cada producto IMNOVA
            </span>
          </h2>

          <p className="mx-auto mt-9 max-w-4xl text-xl leading-9 text-zinc-300">
            Un menú operativo para consultar por país, ciudad y canal comercial
            los marketplaces, mercados y establecimientos activos.
          </p>

        </motion.div>

        <motion.div
          initial={{
            opacity: 0,
            y: 32,
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
            delay: 0.1,
          }}
          className="
            mt-20
            overflow-hidden
            rounded-[42px]
            border
            border-cyan-300/15
            bg-black/70
            shadow-[0_0_140px_rgba(34,211,238,0.10)]
            backdrop-blur-2xl
          "
        >

          <div className="grid lg:grid-cols-[320px_1fr]">

            <aside className="border-b border-cyan-300/10 bg-white/[0.025] p-6 lg:border-b-0 lg:border-r">

              <p className="text-[10px] uppercase tracking-[0.30em] text-cyan-200/60">
                Navegación comercial
              </p>

              <div className="mt-7 grid gap-4">

                <label className="grid gap-2">
                  <span className="text-xs uppercase tracking-[0.22em] text-white/35">
                    País
                  </span>
                  <select
                    value={activeCountry}
                    onChange={(event) => {
                      setActiveCountry(
                        event.target.value
                      )
                      setActiveCity("Todas")
                    }}
                    className="rounded-2xl border border-white/10 bg-black/60 p-4 text-sm text-white outline-none"
                  >
                    {countries.map(
                      country => (
                        <option
                          key={country}
                          value={country}
                        >
                          {country}
                        </option>
                      )
                    )}
                  </select>
                </label>

                <label className="grid gap-2">
                  <span className="text-xs uppercase tracking-[0.22em] text-white/35">
                    Ciudad
                  </span>
                  <select
                    value={activeCity}
                    onChange={(event) =>
                      setActiveCity(
                        event.target.value
                      )
                    }
                    className="rounded-2xl border border-white/10 bg-black/60 p-4 text-sm text-white outline-none"
                  >
                    {cities.map(
                      city => (
                        <option
                          key={city}
                          value={city}
                        >
                          {city}
                        </option>
                      )
                    )}
                  </select>
                </label>

                <label className="grid gap-2">
                  <span className="text-xs uppercase tracking-[0.22em] text-white/35">
                    Canal
                  </span>
                  <select
                    value={activeType}
                    onChange={(event) =>
                      setActiveType(
                        event.target.value
                      )
                    }
                    className="rounded-2xl border border-white/10 bg-black/60 p-4 text-sm text-white outline-none"
                  >
                    {types.map(
                      type => (
                        <option
                          key={type}
                          value={type}
                        >
                          {type}
                        </option>
                      )
                    )}
                  </select>
                </label>

                <label className="grid gap-2">
                  <span className="text-xs uppercase tracking-[0.22em] text-white/35">
                    Buscar
                  </span>
                  <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/60 px-4">
                    <Search className="h-4 w-4 text-cyan-200/70" />
                    <input
                      value={searchTerm}
                      onChange={(event) =>
                        setSearchTerm(
                          event.target.value
                        )
                      }
                      placeholder="Producto o canal"
                      className="min-w-0 flex-1 bg-transparent py-4 text-sm text-white outline-none placeholder:text-white/30"
                    />
                  </div>
                </label>

              </div>

              <div className="mt-8 grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-white/35">
                    Marketplaces
                  </p>
                  <p className="mt-3 text-3xl font-black text-white">
                    {marketplaceCount}
                  </p>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-white/35">
                    Físicos
                  </p>
                  <p className="mt-3 text-3xl font-black text-white">
                    {physicalCount}
                  </p>
                </div>
              </div>

              <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.025] p-4">
                <p className="text-[10px] uppercase tracking-[0.18em] text-white/35">
                  Países activos
                </p>
                <p className="mt-2 text-2xl font-black text-white">
                  {activeCountriesCount}
                </p>
              </div>

            </aside>

            <div className="relative min-h-[620px] p-6 md:p-8">

              <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_20%,rgba(34,211,238,0.10),transparent_32%)]" />

              <div className="relative z-10 grid gap-5">
                {filteredDistribution.length > 0 ? (
                  filteredDistribution.map(
                    (item, index) => {
                      const Icon =
                        getChannelIcon(
                          item.type
                        )

                      return (
                        <motion.article
                          key={`${item.productId}-${item.id}`}
                          initial={{
                            opacity: 0,
                            y: 18,
                          }}
                          animate={{
                            opacity: 1,
                            y: 0,
                          }}
                          transition={{
                            duration: 0.45,
                            delay:
                              index * 0.035,
                          }}
                          className="
                            group
                            grid
                            gap-5
                            rounded-[28px]
                            border
                            border-white/10
                            bg-white/[0.035]
                            p-5
                            backdrop-blur-2xl
                            transition-all
                            duration-500
                            hover:-translate-y-1
                            hover:border-cyan-300/25
                            hover:bg-white/[0.055]
                            md:grid-cols-[88px_1fr_auto]
                            md:items-center
                          "
                        >

                          <div className="relative flex h-24 w-24 items-center justify-center overflow-hidden rounded-3xl border border-cyan-300/15 bg-cyan-300/[0.055]">
                            {item.productImage ? (
                              <img
                                src={item.productImage}
                                alt={item.productName}
                                className="h-full w-full object-contain p-2"
                              />
                            ) : (
                              <Rocket className="h-8 w-8 text-cyan-200" />
                            )}
                          </div>

                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-3">
                              <span className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-cyan-100">
                                <Icon className="h-3.5 w-3.5" />
                                {item.type}
                              </span>

                              <span className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-white/55">
                                {item.status}
                              </span>
                            </div>

                            <h3 className="mt-4 truncate text-3xl font-black tracking-[-0.04em] text-white">
                              {item.name}
                            </h3>

                            <div className="mt-3 flex flex-wrap gap-3 text-sm text-zinc-400">
                              <span className="inline-flex items-center gap-2">
                                <Globe2 className="h-4 w-4 text-cyan-300" />
                                {item.country || "País por definir"}
                              </span>
                              <span className="inline-flex items-center gap-2">
                                <MapPin className="h-4 w-4 text-cyan-300" />
                                {item.city || getChannelLocation(item)}
                              </span>
                            </div>

                            <p className="mt-4 text-sm font-semibold text-white/80">
                              {item.productName}
                            </p>

                            {item.note && (
                              <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
                                {item.note}
                              </p>
                            )}
                          </div>

                          {item.type === "Marketplace" && item.url && (
                            <div className="flex md:justify-end">
                              <a
                                href={item.url}
                                target="_blank"
                                rel="noreferrer"
                                className="rounded-2xl border border-cyan-300/20 bg-cyan-300/10 px-5 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-100 transition-colors hover:bg-cyan-300/20"
                              >
                                Abrir
                              </a>
                            </div>
                          )}

                        </motion.article>
                      )
                    }
                  )
                ) : (
                  <div className="flex min-h-[420px] items-center justify-center text-center">
                    <div>
                      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-cyan-300/20 bg-cyan-300/10">
                        <Rocket className="h-7 w-7 text-cyan-200" />
                      </div>
                      <p className="mt-6 text-sm uppercase tracking-[0.28em] text-cyan-100/65">
                        Sin resultados
                      </p>
                      <p className="mx-auto mt-4 max-w-xl text-lg leading-8 text-zinc-400">
                        Ajusta país, ciudad, canal o búsqueda para ver puntos
                        de venta configurados desde Admin.
                      </p>
                    </div>
                  </div>
                )}
              </div>

            </div>

          </div>

        </motion.div>

        {hasMore && (
          <div className="mt-12 flex justify-center">
            <button
              type="button"
              onClick={() =>
                loadDistribution(false)
              }
              disabled={isLoading}
              className="
                rounded-2xl
                border
                border-cyan-300/20
                bg-cyan-300/10
                px-7
                py-4
                text-xs
                font-semibold
                uppercase
                tracking-[0.22em]
                text-cyan-100
                transition-all
                duration-300
                hover:bg-cyan-300/20
                disabled:cursor-not-allowed
                disabled:opacity-45
              "
            >
              {isLoading
                ? "Cargando..."
                : "Ver más distribución"}
            </button>
          </div>
        )}

      </div>

    </section>
  )

}
