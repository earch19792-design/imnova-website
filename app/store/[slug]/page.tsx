/*
================================================
SECCION: TIENDA
COMPONENTE: ProductPage
OBJETIVO: DETALLE COMERCIAL CLARO
================================================
*/

import Image from "next/image"
import Link from "next/link"
import { notFound } from "next/navigation"

import {
  ArrowLeft,
  BadgeCheck,
  PackageCheck,
  ShieldCheck,
  Sparkles,
  Truck,
} from "lucide-react"

import { getPublicProductBySlug } from "@/lib/products-service"

type Product = {
  id: string
  name: string
  slug: string
  description?: string | null
  image_url?: string | null
  image?: string | null
  price?: string | number | null
  currency?: string | null
  category?: string | null
  bullets?: string[] | null
  launch_promo_enabled?: boolean | null
  launch_discount_percent?: number | string | null
  launch_promo_start_at?: string | null
  launch_promo_end_at?: string | null
  launch_promo_duration_days?: number | string | null
}

type ProductExperience = {
  badge: string
  headline: string
  why: string
  moment: string
  howTitle: string
  howText: string
  benefits: string[]
  chips: string[]
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

const coffeeExperience = {
  badge:
    "Café funcional",
  headline:
    "Café funcional con 10 g de colágeno marino, vitaminas B6, B12 y D3, y extractos herbales para apoyar bienestar diario.",
  why:
    "Para quienes quieren elevar su café diario con una experiencia funcional: café, colágeno marino y vitaminas en una bebida lista para disfrutar.",
  moment:
    "Mañana, oficina o estudio",
  howTitle:
    "Tómalo frío, fácil y sin complicarte.",
  howText:
    "Agítalo, sírvelo sobre hielo y añade tu leche favorita. La energía natural del café acompaña enfoque y rutina diaria sin convertirlo en una bebida energética.",
  benefits: [
    "10 g de colágeno marino por lata",
    "Vitaminas B6, B12 y D3",
    "Extractos herbales funcionales",
    "Sin azúcar y bajo en calorías",
  ],
  chips: [
    "Café funcional",
    "Colágeno marino",
    "Vitaminas B",
    "Sin azúcar",
  ],
}

const productExperiences: Record<string, ProductExperience> = {
  "mash-coffee":
    coffeeExperience,
  "mash-coffee-6pack":
    coffeeExperience,
  "mash-coffee-12pack":
    coffeeExperience,
  "mash-nutri-pancake": {
    badge:
      "Nutrición diaria",
    headline:
      "Pancakes o waffles altos en proteína para desayunos ricos, prácticos y más saciantes.",
    why:
      "Una forma fácil de convertir el desayuno o snack en un momento funcional sin perder sabor ni practicidad.",
    moment:
      "Desayuno, gym o snack saludable",
    howTitle:
      "Prepáralo como pancake o waffle.",
    howText:
      "Mezcla con leche y huevo, cocina hasta que quede doradito y acompáñalo con frutas, yogurt o tu topping favorito.",
    benefits: [
      "Alto en proteína",
      "Ayuda a sentirte satisfecho",
      "Fácil de preparar",
      "Ideal para después del gym",
    ],
    chips: [
      "Alto en proteína",
      "Alto en fibra",
      "Bajo en azúcar",
      "Pancake o waffle",
    ],
  },
  "mash-nutri-pan": {
    badge:
      "Nutrición inteligente",
    headline:
      "Pan proteico bajo en carbohidratos para tostadas, sándwiches y comidas más inteligentes.",
    why:
      "Diseñado para quienes quieren una alternativa de pan más funcional, saciante y fácil de integrar en casa.",
    moment:
      "Desayuno, comida o snack saludable",
    howTitle:
      "Prepáralo como pan casero.",
    howText:
      "Mezcla con agua, levadura y un poco de mantequilla. Hornea hasta que quede suave y doradito. Disfrútalo como tostada, sándwich o acompañamiento.",
    benefits: [
      "Alto en proteína",
      "Ayuda a sentirte satisfecho",
      "Ideal para tostadas y sándwiches",
      "Fácil de preparar en casa",
    ],
    chips: [
      "Pan proteico",
      "Low carb",
      "Con fibra",
      "Hecho en casa",
    ],
  },
}

function getStoreImage(product: Product) {
  return (
    storeImagesBySlug[product.slug] ||
    product.image_url ||
    product.image ||
    "/placeholder.jpg"
  )
}

function getLaunchPromotion(
  product: Product
) {
  const discount =
    Number(
      product.launch_discount_percent
    )

  const now =
    new Date()

  const startDate =
    product.launch_promo_start_at
      ? new Date(
          product.launch_promo_start_at
        )
      : null

  const endDate =
    product.launch_promo_end_at
      ? new Date(
          product.launch_promo_end_at
        )
      : null

  const startsAtValid =
    !startDate ||
    (
      !Number.isNaN(
        startDate.getTime()
      ) &&
      startDate.getTime() <=
        now.getTime()
    )

  const endsAtValid =
    !endDate ||
    (
      !Number.isNaN(
        endDate.getTime()
      ) &&
      endDate.getTime() >
        now.getTime()
    )

  const isActive =
    product.launch_promo_enabled === true &&
    Number.isFinite(discount) &&
    discount > 0 &&
    startsAtValid &&
    endsAtValid

  const remainingMs =
    isActive && endDate
      ? Math.max(
          0,
          endDate.getTime() -
            now.getTime()
        )
      : 0

  return {
    isActive,
    discount,
    days:
      Math.floor(
        remainingMs /
          (1000 * 60 * 60 * 24)
      ),
  }
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

export default async function ProductPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } =
    await params

  const product =
    (await getPublicProductBySlug(
      slug
    )) as Product | null

  if (!product) {
    notFound()
  }

  const experience =
    productExperiences[
      product.slug
    ] || {
      badge:
        product.category ||
        "Producto IMNOVA",
      headline:
        product.description ||
        "Producto funcional IMNOVA diseñado para bienestar, nutrición inteligente y rendimiento diario.",
      why:
        "Creado para sumar valor real a rutinas modernas con una experiencia clara, práctica y funcional.",
      moment:
        "Rutina diaria",
      howTitle:
        "Integra este producto a tu día.",
      howText:
        product.description ||
        "Una experiencia práctica creada para sumar valor a rutinas modernas de bienestar.",
      benefits:
        product.bullets?.slice(
          0,
          4
        ) || [
          "Bienestar diario",
          "Nutrición funcional",
          "Experiencia premium",
        ],
      chips:
        product.bullets?.slice(
          0,
          4
        ) || [
          "IMNOVA",
          "Funcional",
          "Disponible",
        ],
    }

  const image =
    getStoreImage(
      product
    )

  const promotion =
    getLaunchPromotion(product)

  return (
    <main className="min-h-screen bg-[#f8f8f5] text-zinc-950">
      <section className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-6">
          <Link
            href="/store"
            className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50"
          >
            <ArrowLeft className="h-4 w-4" />
            Tienda
          </Link>

          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-black uppercase tracking-[0.2em] text-emerald-700">
            Disponible
          </span>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-10 px-6 py-12 lg:grid-cols-[1.05fr_0.95fr] lg:items-start">
        <div className="sticky top-8 rounded-[36px] border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="relative aspect-square overflow-hidden rounded-[28px] bg-gradient-to-br from-white via-[#fbfbf7] to-[#eef6f3]">
            <Image
              src={image}
              alt={product.name}
              fill
              priority
              sizes="(min-width: 1024px) 50vw, 100vw"
              className="object-contain p-12"
            />
          </div>
        </div>

        <div className="rounded-[36px] border border-zinc-200 bg-white p-7 shadow-sm md:p-10">
          <p className="text-xs font-black uppercase tracking-[0.32em] text-cyan-700">
            {experience.badge}
          </p>

          <h1 className="mt-5 text-5xl font-black leading-[0.95] tracking-[-0.04em] text-zinc-950 md:text-6xl">
            {product.name}
          </h1>

          <p className="mt-6 text-lg leading-8 text-zinc-600">
            {experience.headline}
          </p>

          <div className="mt-7 rounded-[26px] border border-cyan-100 bg-cyan-50/70 p-6">
            <p className="text-xs font-black uppercase tracking-[0.22em] text-cyan-800">
              Por qué puede gustarte
            </p>
            <p className="mt-3 text-base font-semibold leading-7 text-zinc-800">
              {experience.why}
            </p>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {experience.chips.map(
              chip => (
                <span
                  key={chip}
                  className="rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-zinc-700"
                >
                  {chip}
                </span>
              )
            )}
          </div>

          <div className="mt-8 rounded-[28px] border border-zinc-200 bg-[#f8f8f5] p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
              Precio
            </p>
            <p className="mt-2 text-5xl font-black tracking-tight text-zinc-950">
              {formatPrice(
                product.price,
                product.currency ||
                "USD"
              )}
            </p>

            {promotion.isActive && (
              <div className="mt-5 rounded-[22px] border border-amber-200 bg-amber-50 p-4">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-800">
                  Promocion de lanzamiento
                </p>
                <p className="mt-2 text-2xl font-black text-zinc-950">
                  {promotion.discount}% OFF
                </p>
                <p className="mt-1 text-sm font-semibold text-zinc-600">
                  {promotion.days > 0
                    ? `Termina en ${promotion.days} dias.`
                    : "Promocion activa sin fecha de cierre."}
                </p>
              </div>
            )}
          </div>

          <div className="mt-7 grid gap-3 sm:grid-cols-2">
            <Link
              href={`/store#product-${product.slug}`}
              className="rounded-full bg-zinc-950 px-7 py-4 text-center text-sm font-black uppercase tracking-[0.16em] text-white transition hover:bg-cyan-900"
            >
              Comprar ahora
            </Link>

            <Link
              href="/store"
              className="rounded-full border border-zinc-200 bg-white px-7 py-4 text-center text-sm font-black uppercase tracking-[0.16em] text-zinc-800 transition hover:bg-zinc-50"
            >
              Ver catálogo
            </Link>
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            {[
              {
                icon: ShieldCheck,
                label:
                  "Compra segura",
              },
              {
                icon: Truck,
                label:
                  "Distribución",
              },
              {
                icon: PackageCheck,
                label:
                  "Producto limpio",
              },
            ].map(
              item => (
                <div
                  key={item.label}
                  className="rounded-[22px] border border-zinc-200 bg-white p-5"
                >
                  <item.icon className="h-5 w-5 text-cyan-700" />
                  <p className="mt-4 text-sm font-black text-zinc-800">
                    {item.label}
                  </p>
                </div>
              )
            )}
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-6 px-6 pb-28 lg:grid-cols-3">
        <div className="rounded-[32px] border border-zinc-200 bg-white p-8 shadow-sm">
          <Sparkles className="h-7 w-7 text-cyan-700" />
          <p className="mt-7 text-xs font-black uppercase tracking-[0.24em] text-zinc-400">
            Momento de uso
          </p>
          <h2 className="mt-3 text-3xl font-black text-zinc-950">
            {experience.moment}
          </h2>
        </div>

        <div className="rounded-[32px] border border-zinc-200 bg-white p-8 shadow-sm">
          <BadgeCheck className="h-7 w-7 text-cyan-700" />
          <p className="mt-7 text-xs font-black uppercase tracking-[0.24em] text-zinc-400">
            Cómo usarlo
          </p>
          <h2 className="mt-3 text-2xl font-black text-zinc-950">
            {experience.howTitle}
          </h2>
          <p className="mt-4 text-sm leading-7 text-zinc-600">
            {experience.howText}
          </p>
        </div>

        <div className="rounded-[32px] border border-zinc-200 bg-white p-8 shadow-sm">
          <PackageCheck className="h-7 w-7 text-cyan-700" />
          <p className="mt-7 text-xs font-black uppercase tracking-[0.24em] text-zinc-400">
            Beneficios prácticos
          </p>
          <div className="mt-5 grid gap-3">
            {experience.benefits.map(
              benefit => (
                <div
                  key={benefit}
                  className="rounded-full border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm font-semibold text-zinc-700"
                >
                  {benefit}
                </div>
              )
            )}
          </div>
        </div>
      </section>
    </main>
  )
}
