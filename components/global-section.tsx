"use client"

import Link from "next/link"

import {
  motion,
  useInView,
} from "framer-motion"

import {
  Building2,
  ExternalLink,
  Globe2,
  LocateFixed,
  MapPin,
  Navigation,
  Rocket,
  Search,
  ShoppingBag,
  SlidersHorizontal,
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
  getAvailableDistributionLocationsPage,
  type DistributionLocation,
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
  address?: string
  latitude?: number | string
  longitude?: number | string
  lat?: number | string
  lng?: number | string
  map_url?: string
  maps_url?: string
  google_maps_url?: string
}

type DistributionItem = DistributionChannel & {
  productId: string
  productName: string
  productCategory?: string
  productImage?: string | null
}

type UserLocation = {
  latitude: number
  longitude: number
}

const distributionPageSize = 12

const channelIcons: Record<string, typeof Store> = {
  marketplace: ShoppingBag,
  mercado: Building2,
  establecimiento: Store,
  producto: Rocket,
}

function getLocationProduct(
  location: DistributionLocation
) {
  if (Array.isArray(location.products)) {
    return location.products[0] || null
  }

  return location.products || null
}

function getDistributionLocationType(
  location: DistributionLocation
) {
  if (
    location.channel_category ===
    "marketplace"
  ) {
    return "Marketplace"
  }

  const channelType =
    location.channel_type || "establecimiento"

  const labels: Record<string, string> = {
    mercado: "Mercado",
    tienda_conveniencia:
      "Tienda de conveniencia",
    establecimiento:
      "Establecimiento",
    supermercado: "Supermercado",
    farmacia: "Farmacia",
    gimnasio: "Gimnasio",
    distribuidor: "Distribuidor",
    marketplace: "Marketplace",
    otro: "Otro",
  }

  return labels[channelType] || channelType
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
    address?: string
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
    item.address ||
    structured ||
    item.location ||
    "Ubicación en preparación"
  )

}

function parseCoordinate(
  value?: number | string | null
) {

  if (
    value === null ||
    value === undefined
  ) {
    return null
  }

  const parsed =
    typeof value === "number"
      ? value
      : Number.parseFloat(
          value
            .replace(",", ".")
            .trim()
        )

  return Number.isFinite(parsed)
    ? parsed
    : null

}

function getChannelCoordinates(
  item: DistributionItem
) {

  const latitude =
    parseCoordinate(
      item.latitude ?? item.lat
    )

  const longitude =
    parseCoordinate(
      item.longitude ?? item.lng
    )

  if (
    latitude === null ||
    longitude === null ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null
  }

  return {
    latitude,
    longitude,
  }

}

function calculateDistanceKm(
  from: UserLocation,
  to: UserLocation
) {

  const earthRadiusKm = 6371
  const toRadians =
    (degrees: number) =>
      degrees * (Math.PI / 180)

  const deltaLatitude =
    toRadians(
      to.latitude - from.latitude
    )

  const deltaLongitude =
    toRadians(
      to.longitude - from.longitude
    )

  const originLatitude =
    toRadians(from.latitude)

  const destinationLatitude =
    toRadians(to.latitude)

  const a =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(originLatitude) *
      Math.cos(destinationLatitude) *
      Math.sin(deltaLongitude / 2) ** 2

  const c =
    2 *
    Math.atan2(
      Math.sqrt(a),
      Math.sqrt(1 - a)
    )

  return earthRadiusKm * c

}

function formatDistance(
  distanceKm: number
) {

  if (distanceKm < 1) {
    return `${Math.round(
      distanceKm * 1000
    )} m`
  }

  return `${distanceKm.toFixed(
    distanceKm < 10
      ? 1
      : 0
  )} km`

}

function isPhysicalChannel(
  item: DistributionItem
) {

  const type =
    item.type.toLowerCase()

  return (
    !type.includes("marketplace") &&
    !type.includes("online")
  )

}

function getDirectionsUrl(
  item: DistributionItem
) {

  if (item.map_url) {
    return item.map_url
  }

  if (item.maps_url) {
    return item.maps_url
  }

  if (item.google_maps_url) {
    return item.google_maps_url
  }

  const coordinates =
    getChannelCoordinates(item)

  const query =
    coordinates
      ? `${coordinates.latitude},${coordinates.longitude}`
      : [
          item.name,
          item.address,
          item.location,
          item.city,
          item.country,
        ]
          .filter(Boolean)
          .join(" ")

  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    query
  )}`

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
    distributionLocations,
    setDistributionLocations,
  ] = useState<DistributionLocation[]>([])

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

  const [
    userLocation,
    setUserLocation,
  ] = useState<UserLocation | null>(null)

  const [
    hasLocatorIntent,
    setHasLocatorIntent,
  ] = useState(false)

  const [
    locationStatus,
    setLocationStatus,
  ] = useState<
    | "idle"
    | "loading"
    | "ready"
    | "unsupported"
    | "error"
  >("idle")

  const [
    locationMessage,
    setLocationMessage,
  ] = useState(
    "Activa tu ubicacion para encontrar el distribuidor fisico mas cercano."
  )

  const requestUserLocation =
    useCallback(() => {

      if (!("geolocation" in navigator)) {
        setLocationStatus("unsupported")
        setLocationMessage(
          "Tu navegador no permite usar ubicacion. Puedes buscar manualmente por pais y ciudad."
        )
        return
      }

      setLocationStatus("loading")
      setLocationMessage(
        "Buscando el distribuidor mas cercano..."
      )

      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            latitude:
              position.coords.latitude,
            longitude:
              position.coords.longitude,
          })
          setLocationStatus("ready")
          setLocationMessage(
            "Ubicacion detectada. Calculamos el distribuidor mas cercano con coordenadas registradas."
          )
        },
        () => {
          setLocationStatus("error")
          setLocationMessage(
            "No pudimos acceder a tu ubicacion. Usa los filtros para buscar por pais, ciudad o canal."
          )
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 60000,
        }
      )

    }, [])

  const loadDistribution =
    useCallback(
      async (
        reset = false
      ) => {

        setIsLoading(true)

        const from =
          reset
            ? 0
            : productsCountRef.current

        const locationPage =
          Math.floor(
            from / distributionPageSize
          )

        const locationsResult =
          await getAvailableDistributionLocationsPage({
            limit:
              distributionPageSize,
            page:
              locationPage,
          })

        const nextLocations =
          locationsResult.error
            ? []
            : locationsResult.locations

        productsCountRef.current =
          reset
            ? nextLocations.length
            : productsCountRef.current +
              nextLocations.length

        setDistributionLocations(
          currentLocations =>
            reset
              ? nextLocations
              : [
                  ...currentLocations,
                  ...nextLocations,
                ]
        )

        setHasMore(
          !locationsResult.error &&
            from +
              nextLocations.length <
              locationsResult.count
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
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table:
              "distribution_locations",
          },
          () =>
            loadDistribution(true)
        )
        .subscribe()

    return () => {

      supabase.removeChannel(channel)

    }

  }, [loadDistribution])

  useEffect(() => {

    const params =
      new URLSearchParams(
        window.location.search
      )

    const locator =
      params.get("locator")

    const source =
      params.get("source") ||
      params.get("utm_source")

    const hasIntent =
      locator === "nearest" ||
      locator === "distribuidor" ||
      source === "whatsapp"

    if (!hasIntent) {
      return
    }

    setHasLocatorIntent(true)
    setLocationMessage(
      "Vienes desde WhatsApp. Toca el boton para permitir ubicacion y ver tu distribuidor IMNOVA mas cercano."
    )

    window.setTimeout(() => {
      document
        .getElementById(
          "where-to-buy-map"
        )
        ?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        })
    }, 450)

  }, [])

  const distribution =
    useMemo<DistributionItem[]>(
      () => {

        if (
          distributionLocations.length > 0
        ) {
          return distributionLocations.map(
            (location) => {
              const product =
                getLocationProduct(
                  location
                )

              const locationText =
                location.area ||
                location.address ||
                [
                  location.city,
                  location.country,
                ]
                  .filter(Boolean)
                  .join(", ")

              return {
                id:
                  location.id,
                productId:
                  location.product_id,
                country:
                  location.country ||
                  undefined,
                city:
                  location.city ||
                  undefined,
                type:
                  getDistributionLocationType(
                    location
                  ),
                name:
                  location.name,
                location:
                  locationText ||
                  "Ubicacion registrada",
                status:
                  location.availability_status ||
                  "activo",
                url:
                  location.product_url ||
                  undefined,
                note:
                  location.description ||
                  undefined,
                address:
                  location.address ||
                  undefined,
                latitude:
                  location.latitude ||
                  undefined,
                longitude:
                  location.longitude ||
                  undefined,
                map_url:
                  location.map_url ||
                  undefined,
                productName:
                  product?.name ||
                  "Producto IMNOVA",
                productCategory:
                  product?.category ||
                  undefined,
                productImage:
                  product?.image_url ||
                  product?.image ||
                  null,
              }
            }
          )
        }

        return []
      },
      [
        distributionLocations,
      ]
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

  const nearestDistribution =
    useMemo(
      () => {

        if (!userLocation) {
          return null
        }

        return filteredDistribution
          .filter(isPhysicalChannel)
          .map(item => {
            const coordinates =
              getChannelCoordinates(item)

            if (!coordinates) {
              return null
            }

            return {
              item,
              distanceKm:
                calculateDistanceKm(
                  userLocation,
                  coordinates
                ),
            }
          })
          .filter(
            (
              result
            ): result is {
              item: DistributionItem
              distanceKm: number
            } => Boolean(result)
          )
          .sort(
            (first, second) =>
              first.distanceKm -
              second.distanceKm
          )[0] || null

      },
      [
        filteredDistribution,
        userLocation,
      ]
    )

  const groupedDistribution =
    useMemo(
      () => {

        const groups =
          new Map<
            string,
            {
              key: string
              country: string
              city: string
              items: DistributionItem[]
            }
          >()

        filteredDistribution.forEach(
          item => {

            const country =
              item.country ||
              "País por definir"

            const city =
              item.city ||
              item.location ||
              "Ciudad por definir"

            const key =
              `${country}-${city}`

            const group =
              groups.get(key) || {
                key,
                country,
                city,
                items: [],
              }

            group.items.push(item)
            groups.set(
              key,
              group
            )

          }
        )

        return Array.from(
          groups.values()
        )

      },
      [filteredDistribution]
    )

  const activeFilterPath =
    [
      activeCountry === "Todos"
        ? "Todos los países"
        : activeCountry,
      activeCity === "Todas"
        ? "Todas las ciudades"
        : activeCity,
      activeType === "Todos"
        ? "Todos los canales"
        : activeType,
    ]

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

  const featuredDistribution =
    nearestDistribution?.item ||
    filteredDistribution[0] ||
    null

  const featuredDistance =
    nearestDistribution &&
    featuredDistribution &&
    featuredDistribution.id ===
      nearestDistribution.item.id &&
    featuredDistribution.productId ===
      nearestDistribution.item.productId
      ? nearestDistribution.distanceKm
      : null

  const hasActiveFilters =
    activeCountry !== "Todos" ||
    activeCity !== "Todas" ||
    activeType !== "Todos" ||
    searchTerm.trim().length > 0

  const mapPreviewItems =
    filteredDistribution
      .filter(item =>
        Boolean(
          getChannelCoordinates(item)
        )
      )
      .slice(0, 5)

  return (
    <section
      id="where-to-buy"
      ref={ref}
      className="
        relative
        isolate
        scroll-mt-28
        overflow-hidden
        bg-[#f4efe6]
        py-24
        md:scroll-mt-32
        md:py-32
      "
    >

      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_10%,rgba(34,211,238,0.18),transparent_30%),radial-gradient(circle_at_82%_18%,rgba(245,158,11,0.16),transparent_28%),linear-gradient(180deg,#f8f4ec_0%,#efe6d7_100%)]" />
      <div className="absolute inset-0 opacity-[0.32] bg-[linear-gradient(rgba(15,23,42,0.055)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.055)_1px,transparent_1px)] bg-[size:64px_64px]" />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-stone-300 to-transparent" />

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
          className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[0.92fr_1.08fr] lg:items-end"
        >

          <div>
            <div className="inline-flex items-center gap-3 rounded-full border border-cyan-700/20 bg-white/70 px-5 py-3 shadow-sm backdrop-blur-2xl">
              <Rocket className="h-4 w-4 text-cyan-700" />
              <span className="text-xs font-black uppercase tracking-[0.35em] text-cyan-800">
                IMNOVA Locator
              </span>
            </div>

          <h2 className="mt-8 max-w-4xl text-5xl font-black leading-[0.98] tracking-[-0.05em] text-stone-950 sm:text-6xl lg:text-7xl">
            Encuentra tu punto
            <span className="block text-cyan-800">
              IMNOVA mas cercano.
            </span>
          </h2>

          <p className="mt-7 max-w-3xl text-lg leading-9 text-stone-600">
            Activa tu ubicacion o filtra por ciudad para ver canales
            autorizados con productos disponibles. Solo mostramos productos
            listos para compra y rutas reales cuando quieras llegar.
          </p>

          {hasLocatorIntent && (
            <div className="mt-6 rounded-[28px] border border-cyan-500/25 bg-cyan-50/80 p-5 shadow-[0_18px_50px_rgba(34,211,238,0.16)] backdrop-blur">
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-cyan-800">
                Vienes desde WhatsApp
              </p>
              <p className="mt-2 text-sm font-bold leading-6 text-stone-700">
                Pulsa el boton resaltado para permitir ubicacion y calcular el
                distribuidor autorizado mas cercano a ti.
              </p>
            </div>
          )}

          <div className="mt-8 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={requestUserLocation}
              disabled={locationStatus === "loading"}
              className={`inline-flex min-h-14 items-center justify-center gap-3 rounded-full bg-cyan-200 px-7 text-xs font-black uppercase tracking-[0.16em] text-stone-950 shadow-[0_18px_42px_rgba(34,211,238,0.24)] transition hover:-translate-y-0.5 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 ${
                hasLocatorIntent
                  ? "ring-4 ring-cyan-300/45"
                  : ""
              }`}
            >
              <Navigation className="h-4 w-4" />
              {locationStatus === "loading"
                ? "Buscando..."
                : "Distribuidor mas cercano"}
            </button>

            <Link
              href="/store"
              className="inline-flex min-h-14 items-center justify-center gap-3 rounded-full bg-stone-950 px-7 text-xs font-black uppercase tracking-[0.16em] text-white shadow-[0_18px_42px_rgba(15,23,42,0.22)] transition hover:-translate-y-0.5 hover:bg-stone-800"
            >
              <ShoppingBag className="h-4 w-4" />
              Comprar en Store
            </Link>

            <a
              href="#where-to-buy-map"
              className="inline-flex min-h-14 items-center justify-center gap-3 rounded-full border border-stone-300 bg-white/80 px-7 text-xs font-black uppercase tracking-[0.16em] text-stone-900 shadow-sm backdrop-blur transition hover:-translate-y-0.5 hover:bg-white"
            >
              <MapPin className="h-4 w-4" />
              Ver canales
            </a>
          </div>

          <div className="mt-8 grid gap-3 text-left sm:grid-cols-3">
            {[
              "Activa ubicacion",
              "Compara canales",
              "Abre la ruta real",
            ].map(
              (step, index) => (
                <div
                  key={step}
                  className="rounded-[24px] border border-stone-200 bg-white/70 px-4 py-4 shadow-sm backdrop-blur"
                >
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-700">
                    Paso 0{index + 1}
                  </p>
                  <p className="mt-2 text-sm font-black text-stone-900">
                    {step}
                  </p>
                </div>
              )
            )}
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            {[
              "Canales autorizados",
              "Producto disponible",
              "Ruta real en Maps",
              "Compra clara",
            ].map(item => (
              <span
                key={item}
                className="rounded-full border border-stone-300 bg-white/65 px-4 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-stone-700 shadow-sm backdrop-blur"
              >
                {item}
              </span>
            ))}
          </div>
          </div>

          <div className="relative overflow-hidden rounded-[42px] border border-stone-200 bg-stone-950 p-4 shadow-[0_34px_100px_rgba(15,23,42,0.28)]">
            <div className="relative min-h-[420px] overflow-hidden rounded-[32px] border border-white/10 bg-[radial-gradient(circle_at_20%_20%,rgba(34,211,238,0.20),transparent_28%),radial-gradient(circle_at_72%_32%,rgba(245,158,11,0.18),transparent_24%),linear-gradient(135deg,#071312_0%,#050505_58%,#1d160b_100%)]">
              <div className="absolute inset-0 opacity-[0.12] bg-[linear-gradient(rgba(255,255,255,0.22)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.22)_1px,transparent_1px)] bg-[size:48px_48px]" />
              <div className="absolute left-[12%] right-[12%] top-[45%] h-px rotate-[-12deg] bg-gradient-to-r from-transparent via-cyan-200/80 to-transparent" />
              <div className="absolute left-[26%] right-[18%] top-[60%] h-px rotate-[14deg] bg-gradient-to-r from-transparent via-amber-200/60 to-transparent" />

              <div className="absolute left-5 top-5 rounded-full border border-cyan-200/20 bg-black/45 px-4 py-2 text-[10px] font-black uppercase tracking-[0.20em] text-cyan-100 backdrop-blur">
                IMNOVA Locator
              </div>

              <div className="absolute right-5 top-5 rounded-full border border-emerald-200/20 bg-emerald-300/10 px-4 py-2 text-[10px] font-black uppercase tracking-[0.20em] text-emerald-100 backdrop-blur">
                {filteredDistribution.length} canal
                {filteredDistribution.length === 1
                  ? ""
                  : "es"}{" "}
                activo
                {filteredDistribution.length === 1
                  ? ""
                  : "s"}
              </div>

              {mapPreviewItems.map(
                (item, index) => {
                  const positions = [
                    "left-[18%] top-[30%]",
                    "left-[58%] top-[24%]",
                    "left-[72%] top-[54%]",
                    "left-[34%] top-[68%]",
                    "left-[48%] top-[44%]",
                  ]
                  const isFeatured =
                    featuredDistribution &&
                    item.id === featuredDistribution.id &&
                    item.productId === featuredDistribution.productId

                  return (
                    <div
                      key={`${item.productId}-${item.id}-map`}
                      className={`absolute ${positions[index % positions.length]}`}
                    >
                      <div
                        className={`relative flex h-12 w-12 items-center justify-center rounded-full border backdrop-blur-xl ${
                          isFeatured
                            ? "border-amber-200 bg-amber-300 text-stone-950 shadow-[0_0_42px_rgba(251,191,36,0.45)]"
                            : "border-cyan-200/45 bg-cyan-300/20 text-cyan-50 shadow-[0_0_32px_rgba(34,211,238,0.20)]"
                        }`}
                      >
                        {isFeatured && (
                          <span className="absolute inset-0 rounded-full bg-amber-200/40 animate-ping" />
                        )}
                        <MapPin className="h-5 w-5" />
                        <span className="absolute -right-1 -top-1 h-4 w-4 rounded-full border border-white/35 bg-cyan-200" />
                      </div>
                    </div>
                  )
                }
              )}

              <div className="absolute bottom-5 left-5 right-5 rounded-[28px] border border-white/10 bg-black/60 p-5 backdrop-blur-2xl">
                <p className="text-[10px] font-black uppercase tracking-[0.20em] text-cyan-100/70">
                  {featuredDistance !== null
                    ? "Distribuidor mas cercano"
                    : "Canal destacado"}
                </p>
                <h3 className="mt-3 line-clamp-1 text-2xl font-black tracking-[-0.04em] text-white">
                  {featuredDistribution?.name ||
                    "Activa ubicacion para ver el mas cercano"}
                </h3>
                <p className="mt-2 line-clamp-1 text-sm font-semibold text-white/65">
                  {featuredDistribution?.productName ||
                    "Los canales aparecen cuando hay productos disponibles."}
                </p>
                <p className="mt-3 text-xs leading-5 text-white/45">
                  Solo mostramos canales confirmados y productos que ya estan
                  disponibles para compra.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {featuredDistance !== null && (
                    <span className="rounded-full border border-emerald-200/20 bg-emerald-300/10 px-3 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-emerald-100">
                      {formatDistance(featuredDistance)} aprox.
                    </span>
                  )}
                  {featuredDistribution && (
                    <a
                      href={getDirectionsUrl(featuredDistribution)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-stone-950 transition hover:bg-cyan-100"
                    >
                      Como llegar
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
              </div>
            </div>
          </div>

        </motion.div>

        <motion.div
          id="where-to-buy-map"
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
            scroll-mt-32
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

              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-300/20 bg-cyan-300/10">
                  <SlidersHorizontal className="h-5 w-5 text-cyan-200" />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.30em] text-cyan-200/60">
                    Ruta guiada
                  </p>
                  <h3 className="mt-1 text-2xl font-black text-white">
                    Encuentra tu punto
                  </h3>
                </div>
              </div>

              <p className="mt-3 text-sm leading-6 text-zinc-500">
                Primero localizamos canales autorizados. Luego eliges si compras
                en Store, marketplace o visitas un punto fisico cercano.
              </p>

              <div className="mt-6 rounded-[24px] border border-cyan-300/20 bg-cyan-300/[0.06] p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-cyan-200/20 bg-cyan-300/10">
                    <LocateFixed className="h-5 w-5 text-cyan-100" />
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.22em] text-cyan-100/65">
                      Punto mas cercano
                    </p>
                    <p className="mt-2 text-sm leading-6 text-zinc-400">
                      {locationMessage}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={requestUserLocation}
                  disabled={locationStatus === "loading"}
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-cyan-200/25 bg-cyan-300/[0.12] px-5 py-3 text-[10px] font-black uppercase tracking-[0.16em] text-cyan-50 transition hover:border-cyan-100/45 hover:bg-cyan-300/[0.18] disabled:cursor-not-allowed disabled:opacity-55"
                >
                  <Navigation className="h-4 w-4" />
                  {locationStatus === "loading"
                    ? "Detectando..."
                    : "Encontrar distribuidor mas cercano"}
                </button>

                {locationStatus === "ready" &&
                  nearestDistribution && (
                    <div className="mt-4 rounded-2xl border border-emerald-200/20 bg-emerald-300/[0.08] p-4">
                      <p className="text-[10px] uppercase tracking-[0.18em] text-emerald-100/70">
                        Mas cercano
                      </p>
                      <p className="mt-2 line-clamp-1 text-lg font-black text-white">
                        {nearestDistribution.item.name}
                      </p>
                      <p className="mt-1 text-xs text-zinc-400">
                        {nearestDistribution.item.productName}
                      </p>
                      <p className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-emerald-100">
                        <MapPin className="h-4 w-4" />
                        {formatDistance(
                          nearestDistribution.distanceKm
                        )}{" "}
                        aprox.
                      </p>
                      <a
                        href={getDirectionsUrl(
                          nearestDistribution.item
                        )}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-100 px-4 py-3 text-[10px] font-black uppercase tracking-[0.16em] text-black transition hover:bg-white"
                      >
                        Como llegar
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </div>
                  )}

                {locationStatus === "ready" &&
                  !nearestDistribution && (
                    <p className="mt-4 rounded-2xl border border-amber-200/15 bg-amber-200/[0.06] p-3 text-xs leading-5 text-amber-100/75">
                      Todavia no hay puntos fisicos con coordenadas para este
                      filtro. Puedes buscar manualmente por pais y ciudad.
                    </p>
                  )}
              </div>

              <div className="mt-7 grid gap-4">

                <label className="grid gap-2">
                  <span className="text-xs uppercase tracking-[0.22em] text-white/35">
                    1. País
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
                    2. Ciudad
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
                    3. Canal
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
                    4. Buscar
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

              <div className="mt-6 rounded-[24px] border border-cyan-300/15 bg-cyan-300/[0.055] p-4">
                <p className="text-[10px] uppercase tracking-[0.22em] text-cyan-100/55">
                  Ruta seleccionada
                </p>

                <div className="mt-3 flex flex-wrap gap-2">
                  {activeFilterPath.map(
                    item => (
                      <span
                        key={item}
                        className="rounded-full border border-white/10 bg-black/35 px-3 py-2 text-[10px] uppercase tracking-[0.14em] text-zinc-200"
                      >
                        {item}
                      </span>
                    )
                  )}
                </div>

                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={() => {
                      setActiveCountry("Todos")
                      setActiveCity("Todas")
                      setActiveType("Todos")
                      setSearchTerm("")
                    }}
                    className="mt-4 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-cyan-100 transition hover:bg-white/[0.08]"
                  >
                    Limpiar filtros
                  </button>
                )}
              </div>

              <div className="mt-8 grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-white/35">
                    Online
                  </p>
                  <p className="mt-3 text-3xl font-black text-white">
                    {marketplaceCount}
                  </p>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-white/35">
                    Puntos físicos
                  </p>
                  <p className="mt-3 text-3xl font-black text-white">
                    {physicalCount}
                  </p>
                </div>
              </div>

              <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.025] p-4">
                <p className="text-[10px] uppercase tracking-[0.18em] text-white/35">
                  Países
                </p>
                <p className="mt-2 text-2xl font-black text-white">
                  {activeCountriesCount}
                </p>
              </div>

            </aside>

            <div className="relative min-h-[620px] p-6 md:p-8">

              <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_20%,rgba(34,211,238,0.10),transparent_32%)]" />

              <div className="relative z-10">
                <div className="mb-6 rounded-[28px] border border-white/10 bg-black/35 p-5">
                  <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.28em] text-cyan-100/55">
                        Canales autorizados
                      </p>
                      <h3 className="mt-2 text-3xl font-black text-white">
                        {filteredDistribution.length} resultado
                        {filteredDistribution.length === 1
                          ? ""
                          : "s"}
                      </h3>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {activeFilterPath.map(
                        item => (
                          <span
                            key={item}
                            className="rounded-full border border-white/10 bg-white/[0.035] px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-zinc-300"
                          >
                            {item}
                          </span>
                        )
                      )}
                    </div>
                  </div>
                </div>

                {featuredDistribution && (
                  <div className="mb-6 overflow-hidden rounded-[30px] border border-cyan-300/20 bg-gradient-to-br from-cyan-300/[0.12] via-white/[0.04] to-amber-300/[0.08] p-5">
                    {(() => {
                      const Icon =
                        getChannelIcon(
                          featuredDistribution.type
                        )

                      return (
                        <div className="grid gap-5 md:grid-cols-[96px_1fr_auto] md:items-center">
                          <div className="relative flex h-24 w-24 items-center justify-center overflow-hidden rounded-3xl border border-cyan-200/20 bg-black/35">
                            {featuredDistribution.productImage ? (
                              <img
                                src={featuredDistribution.productImage}
                                alt={featuredDistribution.productName}
                                className="h-full w-full object-contain p-2"
                              />
                            ) : (
                              <Icon className="h-9 w-9 text-cyan-100" />
                            )}
                          </div>

                          <div className="min-w-0">
                            <div className="flex flex-wrap gap-2">
                              <span className="inline-flex items-center gap-2 rounded-full border border-cyan-200/20 bg-cyan-300/[0.12] px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-cyan-100">
                                <Icon className="h-3.5 w-3.5" />
                                {featuredDistance !== null
                                  ? "Distribuidor mas cercano"
                                  : "Mejor coincidencia"}
                              </span>
                              <span className="rounded-full border border-white/10 bg-black/25 px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-zinc-300">
                                {featuredDistribution.type}
                              </span>
                              {featuredDistance !== null && (
                                <span className="rounded-full border border-emerald-200/20 bg-emerald-300/[0.08] px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-emerald-100">
                                  {formatDistance(
                                    featuredDistance
                                  )}{" "}
                                  aprox.
                                </span>
                              )}
                            </div>

                            <h4 className="mt-3 line-clamp-1 text-3xl font-black tracking-[-0.04em] text-white">
                              {featuredDistribution.name}
                            </h4>

                            <p className="mt-2 text-sm font-semibold text-white/80">
                              {featuredDistribution.productName}
                            </p>

                            <p className="mt-2 inline-flex items-center gap-2 text-sm text-zinc-400">
                              <MapPin className="h-4 w-4 text-cyan-200" />
                              {getChannelLocation(featuredDistribution)}
                            </p>
                          </div>

                          <div className="flex md:justify-end">
                            {featuredDistribution.type === "Marketplace" &&
                            featuredDistribution.url ? (
                              <a
                                href={featuredDistribution.url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-cyan-200/25 bg-cyan-300/[0.12] px-5 py-3 text-xs font-black uppercase tracking-[0.16em] text-cyan-50 transition hover:bg-cyan-300/[0.20]"
                              >
                                Abrir canal
                                <ExternalLink className="h-3.5 w-3.5" />
                              </a>
                            ) : (
                              <a
                                href={getDirectionsUrl(featuredDistribution)}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-black/25 px-5 py-3 text-xs font-black uppercase tracking-[0.16em] text-cyan-50 transition hover:border-cyan-200/25 hover:bg-cyan-300/[0.10]"
                              >
                                Como llegar
                                <MapPin className="h-3.5 w-3.5" />
                              </a>
                            )}
                          </div>
                        </div>
                      )
                    })()}
                  </div>
                )}

                {groupedDistribution.length > 0 ? (
                  <div className="grid gap-6">
                    {groupedDistribution.map(
                      (group) => (
                        <section
                          key={group.key}
                          className="rounded-[30px] border border-white/10 bg-white/[0.025] p-4 md:p-5"
                        >
                          <div className="flex flex-col gap-3 border-b border-white/10 pb-4 md:flex-row md:items-center md:justify-between">
                            <div>
                              <p className="text-[10px] uppercase tracking-[0.24em] text-cyan-100/55">
                                Ubicación
                              </p>
                              <h4 className="mt-2 text-2xl font-black text-white">
                                {group.country}
                              </h4>
                              <p className="mt-2 inline-flex items-center gap-2 text-sm text-zinc-400">
                                <MapPin className="h-4 w-4 text-cyan-300" />
                                {group.city}
                              </p>
                            </div>

                            <span className="rounded-full border border-cyan-300/15 bg-cyan-300/[0.07] px-4 py-2 text-[10px] uppercase tracking-[0.18em] text-cyan-100">
                              {group.items.length} canal
                              {group.items.length === 1
                                ? ""
                                : "es"}
                            </span>
                          </div>

                          <div className="mt-5 grid gap-4">
                            {group.items.map(
                              (item, index) => {
                                const Icon =
                                  getChannelIcon(
                                    item.type
                                  )
                                const itemCoordinates =
                                  getChannelCoordinates(item)
                                const itemDistance =
                                  userLocation &&
                                  itemCoordinates
                                    ? calculateDistanceKm(
                                        userLocation,
                                        itemCoordinates
                                      )
                                    : null

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
                                        index *
                                        0.025,
                                    }}
                                    className="
                                      group
                                      grid
                                      gap-5
                                      rounded-[26px]
                                      border
                                      border-white/10
                                      bg-black/35
                                      p-4
                                      backdrop-blur-2xl
                                      transition-all
                                      duration-500
                                      hover:-translate-y-1
                                      hover:border-cyan-300/25
                                      hover:bg-white/[0.05]
                                      md:grid-cols-[82px_1fr_auto]
                                      md:items-center
                                    "
                                  >
                                    <div className="relative flex h-20 w-20 items-center justify-center overflow-hidden rounded-3xl border border-cyan-300/15 bg-cyan-300/[0.055]">
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
                                      <div className="flex flex-wrap items-center gap-2">
                                        <span className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-cyan-100">
                                          <Icon className="h-3.5 w-3.5" />
                                          {item.type}
                                        </span>

                                        <span className="rounded-full border border-white/10 bg-white/[0.035] px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-white/55">
                                          {item.status}
                                        </span>

                                        {itemDistance !== null && (
                                          <span className="rounded-full border border-emerald-200/20 bg-emerald-300/[0.08] px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-emerald-100">
                                            {formatDistance(itemDistance)}
                                          </span>
                                        )}
                                      </div>

                                      <h5 className="mt-3 line-clamp-1 text-2xl font-black tracking-[-0.03em] text-white">
                                        {item.name}
                                      </h5>

                                      <p className="mt-2 text-sm font-semibold text-white/80">
                                        {item.productName}
                                      </p>

                                      <div className="mt-2 flex flex-wrap gap-3 text-sm text-zinc-500">
                                        <span className="inline-flex items-center gap-2">
                                          <Globe2 className="h-4 w-4 text-cyan-300" />
                                          {item.country || "País por definir"}
                                        </span>
                                        <span className="inline-flex items-center gap-2">
                                          <MapPin className="h-4 w-4 text-cyan-300" />
                                          {item.city || getChannelLocation(item)}
                                        </span>
                                      </div>

                                      {item.note && (
                                        <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-500">
                                          {item.note}
                                        </p>
                                      )}
                                    </div>

                                    <div className="flex md:justify-end">
                                      {item.type === "Marketplace" && item.url ? (
                                        <a
                                          href={item.url}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 px-5 py-3 text-xs font-black uppercase tracking-[0.16em] text-cyan-100 transition-colors hover:bg-cyan-300/20"
                                        >
                                          Abrir canal
                                          <ExternalLink className="h-3.5 w-3.5" />
                                        </a>
                                      ) : (
                                        <a
                                          href={getDirectionsUrl(item)}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.035] px-5 py-3 text-xs font-black uppercase tracking-[0.16em] text-cyan-100 transition-colors hover:border-cyan-300/25 hover:bg-cyan-300/10"
                                        >
                                          Como llegar
                                          <MapPin className="h-3.5 w-3.5" />
                                        </a>
                                      )}
                                    </div>
                                  </motion.article>
                                )
                              }
                            )}
                          </div>
                        </section>
                      )
                    )}
                  </div>
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
                        Ajusta país, ciudad, canal o búsqueda para encontrar el
                        punto de compra disponible.
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
                : "Ver más canales"}
            </button>
          </div>
        )}

      </div>

    </section>
  )

}
