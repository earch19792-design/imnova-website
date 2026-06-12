"use client"

import Link from "next/link"

import {
  useEffect,
  useMemo,
  useState,
} from "react"

import { motion } from "framer-motion"

import {
  ArrowUpRight,
  CheckCircle2,
  Coffee,
  Dumbbell,
  Leaf,
  Sparkles,
  SunMedium,
  type LucideIcon,
} from "lucide-react"

import {
  getPublicProductsWithStatesByStateNames,
} from "@/lib/products-service"

type Product = {
  id: string
  state_id: string | null
  name: string
  category?: string | null
  description?: string | null
  slug?: string | null
  image?: string | null
  image_url?: string | null
  lifestyle_image?: string | null
  lifestyle_images?: string[] | string | null
  usage_moment?: string | null
  main_benefit?: string | null
  how_to_use?: string | null
  usage_description?: string | null
  routine_suggestion?: string[] | string | null
  benefits?: string[] | string | null
  bullets?: string[] | string | null
  functional_claims?: string[] | string | null
  ingredients_summary?: string | null
}

type ProductState = {
  id: string
  name: string
  progress: number
}

type UsageGuide = {
  id: string
  name: string
  category: string
  status: string
  storyTitle: string
  storyDescription: string
  desireLine: string
  moment: string
  howToUse: string
  benefits: string[]
  steps: string[]
  ingredientsSummary: string | null
  image: string | null
  productImage: string | null
  imageIsLifestyle: boolean
  sceneImage: string
  sceneImages: string[]
  sceneLabel: string
  href: string
  icon: LucideIcon
  accent: "cyan" | "amber" | "emerald"
  ctaMicrocopy: string
}

type ImnovaGuidesSectionProps = {
  onJoinFamily?: () => void
}

const GUIDE_SELECTOR_BATCH_SIZE = 12

function normalizeText(
  value: string
) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
}

function normalizeStringList(
  value?: string[] | string | null
) {
  if (!value) {
    return []
  }

  if (Array.isArray(value)) {
    return value
      .map(item => item.trim())
      .filter(Boolean)
  }

  const trimmedValue =
    value.trim()

  if (!trimmedValue) {
    return []
  }

  try {
    const parsed =
      JSON.parse(trimmedValue)

    if (Array.isArray(parsed)) {
      return parsed
        .map(item =>
          String(item).trim()
        )
        .filter(Boolean)
    }
  } catch {
    // Allows comma or line separated values during migration.
  }

  return trimmedValue
    .split(/,|\n/)
    .map(item => item.trim())
    .filter(Boolean)
}

function normalizeImageList(
  value?: string[] | string | null
) {
  if (!value) {
    return []
  }

  if (Array.isArray(value)) {
    return value
      .map(item => item.trim())
      .filter(Boolean)
  }

  const trimmedValue =
    value.trim()

  if (!trimmedValue) {
    return []
  }

  try {
    const parsed =
      JSON.parse(trimmedValue)

    if (Array.isArray(parsed)) {
      return parsed
        .map(item =>
          String(item).trim()
        )
        .filter(Boolean)
    }
  } catch {
    // Allows comma or line separated URLs during content migration.
  }

  return trimmedValue
    .split(/,|\n/)
    .map(item => item.trim())
    .filter(Boolean)
}

function getProductProfile(
  product: Product
) {
  return normalizeText(
    [
      product.name,
      product.category,
      product.description,
      product.usage_moment,
      product.main_benefit,
      product.how_to_use,
      product.usage_description,
      product.ingredients_summary,
      ...normalizeStringList(product.routine_suggestion),
      ...normalizeStringList(product.benefits),
      ...normalizeStringList(product.bullets),
      ...normalizeStringList(product.functional_claims),
    ]
      .filter(Boolean)
      .join(" ")
  )
}

function profileIncludes(
  profile: string,
  terms: string[]
) {
  return terms.some(
    term =>
      profile.includes(term)
  )
}

function getFirstText(
  values: Array<string | null | undefined>
) {
  return (
    values
      .map(value => value?.trim())
      .find(Boolean) || null
  )
}

function isAvailableStatus(
  status: string
) {
  const normalizedStatus =
    normalizeText(status)

  return (
    normalizedStatus.includes("disponible") &&
    !normalizedStatus.includes("no disponible") &&
    !normalizedStatus.includes("comercial") &&
    !normalizedStatus.includes("viene pronto") &&
    !normalizedStatus.includes("idea") &&
    !normalizedStatus.includes("validacion") &&
    !normalizedStatus.includes("priorizado") &&
    !normalizedStatus.includes("testing") &&
    !normalizedStatus.includes("produccion")
  )
}

function getUsageMoment(
  product: Product
) {
  const configuredMoment =
    getFirstText([
      product.usage_moment,
    ])

  if (configuredMoment) {
    return configuredMoment
  }

  const profile =
    getProductProfile(product)

  if (
    profileIncludes(
      profile,
      [
        "coffee",
        "cafe",
        "caf",
        "espresso",
      ]
    )
  ) {
    return "Mañana, oficina o estudio"
  }

  if (
    profileIncludes(
      profile,
      [
        "pancake",
        "waffle",
      ]
    )
  ) {
    return "Desayuno, gym o snack saludable"
  }

  if (
    profileIncludes(
      profile,
      [
        "pancake",
        "pan",
        "bread",
        "nutri",
        "prote",
        "konjac",
        "carbo",
      ]
    )
  ) {
    return "Desayuno, comida o snack saludable"
  }

  if (
    profileIncludes(
      profile,
      [
        "fitness",
        "entreno",
        "training",
        "workout",
      ]
    )
  ) {
    return "Rutina fitness"
  }

  if (
    profileIncludes(
      profile,
      [
        "focus",
        "enfoque",
        "mental",
        "productividad",
      ]
    )
  ) {
    return "Enfoque mental"
  }

  if (
    profileIncludes(
      profile,
      [
        "snack",
        "merienda",
        "antojo",
      ]
    )
  ) {
    return "Merienda funcional"
  }

  return "Rutina diaria"
}

function getHowToUse(
  product: Product
) {
  const configuredUsage =
    getFirstText([
      product.how_to_use,
      product.usage_description,
      product.main_benefit,
    ])

  if (configuredUsage) {
    return configuredUsage
  }

  const profile =
    getProductProfile(product)

  if (
    profileIncludes(
      profile,
      [
        "coffee",
        "cafe",
        "caf",
      ]
    )
  ) {
    return "Café funcional con vitaminas, colágeno marino y extractos herbales para apoyar bienestar diario."
  }

  if (
    profileIncludes(
      profile,
      [
        "pancake",
        "waffle",
      ]
    )
  ) {
    return "Prepáralo como pancake o waffle. Mezcla con leche y huevo, cocina hasta que quede doradito y acompáñalo con frutas, yogurt o tu topping favorito."
  }

  if (
    profileIncludes(
      profile,
      [
        "pancake",
        "pan",
        "bread",
        "nutri",
        "prote",
        "konjac",
        "carbo",
      ]
    )
  ) {
    return "Prepáralo como pan casero. Mezcla con agua, levadura y un poco de mantequilla. Hornea hasta que quede suave y doradito. Disfrútalo como tostada, sándwich o acompañamiento."
  }

  return (
    product.description ||
    "Úsalo como parte de tu rutina diaria para apoyar bienestar de forma práctica."
  )
}

function getRitualSteps(
  product: Product
) {
  const configuredSteps =
    normalizeStringList(
      product.routine_suggestion
    )

  if (configuredSteps.length > 0) {
    return configuredSteps
  }

  const profile =
    getProductProfile(product)

  if (
    profileIncludes(
      profile,
      [
        "coffee",
        "cafe",
        "caf",
      ]
    )
  ) {
    return [
      "Agítalo bien antes de tomar.",
      "Sírvelo frío sobre hielo.",
      "Añade leche regular, almendra, avena o coco.",
      "Disfrútalo en la mañana, oficina o estudio.",
    ]
  }

  if (
    profileIncludes(
      profile,
      [
        "pancake",
        "waffle",
      ]
    )
  ) {
    return [
      "Mezcla con leche y huevo.",
      "Revuelve hasta que quede suave.",
      "Cocina como pancake o waffle.",
      "Sirve con frutas o tu topping favorito.",
    ]
  }

  if (
    profileIncludes(
      profile,
      [
        "pancake",
        "pan",
        "bread",
        "nutri",
        "prote",
        "konjac",
        "carbo",
      ]
    )
  ) {
    return [
      "Mezcla con agua y levadura.",
      "Agrega un poco de mantequilla.",
      "Hornea hasta que quede doradito.",
      "Disfrútalo como tostada o sándwich.",
    ]
  }

  if (
    profileIncludes(
      profile,
      [
        "fitness",
        "entreno",
        "training",
        "workout",
      ]
    )
  ) {
    return [
      "Úsalo alrededor de una rutina activa.",
      "Mantén una hidratación adecuada.",
      "Ajusta el momento según tu día.",
    ]
  }

  return [
    "Elige un momento simple de tu día.",
    "Integra el producto dentro de tu rutina.",
    "Mantén el hábito de forma constante.",
  ]
}

function getFallbackBenefits(
  product: Product
) {
  const profile =
    getProductProfile(product)

  if (
    profileIncludes(
      profile,
      [
        "coffee",
        "cafe",
        "caf",
      ]
    )
  ) {
    return [
      "Café funcional para bienestar diario",
      "Vitaminas, colágeno marino y extractos herbales",
      "Energía natural del café",
      "Sin azúcar y bajo en calorías",
    ]
  }

  if (
    profileIncludes(
      profile,
      [
        "pancake",
        "waffle",
      ]
    )
  ) {
    return [
      "Alto en proteína",
      "Ayuda a sentirte satisfecho",
      "Fácil de preparar",
      "Ideal para después del gym",
    ]
  }

  if (
    profileIncludes(
      profile,
      [
        "pancake",
        "pan",
        "bread",
        "nutri",
        "prote",
        "konjac",
        "carbo",
      ]
    )
  ) {
    return [
      "Alto en proteína",
      "Ayuda a sentirte satisfecho",
      "Ideal para tostadas y sándwiches",
      "Fácil de preparar en casa",
    ]
  }

  if (
    profileIncludes(
      profile,
      [
        "fitness",
        "entreno",
        "training",
        "workout",
      ]
    )
  ) {
    return [
      "Apoyo para rutinas activas",
      "Energía sostenida",
      "Uso práctico diario",
    ]
  }

  return [
    "Bienestar diario",
    "Fórmula funcional",
    "Fácil de integrar",
  ]
}

function getPracticalBenefits(
  product: Product
) {
  const configuredBenefits = [
    ...normalizeStringList(product.benefits),
    ...normalizeStringList(
      product.functional_claims
    ),
    ...normalizeStringList(product.bullets),
    ...normalizeStringList(product.main_benefit),
  ]

  if (configuredBenefits.length > 0) {
    return configuredBenefits.slice(
      0,
      4
    )
  }

  const configuredFallbacks = [
    ...normalizeStringList(product.benefits),
    ...normalizeStringList(product.bullets),
  ]

  const combinedBenefits = [
    ...configuredFallbacks,
    ...getFallbackBenefits(product),
  ]

  return Array.from(
    new Set(combinedBenefits)
  ).slice(
    0,
    4
  )
}

function getGuideStory(
  product: Product
) {
  const profile =
    getProductProfile(product)

  const mainBenefit =
    getFirstText([
      product.main_benefit,
      product.description,
    ])

  if (
    profileIncludes(
      profile,
      [
        "coffee",
        "cafe",
        "caf",
      ]
    )
  ) {
    const isSixPack =
      profileIncludes(
        profile,
        [
          "6 pack",
          "6pack",
          "6 latas",
        ]
      )

    const isTwelvePack =
      profileIncludes(
        profile,
        [
          "12 pack",
          "12pack",
          "12 latas",
        ]
      )

    if (isTwelvePack) {
      return {
        storyTitle:
          "Tu ritual funcional listo para varios días.",
        storyDescription:
          mainBenefit ||
          "Abastece tu rutina con café funcional, colágeno marino, vitaminas y cero azúcar para acompañar tus mañanas de enfoque.",
        desireLine:
          "Pensado para quienes ya integraron MASH Coffee+ a su día y quieren tenerlo siempre a mano.",
        ctaMicrocopy:
          "Abastece tu rutina funcional.",
      }
    }

    if (isSixPack) {
      return {
        storyTitle:
          "Una semana de café funcional sin complicarte.",
        storyDescription:
          mainBenefit ||
          "Seis latas listas para acompañar mañanas de oficina, estudio o rutina activa con café, colágeno marino y vitaminas.",
        desireLine:
          "Ideal para probar el hábito y convertir tu café en un momento más inteligente del día.",
        ctaMicrocopy:
          "Empieza tu semana funcional.",
      }
    }

    return {
      storyTitle:
        "Convierte tu café diario en un ritual funcional.",
      storyDescription:
        mainBenefit ||
        "Café latte listo con 10g de colágeno marino, vitaminas B6, B12 y D3, extractos botánicos y cero azúcar.",
      desireLine:
        "Para quienes quieren café, enfoque y cuidado diario sin convertir su rutina en algo complicado.",
      ctaMicrocopy:
        "Empieza con MASH Coffee+ hoy.",
    }
  }

  if (
    profileIncludes(
      profile,
      [
        "pancake",
        "waffle",
      ]
    )
  ) {
    return {
      storyTitle:
        "Un desayuno alto en proteína que se siente como premio.",
      storyDescription:
        mainBenefit ||
        "Prepara pancakes o waffles suaves, ricos y funcionales para desayunar mejor sin renunciar al sabor.",
      desireLine:
        "Para quienes quieren cuidarse, rendir mejor y seguir disfrutando un desayuno que provoca.",
      ctaMicrocopy:
        "Prepara tu próximo desayuno IMNOVA.",
    }
  }

  if (
    profileIncludes(
      profile,
      [
        "pan",
        "bread",
        "nutra",
        "konjac",
        "carbo",
      ]
    )
  ) {
    return {
      storyTitle:
        "El pan vuelve a encajar en tu rutina.",
      storyDescription:
        mainBenefit ||
        "Pan casero alto en proteína, alto en fibra y bajo en carbohidratos para tostadas, sándwiches y comidas simples.",
      desireLine:
        "Para quienes extrañan el pan, pero quieren una opción más alineada con una rutina inteligente.",
      ctaMicrocopy:
        "Vuelve a disfrutar pan funcional.",
    }
  }

  return {
    storyTitle:
      "Integra bienestar real a tu rutina diaria.",
    storyDescription:
      mainBenefit ||
      "Una solución IMNOVA diseñada para acompañar momentos reales con uso simple y beneficios claros.",
    desireLine:
      "Para personas que buscan productos prácticos, modernos y fáciles de adoptar.",
    ctaMicrocopy:
      "Empieza tu rutina IMNOVA.",
  }
}

function getGuideIcon(
  product: Product
) {
  const profile =
    getProductProfile(product)

  if (
    profileIncludes(
      profile,
      [
        "coffee",
        "cafe",
        "caf",
      ]
    )
  ) {
    return Coffee
  }

  if (
    profileIncludes(
      profile,
      [
        "fitness",
        "entreno",
        "training",
        "workout",
      ]
    )
  ) {
    return Dumbbell
  }

  if (
    profileIncludes(
      profile,
      [
        "nutri",
        "prote",
        "konjac",
        "wellness",
        "bienestar",
      ]
    )
  ) {
    return Leaf
  }

  return SunMedium
}

function getGuideAccent(
  product: Product
): UsageGuide["accent"] {
  const profile =
    getProductProfile(product)

  if (
    profileIncludes(
      profile,
      [
        "coffee",
        "cafe",
        "caf",
      ]
    )
  ) {
    return "amber"
  }

  if (
    profileIncludes(
      profile,
      [
        "nutri",
        "prote",
        "wellness",
        "bienestar",
      ]
    )
  ) {
    return "emerald"
  }

  return "cyan"
}

function getLifestyleScene(
  product: Product
) {
  const profile =
    getProductProfile(product)

  if (
    profileIncludes(
      profile,
      [
        "coffee",
        "cafe",
        "caf",
        "focus",
        "enfoque",
        "productividad",
      ]
    )
  ) {
    return {
      image:
        "/images/imnova-focus.webp",
      label:
        "Café moderno",
    }
  }

  if (
    profileIncludes(
      profile,
      [
        "pancake",
        "pan",
        "bread",
        "nutri",
        "prote",
        "fitness",
        "entreno",
        "training",
        "workout",
      ]
    )
  ) {
    return {
      image:
        "/images/imnova-fitness.webp",
      label:
        "Nutrición diaria",
    }
  }

  if (
    profileIncludes(
      profile,
      [
        "skin",
        "piel",
        "beauty",
        "belleza",
        "skincare",
      ]
    )
  ) {
    return {
      image:
        "/images/imnova-skincare.webp",
      label:
        "Wellness diario",
    }
  }

  return {
    image:
      "/images/imnova-lifestyle.webp",
    label:
      "Lifestyle IMNOVA",
  }
}

function getGuideImage(
  product: Product
) {
  const slug =
    product.slug || ""

  const fallbackLifestyleImages =
    slug === "mash-coffee"
      ? [
          "/images/lifestyle/mash-coffee-01.webp",
          "/images/lifestyle/mash-coffee-02.webp",
          "/images/lifestyle/mash-coffee-03.webp",
        ]
      : slug === "mash-coffee-6pack"
        ? [
            "/images/lifestyle/mash-6pack.webp",
          ]
        : slug === "mash-coffee-12pack"
          ? [
              "/images/lifestyle/mash-12pack.webp",
            ]
          : slug === "mash-nutri-pan"
            ? [
                "/images/lifestyle/mash-nutra-01.webp",
                "/images/lifestyle/mash-nutra-02.webp",
                "/images/lifestyle/mash-nutra-03.webp",
              ]
            : slug === "mash-nutri-pancake"
              ? [
                  "/images/lifestyle/mash-pancake-01.webp",
                  "/images/lifestyle/mash-pancake-02.webp",
                  "/images/lifestyle/mash-pancake-03.webp",
                ]
              : []

  const configuredLifestyleImages =
    Array.from(
      new Set([
        ...normalizeImageList(
          product.lifestyle_images
        ),
        ...normalizeImageList(
          product.lifestyle_image
        ),
      ])
    ).slice(
      0,
      3
    )

  const productImage =
    product.image_url ||
    product.image ||
    null

  const scene =
    getLifestyleScene(product)

  const fallbackImages =
    fallbackLifestyleImages.length > 0
      ? fallbackLifestyleImages
      : [
          scene.image,
        ]

  const sceneImages =
    configuredLifestyleImages.length > 0
      ? configuredLifestyleImages
      : fallbackImages

  return {
    image:
      configuredLifestyleImages[0] ||
      productImage ||
      fallbackImages[0],
    productImage,
    imageIsLifestyle:
      configuredLifestyleImages.length > 0 ||
      (!productImage &&
        fallbackLifestyleImages.length > 0),
    sceneImage:
      sceneImages[0],
    sceneImages,
    sceneLabel:
      scene.label,
  }
}

function getProductHref(
  product: Product
) {
  return product.slug
    ? `/store/${product.slug}`
    : "/store"
}

function getAccentClasses(
  accent: UsageGuide["accent"]
) {
  if (accent === "amber") {
    return {
      border:
        "border-amber-300/20",
      badge:
        "border-amber-300/25 bg-amber-300/[0.10] text-amber-100",
      glow:
        "from-amber-300/20 via-transparent to-orange-400/10",
      text:
        "text-amber-100",
      button:
        "border-amber-300/25 bg-amber-300/[0.12] text-amber-50 hover:border-amber-200/45 hover:bg-amber-300/[0.18]",
    }
  }

  if (accent === "emerald") {
    return {
      border:
        "border-emerald-300/20",
      badge:
        "border-emerald-300/25 bg-emerald-300/[0.10] text-emerald-100",
      glow:
        "from-emerald-300/20 via-transparent to-cyan-300/10",
      text:
        "text-emerald-100",
      button:
        "border-emerald-300/25 bg-emerald-300/[0.12] text-emerald-50 hover:border-emerald-200/45 hover:bg-emerald-300/[0.18]",
    }
  }

  return {
    border:
      "border-cyan-300/20",
    badge:
      "border-cyan-300/25 bg-cyan-300/[0.10] text-cyan-100",
    glow:
      "from-cyan-300/20 via-transparent to-amber-300/10",
    text:
      "text-cyan-100",
    button:
      "border-cyan-300/25 bg-cyan-300/[0.12] text-cyan-50 hover:border-cyan-200/45 hover:bg-cyan-300/[0.18]",
  }
}

function LifestyleVisual({
  guide,
  priority = false,
}: {
  guide: UsageGuide
  priority?: boolean
}) {
  const Icon =
    guide.icon

  const productImage =
    guide.imageIsLifestyle
      ? null
      : guide.productImage ||
        guide.image

  const sceneImages =
    guide.sceneImages.length > 0
      ? guide.sceneImages
      : [
          guide.sceneImage,
        ]

  const primaryScene =
    sceneImages[0] ||
    guide.sceneImage

  const [
    activeScene,
    setActiveScene,
  ] = useState(primaryScene)

  useEffect(
    () => {
      setActiveScene(primaryScene)
    },
    [
      primaryScene,
    ]
  )

  const selectedScene =
    activeScene ||
    primaryScene

  const shouldUseSceneAsMain =
    guide.imageIsLifestyle ||
    sceneImages.length > 1

  const mainVisualImage =
    shouldUseSceneAsMain
      ? selectedScene ||
        productImage ||
        null
      : productImage ||
        selectedScene ||
        null

  const isLifestyleGallery =
    shouldUseSceneAsMain &&
    Boolean(selectedScene)

  return (
    <div
      className={`relative overflow-hidden rounded-[28px] border border-white/10 bg-black/55 ${
        isLifestyleGallery
          ? "h-fit min-h-0 self-start lg:sticky lg:top-28"
          : "min-h-[320px] md:min-h-[420px]"
      }`}
    >
      {mainVisualImage ? (
        <img
          key={`background-${mainVisualImage}`}
          src={mainVisualImage}
          alt={guide.sceneLabel}
          loading={priority ? "eager" : "lazy"}
          className="absolute inset-0 h-full w-full scale-110 object-cover object-center opacity-45 blur-xl"
        />
      ) : null}

      <div
        className={`absolute inset-0 bg-gradient-to-br ${getAccentClasses(guide.accent).glow}`}
      />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_52%_36%,rgba(255,255,255,0.10),transparent_28%),linear-gradient(180deg,rgba(0,0,0,0.12),rgba(0,0,0,0.86))]" />
      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black via-black/40 to-transparent" />

      <div className="absolute left-5 top-5 z-20 flex flex-wrap gap-2">
        <span className="rounded-full border border-white/15 bg-black/45 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.20em] text-white/70 backdrop-blur-xl">
          {guide.sceneLabel}
        </span>
        <span
          className={`rounded-full border px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.20em] backdrop-blur-xl ${getAccentClasses(guide.accent).badge}`}
        >
          Lifestyle
        </span>
      </div>

      <div
        className={`relative z-10 flex items-center justify-center px-5 pt-20 md:px-10 ${
          isLifestyleGallery
            ? "min-h-0 pb-6"
            : "min-h-[320px] pb-24 md:min-h-[420px]"
        }`}
      >
        {productImage && !shouldUseSceneAsMain ? (
          <div className="relative flex h-[230px] w-[230px] items-center justify-center rounded-[34px] border border-white/15 bg-black/35 p-7 shadow-[0_30px_110px_rgba(0,0,0,0.55)] backdrop-blur-2xl md:h-[300px] md:w-[300px]">
            <div className="absolute inset-0 rounded-[34px] bg-gradient-to-br from-white/[0.12] to-transparent" />
            <img
              src={productImage}
              alt={guide.name}
              loading={priority ? "eager" : "lazy"}
              className="relative z-10 max-h-full max-w-full object-contain drop-shadow-[0_28px_70px_rgba(0,0,0,0.50)]"
            />
          </div>
        ) : mainVisualImage ? (
          <div className="flex w-full flex-col items-center justify-center gap-5">
            <img
              key={`main-${mainVisualImage}`}
              src={mainVisualImage}
              alt={guide.sceneLabel}
              loading={priority ? "eager" : "lazy"}
              className="max-h-[260px] w-full max-w-[94%] rounded-[26px] object-contain object-center shadow-[0_28px_90px_rgba(0,0,0,0.50)] md:max-h-[320px] md:max-w-[90%]"
            />

            {sceneImages.length > 1 && (
              <div className="flex justify-center gap-2">
                {sceneImages
                  .slice(
                    0,
                    3
                  )
                  .map(
                    image => (
                      <button
                        key={image}
                        type="button"
                        onClick={() =>
                          setActiveScene(image)
                        }
                        aria-label={`Ver imagen de ${guide.name}`}
                        className={`h-14 w-14 overflow-hidden rounded-2xl border bg-black/45 p-1 backdrop-blur-xl transition duration-300 hover:border-cyan-100/55 ${
                          selectedScene === image
                            ? "border-cyan-100/70 shadow-[0_0_24px_rgba(103,232,249,0.22)]"
                            : "border-white/15"
                        }`}
                      >
                        <img
                          src={image}
                          alt={guide.sceneLabel}
                          loading="lazy"
                          className="h-full w-full rounded-xl object-cover"
                        />
                      </button>
                    )
                  )}
              </div>
            )}

            <div className="flex max-w-full flex-wrap items-center justify-center gap-2">
              <span
                className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.20em] ${getAccentClasses(guide.accent).badge}`}
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Disponible
              </span>
              <span className="rounded-full border border-white/10 bg-black/55 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.20em] text-white/60 backdrop-blur-xl">
                {guide.moment}
              </span>
            </div>
          </div>
        ) : (
          <div
            className={`flex h-24 w-24 items-center justify-center rounded-full border bg-black/45 backdrop-blur-2xl ${getAccentClasses(guide.accent).badge}`}
          >
            <Icon className="h-10 w-10" />
          </div>
        )}
      </div>

      {!isLifestyleGallery && (
        <div className="absolute bottom-4 left-4 z-20 flex max-w-[calc(100%-2rem)] flex-wrap items-center gap-2 sm:max-w-[58%]">
          <span
            className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.20em] ${getAccentClasses(guide.accent).badge}`}
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Disponible
          </span>
          <span className="rounded-full border border-white/10 bg-black/55 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.20em] text-white/60 backdrop-blur-xl">
            {guide.moment}
          </span>
        </div>
      )}

      {sceneImages.length > 1 && productImage && !shouldUseSceneAsMain && (
        <div className="absolute bottom-4 right-4 z-20 flex gap-2">
          {sceneImages
            .slice(
              0,
              3
            )
            .map(
              image => (
                <button
                  key={image}
                  type="button"
                  onClick={() =>
                    setActiveScene(image)
                  }
                  aria-label={`Ver imagen de ${guide.name}`}
                  className={`h-14 w-14 overflow-hidden rounded-2xl border bg-black/45 p-1 backdrop-blur-xl transition duration-300 hover:border-cyan-100/55 ${
                    selectedScene === image
                      ? "border-cyan-100/70 shadow-[0_0_24px_rgba(103,232,249,0.22)]"
                      : "border-white/15"
                  }`}
                >
                  <img
                    src={image}
                    alt={guide.sceneLabel}
                    loading="lazy"
                    className="h-full w-full rounded-xl object-cover"
                  />
                </button>
              )
            )}
        </div>
      )}
    </div>
  )
}

function BenefitChips({
  benefits,
}: {
  benefits: string[]
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {benefits.map(
        benefit => (
          <span
            key={benefit}
            className="rounded-full border border-white/10 bg-white/[0.045] px-4 py-2 text-xs font-semibold leading-5 text-zinc-200"
          >
            {benefit}
          </span>
        )
      )}
    </div>
  )
}

function ProductGuideCard({
  guide,
  index,
  onJoinFamily,
}: {
  guide: UsageGuide
  index: number
  onJoinFamily?: () => void
}) {
  return (
    <motion.article
      initial={{
        opacity: 0,
        y: 34,
      }}
      whileInView={{
        opacity: 1,
        y: 0,
      }}
      transition={{
        duration: 0.82,
        delay:
          Math.min(
            index,
            4
          ) * 0.04,
      }}
      viewport={{ once: true }}
      className={`group relative overflow-hidden rounded-[32px] border bg-white/[0.035] p-5 shadow-[0_30px_120px_rgba(0,0,0,0.45)] backdrop-blur-2xl md:p-8 ${getAccentClasses(guide.accent).border}`}
    >
      <div
        className={`absolute inset-0 bg-gradient-to-br ${getAccentClasses(guide.accent).glow}`}
      />
      <div className="absolute inset-0 bg-gradient-to-r from-black/88 via-black/70 to-black/82" />

      <div className="relative z-10 grid gap-8 lg:grid-cols-[0.95fr_1.05fr] lg:items-start">
        <LifestyleVisual
          guide={guide}
          priority={index === 0}
        />

        <div className="flex flex-col justify-center py-2 lg:py-8">
          <p className="text-[10px] font-semibold uppercase tracking-[0.30em] text-white/50">
            {guide.category}
          </p>

          <h3 className="mt-4 text-4xl font-black leading-tight text-white md:text-6xl">
            {guide.name}
          </h3>

          <div className="mt-7 grid gap-4 sm:grid-cols-2">
            <div className="rounded-[24px] border border-white/10 bg-black/30 p-5">
              <p
                className={`text-[10px] font-semibold uppercase tracking-[0.24em] ${getAccentClasses(guide.accent).text}`}
              >
                Momento de uso
              </p>
              <p className="mt-3 text-xl font-black text-white">
                {guide.moment}
              </p>
            </div>

            <div className="rounded-[24px] border border-white/10 bg-black/30 p-5">
              <p
                className={`text-[10px] font-semibold uppercase tracking-[0.24em] ${getAccentClasses(guide.accent).text}`}
              >
                Cómo usarlo
              </p>
              <p className="mt-3 text-sm leading-7 text-zinc-300">
                {guide.howToUse}
              </p>
            </div>
          </div>

          <div className="mt-7">
            <p
              className={`mb-3 text-[10px] font-semibold uppercase tracking-[0.24em] ${getAccentClasses(guide.accent).text}`}
            >
              Beneficios prácticos
            </p>
            <BenefitChips
              benefits={guide.benefits}
            />
          </div>

          {guide.ingredientsSummary && (
            <div className="mt-7 rounded-[24px] border border-white/10 bg-black/30 p-5">
              <p
                className={`text-[10px] font-semibold uppercase tracking-[0.24em] ${getAccentClasses(guide.accent).text}`}
              >
                Ingredientes funcionales
              </p>
              <p className="mt-3 text-sm leading-7 text-zinc-300">
                {guide.ingredientsSummary}
              </p>
            </div>
          )}

          <div className="mt-7 rounded-[26px] border border-white/10 bg-black/30 p-5">
            <p
              className={`text-[10px] font-semibold uppercase tracking-[0.24em] ${getAccentClasses(guide.accent).text}`}
            >
              Rutina sugerida
            </p>

            <div className="mt-4 grid gap-3">
              {guide.steps.map(
                (step, stepIndex) => (
                  <div
                    key={step}
                    className="grid grid-cols-[auto_1fr] items-start gap-3 text-sm leading-6 text-zinc-300"
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-white/[0.055] text-[10px] font-black text-white/70">
                      {stepIndex + 1}
                    </span>
                    <span>
                      {step}
                    </span>
                  </div>
                )
              )}
            </div>
          </div>

          <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              href={guide.href}
              className={`inline-flex items-center justify-center gap-3 rounded-2xl border px-6 py-4 text-xs font-black uppercase tracking-[0.18em] transition ${getAccentClasses(guide.accent).button}`}
            >
              Comprar ahora
              <ArrowUpRight className="h-4 w-4" />
            </Link>

            {onJoinFamily && (
              <button
                type="button"
                onClick={onJoinFamily}
                className="inline-flex items-center justify-center gap-3 rounded-2xl border border-white/10 bg-white/[0.045] px-6 py-4 text-xs font-black uppercase tracking-[0.18em] text-white/75 transition hover:border-white/20 hover:bg-white/[0.075]"
              >
                Unirme a la comunidad
                <Sparkles className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </motion.article>
  )
}

export function ImnovaGuidesSection({
  onJoinFamily,
}: ImnovaGuidesSectionProps) {
  const [
    products,
    setProducts,
  ] = useState<Product[]>([])

  const [
    states,
    setStates,
  ] = useState<ProductState[]>([])

  const [
    isLoading,
    setIsLoading,
  ] = useState(true)

  const [
    selectedGuideId,
    setSelectedGuideId,
  ] = useState<string | null>(null)

  const [
    visibleGuideCount,
    setVisibleGuideCount,
  ] = useState(GUIDE_SELECTOR_BATCH_SIZE)

  useEffect(
    () => {
      let mounted =
        true

      async function loadGuides() {
        try {
          const {
            products:
              productRows,
            states:
              stateRows,
          } =
            await getPublicProductsWithStatesByStateNames(
              [
                "Disponible",
              ]
            )

          if (!mounted) {
            return
          }

          setProducts(
            productRows as Product[]
          )
          setStates(
            stateRows as ProductState[]
          )
        } finally {
          if (mounted) {
            setIsLoading(false)
          }
        }
      }

      loadGuides()

      return () => {
        mounted = false
      }
    },
    []
  )

  const stateMap =
    useMemo(
      () =>
        new Map(
          states.map(
            state => [
              state.id,
              state,
            ]
          )
        ),
      [
        states,
      ]
    )

  const productGuides =
    useMemo<UsageGuide[]>(
      () =>
        products
          .map(
            product => {
              const state =
                product.state_id
                  ? stateMap.get(
                      product.state_id
                    )
                  : null

              const status =
                state?.name ||
                "Idea"

              const guideImage =
                getGuideImage(product)

              const guideStory =
                getGuideStory(product)

              return {
                id:
                  product.id,
                name:
                  product.name,
                category:
                  product.category ||
                  "Producto IMNOVA",
                status,
                storyTitle:
                  guideStory.storyTitle,
                storyDescription:
                  guideStory.storyDescription,
                desireLine:
                  guideStory.desireLine,
                moment:
                  getUsageMoment(product),
                howToUse:
                  getHowToUse(product),
                benefits:
                  getPracticalBenefits(product),
                steps:
                  getRitualSteps(product),
                ingredientsSummary:
                  getFirstText([
                    product.ingredients_summary,
                  ]),
                image:
                  guideImage.image,
                productImage:
                  guideImage.productImage,
                imageIsLifestyle:
                  guideImage.imageIsLifestyle,
                sceneImage:
                  guideImage.sceneImage,
                sceneImages:
                  guideImage.sceneImages,
                sceneLabel:
                  guideImage.sceneLabel,
                href:
                  getProductHref(product),
                icon:
                  getGuideIcon(product),
                accent:
                  getGuideAccent(product),
                ctaMicrocopy:
                  guideStory.ctaMicrocopy,
              }
            }
          )
          .filter(
            guide =>
              isAvailableStatus(
                guide.status
              )
          ),
      [
        products,
        stateMap,
      ]
    )

  const featuredGuide =
    productGuides.find(
      guide =>
        guide.id === selectedGuideId
    ) ||
    productGuides[0]

  useEffect(
    () => {
      if (productGuides.length === 0) {
        setSelectedGuideId(null)
        return
      }

      const selectedGuideExists =
        selectedGuideId
          ? productGuides.some(
              guide =>
                guide.id === selectedGuideId
            )
          : false

      if (!selectedGuideExists) {
        setSelectedGuideId(
          productGuides[0].id
        )
      }
    },
    [
      productGuides,
      selectedGuideId,
    ]
  )

  const visibleGuideOptions =
    productGuides.slice(
      0,
      visibleGuideCount
    )

  const hasMoreGuides =
    visibleGuideCount <
    productGuides.length

  if (
    !isLoading &&
    productGuides.length === 0
  ) {
    return (
      <section
        id="imnova-guides"
        className="relative isolate overflow-hidden bg-black py-28 md:py-36"
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_15%,rgba(34,211,238,0.08),transparent_42%),linear-gradient(180deg,rgba(0,0,0,0.20),rgba(0,0,0,0.95))]" />
        <div className="relative z-10 mx-auto max-w-4xl px-6 text-center">
          <div className="inline-flex items-center gap-3 rounded-full border border-cyan-300/20 bg-cyan-300/[0.08] px-5 py-3 text-[10px] uppercase tracking-[0.34em] text-cyan-100">
            <Sparkles className="h-4 w-4" />
            Guías IMNOVA
          </div>

          <h2 className="mt-8 text-4xl font-black leading-tight text-white md:text-6xl">
            Ideas de Uso
          </h2>

          <p className="mx-auto mt-6 max-w-2xl text-base leading-8 text-zinc-400">
            Cuando un producto esté disponible, aquí verás cómo entra en una
            rutina real y por qué puede valer la pena comprarlo.
          </p>
        </div>
      </section>
    )
  }

  return (
    <section
      id="imnova-guides"
      className="relative isolate overflow-hidden bg-black py-32 md:py-40"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(34,211,238,0.10),transparent_42%),radial-gradient(circle_at_85%_70%,rgba(251,191,36,0.08),transparent_36%)]" />
      <div className="absolute inset-0 opacity-[0.022] bg-[linear-gradient(rgba(255,255,255,0.12)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.12)_1px,transparent_1px)] bg-[size:92px_92px]" />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/20 to-transparent" />

      <div className="relative z-10 mx-auto max-w-7xl px-6">
        <motion.div
          initial={{
            opacity: 0,
            y: 30,
          }}
          whileInView={{
            opacity: 1,
            y: 0,
          }}
          transition={{
            duration: 0.8,
          }}
          viewport={{ once: true }}
          className="mx-auto max-w-4xl text-center"
        >
          <div className="inline-flex items-center gap-3 rounded-full border border-cyan-300/20 bg-cyan-300/[0.08] px-5 py-3 text-[10px] uppercase tracking-[0.34em] text-cyan-100">
            <Sparkles className="h-4 w-4" />
            Guías IMNOVA
          </div>

          <h2 className="mt-9 text-5xl font-black leading-tight text-white md:text-7xl">
            Ideas de Uso
          </h2>

          <p className="mx-auto mt-7 max-w-3xl text-lg leading-8 text-zinc-400">
            Mira cómo cada producto disponible puede entrar en tu día: qué
            problema resuelve, cómo se prepara, qué aporta a tu rutina y por
            qué puede convertirse en una compra útil desde el primer uso.
          </p>
        </motion.div>

        <div className="mx-auto mt-10 grid max-w-5xl gap-3 sm:grid-cols-3">
          {[
            [
              "01",
              "Elige tu momento",
              "Mañana, oficina, gym, desayuno o snack.",
            ],
            [
              "02",
              "Úsalo fácil",
              "Preparaciones simples, claras y repetibles.",
            ],
            [
              "03",
              "Compra con intención",
              "Beneficios visibles antes de ir a la tienda.",
            ],
          ].map(
            item => (
              <div
                key={item[0]}
                className="rounded-[24px] border border-white/10 bg-white/[0.035] p-5 text-left backdrop-blur-xl"
              >
                <p className="text-[10px] font-black uppercase tracking-[0.28em] text-cyan-100/70">
                  {item[0]}
                </p>
                <p className="mt-3 text-lg font-black text-white">
                  {item[1]}
                </p>
                <p className="mt-2 text-sm leading-6 text-zinc-400">
                  {item[2]}
                </p>
              </div>
            )
          )}
        </div>

        {productGuides.length > 1 && (
          <div className="mt-12 rounded-[30px] border border-white/10 bg-white/[0.035] p-4 shadow-[0_24px_90px_rgba(0,0,0,0.35)] backdrop-blur-2xl md:p-5">
            <div className="flex flex-col gap-3 border-b border-white/10 pb-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.30em] text-cyan-100/75">
                  Productos disponibles
                </p>
                <p className="mt-2 text-sm leading-6 text-zinc-400">
                  Selecciona un producto y mira su historia de uso: momento,
                  beneficio, preparación y compra directa.
                </p>
              </div>

              <span className="w-fit rounded-full border border-cyan-200/15 bg-cyan-300/[0.07] px-4 py-2 text-[10px] font-black uppercase tracking-[0.22em] text-cyan-100">
                {productGuides.length} disponibles
              </span>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {visibleGuideOptions.map(
                guide => {
                  const isSelected =
                    featuredGuide?.id === guide.id
                  const Icon =
                    guide.icon

                  return (
                    <button
                      key={guide.id}
                      type="button"
                      onClick={() =>
                        setSelectedGuideId(
                          guide.id
                        )
                      }
                      className={`group flex min-h-[92px] items-center gap-4 rounded-[24px] border p-3 text-left transition duration-300 ${
                        isSelected
                          ? "border-cyan-200/45 bg-cyan-300/[0.10] shadow-[0_0_36px_rgba(34,211,238,0.13)]"
                          : "border-white/10 bg-black/25 hover:border-white/20 hover:bg-white/[0.045]"
                      }`}
                    >
                      <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-[18px] border border-white/10 bg-black/40">
                        {guide.image ? (
                          <img
                            src={guide.image}
                            alt={guide.name}
                            loading="lazy"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <Icon className="h-7 w-7 text-cyan-100" />
                        )}
                      </div>

                      <div className="min-w-0">
                        <p className="truncate text-sm font-black leading-5 text-white">
                          {guide.name}
                        </p>
                        <p className="mt-1 truncate text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">
                          {guide.category}
                        </p>
                        <p className="mt-2 inline-flex rounded-full border border-emerald-200/15 bg-emerald-300/[0.08] px-3 py-1 text-[9px] font-black uppercase tracking-[0.18em] text-emerald-100">
                          Disponible
                        </p>
                      </div>
                    </button>
                  )
                }
              )}
            </div>

            {hasMoreGuides && (
              <div className="mt-5 flex justify-center">
                <button
                  type="button"
                  onClick={() =>
                    setVisibleGuideCount(
                      currentCount =>
                        Math.min(
                          currentCount +
                            GUIDE_SELECTOR_BATCH_SIZE,
                          productGuides.length
                        )
                    )
                  }
                  className="rounded-2xl border border-white/10 bg-white/[0.045] px-6 py-3 text-[10px] font-black uppercase tracking-[0.20em] text-white/70 transition hover:border-cyan-200/25 hover:bg-cyan-300/[0.08] hover:text-cyan-100"
                >
                  Ver más productos disponibles
                </button>
              </div>
            )}
          </div>
        )}

        {featuredGuide && (
          <motion.article
            initial={{
              opacity: 0,
              y: 34,
            }}
            whileInView={{
              opacity: 1,
              y: 0,
            }}
            transition={{
              duration: 0.85,
            }}
            viewport={{ once: true }}
            className={`group relative mt-16 overflow-hidden rounded-[32px] border bg-white/[0.035] p-5 shadow-[0_30px_120px_rgba(0,0,0,0.45)] backdrop-blur-2xl md:p-8 ${getAccentClasses(featuredGuide.accent).border}`}
          >
            <div
              className={`absolute inset-0 bg-gradient-to-br ${getAccentClasses(featuredGuide.accent).glow}`}
            />
            <div className="absolute inset-0 bg-gradient-to-r from-black/88 via-black/70 to-black/82" />

            <div className="relative z-10 grid gap-8 lg:grid-cols-[0.95fr_1.05fr] lg:items-start">
              <LifestyleVisual
                guide={featuredGuide}
                priority
              />

              <div className="flex flex-col justify-center py-2 lg:py-8">
                <div className="flex flex-wrap items-center gap-3">
                  <p className="rounded-full border border-white/10 bg-white/[0.045] px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-white/55">
                    {featuredGuide.category}
                  </p>
                  <p
                    className={`rounded-full border px-4 py-2 text-[10px] font-black uppercase tracking-[0.22em] ${getAccentClasses(featuredGuide.accent).badge}`}
                  >
                    Disponible para comprar
                  </p>
                </div>

                <h3 className="mt-4 text-4xl font-black leading-tight text-white md:text-6xl">
                  {featuredGuide.name}
                </h3>

                <p
                  className={`mt-5 text-2xl font-black leading-tight md:text-4xl ${getAccentClasses(featuredGuide.accent).text}`}
                >
                  {featuredGuide.storyTitle}
                </p>

                <p className="mt-5 max-w-3xl text-base leading-8 text-zinc-300 md:text-lg">
                  {featuredGuide.storyDescription}
                </p>

                <div className="mt-6 rounded-[24px] border border-white/10 bg-white/[0.045] p-5">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/45">
                    Por qué puede gustarte
                  </p>
                  <p className="mt-3 text-base leading-7 text-white/85">
                    {featuredGuide.desireLine}
                  </p>
                </div>

                <div className="mt-7 grid gap-4 sm:grid-cols-2">
                  <div className="rounded-[24px] border border-white/10 bg-black/30 p-5">
                    <p
                      className={`text-[10px] font-semibold uppercase tracking-[0.24em] ${getAccentClasses(featuredGuide.accent).text}`}
                    >
                      Momento de uso
                    </p>
                    <p className="mt-3 text-xl font-black text-white">
                      {featuredGuide.moment}
                    </p>
                  </div>

                  <div className="rounded-[24px] border border-white/10 bg-black/30 p-5">
                    <p
                      className={`text-[10px] font-semibold uppercase tracking-[0.24em] ${getAccentClasses(featuredGuide.accent).text}`}
                    >
                      Cómo usarlo
                    </p>
                    <p className="mt-3 text-sm leading-7 text-zinc-300">
                      {featuredGuide.howToUse}
                    </p>
                  </div>
                </div>

                <div className="mt-7">
                  <p
                    className={`mb-3 text-[10px] font-semibold uppercase tracking-[0.24em] ${getAccentClasses(featuredGuide.accent).text}`}
                  >
                    Lo que suma a tu rutina
                  </p>
                  <BenefitChips
                    benefits={featuredGuide.benefits}
                  />
                </div>

                {featuredGuide.ingredientsSummary && (
                  <div className="mt-7 rounded-[24px] border border-white/10 bg-black/30 p-5">
                    <p
                      className={`text-[10px] font-semibold uppercase tracking-[0.24em] ${getAccentClasses(featuredGuide.accent).text}`}
                    >
                      Ingredientes funcionales
                    </p>
                    <p className="mt-3 text-sm leading-7 text-zinc-300">
                      {featuredGuide.ingredientsSummary}
                    </p>
                  </div>
                )}

                <div className="mt-7 rounded-[26px] border border-white/10 bg-black/30 p-5">
                  <p
                    className={`text-[10px] font-semibold uppercase tracking-[0.24em] ${getAccentClasses(featuredGuide.accent).text}`}
                  >
                    Rutina sugerida
                  </p>

                  <div className="mt-4 grid gap-3">
                    {featuredGuide.steps.map(
                      (step, index) => (
                        <div
                          key={step}
                          className="grid grid-cols-[auto_1fr] items-start gap-3 text-sm leading-6 text-zinc-300"
                        >
                          <span className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-white/[0.055] text-[10px] font-black text-white/70">
                            {index + 1}
                          </span>
                          <span>
                            {step}
                          </span>
                        </div>
                      )
                    )}
                  </div>
                </div>

                <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
                  <Link
                    href={featuredGuide.href}
                    className={`inline-flex items-center justify-center gap-3 rounded-2xl border px-6 py-4 text-left transition ${getAccentClasses(featuredGuide.accent).button}`}
                  >
                    <span className="flex flex-col">
                      <span className="text-xs font-black uppercase tracking-[0.18em]">
                        Comprar ahora
                      </span>
                      <span className="mt-1 text-[11px] font-semibold normal-case tracking-normal opacity-75">
                        {featuredGuide.ctaMicrocopy}
                      </span>
                    </span>
                    <ArrowUpRight className="h-4 w-4" />
                  </Link>

                  {onJoinFamily && (
                    <button
                      type="button"
                      onClick={onJoinFamily}
                      className="inline-flex items-center justify-center gap-3 rounded-2xl border border-white/10 bg-white/[0.045] px-6 py-4 text-xs font-black uppercase tracking-[0.18em] text-white/75 transition hover:border-white/20 hover:bg-white/[0.075]"
                    >
                      Unirme a la comunidad
                      <Sparkles className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </motion.article>
        )}

      </div>
    </section>
  )
}
