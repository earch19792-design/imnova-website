"use client"

import { useEffect, useState } from "react"

import {
  motion,
  AnimatePresence,
} from "framer-motion"

import {
  getPublicNichesWithSubniches,
  type StrategicNicheWithSubniches,
} from "@/lib/products-service"
import { useRouter } from "next/navigation"

export type InnovaSurveyIntent = {
  productName: string
  niches: string[]
  problem: string
  promise: string
  source: "web" | "whatsapp" | "redes"
}

interface InnovaPopupProps {
  isOpen: boolean
  onClose: () => void
  surveyIntent?: InnovaSurveyIntent | null
}

const MAX_SELECTED_AREAS = 3

type RegistrationStep =
  "interests" |
  "contact"

type PublicInterestArea = {
  id: string
  title: string
  description: string
  icon: string
  nicheSlugs: string[]
  subnicheSlugs: string[]
  highlightIndex: number
}

const communityRegisterErrorMessages:
  Record<string, string> = {
    subscriber_create_failed:
      "No pudimos completar tu registro en este momento. Intentalo de nuevo en unos segundos.",
    subscriber_id_not_returned:
      "Te registramos, pero no pudimos confirmar el registro. Intentalo de nuevo.",
    subscriber_interests_create_failed:
      "Te registramos, pero no pudimos guardar tus intereses. Intentalo de nuevo.",
    invalid_subniches:
      "Algunos intereses ya no estan disponibles. Cambia tus intereses e intentalo de nuevo.",
    too_many_subniches:
      "Selecciona menos areas e intentalo de nuevo.",
    too_many_area_interests:
      "Selecciona hasta 3 areas e intentalo de nuevo.",
    invalid_area_interests:
      "Algunas areas ya no estan disponibles. Cambia tus intereses e intentalo de nuevo.",
    invalid_email:
      "Revisa el formato de tu correo.",
    invalid_whatsapp:
      "Revisa el formato de tu WhatsApp.",
    email_or_whatsapp_required:
      "Agrega al menos WhatsApp o correo.",
    name_required:
      "Agrega tu nombre para unirte.",
  }

function getCommunityRegisterErrorMessage(
  error?: string
) {
  if (
    error &&
    communityRegisterErrorMessages[error]
  ) {
    return communityRegisterErrorMessages[error]
  }

  return "Error registrando tu participacion"
}

const publicInterestAreas: PublicInterestArea[] = [
  {
    id:
      "bienestar_salud_natural",
    title:
      "Bienestar y Salud Natural",
    description:
      "Vida saludable, productos naturales y nutricion funcional para el dia a dia.",
    icon:
      "✦",
    nicheSlugs: [
      "bienestar_diario",
      "nutricion_funcional",
    ],
    subnicheSlugs: [],
    highlightIndex:
      3,
  },
  {
    id:
      "fitness_rendimiento_recuperacion",
    title:
      "Fitness, Rendimiento y Recuperacion",
    description:
      "Energia, hidratacion, proteina y recuperacion para una vida activa.",
    icon:
      "◆",
    nicheSlugs: [
      "vida_activa",
    ],
    subnicheSlugs: [
      "proteina_funcional",
      "energia_natural",
    ],
    highlightIndex:
      0,
  },
  {
    id:
      "salud_funcionalidad_especifica",
    title:
      "Salud y Funcionalidad Especifica",
    description:
      "Digestión, defensas, descanso, enfoque, estres y soporte funcional.",
    icon:
      "◉",
    nicheSlugs: [
      "soporte_funcional",
      "digestion_balance",
      "energia_enfoque",
    ],
    subnicheSlugs: [],
    highlightIndex:
      1,
  },
  {
    id:
      "cuidado_belleza_natural",
    title:
      "Cuidado Personal y Belleza Natural",
    description:
      "Colageno, piel, cabello y cuidado natural con enfoque funcional.",
    icon:
      "✧",
    nicheSlugs: [
      "belleza_natural",
    ],
    subnicheSlugs: [],
    highlightIndex:
      4,
  },
  {
    id:
      "bienestar_animal_mascotas",
    title:
      "Bienestar Animal y Cuidado de Mascotas",
    description:
      "Productos, bienestar y cuidado funcional para mascotas y animales.",
    icon:
      "✺",
    nicheSlugs: [
      "bienestar_animal",
    ],
    subnicheSlugs: [],
    highlightIndex:
      5,
  },
]

// TODO: remover fallback cuando catálogo público esté estable.
const fallbackPublicNiches: StrategicNicheWithSubniches[] = [
  {
    id: "fallback-nutricion-funcional",
    slug: "nutricion_funcional",
    name: "Nutrición funcional",
    public_name: "Nutrición funcional",
    description: null,
    icon: "apple",
    icon_key: "apple",
    sort_order: 10,
    subniches: [
      {
        id: "fallback-cafe-funcional",
        niche_id: "fallback-nutricion-funcional",
        slug: "cafe_funcional",
        name: "Café funcional",
        public_name: "Café funcional",
        description: null,
        icon: "coffee",
        icon_key: "coffee",
        sort_order: 10,
      },
      {
        id: "fallback-proteina-funcional",
        niche_id: "fallback-nutricion-funcional",
        slug: "proteina_funcional",
        name: "Proteína funcional",
        public_name: "Proteína funcional",
        description: null,
        icon: "dumbbell",
        icon_key: "dumbbell",
        sort_order: 20,
      },
    ],
  },
  {
    id: "fallback-energia-enfoque",
    slug: "energia_enfoque",
    name: "Energía natural y enfoque",
    public_name: "Energía natural y enfoque",
    description: null,
    icon: "zap",
    icon_key: "zap",
    sort_order: 20,
    subniches: [
      {
        id: "fallback-energia-natural",
        niche_id: "fallback-energia-enfoque",
        slug: "energia_natural",
        name: "Energía natural",
        public_name: "Energía natural",
        description: null,
        icon: "zap",
        icon_key: "zap",
        sort_order: 10,
      },
      {
        id: "fallback-enfoque-mental",
        niche_id: "fallback-energia-enfoque",
        slug: "enfoque_mental",
        name: "Enfoque mental",
        public_name: "Enfoque mental",
        description: null,
        icon: "brain",
        icon_key: "brain",
        sort_order: 20,
      },
    ],
  },
]

export default function InnovaPopup({
  isOpen,
  onClose,
  surveyIntent,
}: InnovaPopupProps) {
  const router = useRouter()

  const [fullName, setFullName] =
    useState("")

  const isLogin = false

  const [countryCode, setCountryCode] =
  useState("+505")

  const [phone, setPhone] =
    useState("")

  const [email, setEmail] =
    useState("")
    const [objective, setObjective] =
  useState("")

  const [
    selectedNiches,
    setSelectedNiches,
  ] = useState<string[]>([])

  const [
    nichesWithSubniches,
    setNichesWithSubniches,
  ] = useState<StrategicNicheWithSubniches[]>([])

  const [
    selectedInterestAreaIds,
    setSelectedInterestAreaIds,
  ] = useState<string[]>([])

  const [
    registrationStep,
    setRegistrationStep,
  ] = useState<RegistrationStep>("interests")

  const [
    isLoadingInterests,
    setIsLoadingInterests,
  ] = useState(false)

  const [
    interestsError,
    setInterestsError,
  ] = useState("")

  const [
    interestSaveWarning,
    setInterestSaveWarning,
  ] = useState("")

  const [loading, setLoading] =
    useState(false)

  const [success, setSuccess] =
    useState(false)

  

  const [mounted, setMounted] =
    useState(false)

  /* =================================================
  INIT
  ================================================= */

  useEffect(() => {

  setMounted(true)

}, [])

  useEffect(() => {

    if (!isOpen) {
      return
    }

    setRegistrationStep("interests")
    setInterestSaveWarning("")
    setSuccess(false)

  }, [isOpen])

  useEffect(() => {

    if (!isOpen) {
      return
    }

    let isMounted = true

    async function loadInterests() {
      setIsLoadingInterests(true)
      setInterestsError("")

      try {
        const publicNiches =
          await getPublicNichesWithSubniches()

        if (!isMounted) {
          return
        }

        if (publicNiches.length === 0) {
          setNichesWithSubniches(
            fallbackPublicNiches
          )
          setInterestsError(
            "Estamos preparando los intereses. Puedes registrarte y actualizarlos después."
          )
          return
        }

        setNichesWithSubniches(
          publicNiches
        )
      } catch (error) {
        console.error(
          "LOAD PUBLIC INTERESTS ERROR:",
          error
        )

        if (!isMounted) {
          return
        }

        setNichesWithSubniches(
          fallbackPublicNiches
        )
        setInterestsError(
          "Estamos preparando los intereses. Puedes registrarte y actualizarlos después."
        )
      } finally {
        if (isMounted) {
          setIsLoadingInterests(false)
        }
      }
    }

    loadInterests()

    return () => {
      isMounted = false
    }

  }, [isOpen])
  
  /* =================================================
  POPUP HIGHLIGHTS
  ================================================= */

  const popupHighlights = [

  {
    title:
      "Fitness, Rendimiento y Recuperacion",

    subtitle:
      "Vida activa, energia y recuperacion",

    status:
      "Detectando alto rendimiento...",

    icon:
      "⚡",

    image:
      "/images/imnova-community-hero.webp",

    quote:
      "⚡ Energía desbloqueada.",

    glow:
      "from-cyan-400/30 to-cyan-600/10",

    energy:
      "bg-cyan-400/20",

    scene:
      "IM NOVA tomando PURA+ y comiendo pancakes Mash Nutri+ en un gym futurista.",
  },

  {
    title:
      "Salud y Funcionalidad Especifica",

    subtitle:
      "Soporte funcional y bienestar dirigido",

    status:
      "Conectando al ecosistema IMNOVA...",

    icon:
      "◉",

    image:
      "/images/imnova-community-hero.webp",

    quote:
      "◉ Bienvenido al futuro.",

    glow:
      "from-blue-500/30 to-indigo-600/10",

    energy:
      "bg-blue-500/20",

    scene:
      "IM NOVA usando hologramas, IA y gadgets futuristas.",
  },

  {
    title:
      "Bienestar y Salud Natural",

    subtitle:
      "Habitos, nutricion y vida saludable",

    status:
      "Modo enfoque sincronizado...",

    icon:
      "☕",

    image:
      "/images/imnova-community-hero.webp",

    quote:
      "☕ Modo enfoque activado.",

    glow:
      "from-orange-400/30 to-yellow-500/10",

    energy:
      "bg-orange-400/20",

    scene:
      "IM NOVA trabajando con Mash Coffee y setup productivity premium.",
  },

  {
    title:
      "Bienestar y Salud Natural",

    subtitle:
      "Productos naturales para el dia a dia",

    status:
      "Sincronizando vida inteligente...",

    icon:
      "◆",

    image:
      "/images/imnova-community-hero.webp",

    quote:
      "◆ Simplificá tu vida.",

    glow:
      "from-emerald-400/30 to-green-600/10",

    energy:
      "bg-emerald-400/20",

    scene:
      "IM NOVA interactuando con gadgets smart home y estilo de vida futurista.",
  },

  {
    title:
      "Cuidado Personal y Belleza Natural",

    subtitle:
      "Colageno, piel, cabello y cuidado natural",

    status:
      "Glow premium activado...",

    icon:
      "✨",

    image:
      "/images/imnova-community-hero.webp",

    quote:
      "✨ Glow premium activado.",

    glow:
      "from-pink-400/30 to-fuchsia-600/10",

    energy:
      "bg-pink-400/20",

    scene:
      "IM NOVA usando skincare premium con iluminación luxury glow.",
  },

  {
    title:
      "Bienestar Animal y Cuidado de Mascotas",

    subtitle:
      "Cuidado funcional para animales",

    status:
      "Buscando beneficios exclusivos...",

    icon:
      "✺",

    image:
      "/images/imnova-community-hero.webp",

    quote:
      "✺ Acceso VIP desbloqueado.",

    glow:
      "from-yellow-300/30 to-orange-500/10",

    energy:
      "bg-yellow-300/20",

    scene:
      "IM NOVA mostrando ofertas premium y acceso VIP futurista.",
  },
]
const [activeHighlight, setActiveHighlight] =
  useState(popupHighlights[0])

const [isSwitching, setIsSwitching] =
  useState(false)

const [displayText, setDisplayText] =
  useState("")

const interestGroups =
  nichesWithSubniches

const normalizeInterestTerm =
  (value: string) =>
    value
      .toLowerCase()
      .trim()

const isFallbackSubnicheId =
  (subnicheId: string) =>
    subnicheId.startsWith("fallback-")

const getSelectedInterestAreaNames =
  (
    areaIds: string[]
  ) =>
    publicInterestAreas
      .filter(
        area =>
          areaIds.includes(
            area.id
          )
      )
      .map(area => area.title)

const getAreaSubnicheIds =
  (
    areaIds: string[]
  ) => {
    const selectedAreas =
      publicInterestAreas.filter(
        area =>
          areaIds.includes(area.id)
      )

    const selectedNicheSlugs =
      new Set(
        selectedAreas.flatMap(
          area =>
            area.nicheSlugs
        )
      )

    const selectedSubnicheSlugs =
      new Set(
        selectedAreas.flatMap(
          area =>
            area.subnicheSlugs
        )
      )

    const subnicheIds =
      interestGroups.flatMap(niche => {
        const nicheMatches =
          selectedNicheSlugs.has(
            niche.slug
          )

        return (niche.subniches || [])
          .filter(
            subniche =>
              nicheMatches ||
              selectedSubnicheSlugs.has(
                subniche.slug
              )
          )
          .map(subniche => subniche.id)
      })

    return Array.from(
      new Set(subnicheIds)
    )
  }

const getAreaSearchTerms =
  (area: PublicInterestArea) => {
    const selectedNicheSlugs =
      new Set(area.nicheSlugs)

    const selectedSubnicheSlugs =
      new Set(area.subnicheSlugs)

    const mappedTerms =
      interestGroups.flatMap(niche => {
        const nicheMatches =
          selectedNicheSlugs.has(
            niche.slug
          )

        const nicheTerms =
          nicheMatches
            ? [
                niche.slug,
                niche.name,
                niche.public_name || "",
              ]
            : []

        const subnicheTerms =
          (niche.subniches || [])
            .filter(
              subniche =>
                nicheMatches ||
                selectedSubnicheSlugs.has(
                  subniche.slug
                )
            )
            .flatMap(subniche => [
              subniche.slug,
              subniche.name,
              subniche.public_name || "",
            ])

        return [
          ...nicheTerms,
          ...subnicheTerms,
        ]
      })

    return [
      area.id,
      area.title,
      ...area.nicheSlugs,
      ...area.subnicheSlugs,
      ...mappedTerms,
    ].map(normalizeInterestTerm)
  }

const toggleInterestArea =
  (
    area: PublicInterestArea
  ) => {
    const isSelected =
      selectedInterestAreaIds.includes(
        area.id
      )

    if (
      !isSelected &&
      selectedInterestAreaIds.length >=
        MAX_SELECTED_AREAS
    ) {
      setInterestsError(
        "Puedes seleccionar hasta 3 areas."
      )
      return
    }

    const nextAreaIds =
      isSelected
        ? selectedInterestAreaIds.filter(
            areaId =>
              areaId !== area.id
          )
        : [
            ...selectedInterestAreaIds,
            area.id,
          ]

    setSelectedInterestAreaIds(
      nextAreaIds
    )
    setSelectedNiches(
      getSelectedInterestAreaNames(
        nextAreaIds
      )
    )
    setInterestsError("")
    setIsSwitching(true)
    setActiveHighlight(
      popupHighlights[
        area.highlightIndex %
          popupHighlights.length
      ]
    )

    setTimeout(() => {

      setIsSwitching(false)

    }, 700)
  }

useEffect(() => {

  if (
    !isOpen ||
    !surveyIntent
  ) {
    return
  }

  const normalizedIntentNiches =
    surveyIntent.niches.map(
      intentNiche =>
        normalizeInterestTerm(
          intentNiche
        )
    )

  const matchedAreaIds =
    publicInterestAreas
      .filter(area => {
        const areaTerms =
          getAreaSearchTerms(area)

        return normalizedIntentNiches.some(
          intentNiche =>
            areaTerms.includes(
              intentNiche
            )
        )
      })
      .map(area => area.id)
      .slice(0, MAX_SELECTED_AREAS)

  if (matchedAreaIds.length > 0) {
    setSelectedInterestAreaIds(prev => {
      const nextAreaIds =
        Array.from(
          new Set([
            ...prev,
            ...matchedAreaIds,
          ])
        ).slice(
          0,
          MAX_SELECTED_AREAS
        )

      setSelectedNiches(
        getSelectedInterestAreaNames(
          nextAreaIds
        )
      )

      const selectedArea =
        publicInterestAreas.find(
          area =>
            nextAreaIds.includes(
              area.id
            )
          )

      if (selectedArea) {
        setActiveHighlight(
          popupHighlights[
            selectedArea.highlightIndex %
              popupHighlights.length
          ]
        )
      }

      return nextAreaIds
    })
  } else {
    setSelectedNiches(prev => [
      ...new Set([
        ...prev,
        ...surveyIntent.niches,
      ]),
    ])
  }

  const matchedHighlight =
    popupHighlights.find(highlight =>
      surveyIntent.niches.some(
        intentNiche =>
          highlight.title.toLowerCase() ===
          intentNiche.toLowerCase()
      )
    )

  if (matchedHighlight) {
    setActiveHighlight(matchedHighlight)
  }

  setObjective(
    `Validación comunitaria: ${surveyIntent.productName}`
  )

}, [
  isOpen,
  surveyIntent,
  nichesWithSubniches,
])

useEffect(() => {

  if (!isSwitching) return

  const text =
    activeHighlight.status

  let index = 0

  setDisplayText("")

  const interval =
    setInterval(() => {

      setDisplayText(
        text.slice(0, index)
      )

      index++

      if (index > text.length) {
        clearInterval(interval)
      }

    }, 35)

  return () =>
    clearInterval(interval)

}, [isSwitching, activeHighlight])

  /* =================================================
  SUBMIT
  ================================================= */

  const handleSubmit =
    async () => {

      try {

        setLoading(true)
        setInterestSaveWarning("")

        /* =========================================
        COMMUNITY REGISTRATION VALIDATION
        ========================================= */

        const surveyRecord =
          surveyIntent
            ? [
                "Encuesta de validación",
                `Canal: ${surveyIntent.source}`,
                "Canales disponibles: web, WhatsApp, redes sociales",
                `Producto: ${surveyIntent.productName}`,
                `Nichos: ${surveyIntent.niches.join(", ")}`,
                `Problema: ${surveyIntent.problem}`,
              ].join(" | ")
            : ""

        const effectiveObjective =
          surveyRecord ||
          objective ||
          "Registro comunidad IMNOVA"

        const normalizedPhone =
          phone.replace(/\D/g, "")

        const trimmedEmail =
          email.trim()

       if (
  !fullName.trim() ||
  (
    !normalizedPhone &&
    !trimmedEmail
  )
) {

  alert(
    "Completá tu nombre y al menos WhatsApp o correo"
  )

  return

        }
        if (
          selectedInterestAreaIds.length === 0
        ) {

          alert(
            "Selecciona al menos un area de interes"
          )

          return

        }

        /* =========================================
        SAVE USER DATA
        ========================================= */

        const selectedInterestNames =
          getSelectedInterestAreaNames(
            selectedInterestAreaIds
          )

        const normalizedSubnicheIds =
          []

        const registerResponse =
          await fetch(
            "/api/community/register",
            {
              method:
                "POST",
              headers: {
                "Content-Type":
                  "application/json",
              },
              body:
                JSON.stringify({
                  name:
                    fullName.trim(),
                  email:
                    trimmedEmail,
                  whatsapp:
                    phone.trim(),
                  country:
                    countryCode,
                  selectedSubnicheIds:
                    normalizedSubnicheIds,
                  selectedSubnicheNames:
                    [],
                  selectedAreaKeys:
                    selectedInterestAreaIds,
                  selectedAreaLabels:
                    selectedInterestNames,
                  objective:
                    effectiveObjective,
                  source:
                    "community_popup",
                  honeypot:
                    "",
                }),
            }
          )

        const registerResult =
          await registerResponse.json()
            .catch(() => null)

        if (
          !registerResponse.ok ||
          !registerResult?.success
        ) {
          throw new Error(
            getCommunityRegisterErrorMessage(
              registerResult?.error
            )
          )
        }

        if (
          Array.isArray(
            registerResult.warnings
          ) &&
          registerResult.warnings.length > 0
        ) {
          console.warn(
            "COMMUNITY REGISTER WARNINGS:",
            registerResult.warnings
          )
        }

        if (
          normalizedSubnicheIds.length === 0 &&
          selectedInterestAreaIds.length > 0
        ) {
          console.warn(
            "COMMUNITY REGISTER LEGACY INTERESTS ONLY: selected areas did not map to public subniche IDs."
          )
        }

        localStorage.setItem(
          "innova-access",
          "true"
        )

        localStorage.setItem(
          "innova-access-expiration",
          String(
            Date.now() +
            24 * 60 * 60 * 1000
          )
        )

        setSuccess(true)

       setTimeout(() => {

  onClose()

  router.push("/")

}, 1800)
        setFullName("")
        setPhone("")
        setEmail("")
        setSelectedNiches([])
        setSelectedInterestAreaIds([])
        setRegistrationStep("interests")

      } catch (err: any) {

        console.log(
          "SUPABASE ERROR:",
          JSON.stringify(err, null, 2)
        )

        console.log(err)

        alert(

          err?.message ||

          err?.error_description ||

          "Error registrando tu participación"

        )

      } finally {

        setLoading(false)

      }

    }

  const handlePrimaryAction =
    async () => {

      if (registrationStep === "interests") {
        if (selectedInterestAreaIds.length === 0) {
          alert(
            "Selecciona al menos un area de interes"
          )

          return
        }

        setRegistrationStep("contact")
        return
      }

      await handleSubmit()

    }

  if (!mounted) return null

  return (

    <AnimatePresence>

      {isOpen && (

        <motion.div
          initial={{
            opacity: 0,
          }}
          animate={{
            opacity: 1,
          }}
          exit={{
            opacity: 0,
          }}
          className="
            fixed
            inset-0
            z-[9999]
            flex
            items-start
            justify-center
            overflow-y-auto
            bg-black/90
            px-4
            py-4
            backdrop-blur-3xl
            sm:py-8
            lg:py-10
          "
        >

          {/* BACKGROUND */}
          <motion.div
  key={activeHighlight.title}
  initial={{
    opacity: 0,
    scale: 0.7,
  }}
  animate={{
    opacity: 1,
    scale: 1,
  }}
  transition={{
    duration: 1,
  }}
  className={`
    pointer-events-none
    absolute
    left-1/2
    top-1/2
    h-[700px]
    w-[700px]
    -translate-x-1/2
    -translate-y-1/2
    rounded-full
    blur-3xl
    ${activeHighlight.energy}
  `}
/>

          <div
            className="
              pointer-events-none
              absolute
              inset-0
              overflow-hidden
            "
          >

            <motion.div
              animate={{
                scale: [1.04, 1.06, 1.04],
              }}
              transition={{
                duration: 28,
                repeat: Infinity,
                ease: "easeInOut",
              }}
              className="
                absolute
                inset-0
                bg-[url('/images/imnova-popup-3d.webp')]
                bg-cover
                bg-center
                opacity-[0.10]
              "
            />

            <div
              className="
                absolute
                inset-0
                bg-black/80
              "
            />

          </div>

          {/* CONTAINER */}

          <motion.div
            initial={{
              opacity: 0,
              scale: 0.96,
              y: 40,
            }}
            animate={{
              opacity: 1,
              scale: 1,
              y: 0,
            }}
            exit={{
              opacity: 0,
              scale: 0.98,
            }}
            transition={{
              duration: 0.8,
              ease: [0.22, 1, 0.36, 1],
            }}
            className="
              relative
              w-full
              max-w-6xl
              rounded-[30px]
              border
              border-cyan-400/10
              bg-black/60
              backdrop-blur-3xl
              shadow-[0_0_120px_rgba(34,211,238,0.08)]
              sm:rounded-[40px]
            "
          >

            <div
              className="
                grid
                lg:grid-cols-2
              "
            >

              {/* LEFT */}

              <div
                className="
                  hidden
                  relative
                  overflow-hidden
                  border-b
                  border-white/10
                  p-8
                  lg:block
                  lg:border-b-0
                  lg:border-r
                  lg:p-12
                "
              >

                <div
                  className="
                    relative
                    inline-flex
                    items-center
                    gap-3
                    rounded-full
                    border
                    border-cyan-400/20
                    bg-cyan-400/[0.08]
                    px-5
                    py-3
                    backdrop-blur-md
                  "
                >

                  <div
                    className="
                      h-2
                      w-2
                      rounded-full
                      bg-cyan-300
                    "
                  />

                  <span
                    className="
                      text-[10px]
                      uppercase
                      tracking-[0.35em]
                      text-cyan-100
                    "
                  >

                    COMUNIDAD IMNOVA

                  </span>

                </div>

                <h2
                  className="
                    mt-10
                    text-4xl
                    font-bold
                    leading-[1]
                    tracking-[-0.05em]
                    text-white
                    lg:text-5xl
                  "
                >

                  La comunidad decide

                  <span
                    className="
                      block
                      bg-gradient-to-r
                      from-cyan-200
                      via-white
                      to-zinc-400
                      bg-clip-text
                      text-transparent
                    "
                  >

                    lo próximo

                  </span>

                </h2>

                <div
                  className="
                    relative
                    mt-10
                    flex
                    items-center
                    justify-center
                    min-h-[420px]
                  "
                >

                  <motion.div
                    animate={{
                      rotate: 360,
                    }}
                    transition={{
                      duration: 160,
                      repeat: Infinity,
                      ease: "linear",
                    }}
                    className="
                      absolute
                      h-[620px]
                      w-[620px]
                      rounded-full
                      border
                      border-cyan-400/10
                    "
                  />

                  <motion.img
  key={activeHighlight.image}
  src={activeHighlight.image}
  alt="Comunidad IMNOVA participando en innovación y selección de intereses."
  initial={{
    opacity: 0,
    scale: 0.92,
    y: 30,
  }}
  animate={{
    opacity: 1,
    scale: [1, 1.015, 1],
    y: [0, -6, 0],
    rotateY: [0, 2, 0],
    rotateX: [0, 1, 0],
    filter: [
      "drop-shadow(0 0 40px rgba(34,211,238,0.25))",
      "drop-shadow(0 0 90px rgba(34,211,238,0.55))",
      "drop-shadow(0 0 40px rgba(34,211,238,0.25))",
    ],
  }}
  transition={{
    duration: 12,
    repeat: Infinity,
    ease: "easeInOut",
  }}
  className="
    relative
    z-10
    w-full
    max-w-[620px]
    rounded-[40px]
    object-contain
    opacity-95
  "
/>

{/* TEMPORALMENTE ELIMINADO */}
               </div>

              </div>

              {/* RIGHT */}

              <div
                className="
                  relative
                  p-5
                  sm:p-8
                  lg:p-12
                "
              >

                {/* TOP ACCESS BAR */}

                <div
                  className="
                    mb-4
                    flex
                    items-center
                    justify-end
                    gap-4
                    sm:mb-6
                  "
                >

                  <button
                    type="button"
                    onClick={onClose}
                    className="
                      rounded-full
                      border
                      border-white/10
                      bg-white/[0.04]
                      px-4
                      py-2
                      text-[10px]
                      uppercase
                      tracking-[0.18em]
                      text-white/50
                      transition-all
                      duration-300
                      hover:border-cyan-400/30
                      hover:bg-cyan-400/[0.08]
                      hover:text-cyan-100
                    "
                  >

                    Regresar a la página web

                  </button>

                </div>

                <h3
                  className="
                    text-2xl
                    font-bold
                    tracking-[-0.04em]
                    text-white
                    sm:text-3xl
                  "
                >

                  {
                    isLogin
                      ? "Bienvenido de nuevo"
                      : "Decidí los próximos lanzamientos de IMNOVA"
                  }

                </h3>

                {!isLogin && (

                  <p
                    className="
                      mt-3
                      text-sm
                      leading-6
                      text-white/60
                    "
                  >

                    Elige hasta 3 áreas. Tus intereses ayudan a decidir próximos productos, encuestas y lanzamientos relevantes.

                  </p>

                )}
{!isLogin && (

  <div
    className="
      mt-4
      hidden
      gap-3
      sm:grid-cols-3
      sm:grid
    "
  >

    {[
      "Vota ideas antes de que se fabriquen",
      "Recibe acceso anticipado a lanzamientos",
      "Participa en pruebas, encuestas y beneficios exclusivos",
    ].map((benefit, index) => (

      <div
        key={benefit}
        className="
          rounded-2xl
          border
          border-white/10
          bg-white/[0.04]
          p-4
        "
      >

        <span
          className="
            flex
            h-7
            w-7
            items-center
            justify-center
            rounded-full
            border
            border-cyan-300/25
            bg-cyan-300/[0.08]
            text-[10px]
            font-black
            text-cyan-100
          "
        >

          {index + 1}

        </span>

        <p
          className="
            mt-3
            text-xs
            font-semibold
            leading-5
            text-white/75
          "
        >

          {benefit}

        </p>

      </div>

    ))}

  </div>

)}

{!isLogin && (

  <div
    className="
      mt-4
      flex
      flex-wrap
      gap-2
      sm:hidden
    "
  >

    {[
      "Sin spam",
      "Hasta 3 areas",
      "Vota lo proximo",
    ].map(item => (

      <span
        key={item}
        className="
          rounded-full
          border
          border-cyan-300/15
          bg-cyan-300/[0.07]
          px-3
          py-2
          text-[10px]
          font-black
          uppercase
          tracking-[0.14em]
          text-cyan-50/75
        "
      >

        {item}

      </span>

    ))}

  </div>

)}

{!isLogin && (

  <div
    className="
      mt-4
      grid
      grid-cols-2
      gap-3
    "
  >

    {[
      {
        key:
          "interests",
        label:
          "1. Intereses",
      },
      {
        key:
          "contact",
        label:
          "2. Tus datos",
      },
    ].map(step => {
      const active =
        registrationStep === step.key

      return (

        <div
          key={step.key}
          className={`
            rounded-full
            border
            px-4
            py-2
            text-center
            text-[10px]
            font-black
            uppercase
            tracking-[0.16em]
            transition-all
            duration-300

            ${
              active
                ? `
                  border-cyan-300/40
                  bg-cyan-300/[0.12]
                  text-cyan-50
                `
                : `
                  border-white/10
                  bg-white/[0.03]
                  text-white/35
                `
            }
          `}
        >

          {step.label}

        </div>

      )
    })}

  </div>

)}

                <div
  className={`
    mt-4
    hidden
    rounded-2xl
    border
    border-cyan-400/20
    bg-gradient-to-br
    ${activeHighlight.glow}
    p-5
    backdrop-blur-xl
    sm:block
  `}
>

  <div
    className="
      text-sm
      leading-relaxed
      text-cyan-100
    "
  >

    {
       isSwitching
    ? `${displayText}|`
    : activeHighlight.quote
    }

  </div>

</div>

{surveyIntent && !isLogin && (

  <div
    className="
      mt-4
      rounded-2xl
      border
      border-amber-200/20
      bg-amber-200/[0.06]
      p-5
      text-sm
      leading-6
      text-amber-50/85
    "
  >

    <p
      className="
        text-[10px]
        font-semibold
        uppercase
        tracking-[0.22em]
        text-amber-100/65
      "
    >

      Encuesta vinculada

    </p>

    <p className="mt-3 font-semibold text-white">
      {surveyIntent.productName}
    </p>

    <p className="mt-2 text-white/60">
      {surveyIntent.promise}
    </p>

    <p className="mt-3 text-cyan-100/80">
      Canal detectado: página web. Tu WhatsApp queda registrado para recibir
      encuestas y avances según el nicho que elegiste.
    </p>

  </div>

)}
               {/* FORM */}

<div
  className={
    registrationStep === "contact"
      ? "mt-6 space-y-4"
      : "hidden"
  }
>

  <div
    className="
      rounded-2xl
      border
      border-cyan-300/15
      bg-cyan-300/[0.06]
      p-4
      text-sm
      leading-6
      text-cyan-50/80
    "
  >

    Déjanos tu WhatsApp o correo para enviarte encuestas y oportunidades conectadas a los intereses que elegiste.

  </div>

  {!isLogin && (

    <>

      {/* NAME */}

      <input
        value={fullName}
        onChange={(e) =>
          setFullName(
            e.target.value
          )
        }
        placeholder="Tu nombre"
        className="
          w-full
          rounded-2xl
          border
          border-white/10
          bg-white/[0.06]
          px-6
          py-3.5
          text-white
          outline-none
          placeholder:text-white/45
          sm:py-4
        "
      />

      {/* PHONE */}

      <div className="flex gap-3">

       <select
  value={countryCode}
  onChange={(e) =>
    setCountryCode(
      e.target.value
    )
  }
  className="
    rounded-2xl
    border
    border-white/10
    bg-white/[0.06]
    px-4
    py-3.5
    text-white
    outline-none
    sm:py-4
  "
>

  {/* CENTROAMÉRICA */}

  <option value="+501">
    🇧🇿 Belize +501
  </option>

  <option value="+502">
    🇬🇹 Guatemala +502
  </option>

  <option value="+503">
    🇸🇻 El Salvador +503
  </option>

  <option value="+504">
    🇭🇳 Honduras +504
  </option>

  <option value="+505">
    🇳🇮 Nicaragua +505
  </option>

  <option value="+506">
    🇨🇷 Costa Rica +506
  </option>

  <option value="+507">
    🇵🇦 Panamá +507
  </option>

  {/* NORTEAMÉRICA */}

  <option value="+1">
    🇺🇸 Estados Unidos +1
  </option>

  <option value="+1">
    🇨🇦 Canadá +1
  </option>

</select>
        <input
          value={phone}
          onChange={(e) =>
            setPhone(
              e.target.value
            )
          }
          placeholder="Número WhatsApp"
          className="
            w-full
            rounded-2xl
            border
            border-white/10
            bg-white/[0.06]
            px-6
            py-3.5
            text-white
            outline-none
            placeholder:text-white/45
            sm:py-4
          "
        />

      </div>

    </>

  )}
  {/* EMAIL */}

  <input
    value={email}
    onChange={(e) =>
      setEmail(
        e.target.value
      )
    }
    placeholder="Correo electrónico"
    className="
      w-full
      rounded-2xl
      border
      border-white/10
      bg-white/[0.06]
      px-6
      py-3.5
      text-white
      outline-none
      placeholder:text-white/45
      sm:py-4
    "
  />

</div>

{/* NICHES */}

{!isLogin && registrationStep === "interests" && (

  <div
    className="
      mt-5
      space-y-4
    "
  >

    <div className="space-y-2">

      <h4
        className="
          text-base
          font-bold
          text-white
        "
      >

        ¿Qué temas te interesan más?

      </h4>

      <p
        className="
          text-sm
          leading-5
          text-white/60
          sm:leading-6
        "
      >

        Selecciona hasta 3 areas generales. Esto nos ayuda a enviarte encuestas y lanzamientos relevantes sin hacerte escoger subnichos técnicos.

      </p>

    </div>

    {isLoadingInterests && (

      <div
        className="
          rounded-2xl
          border
          border-white/10
          bg-white/[0.04]
          px-4
          py-3
          text-sm
          text-cyan-100
        "
      >

        Cargando intereses...

      </div>

    )}

    {interestsError && (

      <div
        className="
          rounded-2xl
          border
          border-amber-200/20
          bg-amber-200/[0.06]
          px-4
          py-3
          text-sm
          leading-6
          text-amber-50/85
        "
      >

        {interestsError}

      </div>

    )}

    <div
      className="
        grid
        gap-3
        sm:grid-cols-2
      "
    >

      {publicInterestAreas.map(
        (area) => {
          const active =
            selectedInterestAreaIds.includes(
              area.id
            )

          const disabled =
            !active &&
            selectedInterestAreaIds.length >=
              MAX_SELECTED_AREAS

          return (

            <button
              key={area.id}
              type="button"
              disabled={disabled}
              onClick={() =>
                toggleInterestArea(area)
              }
              className={`
                rounded-2xl
                border
                p-3
                text-left
                transition-all
                duration-300
                sm:p-4

                ${
                  active
                    ? `
                      border-cyan-300/50
                      bg-cyan-300/[0.12]
                      shadow-[0_0_34px_rgba(34,211,238,0.16)]
                    `
                    : disabled
                      ? `
                        cursor-not-allowed
                        border-white/5
                        bg-white/[0.02]
                        opacity-45
                      `
                      : `
                        border-white/10
                        bg-white/[0.04]
                        hover:border-cyan-300/25
                        hover:bg-cyan-300/[0.07]
                      `
                }
              `}
            >

              <div
                className="
                  flex
                  items-center
                  justify-between
                  gap-3
                "
              >

                <span
                  className={`
                  flex
                  h-9
                  w-9
                  shrink-0
                    items-center
                    justify-center
                    rounded-2xl
                    border
                    text-base

                    ${
                      active
                        ? `
                          border-cyan-300/40
                          bg-cyan-300/[0.14]
                          text-cyan-50
                        `
                        : `
                          border-white/10
                          bg-white/[0.05]
                          text-white/70
                        `
                    }
                  `}
                >

                  {area.icon}

                </span>

                {active && (

                  <span
                    className="
                      rounded-full
                      border
                      border-cyan-300/25
                      bg-cyan-300/[0.12]
                      px-2.5
                      py-1
                      text-[10px]
                      font-black
                      uppercase
                      tracking-[0.16em]
                      text-cyan-50
                    "
                  >

                    Elegido

                  </span>

                )}

              </div>

              <h5
                className="
                  mt-3
                  text-sm
                  font-bold
                  leading-5
                  text-white
                "
              >

                {area.title}

              </h5>

              <p
                className="
                  mt-2
                  hidden
                  text-xs
                  leading-5
                  text-white/58
                  sm:block
                "
              >

                {area.description}

              </p>

            </button>

          )
        }
      )}

    </div>

    <p
      className="
        text-xs
        text-white/45
      "
    >

      {selectedInterestAreaIds.length}/{MAX_SELECTED_AREAS} areas seleccionadas

    </p>

    <p
      className="
        text-xs
        leading-5
        text-white/45
      "
    >

      Mostramos areas simples para que elijas rapido. La segmentacion detallada queda organizada internamente por IMNOVA.

    </p>

  </div>

)}

{/* BUTTON */}

{registrationStep === "contact" && !isLogin && (

  <button
    type="button"
    onClick={() =>
      setRegistrationStep("interests")
    }
    className="
      mt-4
      w-full
      rounded-2xl
      border
      border-white/10
      bg-white/[0.04]
      px-5
      py-3
      text-xs
      font-bold
      uppercase
      tracking-[0.18em]
      text-white/60
      transition-all
      duration-300
      hover:border-cyan-300/25
      hover:bg-cyan-300/[0.08]
      hover:text-cyan-50
    "
  >

    Cambiar intereses

  </button>

)}

<button
  type="button"
  onClick={handlePrimaryAction}
  disabled={
    loading ||
    (
      registrationStep === "interests" &&
      isLoadingInterests
    )
  }
  className="
    mt-6
    w-full
    rounded-3xl
    border
    border-cyan-400/20
    bg-gradient-to-r
    from-cyan-300
    to-white
    px-6
    py-4
    text-sm
    font-black
    uppercase
    tracking-[0.25em]
    text-black
    transition-all
    duration-500
    hover:scale-[1.01]
    disabled:opacity-50
    sm:px-8
    sm:py-5
  "
>

  {
    loading
      ? "PROCESANDO..."
      : registrationStep === "interests"
        ? "CONTINUAR A MIS DATOS"
        : "QUIERO VOTAR LO PRÓXIMO"
  }

</button>

{!isLogin && (

  <p
    className="
      mt-3
      text-center
      text-xs
      leading-5
      text-white/45
    "
  >

    Sin spam. Usamos tus datos solo para enviarte avances, encuestas y oportunidades conectadas a tus intereses.

  </p>

)}

                {interestSaveWarning && (

                  <motion.div
                    initial={{
                      opacity: 0,
                      y: 10,
                    }}
                    animate={{
                      opacity: 1,
                      y: 0,
                    }}
                    className="
                      mt-5
                      rounded-2xl
                      border
                      border-amber-200/20
                      bg-amber-200/[0.06]
                      p-5
                      text-sm
                      leading-6
                      text-amber-50/85
                    "
                  >

                    {interestSaveWarning}

                  </motion.div>

                )}

                {/* SUCCESS */}

                {success && (

                  <motion.div
                    initial={{
                      opacity: 0,
                      y: 10,
                    }}
                    animate={{
                      opacity: 1,
                      y: 0,
                    }}
                    className="
                      mt-5
                      rounded-2xl
                      border
                      border-cyan-400/20
                      bg-cyan-400/[0.08]
                      p-5
                      text-cyan-100
                    "
                  >

                    Ya eres parte de la comunidad IMNOVA. Te enviaremos encuestas, avances y oportunidades según tus intereses.

                  </motion.div>

                )}

              </div>

            </div>

          </motion.div>

        </motion.div>

      )}

    </AnimatePresence>

  )

}
