"use client"

import {
  useEffect,
  useState,
} from "react"

import {
  ArrowUpRight,
  CheckCircle2,
  Eye,
  Gift,
  HeartHandshake,
  Mail,
  MapPin,
  MessageCircle,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Star,
  Target,
  Trophy,
  UsersRound,
  Vote,
  Zap,
} from "lucide-react"

import { Footer } from "@/components/footer"
import InnovaPopup from "@/components/imnova-popup"
import { Navigation } from "@/components/navigation"

type PublicIdea = {
  id?: string
  key: string
  title: string
  tag: string
  description: string
  signal: string
  problem: string
  solution: string
}

type HomeFeaturedProduct = {
  id: string
  slug: string | null
  name: string
  category: string | null
  description: string | null
  image: string
  storeHref: string
  headline: string
  badge: string
  promoLabel: string
  hasActivePromotion: boolean
  discount: number
}

type PublicVoteType =
  | "interested"
  | "would_buy"
  | "wants_trial"
  | "not_interested"

const publicVoteOptions: Array<{
  type: PublicVoteType
  label: string
}> = [
  {
    type: "interested",
    label: "Me interesa",
  },
  {
    type: "would_buy",
    label: "Lo compraria",
  },
  {
    type: "wants_trial",
    label: "Quiero prueba",
  },
  {
    type: "not_interested",
    label: "No me interesa",
  },
]

const fallbackPublicIdeas: PublicIdea[] = [
  {
    key: "functional-coffee-collagen",
    title: "Cafe funcional con colageno",
    tag: "Energia + belleza",
    description:
      "Una idea para unir energia diaria, cuidado personal y rutina simple en un formato facil de adoptar.",
    signal: "Ideal si te interesan cafe funcional, enfoque y belleza natural.",
    problem:
      "Personas que quieren cafe, energia y cuidado personal, pero no desean agregar mas pasos ni productos sueltos a su rutina diaria.",
    solution:
      "Un cafe funcional con enfoque en energia, belleza y practicidad para validar si la comunidad quiere una opcion lista para incorporar a su dia.",
  },
  {
    key: "high-protein-breakfast",
    title: "Desayuno alto en proteina",
    tag: "Nutricion practica",
    description:
      "Mezclas listas para preparar pancakes, waffles o pan funcional sin complicar la rutina.",
    signal: "Pensado para saciedad, conveniencia y mejor nutricion diaria.",
    problem:
      "Muchas personas quieren desayunar mejor, pero terminan eligiendo opciones rapidas con poca proteina o demasiada azucar.",
    solution:
      "Una mezcla funcional facil de preparar que permita disfrutar un desayuno rico, practico y con mejor perfil nutricional.",
  },
  {
    key: "daily-digestive-balance",
    title: "Balance digestivo diario",
    tag: "Bienestar diario",
    description:
      "Productos suaves para apoyar digestion, hidratacion y bienestar cotidiano sin promesas agresivas.",
    signal: "Una oportunidad para quienes priorizan salud natural y constancia.",
    problem:
      "El bienestar digestivo suele sentirse complicado, tecnico o dificil de sostener todos los dias.",
    solution:
      "Una propuesta simple para convertir el balance digestivo en un habito claro, suave y facil de repetir.",
  },
]

const observatorySignals = [
  {
    title: "Cafe funcional",
    label: "Senal semanal",
    text: "El radar observa conversaciones sobre energia practica, enfoque y rutinas con cafe funcional.",
  },
  {
    title: "Desayunos altos en proteina",
    label: "Tendencia social",
    text: "La comunidad digital busca opciones faciles para desayunar mejor sin complicar la preparacion.",
  },
  {
    title: "Belleza desde la nutricion",
    label: "Oportunidad emergente",
    text: "Aparecen senales de interes por colageno, piel, cabello y beneficios funcionales faciles de entender.",
  },
]

const trustSignals = [
  "Gratis y sin spam",
  "Votas sin crear cuenta",
  "Beneficios por participar",
  "Compra solo cuando esta disponible",
]

const howItWorks = [
  {
    icon: UsersRound,
    title: "Te unes",
    text: "Dejas tus datos basicos, aceptas el consentimiento y eliges hasta 3 intereses.",
  },
  {
    icon: Target,
    title: "Eliges intereses",
    text: "IMNOVA usa esos intereses para enviarte ideas, encuestas y novedades relevantes.",
  },
  {
    icon: Vote,
    title: "Votas ideas",
    text: "Tu respuesta ayuda a decidir si una oportunidad avanza, se ajusta o se pausa.",
  },
  {
    icon: Gift,
    title: "Recibes beneficios",
    text: "Cuando algo llega al mercado, la comunidad recibe acceso temprano y beneficios disponibles.",
  },
]

const missionVision = [
  {
    icon: Target,
    label: "Mision",
    title: "Crear productos guiados por necesidades reales.",
    text: "IMNOVA une comunidad, tendencias y validacion para desarrollar productos funcionales que ayuden a vivir mejor, elegir mejor y acceder primero a soluciones utiles.",
  },
  {
    icon: Eye,
    label: "Vision",
    title: "Convertir a la comunidad en el motor de lo proximo.",
    text: "Queremos que cada lanzamiento nazca de una lectura clara del mercado: personas que votan, ideas que se validan y productos que llegan solo cuando tienen sentido real.",
  },
]

const benefits = [
  {
    icon: Vote,
    title: "Decides con tu voto",
    text: "Tu opinion ayuda a priorizar ideas antes de que IMNOVA invierta tiempo y recursos.",
  },
  {
    icon: Zap,
    title: "Acceso temprano",
    text: "Recibe novedades, pruebas o preventas antes de que una oportunidad llegue al mercado.",
  },
  {
    icon: Sparkles,
    title: "Tendencias utiles",
    text: "Descubre senales simples sobre bienestar, nutricion, belleza y vida activa.",
  },
  {
    icon: HeartHandshake,
    title: "Beneficios VIP",
    text: "Los miembros activos podran acceder a recompensas, referidos y oportunidades especiales.",
  },
]

const transparencyStages = [
  {
    title: "Ideas propuestas",
    text: "Oportunidades simples que la comunidad puede entender y votar.",
  },
  {
    title: "Ideas en validacion",
    text: "Las mejores senales pasan por votos, encuestas y lectura de demanda.",
  },
  {
    title: "Productos en desarrollo",
    text: "IMNOVA prepara solo lo que tiene sentido para comunidad y mercado.",
  },
  {
    title: "Productos lanzados",
    text: "Cuando un producto esta listo, aparece en tienda y puede comprarse.",
  },
]

function getClientVoteKey() {
  if (typeof window === "undefined") {
    return ""
  }

  const storageKey = "imnova_public_vote_client_key"
  const existingKey = window.localStorage.getItem(storageKey)

  if (existingKey) {
    return existingKey
  }

  const newKey =
    typeof window.crypto?.randomUUID === "function"
      ? window.crypto.randomUUID()
      : `public-${Date.now()}-${Math.random().toString(16).slice(2)}`

  window.localStorage.setItem(storageKey, newKey)

  return newKey
}

async function getPublicIdeas() {
  const response =
    await fetch(
      "/api/community/ideas",
      {
        cache: "no-store",
      }
    )

  const result =
    await response
      .json()
      .catch(() => null)

  if (
    !response.ok ||
    !result?.success ||
    !Array.isArray(result.ideas)
  ) {
    throw new Error(
      result?.error ||
      "public_ideas_lookup_failed"
    )
  }

  return result.ideas as PublicIdea[]
}

async function getHomeFeaturedProduct() {
  const response =
    await fetch(
      "/api/store/featured",
      {
        cache: "no-store",
      }
    )

  const result =
    await response
      .json()
      .catch(() => null)

  if (
    !response.ok ||
    !result?.success
  ) {
    throw new Error(
      result?.error ||
      "home_featured_product_lookup_failed"
    )
  }

  return result.product
    ? result.product as HomeFeaturedProduct
    : null
}

export default function IMNOVAPage() {
  const [showPopup, setShowPopup] = useState(false)
  const [publicIdeas, setPublicIdeas] =
    useState<PublicIdea[]>(fallbackPublicIdeas)
  const [isLoadingPublicIdeas, setIsLoadingPublicIdeas] =
    useState(true)
  const [featuredHomeProduct, setFeaturedHomeProduct] =
    useState<HomeFeaturedProduct | null>(null)
  const [isLoadingFeaturedProduct, setIsLoadingFeaturedProduct] =
    useState(true)
  const [votedIdeas, setVotedIdeas] =
    useState<Record<string, PublicVoteType>>({})
  const [votingIdeaKey, setVotingIdeaKey] = useState<string | null>(null)
  const [voteError, setVoteError] = useState("")

  const featuredIdea = publicIdeas[0]

  useEffect(() => {
    let isMounted =
      true

    getPublicIdeas()
      .then(ideas => {
        if (!isMounted) {
          return
        }

        if (ideas.length > 0) {
          setPublicIdeas(ideas)
        }
      })
      .catch(error => {
        console.error(
          "PUBLIC IDEAS LOAD ERROR:",
          error
        )
      })
      .finally(() => {
        if (isMounted) {
          setIsLoadingPublicIdeas(false)
        }
      })

    return () => {
      isMounted =
        false
    }
  }, [])

  useEffect(() => {
    let isMounted =
      true

    getHomeFeaturedProduct()
      .then(product => {
        if (!isMounted) {
          return
        }

        setFeaturedHomeProduct(product)
      })
      .catch(error => {
        console.error(
          "HOME FEATURED PRODUCT LOAD ERROR:",
          error
        )
      })
      .finally(() => {
        if (isMounted) {
          setIsLoadingFeaturedProduct(false)
        }
      })

    return () => {
      isMounted =
        false
    }
  }, [])

  const openCommunity = () => {
    setShowPopup(true)
  }

  const closePopup = () => {
    setShowPopup(false)
  }

  const handleIdeaVote = async (
    idea: PublicIdea,
    voteType: PublicVoteType
  ) => {
    setVoteError("")
    setVotingIdeaKey(idea.key)

    try {
      const response = await fetch("/api/community/vote", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          product_id:
            idea.id ||
            undefined,
          idea_key:
            idea.id
              ? undefined
              : idea.key,
          idea_title: idea.title,
          vote_type: voteType,
          source: "public_home",
          client_vote_key: getClientVoteKey(),
        }),
      })

      const result = await response.json().catch(() => null)

      if (!response.ok || !result?.success) {
        throw new Error(result?.error || "vote_failed")
      }

      setVotedIdeas(current => ({
        ...current,
        [idea.key]: voteType,
      }))

      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("imnova:public_idea_vote", {
            detail: {
              product_id:
                idea.id ||
                null,
              idea_key: idea.key,
              idea_title: idea.title,
              vote_type: voteType,
              source: "public_home",
            },
          })
        )
      }
    } catch (error) {
      console.error("PUBLIC IDEA VOTE ERROR:", error)
      setVoteError(
        "No pudimos registrar tu voto ahora. Puedes unirte gratis y votar despues."
      )
    } finally {
      setVotingIdeaKey(null)
    }
  }

  const renderIdeaCardVoteButtons = (idea: PublicIdea) => (
    <div className="grid gap-2 sm:grid-cols-2">
      {publicVoteOptions.map(option => {
        const isSelected = votedIdeas[idea.key] === option.type

        return (
          <button
            key={option.type}
            type="button"
            onClick={() => handleIdeaVote(idea, option.type)}
            disabled={votingIdeaKey === idea.key}
            className={`min-h-12 rounded-2xl px-4 py-3 text-[11px] font-black uppercase tracking-[0.12em] transition focus:outline-none focus:ring-2 focus:ring-cyan-500/50 ${
              isSelected
                ? "bg-stone-950 text-white shadow-[0_14px_34px_rgba(15,23,42,0.18)]"
                : "border border-stone-200 bg-white/82 text-stone-700 shadow-sm hover:-translate-y-0.5 hover:border-cyan-300 hover:bg-white hover:text-stone-950"
            } disabled:cursor-not-allowed disabled:opacity-60`}
          >
            {votingIdeaKey === idea.key ? "Guardando..." : option.label}
          </button>
        )
      })}
    </div>
  )

  return (
    <main className="relative isolate overflow-hidden bg-[#f6f1e8] text-stone-950">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_12%_0%,rgba(14,165,183,0.14),transparent_34%),radial-gradient(circle_at_86%_8%,rgba(245,158,11,0.12),transparent_30%),linear-gradient(180deg,#fbf7ef_0%,#f6f1e8_48%,#efe7db_100%)]" />
      <div className="pointer-events-none fixed inset-0 -z-10 opacity-[0.18] bg-[linear-gradient(rgba(92,73,47,0.10)_1px,transparent_1px),linear-gradient(90deg,rgba(92,73,47,0.10)_1px,transparent_1px)] bg-[size:104px_104px]" />

      <Navigation />

      <section
        id="hero"
        className="relative isolate overflow-hidden bg-stone-950 px-6 pb-16 pt-40 text-white md:pb-24 md:pt-48"
      >
        <div className="pointer-events-none absolute inset-0 z-0">
          <img
            src="/images/mash-coffee.png"
            alt=""
            aria-hidden="true"
            className="absolute inset-y-0 right-0 h-full w-full scale-[1.02] object-cover object-center opacity-48 blur-[0.1px] md:opacity-58 lg:w-[64%] lg:opacity-92"
          />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,#050505_0%,rgba(5,5,5,0.96)_34%,rgba(5,5,5,0.70)_62%,rgba(5,5,5,0.22)_100%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_73%_46%,rgba(245,158,11,0.25),transparent_31%),radial-gradient(circle_at_19%_18%,rgba(34,211,238,0.18),transparent_34%)]" />
          <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-[#f6f1e8] via-[#f6f1e8]/20 to-transparent" />
          <div className="absolute inset-0 opacity-[0.12] bg-[linear-gradient(rgba(255,255,255,0.18)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.18)_1px,transparent_1px)] bg-[size:88px_88px]" />
        </div>

        <div className="relative z-10 mx-auto grid min-h-[620px] max-w-7xl items-center gap-10 lg:grid-cols-[0.88fr_1.12fr] xl:gap-14">
          <div className="max-w-[820px]">
            <div className="inline-flex items-center gap-3 rounded-full border border-cyan-300/35 bg-cyan-300/10 px-4 py-2 shadow-[0_18px_46px_rgba(6,182,212,0.08)] backdrop-blur">
              <span className="h-2.5 w-2.5 rounded-full bg-cyan-300 shadow-[0_0_18px_rgba(103,232,249,0.9)]" />
              <span className="text-[11px] font-black uppercase tracking-[0.22em] text-cyan-100">
                Comunidad IMNOVA
              </span>
            </div>

            <h1 className="mt-7 max-w-[760px] text-4xl font-black leading-[1.02] tracking-[-0.04em] text-white sm:text-5xl md:text-6xl lg:text-[4.75rem] xl:text-[5.25rem]">
              La comunidad que decide lo proximo del mercado.
            </h1>

            <p className="mt-7 max-w-3xl text-lg leading-8 text-white/72 md:text-xl md:leading-9">
              Vota ideas, descubre tendencias y recibe beneficios exclusivos
              antes que nadie. IMNOVA convierte senales reales en productos que
              la comunidad entiende, valida y espera.
            </p>

            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={openCommunity}
                className="inline-flex min-h-14 items-center justify-center gap-3 rounded-full bg-cyan-200 px-8 text-[12px] font-black uppercase tracking-[0.14em] text-stone-950 shadow-[0_22px_58px_rgba(34,211,238,0.23)] transition hover:-translate-y-0.5 hover:bg-white focus:outline-none focus:ring-2 focus:ring-cyan-200/70"
              >
                Unirme gratis
                <ArrowUpRight className="h-4 w-4" />
              </button>

              <a
                href="#ideas-activas"
                className="inline-flex min-h-14 items-center justify-center gap-3 rounded-full border border-white/18 bg-white/8 px-8 text-[12px] font-black uppercase tracking-[0.14em] text-white shadow-sm backdrop-blur transition hover:-translate-y-0.5 hover:bg-white/14 focus:outline-none focus:ring-2 focus:ring-cyan-200/50"
              >
                Ver ideas activas
                <Vote className="h-4 w-4" />
              </a>
            </div>

            <div className="mt-8 flex flex-wrap gap-2.5">
              {trustSignals.map(item => (
                <span
                  key={item}
                  className="inline-flex items-center gap-2 rounded-full border border-white/14 bg-white/8 px-4 py-2 text-[11px] font-bold text-white/72 shadow-sm backdrop-blur"
                >
                  <CheckCircle2 className="h-3.5 w-3.5 text-cyan-200" />
                  {item}
                </span>
              ))}
            </div>

            <div className="mt-9 grid max-w-3xl gap-3 sm:grid-cols-3">
              {[
                {
                  label: "Participa",
                  value: "elige intereses",
                },
                {
                  label: "Valida",
                  value: "vota ideas",
                },
                {
                  label: "Accede",
                  value: "recibe beneficios",
                },
              ].map(item => (
                <div
                  key={item.label}
                  className="rounded-[24px] border border-white/10 bg-white/[0.07] p-4 backdrop-blur"
                >
                  <p className="text-[10px] font-black uppercase tracking-[0.20em] text-cyan-100/70">
                    {item.label}
                  </p>
                  <p className="mt-2 text-xl font-black tracking-[-0.04em] text-white">
                    {item.value}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="relative lg:max-w-[590px] lg:justify-self-end xl:max-w-[650px]">
            <div className="absolute -right-8 -top-8 hidden h-36 w-36 rounded-full bg-amber-300/25 blur-3xl md:block" />
            <div className="relative overflow-hidden rounded-[36px] border border-white/14 bg-white/[0.08] p-4 shadow-[0_32px_90px_rgba(0,0,0,0.32)] backdrop-blur-xl">
              {featuredHomeProduct ? (
                <div className="relative overflow-hidden rounded-[28px] border border-white/10 bg-stone-950">
                  <img
                    src={featuredHomeProduct.image}
                    alt={`${featuredHomeProduct.name} disponible en IMNOVA Store.`}
                    className="h-[300px] w-full bg-[radial-gradient(circle_at_50%_42%,rgba(245,158,11,0.18),transparent_34%),linear-gradient(135deg,#17110b_0%,#050505_55%,#24190e_100%)] object-contain object-center p-7 md:h-[410px] md:p-9"
                  />
                  <div className="absolute left-5 top-5 rounded-full bg-amber-300 px-4 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-stone-950 shadow-sm">
                    {isLoadingFeaturedProduct
                      ? "Buscando disponible"
                      : featuredHomeProduct.badge}
                  </div>
                  <div className="absolute bottom-4 left-4 right-4 rounded-[22px] border border-white/15 bg-stone-950/86 p-4 text-white shadow-[0_18px_48px_rgba(0,0,0,0.28)] backdrop-blur">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-amber-100/80">
                          IMNOVA Store
                        </p>
                        <p className="mt-1 text-lg font-black leading-tight tracking-[-0.035em]">
                          {featuredHomeProduct.headline}
                        </p>
                      </div>
                      <a
                        href={featuredHomeProduct.storeHref || "/store"}
                        className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-full bg-white px-4 text-[10px] font-black uppercase tracking-[0.14em] text-stone-950 transition hover:bg-cyan-100 focus:outline-none focus:ring-2 focus:ring-cyan-200/70"
                      >
                        Comprar ahora
                        <ShoppingBag className="h-3.5 w-3.5" />
                      </a>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="relative flex min-h-[300px] flex-col justify-between overflow-hidden rounded-[28px] border border-cyan-200/14 bg-[radial-gradient(circle_at_70%_18%,rgba(103,232,249,0.14),transparent_30%),linear-gradient(135deg,#071111_0%,#050505_58%,#15120b_100%)] p-7 text-white md:min-h-[410px] md:p-9">
                  <div className="w-fit rounded-full border border-cyan-200/24 bg-cyan-200/10 px-4 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-cyan-50">
                    {isLoadingFeaturedProduct
                      ? "Buscando disponible"
                      : "Sin producto disponible"}
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-100/70">
                      IMNOVA Store
                    </p>
                    <h2 className="mt-3 max-w-md text-3xl font-black leading-tight tracking-[-0.05em] md:text-5xl">
                      Cuando un producto este listo, aparecera aqui.
                    </h2>
                    <p className="mt-4 max-w-md text-sm leading-7 text-white/62">
                      Los productos en Produccion, Desarrollo o Validacion no se muestran como comprables.
                    </p>
                  </div>
                </div>
              )}

              <div
                id="idea-activa"
                className="mt-4 scroll-mt-28 rounded-[24px] border border-cyan-200/14 bg-stone-950/82 p-5 text-white"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-[10px] font-black uppercase tracking-[0.20em] text-cyan-100/70">
                    Idea activa destacada
                  </p>
                  <span className="rounded-full border border-cyan-200/20 bg-cyan-200/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-cyan-50">
                    {isLoadingPublicIdeas
                      ? "Cargando"
                      : `${publicIdeas.length} en votacion`}
                  </span>
                </div>

                <h2 className="mt-3 text-2xl font-black tracking-[-0.04em]">
                  {featuredIdea.title}
                </h2>
                <p className="mt-3 text-sm leading-6 text-white/65">
                  Revisa el problema, la solucion propuesta y vota en la seccion
                  completa de ideas activas.
                </p>
                <a
                  href="#ideas-activas"
                  className="mt-5 inline-flex min-h-10 items-center justify-center gap-2 rounded-full bg-cyan-200 px-4 text-[10px] font-black uppercase tracking-[0.14em] text-stone-950 transition hover:bg-white focus:outline-none focus:ring-2 focus:ring-cyan-200/70"
                >
                  Ver y votar ideas
                  <Vote className="h-3.5 w-3.5" />
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="relative z-20 -mt-8 px-6 pb-14">
        <div className="mx-auto grid max-w-7xl gap-3 rounded-[30px] border border-stone-200 bg-white/76 p-4 shadow-[0_24px_70px_rgba(58,44,28,0.12)] backdrop-blur md:grid-cols-4">
          {[
            {
              label: "Comunidad",
              value: "Primero la participacion",
            },
            {
              label: "Votacion",
              value: "Senales reales",
            },
            {
              label: "Store",
              value: "Solo disponible",
            },
            {
              label: "Mensajes",
              value: "Con consentimiento",
            },
          ].map(item => (
            <div
              key={item.label}
              className="rounded-[22px] bg-[#fbf7ef] px-5 py-4 shadow-sm"
            >
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-700">
                {item.label}
              </p>
              <p className="mt-2 text-lg font-black tracking-[-0.03em] text-stone-950">
                {item.value}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section
        id="mision-vision"
        className="px-6 py-16 md:py-20"
      >
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-5 lg:grid-cols-[0.86fr_1.14fr]">
            <div className="relative overflow-hidden rounded-[34px] border border-stone-200 bg-stone-950 p-7 text-white shadow-[0_28px_80px_rgba(15,23,42,0.16)] md:p-9">
              <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-cyan-300/16 blur-3xl" />
              <div className="pointer-events-none absolute -bottom-24 left-12 h-56 w-56 rounded-full bg-amber-300/12 blur-3xl" />
              <p className="text-[10px] font-black uppercase tracking-[0.26em] text-cyan-100/70">
                Quienes somos
              </p>
              <h2 className="mt-5 text-4xl font-black leading-tight tracking-[-0.05em] md:text-6xl">
                IMNOVA crea con la comunidad, no a espaldas del mercado.
              </h2>
              <p className="mt-6 text-base leading-8 text-white/68">
                El sistema es simple: personas comparten intereses, votan ideas
                y ayudan a priorizar que oportunidades merecen convertirse en
                productos reales.
              </p>
              <div className="mt-8 grid gap-3 sm:grid-cols-3">
                {["Escuchar", "Validar", "Lanzar"].map(item => (
                  <div
                    key={item}
                    className="rounded-2xl border border-white/10 bg-white/[0.07] px-4 py-3"
                  >
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-100/75">
                      {item}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {missionVision.map(item => (
                <article
                  key={item.label}
                  className="rounded-[30px] border border-stone-200 bg-white/76 p-6 shadow-[0_20px_55px_rgba(58,44,28,0.07)] backdrop-blur transition hover:-translate-y-1 hover:shadow-[0_24px_70px_rgba(58,44,28,0.10)]"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-50 text-cyan-700">
                    <item.icon className="h-5 w-5" />
                  </div>
                  <p className="mt-6 text-[10px] font-black uppercase tracking-[0.24em] text-cyan-700">
                    {item.label}
                  </p>
                  <h3 className="mt-3 text-2xl font-black leading-tight tracking-[-0.04em] text-stone-950">
                    {item.title}
                  </h3>
                  <p className="mt-4 text-sm leading-7 text-stone-600">
                    {item.text}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section
        id="como-funciona"
        className="px-6 py-16 md:py-24"
      >
        <div className="mx-auto max-w-7xl">
          <div className="max-w-3xl">
            <p className="text-[10px] font-black uppercase tracking-[0.28em] text-cyan-700">
              Como funciona
            </p>
            <h2 className="mt-4 text-4xl font-black tracking-[-0.05em] text-stone-950 md:text-6xl">
              Un flujo claro para cualquier visitante.
            </h2>
          </div>

          <div className="mt-11 grid gap-4 md:grid-cols-4">
            {howItWorks.map((step, index) => (
              <article
                key={step.title}
                className="relative overflow-hidden rounded-[30px] border border-stone-200 bg-white/72 p-6 shadow-[0_20px_55px_rgba(58,44,28,0.07)] backdrop-blur transition hover:-translate-y-1 hover:shadow-[0_24px_70px_rgba(58,44,28,0.10)]"
              >
                <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-cyan-300 via-amber-200 to-transparent" />
                <div className="flex items-center justify-between gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-stone-950 text-white">
                    <step.icon className="h-5 w-5" />
                  </div>
                  <span className="text-sm font-black text-stone-300">
                    0{index + 1}
                  </span>
                </div>
                <h3 className="mt-7 text-2xl font-black tracking-[-0.04em] text-stone-950">
                  {step.title}
                </h3>
                <p className="mt-4 text-sm leading-7 text-stone-600">
                  {step.text}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section
        id="ideas-activas"
        className="px-6 py-16 md:py-24"
      >
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div className="max-w-3xl">
              <p className="text-[10px] font-black uppercase tracking-[0.28em] text-cyan-700">
                Ideas activas en votacion
              </p>
              <h2 className="mt-4 text-4xl font-black tracking-[-0.05em] text-stone-950 md:text-6xl">
                Estas oportunidades ya salieron del radar y necesitan tu voto.
              </h2>
              <p className="mt-5 text-base leading-8 text-stone-600 md:text-lg">
                Cada idea muestra el problema que detectamos y la solucion que
                IMNOVA podria desarrollar. Tu respuesta ayuda a decidir si
                avanza, se ajusta o se pausa.
              </p>
              {isLoadingPublicIdeas && (
                <p className="mt-3 text-xs font-black uppercase tracking-[0.16em] text-stone-400">
                  Cargando ideas activas...
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={openCommunity}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-cyan-200 bg-cyan-50 px-6 text-[12px] font-black uppercase tracking-[0.14em] text-cyan-800 transition hover:-translate-y-0.5 hover:bg-cyan-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/60"
            >
              Recibir avances
              <MessageCircle className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-12 grid gap-5 lg:grid-cols-2">
            {publicIdeas.map((idea, index) => (
              <article
                key={idea.key}
                className="relative overflow-hidden rounded-[34px] border border-stone-200 bg-white/78 p-6 shadow-[0_26px_72px_rgba(58,44,28,0.09)] backdrop-blur transition hover:-translate-y-1 hover:shadow-[0_30px_90px_rgba(58,44,28,0.12)] md:p-7"
              >
                <div className="pointer-events-none absolute -right-24 -top-24 h-56 w-56 rounded-full bg-cyan-200/26 blur-3xl" />
                <div className="relative">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="rounded-full bg-stone-950 px-4 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-white">
                      Idea activa {index + 1}
                    </span>
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-4 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-amber-800">
                      {idea.tag}
                    </span>
                  </div>

                  <h3 className="mt-6 text-4xl font-black leading-tight tracking-[-0.05em] text-stone-950 md:text-5xl">
                    {idea.title}
                  </h3>

                  <div className="mt-7 grid gap-3 md:grid-cols-2">
                    <div className="rounded-[24px] border border-stone-200 bg-[#fbf7ef] p-5">
                      <p className="text-[10px] font-black uppercase tracking-[0.20em] text-stone-500">
                        Problema detectado
                      </p>
                      <p className="mt-3 text-sm leading-7 text-stone-700">
                        {idea.problem}
                      </p>
                    </div>

                    <div className="rounded-[24px] border border-cyan-200 bg-cyan-50 p-5">
                      <p className="text-[10px] font-black uppercase tracking-[0.20em] text-cyan-800">
                        Solucion propuesta
                      </p>
                      <p className="mt-3 text-sm leading-7 text-cyan-950">
                        {idea.solution}
                      </p>
                    </div>
                  </div>

                  <div className="mt-7">
                    <p className="mb-3 text-[11px] font-black uppercase tracking-[0.18em] text-stone-500">
                      Que harias si IMNOVA desarrolla esta idea?
                    </p>
                    {renderIdeaCardVoteButtons(idea)}
                  </div>

                  {votedIdeas[idea.key] && (
                    <div
                      aria-live="polite"
                      className="mt-4 rounded-2xl border border-cyan-200 bg-cyan-50 px-5 py-4 text-sm leading-7 text-cyan-900"
                    >
                      Gracias. Tu respuesta ayuda a decidir los proximos
                      lanzamientos.
                      <button
                        type="button"
                        onClick={openCommunity}
                        className="mt-3 inline-flex font-black text-cyan-900 underline decoration-cyan-400 underline-offset-4"
                      >
                        Unirme a la comunidad para recibir avances
                      </button>
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>

          {voteError && (
            <p
              aria-live="assertive"
              className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900"
            >
              {voteError}
            </p>
          )}
        </div>
      </section>

      <section
        id="observatorio"
        className="px-6 py-16 md:py-24"
      >
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div className="max-w-3xl">
              <p className="text-[10px] font-black uppercase tracking-[0.28em] text-cyan-700">
                Observatorio IMNOVA
              </p>
              <h2 className="mt-4 text-4xl font-black tracking-[-0.05em] text-stone-950 md:text-6xl">
                Senales que el radar observa antes de convertirlas en ideas.
              </h2>
              <p className="mt-5 text-base leading-8 text-stone-600 md:text-lg">
                Esta parte muestra tendencias, conversaciones y oportunidades
                que IMNOVA esta observando. Todavia no son ideas votables; si
                una senal tiene sentido, pasa al bloque de ideas activas.
              </p>
            </div>

            <a
              href="#ideas-activas"
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-cyan-200 bg-cyan-50 px-6 text-[12px] font-black uppercase tracking-[0.14em] text-cyan-800 transition hover:-translate-y-0.5 hover:bg-cyan-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/60"
            >
              Ver ideas activas
              <Vote className="h-4 w-4" />
            </a>
          </div>

          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {observatorySignals.map(signal => (
              <article
                key={signal.title}
                className="rounded-[30px] border border-stone-200 bg-white/72 p-6 shadow-[0_20px_55px_rgba(58,44,28,0.07)] backdrop-blur transition hover:-translate-y-1 hover:shadow-[0_24px_70px_rgba(58,44,28,0.10)]"
              >
                <span className="rounded-full border border-stone-200 bg-[#fbf7ef] px-4 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-stone-600">
                  {signal.label}
                </span>
                <h3 className="mt-6 text-3xl font-black leading-tight tracking-[-0.04em] text-stone-950">
                  {signal.title}
                </h3>
                <p className="mt-4 text-sm leading-7 text-stone-600">
                  {signal.text}
                </p>
                <p className="mt-5 rounded-2xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-xs font-bold leading-6 text-cyan-900">
                  Senal observada. Aun no es una idea activa para votar.
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section
        id="beneficios"
        className="px-6 py-16 md:py-24"
      >
        <div className="mx-auto max-w-7xl">
          <div className="max-w-3xl">
            <p className="text-[10px] font-black uppercase tracking-[0.28em] text-cyan-700">
              Beneficios
            </p>
            <h2 className="mt-4 text-4xl font-black tracking-[-0.05em] text-stone-950 md:text-6xl">
              Por que vale la pena unirse.
            </h2>
          </div>

          <div className="mt-11 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {benefits.map(benefit => (
              <article
                key={benefit.title}
                className="rounded-[30px] border border-stone-200 bg-white/68 p-6 shadow-[0_20px_55px_rgba(58,44,28,0.07)] backdrop-blur"
              >
                <benefit.icon className="h-6 w-6 text-cyan-700" />
                <h3 className="mt-5 text-2xl font-black tracking-[-0.04em] text-stone-950">
                  {benefit.title}
                </h3>
                <p className="mt-4 text-sm leading-7 text-stone-600">
                  {benefit.text}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section
        id="store-preview"
        className="px-6 py-14 md:py-20"
      >
        <div className="mx-auto grid max-w-7xl gap-8 overflow-hidden rounded-[36px] border border-stone-200 bg-stone-950 p-6 text-white shadow-[0_34px_95px_rgba(15,23,42,0.18)] md:p-8 lg:grid-cols-[0.72fr_1.28fr] lg:items-center">
          <div className="max-w-xl">
            <p className="text-[10px] font-black uppercase tracking-[0.28em] text-cyan-100/70">
              {featuredHomeProduct?.hasActivePromotion
                ? "Promocion de lanzamiento"
                : "Producto terminado"}
            </p>
            <h2 className="mt-4 text-3xl font-black leading-tight tracking-[-0.04em] md:text-5xl lg:text-[3.35rem]">
              {featuredHomeProduct?.hasActivePromotion
                ? "Descuento activo cuando el producto ya esta listo."
                : featuredHomeProduct
                  ? "La tienda muestra solo lo que ya se puede comprar."
                  : "Aun no hay producto disponible para compra."}
            </h2>
            <p className="mt-5 text-base leading-8 text-white/68">
              {featuredHomeProduct
                ? "Un producto disponible ya paso de idea a validacion, canalizacion y producto terminado. Por eso aparece en Store con precio, promocion de lanzamiento cuando aplica y canales claros."
                : "Los productos en Produccion, Desarrollo o Validacion se mantienen fuera de la tienda publica hasta que realmente esten listos para comprarse."}
            </p>
            {featuredHomeProduct ? (
              <a
                href="/store"
                className="mt-8 inline-flex min-h-14 items-center justify-center gap-3 rounded-full bg-white px-7 text-[12px] font-black uppercase tracking-[0.14em] text-stone-950 transition hover:-translate-y-0.5 hover:bg-cyan-100 focus:outline-none focus:ring-2 focus:ring-cyan-300/80"
              >
                Ver tienda
                <ShoppingBag className="h-4 w-4" />
              </a>
            ) : (
              <button
                type="button"
                onClick={openCommunity}
                className="mt-8 inline-flex min-h-14 items-center justify-center gap-3 rounded-full bg-cyan-200 px-7 text-[12px] font-black uppercase tracking-[0.14em] text-stone-950 transition hover:-translate-y-0.5 hover:bg-white focus:outline-none focus:ring-2 focus:ring-cyan-300/80"
              >
                Recibir aviso cuando este listo
                <MessageCircle className="h-4 w-4" />
              </button>
            )}

            <a
              href="#where-to-buy"
              className="mt-3 inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-white/15 px-6 text-[11px] font-black uppercase tracking-[0.14em] text-white/72 transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-cyan-300/70"
            >
              Donde comprar
              <MapPin className="h-4 w-4" />
            </a>
          </div>

          <div className="grid gap-4">
            <div className="relative overflow-hidden rounded-[32px] border border-white/10 bg-white/[0.08]">
              {featuredHomeProduct ? (
                <>
                  <img
                    src={featuredHomeProduct.image}
                    alt={`${featuredHomeProduct.name} disponible en IMNOVA Store.`}
                    className="h-[300px] w-full bg-white object-contain object-center p-5 md:h-[380px] md:p-8"
                  />
                  <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent_20%,rgba(5,5,5,0.88)_100%)]" />
                  <div className="absolute left-5 top-5 flex flex-wrap gap-2">
                    <span className="rounded-full bg-amber-300 px-4 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-stone-950 shadow-sm">
                      {featuredHomeProduct.hasActivePromotion
                        ? "Promocion de lanzamiento"
                        : "Producto disponible"}
                    </span>
                    <span className="rounded-full border border-white/20 bg-stone-950/70 px-4 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-white backdrop-blur">
                      {featuredHomeProduct.promoLabel}
                    </span>
                  </div>
                  <div className="absolute bottom-5 left-5 right-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.20em] text-amber-100/80">
                        Producto terminado
                      </p>
                      <h3 className="mt-2 text-3xl font-black tracking-[-0.05em]">
                        {featuredHomeProduct.name}
                      </h3>
                    </div>
                    <a
                      href={featuredHomeProduct.storeHref || "/store"}
                      className="inline-flex min-h-11 items-center justify-center rounded-full bg-amber-300 px-5 text-[10px] font-black uppercase tracking-[0.14em] text-stone-950 transition hover:bg-white focus:outline-none focus:ring-2 focus:ring-cyan-200/70"
                    >
                      Comprar
                    </a>
                  </div>
                </>
              ) : (
                <div className="flex min-h-[300px] flex-col justify-between bg-[radial-gradient(circle_at_70%_20%,rgba(103,232,249,0.16),transparent_32%),linear-gradient(135deg,#061111_0%,#050505_55%,#19140c_100%)] p-6 md:min-h-[380px] md:p-8">
                  <span className="w-fit rounded-full border border-cyan-200/24 bg-cyan-200/10 px-4 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-cyan-50">
                    Esperando disponible
                  </span>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.20em] text-cyan-100/70">
                      Producto en proceso
                    </p>
                    <h3 className="mt-2 max-w-md text-3xl font-black tracking-[-0.05em]">
                      Nada se muestra como compra hasta pasar a Disponible.
                    </h3>
                  </div>
                </div>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                "Producto terminado",
                "Promocion de lanzamiento",
                "Compra clara",
                "Canales autorizados",
              ].map(item => (
                <div
                  key={item}
                  className="rounded-[24px] border border-white/10 bg-white/[0.08] p-4"
                >
                  <CheckCircle2 className="h-5 w-5 text-cyan-100" />
                  <p className="mt-4 text-base font-black tracking-[-0.035em]">
                    {item}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section
        id="where-to-buy"
        className="scroll-mt-28 px-6 py-16 md:py-24"
      >
        <div className="mx-auto grid max-w-7xl gap-8 rounded-[36px] border border-stone-200 bg-white/72 p-7 shadow-[0_28px_78px_rgba(58,44,28,0.10)] backdrop-blur md:p-10 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.28em] text-cyan-700">
              Donde comprar
            </p>
            <h2 className="mt-4 text-4xl font-black leading-tight tracking-[-0.05em] text-stone-950 md:text-6xl">
              Encuentra productos IMNOVA sin complicarte.
            </h2>
            <p className="mt-6 text-base leading-8 text-stone-600 md:text-lg">
              Primero ve a la tienda para comprar productos disponibles. Cuando
              un canal autorizado este confirmado, aqui se mostrara como
              alternativa para compra online o punto fisico.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a
                href="/store"
                className="inline-flex min-h-14 items-center justify-center gap-3 rounded-full bg-stone-950 px-7 text-[12px] font-black uppercase tracking-[0.14em] text-white transition hover:-translate-y-0.5 hover:bg-cyan-700 focus:outline-none focus:ring-2 focus:ring-cyan-500/60"
              >
                Comprar en Store
                <ShoppingBag className="h-4 w-4" />
              </a>
              <button
                type="button"
                onClick={openCommunity}
                className="inline-flex min-h-14 items-center justify-center gap-3 rounded-full border border-stone-200 bg-white/80 px-7 text-[12px] font-black uppercase tracking-[0.14em] text-stone-800 transition hover:-translate-y-0.5 hover:bg-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
              >
                Recibir disponibilidad
                <MessageCircle className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {[
              {
                icon: ShoppingBag,
                title: "IMNOVA Store",
                text: "Compra directa cuando el producto ya esta Disponible.",
              },
              {
                icon: ShieldCheck,
                title: "Canales autorizados",
                text: "Solo se mostraran canales confirmados para evitar confusion.",
              },
              {
                icon: MapPin,
                title: "Distribuidor cercano",
                text: "La busqueda por ubicacion se activara cuando los puntos fisicos tengan coordenadas publicadas.",
              },
            ].map(item => (
              <article
                key={item.title}
                className="rounded-[28px] border border-stone-200 bg-[#fbf7ef] p-5"
              >
                <item.icon className="h-5 w-5 text-cyan-700" />
                <h3 className="mt-5 text-xl font-black tracking-[-0.04em] text-stone-950">
                  {item.title}
                </h3>
                <p className="mt-3 text-sm leading-6 text-stone-600">
                  {item.text}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section
        id="transparencia"
        className="px-6 py-16 md:py-24"
      >
        <div className="mx-auto max-w-7xl">
          <div className="max-w-3xl">
            <p className="text-[10px] font-black uppercase tracking-[0.28em] text-cyan-700">
              Transparencia
            </p>
            <h2 className="mt-4 text-4xl font-black tracking-[-0.05em] text-stone-950 md:text-6xl">
              Una idea no aparece en tienda por magia.
            </h2>
            <p className="mt-5 text-base leading-8 text-stone-600 md:text-lg">
              IMNOVA separa la participacion publica de la decision comercial:
              la comunidad senala interes, y el equipo IMNOVA decide que avanza.
            </p>
          </div>

          <div className="mt-11 grid gap-4 md:grid-cols-4">
            {transparencyStages.map((stage, index) => (
              <article
                key={stage.title}
                className="rounded-[30px] border border-stone-200 bg-white/68 p-6 shadow-[0_20px_55px_rgba(58,44,28,0.07)] backdrop-blur"
              >
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-cyan-700 text-sm font-black text-white">
                  {index + 1}
                </span>
                <h3 className="mt-6 text-2xl font-black tracking-[-0.04em] text-stone-950">
                  {stage.title}
                </h3>
                <p className="mt-4 text-sm leading-7 text-stone-600">
                  {stage.text}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section
        id="comunidad"
        className="px-6 py-16 md:py-24"
      >
        <div className="mx-auto grid max-w-7xl gap-8 rounded-[36px] border border-cyan-200 bg-white/72 p-7 shadow-[0_34px_95px_rgba(58,44,28,0.12)] backdrop-blur md:p-10 lg:grid-cols-[0.95fr_1.05fr]">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.28em] text-cyan-700">
              Formulario de comunidad
            </p>
            <h2 className="mt-4 text-4xl font-black leading-tight tracking-[-0.05em] text-stone-950 md:text-6xl">
              Tu opinion puede ayudar a decidir lo que viene.
            </h2>
            <p className="mt-6 text-base leading-8 text-stone-600 md:text-lg">
              Unirte toma menos de un minuto. Elegis hasta 3 areas, aceptas el
              consentimiento y eliges como quieres recibir novedades.
            </p>

            <button
              type="button"
              onClick={openCommunity}
              className="mt-8 inline-flex min-h-14 items-center justify-center gap-3 rounded-full bg-stone-950 px-8 text-[12px] font-black uppercase tracking-[0.14em] text-white transition hover:-translate-y-0.5 hover:bg-cyan-700 focus:outline-none focus:ring-2 focus:ring-cyan-500/60"
            >
              Unirme gratis
              <ArrowUpRight className="h-4 w-4" />
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {[
              {
                icon: UsersRound,
                title: "Nombre",
                text: "Para tratarte como miembro de comunidad.",
              },
              {
                icon: MessageCircle,
                title: "WhatsApp",
                text: "Solo con consentimiento para novedades relevantes.",
              },
              {
                icon: Mail,
                title: "Email",
                text: "Para encuestas, avances y beneficios que puedas revisar.",
              },
              {
                icon: Star,
                title: "Hasta 3 intereses",
                text: "Para no recibir mensajes genericos.",
              },
              {
                icon: ShieldCheck,
                title: "Consentimiento",
                text: "Sin spam. Tu participacion debe ser clara y voluntaria.",
              },
              {
                icon: Trophy,
                title: "Beneficios",
                text: "Acceso temprano y oportunidades cuando esten disponibles.",
              },
            ].map(item => (
              <article
                key={item.title}
                className="rounded-[26px] border border-stone-200 bg-[#fbf7ef] p-5"
              >
                <item.icon className="h-5 w-5 text-cyan-700" />
                <h3 className="mt-4 text-xl font-black tracking-[-0.035em] text-stone-950">
                  {item.title}
                </h3>
                <p className="mt-3 text-sm leading-6 text-stone-600">
                  {item.text}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <button
        type="button"
        onClick={openCommunity}
        className="fixed bottom-4 left-4 right-4 z-40 inline-flex min-h-[52px] items-center justify-center gap-2 rounded-full bg-stone-950 px-5 text-[11px] font-black uppercase tracking-[0.14em] text-white shadow-[0_18px_48px_rgba(15,23,42,0.20)] transition hover:-translate-y-0.5 hover:bg-cyan-700 focus:outline-none focus:ring-2 focus:ring-cyan-500/60 sm:left-auto sm:right-5 sm:w-auto lg:hidden"
      >
        Unirme gratis
        <ArrowUpRight className="h-4 w-4" />
      </button>

      <InnovaPopup
        isOpen={showPopup}
        onClose={closePopup}
      />

      <Footer />
    </main>
  )
}
