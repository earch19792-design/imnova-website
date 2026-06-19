"use client"

import { useState } from "react"

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
  key: string
  title: string
  tag: string
  description: string
  signal: string
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

const publicIdeas: PublicIdea[] = [
  {
    key: "functional-coffee-collagen",
    title: "Cafe funcional con colageno",
    tag: "Energia + belleza",
    description:
      "Una idea para unir energia diaria, cuidado personal y rutina simple en un formato facil de adoptar.",
    signal: "Ideal si te interesan cafe funcional, enfoque y belleza natural.",
  },
  {
    key: "high-protein-breakfast",
    title: "Desayuno alto en proteina",
    tag: "Nutricion practica",
    description:
      "Mezclas listas para preparar pancakes, waffles o pan funcional sin complicar la rutina.",
    signal: "Pensado para saciedad, conveniencia y mejor nutricion diaria.",
  },
  {
    key: "daily-digestive-balance",
    title: "Balance digestivo diario",
    tag: "Bienestar diario",
    description:
      "Productos suaves para apoyar digestion, hidratacion y bienestar cotidiano sin promesas agresivas.",
    signal: "Una oportunidad para quienes priorizan salud natural y constancia.",
  },
]

const trustSignals = [
  "Registro gratis",
  "Consentimiento claro",
  "Votos sin login",
  "Solo productos disponibles en tienda",
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
    text: "Tu opinion ayuda a priorizar ideas antes de que se conviertan en productos.",
  },
  {
    icon: Zap,
    title: "Acceso temprano",
    text: "Recibe novedades, pruebas o preventas cuando una oportunidad avance.",
  },
  {
    icon: Sparkles,
    title: "Tendencias utiles",
    text: "Conoce senales simples sobre bienestar, nutricion, belleza y vida activa.",
  },
  {
    icon: HeartHandshake,
    title: "Beneficios VIP",
    text: "Los miembros activos podran acceder a recompensas, referidos y oportunidades futuras.",
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

export default function IMNOVAPage() {
  const [showPopup, setShowPopup] = useState(false)
  const [votedIdeas, setVotedIdeas] =
    useState<Record<string, PublicVoteType>>({})
  const [votingIdeaKey, setVotingIdeaKey] = useState<string | null>(null)
  const [voteError, setVoteError] = useState("")

  const featuredIdea = publicIdeas[0]
  const secondaryIdeas = publicIdeas.slice(1, 3)

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
          idea_key: idea.key,
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

  const renderVoteButtons = (idea: PublicIdea) => (
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
                : "border border-stone-200 bg-white/75 text-stone-700 hover:border-cyan-300 hover:bg-white hover:text-stone-950"
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
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_12%_0%,rgba(14,165,183,0.16),transparent_34%),radial-gradient(circle_at_90%_10%,rgba(245,158,11,0.16),transparent_32%),linear-gradient(180deg,#fbf7ef_0%,#f6f1e8_46%,#efe7db_100%)]" />
      <div className="pointer-events-none fixed inset-0 -z-10 opacity-[0.24] bg-[linear-gradient(rgba(92,73,47,0.10)_1px,transparent_1px),linear-gradient(90deg,rgba(92,73,47,0.10)_1px,transparent_1px)] bg-[size:96px_96px]" />

      <Navigation />

      <section
        id="hero"
        className="relative isolate min-h-[760px] overflow-hidden px-6 pb-16 pt-32 md:pb-24 md:pt-40"
      >
        <div className="pointer-events-none absolute inset-y-0 right-0 z-0 w-full lg:w-[62%]">
          <img
            src="/images/mash-coffee.png"
            alt=""
            aria-hidden="true"
            className="h-full w-full scale-[1.04] object-cover object-center opacity-42 blur-[0.1px] lg:opacity-95"
          />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,#f6f1e8_0%,rgba(246,241,232,0.94)_30%,rgba(246,241,232,0.58)_58%,rgba(246,241,232,0.12)_100%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_78%_48%,rgba(15,23,42,0.10),transparent_44%)]" />
          <div className="absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-[#f6f1e8] to-transparent" />
        </div>

        <div className="relative z-10 mx-auto grid max-w-7xl items-center gap-10 lg:grid-cols-[1.02fr_0.98fr]">
          <div>
            <div className="inline-flex items-center gap-3 rounded-full border border-cyan-200 bg-white/70 px-4 py-2 shadow-sm">
              <span className="h-2.5 w-2.5 rounded-full bg-cyan-500" />
              <span className="text-[11px] font-black uppercase tracking-[0.22em] text-cyan-800">
                Innovacion guiada por comunidad
              </span>
            </div>

            <h1 className="mt-7 max-w-5xl text-5xl font-black leading-[0.98] tracking-[-0.055em] text-stone-950 md:text-7xl lg:text-8xl">
              Los proximos productos no se adivinan. Se deciden en comunidad.
            </h1>

            <p className="mt-7 max-w-3xl text-lg leading-8 text-stone-600 md:text-xl md:leading-9">
              Descubre ideas, comparte tu intencion y ayuda a convertir las
              mejores oportunidades en productos reales.
            </p>

            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={openCommunity}
                className="inline-flex min-h-14 items-center justify-center gap-3 rounded-full bg-stone-950 px-8 text-[12px] font-black uppercase tracking-[0.14em] text-white shadow-[0_22px_58px_rgba(15,23,42,0.18)] transition hover:-translate-y-0.5 hover:bg-cyan-700 focus:outline-none focus:ring-2 focus:ring-cyan-500/60"
              >
                Unirme gratis
                <ArrowUpRight className="h-4 w-4" />
              </button>

              <a
                href="#ideas"
                className="inline-flex min-h-14 items-center justify-center gap-3 rounded-full border border-stone-200 bg-white/75 px-8 text-[12px] font-black uppercase tracking-[0.14em] text-stone-800 shadow-sm transition hover:-translate-y-0.5 hover:bg-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
              >
                Ver ideas en votacion
                <Vote className="h-4 w-4" />
              </a>
            </div>

            <div className="mt-8 flex flex-wrap gap-2.5">
              {trustSignals.map(item => (
                <span
                  key={item}
                  className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white/60 px-4 py-2 text-[11px] font-bold text-stone-600 shadow-sm"
                >
                  <CheckCircle2 className="h-3.5 w-3.5 text-cyan-700" />
                  {item}
                </span>
              ))}
            </div>
          </div>

          <div className="relative">
            <div className="absolute -right-8 -top-8 hidden h-36 w-36 rounded-full bg-amber-300/25 blur-3xl md:block" />
            <div className="relative overflow-hidden rounded-[36px] border border-white/70 bg-white/64 p-4 shadow-[0_32px_90px_rgba(58,44,28,0.16)] backdrop-blur-xl">
              <div className="relative overflow-hidden rounded-[28px] bg-stone-950">
                <img
                  src="/images/mash-coffee.png"
                  alt="Lata MASH Coffee+ Collagen Marine de IMNOVA."
                  className="h-[300px] w-full object-cover object-center md:h-[420px]"
                />
                <div className="absolute left-4 top-4 rounded-full bg-white/90 px-4 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-stone-950 shadow-sm">
                  Producto disponible
                </div>
                <div className="absolute bottom-4 left-4 right-4 rounded-[22px] border border-white/15 bg-stone-950/78 p-4 text-white backdrop-blur">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-amber-100/80">
                    IMNOVA Store
                  </p>
                  <p className="mt-1 text-lg font-black tracking-[-0.035em]">
                    MASH Coffee+ ya puede comprarse.
                  </p>
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-[0.82fr_1.18fr]">
                <div className="rounded-[24px] bg-stone-950 p-5 text-white">
                  <p className="text-[10px] font-black uppercase tracking-[0.20em] text-cyan-100/70">
                    Idea activa
                  </p>
                  <h2 className="mt-3 text-2xl font-black tracking-[-0.04em]">
                    {featuredIdea.title}
                  </h2>
                  <p className="mt-3 text-sm leading-6 text-white/65">
                    Tu voto ayuda a decidir si esta idea avanza.
                  </p>
                </div>

                <div className="grid gap-2">
                  {publicVoteOptions.slice(0, 3).map(option => (
                    <div
                      key={option.type}
                      className="flex items-center justify-between rounded-2xl border border-stone-200 bg-white/80 px-4 py-3 text-sm font-bold text-stone-700"
                    >
                      <span>{option.label}</span>
                      <span className="h-2 w-2 rounded-full bg-cyan-500" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="px-6 pb-14">
        <div className="mx-auto grid max-w-7xl gap-3 rounded-[30px] border border-stone-200 bg-white/60 p-4 shadow-[0_18px_55px_rgba(58,44,28,0.06)] backdrop-blur md:grid-cols-4">
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
              className="rounded-[22px] bg-[#fbf7ef] px-5 py-4"
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
            <div className="rounded-[34px] border border-stone-200 bg-stone-950 p-7 text-white shadow-[0_28px_80px_rgba(15,23,42,0.16)] md:p-9">
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
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {missionVision.map(item => (
                <article
                  key={item.label}
                  className="rounded-[30px] border border-stone-200 bg-white/70 p-6 shadow-[0_20px_55px_rgba(58,44,28,0.07)] backdrop-blur"
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
                className="relative rounded-[30px] border border-stone-200 bg-white/68 p-6 shadow-[0_20px_55px_rgba(58,44,28,0.07)] backdrop-blur"
              >
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
        id="ideas"
        className="px-6 py-16 md:py-24"
      >
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div className="max-w-3xl">
              <p className="text-[10px] font-black uppercase tracking-[0.28em] text-cyan-700">
                Ideas en votacion
              </p>
              <h2 className="mt-4 text-4xl font-black tracking-[-0.05em] text-stone-950 md:text-6xl">
                Dinos que harias si IMNOVA lanza estas ideas.
              </h2>
              <p className="mt-5 text-base leading-8 text-stone-600 md:text-lg">
                La votacion mide intencion. No necesitas cuenta para responder,
                y puedes cambiar tu voto desde el mismo navegador.
              </p>
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

          <div className="mt-12 grid gap-5 lg:grid-cols-[1.08fr_0.92fr]">
            <article className="rounded-[34px] border border-stone-200 bg-white/75 p-6 shadow-[0_30px_80px_rgba(58,44,28,0.10)] backdrop-blur md:p-8">
              <div className="flex flex-wrap items-center gap-3">
                <span className="rounded-full bg-stone-950 px-4 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-white">
                  Idea destacada
                </span>
                <span className="rounded-full border border-amber-200 bg-amber-50 px-4 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-amber-800">
                  {featuredIdea.tag}
                </span>
              </div>
              <h3 className="mt-7 max-w-3xl text-4xl font-black leading-tight tracking-[-0.05em] text-stone-950 md:text-6xl">
                {featuredIdea.title}
              </h3>
              <p className="mt-6 max-w-2xl text-base leading-8 text-stone-600 md:text-lg">
                {featuredIdea.description}
              </p>
              <p className="mt-5 rounded-2xl border border-cyan-200 bg-cyan-50 px-5 py-4 text-sm leading-7 text-cyan-900">
                {featuredIdea.signal}
              </p>

              <div className="mt-8">
                <p className="mb-3 text-[11px] font-black uppercase tracking-[0.18em] text-stone-500">
                  Que harias si IMNOVA lanza esta idea?
                </p>
                {renderVoteButtons(featuredIdea)}
              </div>

              {votedIdeas[featuredIdea.key] && (
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
            </article>

            <div className="grid gap-5">
              {secondaryIdeas.map(idea => (
                <article
                  key={idea.key}
                  className="rounded-[30px] border border-stone-200 bg-white/68 p-6 shadow-[0_20px_55px_rgba(58,44,28,0.07)] backdrop-blur"
                >
                  <span className="rounded-full border border-stone-200 bg-[#fbf7ef] px-4 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-stone-600">
                    {idea.tag}
                  </span>
                  <h3 className="mt-5 text-3xl font-black leading-tight tracking-[-0.04em] text-stone-950">
                    {idea.title}
                  </h3>
                  <p className="mt-4 text-sm leading-7 text-stone-600">
                    {idea.description}
                  </p>
                  <div className="mt-6">
                    {renderVoteButtons(idea)}
                  </div>
                  {votedIdeas[idea.key] && (
                    <p
                      aria-live="polite"
                      className="mt-3 rounded-2xl bg-cyan-50 px-4 py-3 text-xs leading-6 text-cyan-900"
                    >
                      Voto guardado. Puedes actualizarlo si cambias de opinion.
                    </p>
                  )}
                </article>
              ))}
            </div>
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
        className="px-6 py-16 md:py-24"
      >
        <div className="mx-auto grid max-w-7xl gap-8 rounded-[36px] border border-stone-200 bg-stone-950 p-7 text-white shadow-[0_34px_95px_rgba(15,23,42,0.18)] md:p-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.28em] text-cyan-100/70">
              Productos disponibles
            </p>
            <h2 className="mt-4 text-4xl font-black leading-tight tracking-[-0.05em] md:text-6xl">
              La tienda muestra solo lo que ya se puede comprar.
            </h2>
            <p className="mt-6 text-base leading-8 text-white/68">
              Las ideas y productos en validacion no se presentan como
              comprables. Cuando algo esta disponible, pasa a Store con claridad.
              Si tiene promocion de lanzamiento activa, la tienda muestra el
              descuento y el tiempo restante.
            </p>
            <a
              href="/store"
              className="mt-8 inline-flex min-h-14 items-center justify-center gap-3 rounded-full bg-white px-7 text-[12px] font-black uppercase tracking-[0.14em] text-stone-950 transition hover:-translate-y-0.5 hover:bg-cyan-100 focus:outline-none focus:ring-2 focus:ring-cyan-300/80"
            >
              Ver tienda
              <ShoppingBag className="h-4 w-4" />
            </a>

            <a
              href="#where-to-buy"
              className="mt-3 inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-white/15 px-6 text-[11px] font-black uppercase tracking-[0.14em] text-white/72 transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-cyan-300/70"
            >
              Donde comprar
              <MapPin className="h-4 w-4" />
            </a>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              "Producto disponible",
              "Promocion de lanzamiento",
              "Compra clara",
              "Canales autorizados",
            ].map(item => (
              <div
                key={item}
                className="rounded-[26px] border border-white/10 bg-white/[0.08] p-5"
              >
                <CheckCircle2 className="h-5 w-5 text-cyan-100" />
                <p className="mt-5 text-xl font-black tracking-[-0.04em]">
                  {item}
                </p>
              </div>
            ))}
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
              Primero ve a la tienda para productos disponibles. Cuando existan
              canales autorizados publicados, aqui se mostrara la forma mas
              clara de comprar online o encontrar un punto cercano.
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
                text: "La ubicacion debe usarse solo cuando haya puntos fisicos listos para recomendar.",
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
              IMNOVA separa la participacion publica de las decisiones internas:
              la comunidad senala interes, y el Admin decide que avanza.
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
        className="fixed bottom-4 left-4 right-4 z-40 inline-flex min-h-[52px] items-center justify-center gap-2 rounded-full bg-stone-950 px-5 text-[11px] font-black uppercase tracking-[0.14em] text-white shadow-[0_18px_48px_rgba(15,23,42,0.20)] transition hover:-translate-y-0.5 hover:bg-cyan-700 focus:outline-none focus:ring-2 focus:ring-cyan-500/60 sm:left-auto sm:right-5 sm:w-auto"
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
