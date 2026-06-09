"use client"

import Link from "next/link"

import {
  motion,
  useInView,
} from "framer-motion"

import {
  Building2,
  Globe2,
  MapPin,
  Rocket,
  ShoppingBag,
  Store,
} from "lucide-react"

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import {
  getProducts,
  getProductStates,
} from "@/lib/products-service"

import { supabase } from "@/lib/supabase"

type DistributionChannel = {
  id: string
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
  distribution_channels?: DistributionChannel[]
}

type ProductState = {
  id: string
  name: string
}

const fallbackChannels = [
  {
    icon: Globe2,
    title: "Países",
    text: "Nuevos territorios se activarán conforme cada producto entre a comercialización.",
  },
  {
    icon: Building2,
    title: "Mercados",
    text: "Canales regionales, retail y distribución selectiva se publicarán por producto.",
  },
  {
    icon: Store,
    title: "Establecimientos",
    text: "Puntos físicos autorizados aparecerán cuando la disponibilidad esté confirmada.",
  },
  {
    icon: ShoppingBag,
    title: "Marketplaces",
    text: "Amazon, TikTok Shop, eBay u otros canales se mostrarán cuando estén activos.",
  },
]

const channelIcons: Record<string, typeof Globe2> = {
  pais: Globe2,
  país: Globe2,
  mercado: Building2,
  establecimiento: Store,
  marketplace: ShoppingBag,
}

function getChannelIcon(
  type: string
) {

  return (
    channelIcons[type.toLowerCase()] ||
    MapPin
  )

}

export function GlobalSection() {

  const ref =
    useRef(null)

  const isInView =
    useInView(ref, {
      once: true,
      margin: "-100px",
    })

  const [
    products,
    setProducts,
  ] = useState<Product[]>([])

  useEffect(() => {

    async function loadDistribution() {

      const productData =
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

      const commercialProducts =
        (productData as Product[]).filter(
          (product) => {

            const stateName =
              product.state_id
                ? stateMap.get(
                    product.state_id
                  )
                : ""

            return Boolean(
              stateName?.includes(
                "Comercialización"
              )
            )

          }
        )

      setProducts(commercialProducts)

    }

    loadDistribution()

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
          loadDistribution
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "product_states",
          },
          loadDistribution
        )
        .subscribe()

    return () => {

      supabase.removeChannel(channel)

    }

  }, [])

  const distribution =
    useMemo(
      () =>
        products.flatMap(
          (product) =>
            (
              product.distribution_channels ||
              []
            ).map((channel) => ({
              ...channel,
              productName:
                product.name,
              productCategory:
                product.category,
            }))
        ),
      [products]
    )

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

      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.09),transparent_46%)]" />
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
              Distribución comercial
            </span>
          </div>

          <h2 className="mx-auto mt-10 max-w-6xl text-5xl font-black leading-[1.02] tracking-[-0.04em] text-white sm:text-6xl lg:text-7xl">
            Canales activos del
            <span className="block bg-gradient-to-r from-cyan-200 via-cyan-400 to-white bg-clip-text text-transparent">
              ecosistema IMNOVA
            </span>
          </h2>

          <p className="mx-auto mt-9 max-w-4xl text-xl leading-9 text-zinc-300">
            Cuando un producto entra a comercialización, el equipo IMNOVA puede
            publicar desde Admin los países, mercados, establecimientos y
            marketplaces donde se está distribuyendo.
          </p>

        </motion.div>

        <div className="mt-20">

          {distribution.length > 0 ? (
            <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
              {distribution.map((channel, index) => {
                const Icon =
                  getChannelIcon(
                    channel.type
                  )

                const content = (
                  <motion.div
                    initial={{
                      opacity: 0,
                      y: 28,
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
                      duration: 0.6,
                      delay:
                        index * 0.06,
                    }}
                    className="
                      group
                      relative
                      h-full
                      overflow-hidden
                      rounded-[30px]
                      border
                      border-cyan-200/10
                      bg-white/[0.035]
                      p-7
                      backdrop-blur-2xl
                      transition-all
                      duration-500
                      hover:-translate-y-1
                      hover:border-cyan-300/25
                      hover:bg-white/[0.055]
                    "
                  >
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.12),transparent_42%)] opacity-0 transition-opacity duration-500 group-hover:opacity-100" />

                    <div className="relative z-10">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-cyan-300/20 bg-cyan-300/10">
                          <Icon className="h-6 w-6 text-cyan-200" />
                        </div>

                        <span className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-[10px] uppercase tracking-[0.22em] text-cyan-100/70">
                          {channel.status || "Activo"}
                        </span>
                      </div>

                      <p className="mt-7 text-[10px] uppercase tracking-[0.32em] text-cyan-200/55">
                        {channel.type}
                      </p>

                      <h3 className="mt-3 text-3xl font-black tracking-[-0.04em] text-white">
                        {channel.name}
                      </h3>

                      <p className="mt-4 flex items-center gap-2 text-sm text-zinc-300">
                        <MapPin className="h-4 w-4 text-cyan-300" />
                        {channel.location}
                      </p>

                      <div className="mt-7 border-t border-white/10 pt-5">
                        <p className="text-xs uppercase tracking-[0.25em] text-white/35">
                          Producto
                        </p>
                        <p className="mt-2 text-lg font-semibold text-white">
                          {channel.productName}
                        </p>
                        {channel.note && (
                          <p className="mt-3 text-sm leading-6 text-zinc-400">
                            {channel.note}
                          </p>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )

                return channel.url ? (
                  <Link
                    key={channel.id}
                    href={channel.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {content}
                  </Link>
                ) : (
                  <div key={channel.id}>
                    {content}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
              {fallbackChannels.map(
                (item, index) => {
                  const Icon =
                    item.icon

                  return (
                    <motion.div
                      key={item.title}
                      initial={{
                        opacity: 0,
                        y: 24,
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
                        duration: 0.6,
                        delay:
                          index * 0.08,
                      }}
                      className="
                        rounded-[30px]
                        border
                        border-white/10
                        bg-white/[0.03]
                        p-7
                        backdrop-blur-2xl
                      "
                    >
                      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-cyan-300/20 bg-cyan-300/10">
                        <Icon className="h-6 w-6 text-cyan-200" />
                      </div>
                      <h3 className="mt-7 text-2xl font-black text-white">
                        {item.title}
                      </h3>
                      <p className="mt-4 text-sm leading-7 text-zinc-400">
                        {item.text}
                      </p>
                    </motion.div>
                  )
                }
              )}
            </div>
          )}

        </div>

      </div>

    </section>
  )

}
