"use client"

import { useState } from "react"

import {
  ArrowUpRight,
  CheckCircle2,
  Gift,
  HeartHandshake,
  Mail,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  Star,
  Eye,
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
    signal: "Ideal para votar si te interesan cafe funcional, enfoque y belleza natural.",
  },
  {
    key: "high-protein-breakfast",
    title: "Desayuno alto en proteina",
    tag: "Nutricion practica",
    description:
      "Mezclas listas para preparar pancakes, waffles o pan funcional sin complicar la rutina.",
    signal: "Pensado para quienes buscan saciedad, conveniencia y mejor nutricion diaria.",
  },
  {
    key: "daily-digestive-balance",
    title: "Balance digestivo diario",
    tag: "Bienestar diario",
    description:
      "Productos suaves para apoyar digestion, hidratacion y bienestar cotidiano sin promesas agresivas.",
    signal: "Una oportunidad para personas que priorizan salud natural y constancia.",
  },
]

const howItWorks = [
  {
    icon: UsersRound,
    title: "Entras como visitante",
    text: "Entiendes IMNOVA rapido y decides unirte gratis a la comunidad.",
  },
  {
    icon: MessageCircle,
    title: "Te unes a la comunidad",
    text: "Dejas nombre, WhatsApp o email y eliges hasta 3 intereses.",
  },
  {
    icon: Vote,
    title: "Participas y votas",
    text: "Tu voto ayuda a decidir que ideas merecen seguir avanzando.",
  },
  {
    icon: Trophy,
    title: "Recibes beneficios VIP",
    text: "Cuando algo llega al mercado, la comunidad recibe acceso temprano, recompra y oportunidades para recomendar.",
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
    icon: Gift,
    title: "Descuentos VIP",
    text: "Beneficios especiales cuando una idea se convierte en lanzamiento.",
  },
  {
    icon: Zap,
    title: "Acceso temprano",
    text: "Primero enterado cuando haya pruebas, preventas o productos disponibles.",
  },
  {
    icon: Sparkles,
    title: "Tendencias",
    text: "Recibe senales breves sobre categorias que estan creciendo.",
  },
  {
    icon: Vote,
    title: "Votaciones",
    text: "Tu opinion ayuda a decidir si una idea avanza, se ajusta o se pausa.",
  },
  {
    icon: Star,
    title: "Sorteos",
    text: "Participa en oportunidades exclusivas de la comunidad IMNOVA.",
  },
  {
    icon: HeartHandshake,
    title: "Referido / Embajador",
    text: "Los miembros mas activos podran recomendar, invitar y recibir beneficios futuros.",
  },
]

const transparencyStages = [
  {
    title: "Ideas propuestas",
    text: "La comunidad ve oportunidades simples y puede mostrar interes sin crear cuenta.",
  },
  {
    title: "Ideas en validacion",
    text: "Las ideas con mas senales reciben votos, encuestas y lectura de demanda.",
  },
  {
    title: "Productos en desarrollo",
    text: "Solo las mejores oportunidades pasan a preparacion interna de IMNOVA.",
  },
  {
    title: "Productos lanzados",
    text: "Cuando un producto esta listo, la comunidad recibe acceso y beneficios primero.",
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
  const [
    votedIdeas,
    setVotedIdeas,
  ] = useState<Record<string, PublicVoteType>>({})
  const [votingIdeaKey, setVotingIdeaKey] = useState<string | null>(null)
  const [voteError, setVoteError] = useState("")

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
          new CustomEvent(
            "imnova:public_idea_vote",
            {
              detail: {
                idea_key: idea.key,
                idea_title: idea.title,
                vote_type: voteType,
                source: "public_home",
              },
            }
          )
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

  return (
    <main className="relative isolate overflow-hidden bg-black text-white">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_50%_0%,rgba(34,211,238,0.12),transparent_34%),linear-gradient(180deg,#000000_0%,#050505_48%,#000000_100%)]" />
      <div className="pointer-events-none fixed inset-0 -z-10 opacity-[0.025] bg-[linear-gradient(rgba(255,255,255,0.18)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.18)_1px,transparent_1px)] bg-[size:84px_84px]" />
      <div className="pointer-events-none fixed inset-0 -z-10 opacity-[0.018] bg-[url('/noise.png')]" />

      <Navigation />

      <section
        id="hero"
        className="relative overflow-hidden px-6 pb-20 pt-36 md:pb-28 md:pt-44"
      >
        <div className="mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <div className="inline-flex items-center gap-3 rounded-full border border-cyan-200/20 bg-cyan-300/[0.08] px-4 py-2">
              <span className="h-2 w-2 rounded-full bg-cyan-200 shadow-[0_0_22px_rgba(34,211,238,0.75)]" />
              <span className="text-[10px] font-black uppercase tracking-[0.26em] text-cyan-100/75">
                Comunidad IMNOVA
              </span>
            </div>

            <h1 className="mt-8 max-w-5xl text-5xl font-black leading-[0.98] tracking-[-0.055em] text-white md:text-7xl lg:text-8xl">
              La comunidad que decide los proximos productos del mercado
            </h1>

            <p className="mt-7 max-w-3xl text-lg leading-8 text-zinc-300 md:text-xl">
              Vota ideas, descubre tendencias y recibe beneficios exclusivos
              antes que nadie.
            </p>

            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={openCommunity}
                className="group inline-flex items-center justify-center gap-3 rounded-3xl border border-cyan-100/60 bg-gradient-to-r from-cyan-200 to-white px-8 py-5 text-xs font-black uppercase tracking-[0.18em] text-black shadow-[0_0_55px_rgba(34,211,238,0.24)] transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_0_75px_rgba(34,211,238,0.36)]"
              >
                Unirme gratis
                <ArrowUpRight className="h-4 w-4 transition duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </button>

              <a
                href="#ideas"
                className="inline-flex items-center justify-center gap-3 rounded-3xl border border-white/12 bg-white/[0.04] px-8 py-5 text-xs font-black uppercase tracking-[0.18em] text-white/75 transition duration-300 hover:-translate-y-0.5 hover:border-white/25 hover:bg-white/[0.08] hover:text-white"
              >
                Ver ideas en votacion
                <Vote className="h-4 w-4" />
              </a>
            </div>

            <div className="mt-8 flex flex-wrap gap-3">
              {[
                "Gratis",
                "Sin spam",
                "Hasta 3 intereses",
                "Beneficios VIP",
              ].map(item => (
                <span
                  key={item}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.035] px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/60"
                >
                  <CheckCircle2 className="h-3.5 w-3.5 text-cyan-100" />
                  {item}
                </span>
              ))}
            </div>
          </div>

          <div className="relative">
            <div className="overflow-hidden rounded-[34px] border border-cyan-200/15 bg-white/[0.035] shadow-[0_30px_120px_rgba(34,211,238,0.12)]">
              <img
                src="/images/imnova-community-hero.webp"
                alt="Comunidad IMNOVA participando en ideas, tendencias y beneficios exclusivos."
                className="h-[360px] w-full object-cover md:h-[500px]"
              />
              <div className="border-t border-white/10 bg-black/70 p-6 backdrop-blur-xl">
                <p className="text-[10px] font-black uppercase tracking-[0.26em] text-cyan-100/60">
                  Ruta simple
                </p>
                <p className="mt-3 text-2xl font-black tracking-[-0.04em] text-white">
                  Te unes. Votas. Recibes primero.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        id="mision-vision"
        className="px-6 pb-20 md:pb-24"
      >
        <div className="mx-auto max-w-7xl">
          <div className="rounded-[34px] border border-white/10 bg-white/[0.025] p-6 shadow-[0_24px_120px_rgba(34,211,238,0.08)] md:p-8">
            <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr] lg:items-stretch">
              <div className="rounded-[28px] border border-cyan-200/15 bg-cyan-300/[0.055] p-6">
                <p className="text-[10px] font-black uppercase tracking-[0.28em] text-cyan-100/60">
                  Quienes somos
                </p>
                <h2 className="mt-4 text-3xl font-black leading-tight tracking-[-0.045em] text-white md:text-5xl">
                  IMNOVA crea con la comunidad, no a espaldas del mercado.
                </h2>
                <p className="mt-5 text-sm leading-7 text-zinc-300 md:text-base">
                  La pagina publica debe ser simple: entender la idea, votar lo
                  que interesa y unirse para recibir beneficios antes que nadie.
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                {missionVision.map(item => (
                  <div
                    key={item.label}
                    className="rounded-[28px] border border-white/10 bg-black/45 p-6"
                  >
                    <div className="flex items-center gap-4">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-200/20 bg-cyan-300/[0.08]">
                        <item.icon className="h-5 w-5 text-cyan-100" />
                      </div>
                      <span className="text-[10px] font-black uppercase tracking-[0.24em] text-cyan-100/60">
                        {item.label}
                      </span>
                    </div>
                    <h3 className="mt-6 text-2xl font-black leading-tight tracking-[-0.04em] text-white md:text-3xl">
                      {item.title}
                    </h3>
                    <p className="mt-4 text-sm leading-7 text-zinc-400">
                      {item.text}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        id="como-funciona"
        className="border-y border-white/10 bg-white/[0.025] px-6 py-20 md:py-24"
      >
        <div className="mx-auto max-w-7xl">
          <div className="max-w-3xl">
            <p className="text-[10px] font-black uppercase tracking-[0.28em] text-cyan-100/55">
              Como funciona
            </p>
            <h2 className="mt-4 text-4xl font-black tracking-[-0.045em] text-white md:text-6xl">
              Una ruta facil de entender y facil de usar.
            </h2>
          </div>

          <div className="mt-12 grid gap-4 md:grid-cols-4">
            {howItWorks.map((step, index) => (
              <div
                key={step.title}
                className="relative rounded-[28px] border border-white/10 bg-black/45 p-6"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-200/20 bg-cyan-300/[0.08]">
                    <step.icon className="h-5 w-5 text-cyan-100" />
                  </div>
                  <span className="text-xs font-black text-white/25">
                    0{index + 1}
                  </span>
                </div>
                <h3 className="mt-7 text-2xl font-black tracking-[-0.04em] text-white">
                  {step.title}
                </h3>
                <p className="mt-4 text-sm leading-7 text-zinc-400">
                  {step.text}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section
        id="ideas"
        className="px-6 py-20 md:py-28"
      >
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div className="max-w-3xl">
              <p className="text-[10px] font-black uppercase tracking-[0.28em] text-cyan-100/55">
                Ideas en votacion
              </p>
              <h2 className="mt-4 text-4xl font-black tracking-[-0.045em] text-white md:text-6xl">
                Vota lo que te gustaria ver nacer.
              </h2>
              <p className="mt-5 text-base leading-8 text-zinc-400 md:text-lg">
                Mostramos solo algunas ideas destacadas. Tu voto ayuda a
                entender si una oportunidad merece avanzar.
              </p>
            </div>

            <button
              type="button"
              onClick={openCommunity}
              className="inline-flex items-center justify-center gap-3 rounded-3xl border border-cyan-200/30 bg-cyan-300/[0.10] px-6 py-4 text-xs font-black uppercase tracking-[0.16em] text-cyan-50 transition hover:border-cyan-100/50 hover:bg-cyan-300/[0.16]"
            >
              Recibir avances
              <MessageCircle className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-12 grid gap-5 lg:grid-cols-3">
            {publicIdeas.slice(0, 3).map(idea => (
              <article
                key={idea.key}
                className="flex min-h-[360px] flex-col rounded-[30px] border border-white/10 bg-white/[0.035] p-6 transition duration-300 hover:-translate-y-1 hover:border-cyan-200/25 hover:bg-cyan-300/[0.055]"
              >
                <span className="w-fit rounded-full border border-amber-200/20 bg-amber-300/[0.08] px-4 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-amber-100/80">
                  {idea.tag}
                </span>
                <h3 className="mt-7 text-3xl font-black leading-tight tracking-[-0.04em] text-white">
                  {idea.title}
                </h3>
                <p className="mt-5 text-sm leading-7 text-zinc-400">
                  {idea.description}
                </p>
                <p className="mt-5 text-xs leading-6 text-cyan-100/60">
                  {idea.signal}
                </p>

                <div className="mt-auto pt-8">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/45">
                    Que harias si IMNOVA lanza esta idea?
                  </p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {publicVoteOptions.map(option => {
                      const isSelected =
                        votedIdeas[idea.key] ===
                        option.type

                      return (
                        <button
                          key={option.type}
                          type="button"
                          onClick={() =>
                            handleIdeaVote(
                              idea,
                              option.type
                            )
                          }
                          disabled={
                            votingIdeaKey === idea.key
                          }
                          className={`inline-flex min-h-[48px] items-center justify-center rounded-2xl px-4 py-3 text-[10px] font-black uppercase tracking-[0.14em] transition ${
                            isSelected
                              ? "border border-cyan-100/45 bg-cyan-200 text-black"
                              : "border border-white/10 bg-white/[0.05] text-white/70 hover:border-cyan-200/35 hover:bg-cyan-300/[0.12] hover:text-white"
                          } disabled:cursor-not-allowed disabled:opacity-60`}
                        >
                          {votingIdeaKey === idea.key
                            ? "Guardando..."
                            : option.label}
                        </button>
                      )
                    })}
                  </div>

                  {votedIdeas[idea.key] && (
                    <p className="mt-3 rounded-2xl border border-cyan-200/20 bg-cyan-300/[0.08] px-4 py-3 text-xs leading-5 text-cyan-50/75">
                      Gracias. Tu voto quedo registrado y puedes cambiarlo cuando quieras.
                    </p>
                  )}

                  <button
                    type="button"
                    onClick={openCommunity}
                    className="mt-3 inline-flex w-full items-center justify-center gap-3 rounded-2xl border border-cyan-200/20 bg-cyan-300/[0.08] px-5 py-4 text-xs font-black uppercase tracking-[0.16em] text-cyan-50 transition hover:border-cyan-100/45 hover:bg-cyan-300/[0.14]"
                  >
                    Unirme gratis
                  </button>
                </div>
              </article>
            ))}
          </div>

          {voteError && (
            <p className="mt-6 rounded-2xl border border-amber-200/20 bg-amber-300/[0.08] px-5 py-4 text-sm text-amber-100/85">
              {voteError}
            </p>
          )}
        </div>
      </section>

      <section
        id="transparencia"
        className="border-y border-white/10 bg-white/[0.025] px-6 py-20 md:py-24"
      >
        <div className="mx-auto max-w-7xl">
          <div className="max-w-3xl">
            <p className="text-[10px] font-black uppercase tracking-[0.28em] text-cyan-100/55">
              Muro de transparencia
            </p>
            <h2 className="mt-4 text-4xl font-black tracking-[-0.045em] text-white md:text-6xl">
              Ves como una idea puede llegar al mercado.
            </h2>
            <p className="mt-5 text-base leading-8 text-zinc-400 md:text-lg">
              IMNOVA no quiere lanzar por intuicion. Queremos que la comunidad vea el camino: propuesta, validacion, preparacion y lanzamiento.
            </p>
          </div>

          <div className="mt-12 grid gap-4 md:grid-cols-4">
            {transparencyStages.map((stage, index) => (
              <div
                key={stage.title}
                className="rounded-[28px] border border-white/10 bg-black/45 p-6"
              >
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-200/20 bg-cyan-300/[0.08] text-sm font-black text-cyan-100">
                  {index + 1}
                </span>
                <h3 className="mt-6 text-2xl font-black tracking-[-0.04em] text-white">
                  {stage.title}
                </h3>
                <p className="mt-4 text-sm leading-7 text-zinc-400">
                  {stage.text}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section
        id="beneficios"
        className="px-6 py-20 md:py-24"
      >
        <div className="mx-auto max-w-7xl">
          <div className="max-w-3xl">
            <p className="text-[10px] font-black uppercase tracking-[0.28em] text-cyan-100/55">
              Beneficios
            </p>
            <h2 className="mt-4 text-4xl font-black tracking-[-0.045em] text-white md:text-6xl">
              Por que vale la pena unirse.
            </h2>
          </div>

          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {benefits.map(benefit => (
              <div
                key={benefit.title}
                className="rounded-[28px] border border-white/10 bg-black/45 p-6"
              >
                <benefit.icon className="h-6 w-6 text-cyan-100" />
                <h3 className="mt-5 text-2xl font-black tracking-[-0.04em] text-white">
                  {benefit.title}
                </h3>
                <p className="mt-4 text-sm leading-7 text-zinc-400">
                  {benefit.text}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section
        id="comunidad"
        className="px-6 py-20 md:py-28"
      >
        <div className="mx-auto grid max-w-7xl gap-8 rounded-[34px] border border-cyan-200/15 bg-cyan-300/[0.055] p-7 shadow-[0_30px_140px_rgba(34,211,238,0.10)] md:p-10 lg:grid-cols-[0.95fr_1.05fr]">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.28em] text-cyan-100/65">
              Formulario de comunidad
            </p>
            <h2 className="mt-4 text-4xl font-black leading-tight tracking-[-0.045em] text-white md:text-6xl">
              Unirte toma menos de un minuto.
            </h2>
            <p className="mt-6 text-base leading-8 text-zinc-300 md:text-lg">
              Te pedimos solo lo necesario para enviarte encuestas, avances y
              beneficios conectados a tus intereses.
            </p>

            <button
              type="button"
              onClick={openCommunity}
              className="mt-8 inline-flex items-center justify-center gap-3 rounded-3xl border border-cyan-100/60 bg-white px-8 py-5 text-xs font-black uppercase tracking-[0.18em] text-black transition hover:-translate-y-0.5 hover:shadow-[0_0_70px_rgba(255,255,255,0.22)]"
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
                text: "Para tratarte como miembro de la comunidad, no como un registro frio.",
              },
              {
                icon: MessageCircle,
                title: "WhatsApp",
                text: "Para avisos importantes, pruebas y lanzamientos relevantes.",
              },
              {
                icon: Mail,
                title: "Email",
                text: "Para recibir encuestas, resumenes y beneficios sin perderlos.",
              },
              {
                icon: Star,
                title: "Hasta 3 intereses",
                text: "Para que tus votos y mensajes sean mas relevantes.",
              },
              {
                icon: ShieldCheck,
                title: "Consentimiento explicito",
                text: "Sin spam. Tu participacion debe ser clara y voluntaria.",
              },
              {
                icon: CheckCircle2,
                title: "Beneficios VIP",
                text: "La comunidad recibe oportunidades antes que el publico general.",
              },
            ].map(item => (
              <div
                key={item.title}
                className="rounded-[26px] border border-white/10 bg-black/38 p-5"
              >
                <item.icon className="h-5 w-5 text-cyan-100" />
                <h3 className="mt-4 text-xl font-black tracking-[-0.035em] text-white">
                  {item.title}
                </h3>
                <p className="mt-3 text-sm leading-6 text-zinc-400">
                  {item.text}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <button
        type="button"
        onClick={openCommunity}
        className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-3 rounded-full border border-cyan-100/40 bg-cyan-200 px-5 py-4 text-[11px] font-black uppercase tracking-[0.16em] text-black shadow-[0_0_45px_rgba(34,211,238,0.32)] transition hover:-translate-y-0.5 md:bottom-7 md:right-7"
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
