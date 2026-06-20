"use client"

import Link from "next/link"
import type { ReactNode } from "react"
import { useEffect, useMemo, useState } from "react"
import {
  ArrowUpRight,
  Copy,
  Gift,
  Loader2,
  Medal,
  Share2,
  Sparkles,
  Trophy,
  UserRound,
  Vote,
} from "lucide-react"

type MemberAreaInterest = {
  id: string
  key?: string | null
  label: string
  description?: string | null
  source?: string | null
  created_at?: string | null
}

type MemberSpecificInterest = {
  id: string
  label: string
  niche_label?: string | null
  source?: string | null
  created_at?: string | null
}

type MemberVote = {
  id: string
  product_id?: string | null
  idea_key?: string | null
  idea_title: string
  vote_type: string
  source?: string | null
  created_at?: string | null
  updated_at?: string | null
}

type MemberPointEvent = {
  id: string
  event_type: string
  points: number
  source?: string | null
  description?: string | null
  created_at?: string | null
}

type MemberReward = {
  id: string
  title: string
  description?: string | null
  points_cost?: number | null
  required_level_key?: string | null
  discount_type?: string | null
  discount_value?: number | null
  ends_at?: string | null
}

type MemberProfile = {
  id: string
  name: string
  joined_at?: string | null
  level: {
    key: string
    label: string
    description?: string | null
    benefits?: string[]
  }
  points_total: number
  is_vip: boolean
  last_activity_at?: string | null
  referral: {
    code: string
    total_referrals: number
  }
  interests: {
    areas: MemberAreaInterest[]
    specific: MemberSpecificInterest[]
    legacy: string[]
  }
  votes: MemberVote[]
  points_ledger: MemberPointEvent[]
  rewards: MemberReward[]
  warnings?: string[]
}

const voteLabels: Record<string, string> = {
  interested: "Me interesa",
  would_buy: "Lo compraría",
  wants_trial: "Quiero prueba",
  not_interested: "No me interesa",
}

const pointEventLabels: Record<string, string> = {
  join: "Registro en comunidad",
  referral: "Referido registrado",
  vote: "Voto en idea",
  survey: "Encuesta respondida",
  purchase: "Compra registrada",
}

function getStoredMemberIdentity() {
  if (typeof window === "undefined") {
    return {
      subscriberId: "",
      referralCode: "",
    }
  }

  return {
    subscriberId:
      window.localStorage
        .getItem("imnova_community_subscriber_id")
        ?.trim() || "",
    referralCode:
      window.localStorage
        .getItem("imnova_community_referral_code")
        ?.trim() || "",
  }
}

function clearStoredMemberIdentity() {
  if (typeof window === "undefined") {
    return
  }

  window.localStorage.removeItem(
    "imnova_community_subscriber_id"
  )
  window.localStorage.removeItem(
    "imnova_community_referral_code"
  )
}

function formatDate(value?: string | null) {
  if (!value) {
    return "Pendiente"
  }

  return new Intl.DateTimeFormat(
    "es-NI",
    {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }
  ).format(new Date(value))
}

function getReferralMessage(url: string) {
  return `Estoy en la comunidad IMNOVA, donde votamos ideas y recibimos beneficios antes de los lanzamientos. Únete gratis aquí: ${url}`
}

export default function MemberPage() {
  const [
    member,
    setMember,
  ] = useState<MemberProfile | null>(null)

  const [
    loading,
    setLoading,
  ] = useState(true)

  const [
    error,
    setError,
  ] = useState("")

  const [
    copied,
    setCopied,
  ] = useState(false)

  const [
    showAllInterests,
    setShowAllInterests,
  ] = useState(false)

  const [
    origin,
    setOrigin,
  ] = useState("")

  useEffect(() => {
    setOrigin(
      window.location.origin
    )

    const identity =
      getStoredMemberIdentity()

    if (
      !identity.subscriberId ||
      !identity.referralCode
    ) {
      setLoading(false)
      setError(
        "member_identity_missing"
      )
      return
    }

    async function loadMember() {
      try {
        const response =
          await fetch(
            "/api/community/member",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body:
                JSON.stringify(identity),
            }
          )

        const result =
          await response
            .json()
            .catch(() => null)

        if (
          !response.ok ||
          !result?.success ||
          !result?.member
        ) {
          if (
            result?.error === "member_not_found" ||
            result?.error === "member_identity_required"
          ) {
            clearStoredMemberIdentity()
          }

          throw new Error(
            result?.error ||
            "member_profile_failed"
          )
        }

        setMember(
          result.member as MemberProfile
        )
        setError("")
      } catch (memberError) {
        console.error(
          "MEMBER AREA LOAD ERROR:",
          memberError
        )
        setError(
          memberError instanceof Error
            ? memberError.message
            : "member_profile_failed"
        )
      } finally {
        setLoading(false)
      }
    }

    loadMember()
  }, [])

  const referralUrl =
    useMemo(() => {
      if (
        !origin ||
        !member?.referral.code
      ) {
        return ""
      }

      return `${origin}/?ref=${member.referral.code}`
    }, [
      origin,
      member?.referral.code,
    ])

  const copyReferral = async () => {
    if (!referralUrl) {
      return
    }

    const text =
      getReferralMessage(referralUrl)

    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(
        () => setCopied(false),
        2400
      )
    } catch (copyError) {
      console.error(
        "MEMBER REFERRAL COPY ERROR:",
        copyError
      )
    }
  }

  const hasBenefits =
    Boolean(
      member?.rewards?.length
    )

  const areaInterests =
    member?.interests.areas || []

  const specificInterests =
    member?.interests.specific || []

  const visibleAreaInterests =
    showAllInterests
      ? areaInterests
      : areaInterests.slice(0, 4)

  const visibleSpecificInterests =
    showAllInterests
      ? specificInterests
      : specificInterests.slice(0, 4)

  const hasHiddenInterests =
    areaInterests.length > visibleAreaInterests.length ||
    specificInterests.length > visibleSpecificInterests.length

  return (
    <main className="min-h-screen w-full overflow-x-hidden bg-[#f4efe6] text-stone-950">
      <section className="relative w-full overflow-hidden px-5 py-8 sm:px-8 lg:px-12">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_16%_10%,rgba(34,211,238,0.18),transparent_30%),radial-gradient(circle_at_86%_16%,rgba(245,158,11,0.16),transparent_28%),linear-gradient(180deg,#f8f4ec_0%,#efe6d7_100%)]" />
        <div className="absolute inset-0 opacity-[0.28] bg-[linear-gradient(rgba(15,23,42,0.055)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.055)_1px,transparent_1px)] bg-[size:64px_64px]" />

        <div className="relative z-10 mx-auto w-full max-w-7xl min-w-0">
          <header className="flex flex-wrap items-center justify-between gap-4 rounded-[32px] border border-stone-200 bg-white/75 p-3 shadow-sm backdrop-blur-2xl">
            <Link
              href="/"
              className="flex items-center gap-3 rounded-[24px] px-2 py-1 transition hover:bg-stone-100"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-stone-950 text-lg font-black text-white">
                I
                </span>
                <span>
                  <span className="block text-lg font-black uppercase tracking-[-0.04em]">
                    IMNOVA
                  </span>
                  <span className="block text-[10px] font-black uppercase tracking-[0.28em] text-stone-500">
                  Área del miembro
                </span>
              </span>
            </Link>

            <div className="flex flex-wrap gap-2">
              <Link
                href="/#ideas-activas"
                className="inline-flex min-h-12 items-center gap-2 rounded-full border border-stone-300 bg-white px-5 text-[11px] font-black uppercase tracking-[0.15em] text-stone-900 shadow-sm transition hover:-translate-y-0.5"
              >
                <Vote className="h-4 w-4" />
                Votar ideas
              </Link>

              <button
                type="button"
                onClick={copyReferral}
                disabled={!member || !referralUrl}
                className="inline-flex min-h-12 items-center gap-2 rounded-full bg-stone-950 px-5 text-[11px] font-black uppercase tracking-[0.15em] text-white shadow-[0_16px_40px_rgba(15,23,42,0.18)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Share2 className="h-4 w-4" />
                Invitar a un amigo
              </button>
            </div>
          </header>

          {loading && (
            <div className="mt-10 flex min-h-[60vh] items-center justify-center rounded-[40px] border border-stone-200 bg-white/70 p-10 shadow-sm backdrop-blur-2xl">
              <div className="text-center">
                <Loader2 className="mx-auto h-8 w-8 animate-spin text-cyan-700" />
                <p className="mt-4 text-sm font-black uppercase tracking-[0.22em] text-stone-500">
                  Cargando tu membresía
                </p>
              </div>
            </div>
          )}

          {!loading && !member && (
            <div className="mt-10 grid w-full min-w-0 gap-6 rounded-[32px] border border-stone-200 bg-white/78 p-4 shadow-sm backdrop-blur-2xl sm:rounded-[44px] sm:p-6 lg:grid-cols-[0.9fr_1.1fr] lg:p-10">
              <div className="min-w-0 overflow-hidden rounded-[28px] bg-stone-950 p-6 text-white sm:rounded-[34px] sm:p-8">
                <p className="text-xs font-black uppercase tracking-[0.28em] text-cyan-100/70">
                  Membresía no detectada
                </p>
                <h1 className="mt-5 max-w-full break-words text-[1.9rem] font-black leading-[1.08] tracking-[-0.04em] sm:text-5xl sm:leading-none">
                  Activa tu área de miembro.
                </h1>
                <p className="mt-5 max-w-xl font-sans text-base leading-8 text-white/62">
                  El área del miembro se activa después de registrarte en la comunidad IMNOVA desde este navegador.
                </p>
              </div>

              <div className="min-w-0 overflow-hidden rounded-[28px] border border-stone-200 bg-[#f8f4ec] p-6 sm:rounded-[34px] sm:p-8">
                <p className="font-sans text-base leading-8 text-stone-600">
                  No encontramos una identidad local segura para consultar tu perfil. Si ya te registraste desde otro dispositivo, vuelve a unirte con el mismo WhatsApp o correo para recuperar tu código.
                </p>
                <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                  <Link
                    href="/"
                    className="inline-flex min-h-12 items-center justify-center rounded-full bg-stone-950 px-6 text-xs font-black uppercase tracking-[0.16em] text-white"
                  >
                    Ir al inicio
                  </Link>
                  <Link
                    href="/#ideas-activas"
                    className="inline-flex min-h-12 items-center justify-center rounded-full border border-stone-300 bg-white px-6 text-xs font-black uppercase tracking-[0.16em] text-stone-900"
                  >
                    Votar ideas
                  </Link>
                </div>
              </div>
            </div>
          )}

          {!loading && member && (
            <div className="mt-10 space-y-6">
              <section className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
                <div className="rounded-[44px] border border-stone-200 bg-stone-950 p-7 text-white shadow-[0_32px_90px_rgba(15,23,42,0.20)] sm:p-10">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.28em] text-cyan-100/65">
                        Comunidad IMNOVA
                      </p>
                      <h1 className="mt-5 text-5xl font-black leading-none tracking-[-0.06em] sm:text-6xl lg:text-7xl">
                        Hola, {member.name.split(" ")[0] || "miembro"}.
                      </h1>
                    </div>

                    <span className="inline-flex items-center gap-2 rounded-full border border-cyan-200/20 bg-cyan-300/10 px-4 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-cyan-50">
                      <Medal className="h-4 w-4" />
                      {member.level.label}
                    </span>
                  </div>

                  <p className="mt-6 max-w-3xl font-sans text-lg leading-9 text-white/65">
                    Este es tu espacio personal para ver cómo participas, cuántos puntos tienes y cómo invitar a otras personas a construir lo próximo con IMNOVA.
                  </p>

                  <div className="mt-8 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-[28px] border border-white/10 bg-white/[0.05] p-5">
                      <p className="text-[10px] font-black uppercase tracking-[0.22em] text-white/45">
                        Puntos
                      </p>
                      <p className="mt-2 text-4xl font-black">
                        {member.points_total.toLocaleString("es-NI")}
                      </p>
                    </div>
                    <div className="rounded-[28px] border border-white/10 bg-white/[0.05] p-5">
                      <p className="text-[10px] font-black uppercase tracking-[0.22em] text-white/45">
                        Ingreso
                      </p>
                      <p className="mt-3 text-sm font-black text-white/82">
                        {formatDate(member.joined_at)}
                      </p>
                    </div>
                    <div className="rounded-[28px] border border-white/10 bg-white/[0.05] p-5">
                      <p className="text-[10px] font-black uppercase tracking-[0.22em] text-white/45">
                        Referidos
                      </p>
                      <p className="mt-2 text-4xl font-black">
                        {member.referral.total_referrals.toLocaleString("es-NI")}
                      </p>
                    </div>
                  </div>

                  <div className="mt-5 rounded-[28px] border border-cyan-200/15 bg-cyan-100/[0.06] p-5">
                    <p className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-100/55">
                      Nivel
                    </p>
                    <p className="mt-2 font-sans text-sm leading-7 text-white/65">
                      Sigue participando para subir de nivel.
                    </p>
                  </div>
                </div>

                <div className="rounded-[44px] border border-stone-200 bg-white/78 p-7 shadow-sm backdrop-blur-2xl sm:p-10">
                  <div className="flex items-center gap-3">
                    <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-100 text-cyan-800">
                      <Share2 className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.22em] text-cyan-800">
                        Mi referido
                      </p>
                      <h2 className="text-2xl font-black tracking-[-0.04em]">
                        Invita y suma comunidad.
                      </h2>
                    </div>
                  </div>

                  <div className="mt-6 rounded-[28px] border border-stone-200 bg-[#f8f4ec] p-5">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-stone-500">
                      Código único
                    </p>
                    <p className="mt-2 break-all text-3xl font-black tracking-[-0.04em] text-stone-950">
                      {member.referral.code}
                    </p>
                    <p className="mt-4 break-all font-sans text-xs leading-6 text-stone-500">
                      {referralUrl}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={copyReferral}
                    className="mt-5 inline-flex min-h-14 w-full items-center justify-center gap-3 rounded-full bg-stone-950 px-6 text-xs font-black uppercase tracking-[0.18em] text-white transition hover:-translate-y-0.5"
                  >
                    <Copy className="h-4 w-4" />
                    {copied
                      ? "Link copiado"
                      : "Copiar invitación"}
                  </button>

                  <p className="mt-4 font-sans text-sm leading-7 text-stone-600">
                    Comparte tu enlace. Cuando alguien se una con tu código, queda registrado como referido y puede sumar puntos según las reglas activas.
                  </p>
                </div>
              </section>

              <section className="grid gap-6 lg:grid-cols-3">
                <MemberCard
                  icon={<Sparkles className="h-5 w-5" />}
                  title="Mis intereses"
                  subtitle="Áreas elegidas para recibir ideas y oportunidades relevantes."
                  className="lg:col-span-1"
                >
                  <div className="space-y-3">
                    {areaInterests.length > 0
                      ? visibleAreaInterests.map(area => (
                          <div
                            key={area.id}
                            className="rounded-2xl border border-stone-200 bg-white p-4"
                          >
                            <p className="text-sm font-black text-stone-950">
                              {area.label}
                            </p>
                            {area.description && (
                              <p className="mt-2 font-sans text-xs leading-6 text-stone-500">
                                {area.description}
                              </p>
                            )}
                          </div>
                        ))
                      : (
                          <p className="rounded-2xl border border-stone-200 bg-white p-4 font-sans text-sm leading-7 text-stone-500">
                            Aún no hay áreas generales guardadas.
                          </p>
                        )}
                  </div>

                  {specificInterests.length > 0 && (
                    <div className="mt-5">
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-stone-400">
                        Intereses específicos
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {visibleSpecificInterests.map(interest => (
                          <span
                            key={interest.id}
                            className="rounded-full border border-cyan-200 bg-cyan-50 px-3 py-2 text-[11px] font-black text-cyan-900"
                          >
                            {interest.label}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {hasHiddenInterests && (
                    <button
                      type="button"
                      onClick={() => setShowAllInterests(value => !value)}
                      className="mt-5 inline-flex min-h-10 items-center rounded-full border border-stone-300 bg-white px-4 text-[10px] font-black uppercase tracking-[0.16em] text-stone-800 transition hover:-translate-y-0.5"
                    >
                      {showAllInterests ? "Ver menos" : "Ver más"}
                    </button>
                  )}
                </MemberCard>

                <MemberCard
                  icon={<Vote className="h-5 w-5" />}
                  title="Mis votos"
                  subtitle="Ideas donde tu respuesta ayuda a decidir si avanzar, ajustar o pausar."
                  className="lg:col-span-2"
                >
                  <div className="space-y-3">
                    {member.votes.length > 0
                      ? member.votes.map(vote => (
                          <div
                            key={vote.id}
                            className="grid gap-3 rounded-2xl border border-stone-200 bg-white p-4 sm:grid-cols-[1fr_auto]"
                          >
                            <div>
                              <p className="text-sm font-black text-stone-950">
                                {vote.idea_title}
                              </p>
                              <p className="mt-1 text-xs text-stone-500">
                                Última actividad: {formatDate(vote.updated_at || vote.created_at)}
                              </p>
                            </div>
                            <span className="inline-flex items-center justify-center rounded-full bg-stone-950 px-4 py-2 text-[10px] font-black uppercase tracking-[0.12em] text-white">
                              {voteLabels[vote.vote_type] || vote.vote_type}
                            </span>
                          </div>
                        ))
                      : (
                          <div className="rounded-2xl border border-stone-200 bg-white p-4">
                            <p className="font-sans text-sm leading-7 text-stone-500">
                              Vota tu primera idea y gana puntos.
                            </p>
                            <Link
                              href="/#ideas-activas"
                              className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-full bg-stone-950 px-5 text-[11px] font-black uppercase tracking-[0.14em] text-white"
                            >
                              Votar ideas
                              <ArrowUpRight className="h-4 w-4" />
                            </Link>
                          </div>
                        )}
                  </div>
                </MemberCard>
              </section>

              <section className="grid gap-6 lg:grid-cols-2">
                <MemberCard
                  icon={<Trophy className="h-5 w-5" />}
                  title="Mis puntos"
                  subtitle="Tu participación se registra en un historial auditable."
                >
                  <div className="grid gap-3 sm:grid-cols-3">
                    {[
                      {
                        label: "Unirte",
                        value: "+10",
                      },
                      {
                        label: "Votar",
                        value: "+5",
                      },
                      {
                        label: "Referir",
                        value: "+25",
                      },
                    ].map(item => (
                      <div
                        key={item.label}
                        className="rounded-2xl border border-stone-200 bg-white p-4"
                      >
                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-stone-400">
                          {item.label}
                        </p>
                        <p className="mt-2 text-2xl font-black text-stone-950">
                          {item.value}
                        </p>
                      </div>
                    ))}
                  </div>

                  <div className="mt-5 space-y-3">
                    {member.points_ledger.length > 0
                      ? member.points_ledger.map(event => (
                          <div
                            key={event.id}
                            className="flex items-center justify-between gap-3 rounded-2xl border border-stone-200 bg-white p-4"
                          >
                            <div>
                              <p className="text-sm font-black text-stone-950">
                                {pointEventLabels[event.event_type] || event.event_type}
                              </p>
                              <p className="mt-1 text-xs text-stone-500">
                                {event.description || formatDate(event.created_at)}
                              </p>
                            </div>
                            <span className="rounded-full bg-cyan-100 px-3 py-2 text-xs font-black text-cyan-900">
                              +{Number(event.points || 0)}
                            </span>
                          </div>
                        ))
                      : (
                          <p className="rounded-2xl border border-stone-200 bg-white p-4 font-sans text-sm leading-7 text-stone-500">
                            Tus eventos de puntos aparecerán aquí cuando participes.
                          </p>
                        )}
                  </div>
                </MemberCard>

                <MemberCard
                  icon={<Gift className="h-5 w-5" />}
                  title="Mis beneficios"
                  subtitle="Beneficios disponibles según tu nivel y puntos."
                >
                  <div className="space-y-3">
                    {hasBenefits
                      ? member.rewards.map(reward => (
                          <div
                            key={reward.id}
                            className="rounded-2xl border border-stone-200 bg-white p-5"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-black text-stone-950">
                                  {reward.title}
                                </p>
                                {reward.description && (
                                  <p className="mt-2 font-sans text-xs leading-6 text-stone-500">
                                    {reward.description}
                                  </p>
                                )}
                              </div>
                              <span className="rounded-full bg-amber-100 px-3 py-2 text-[10px] font-black uppercase tracking-[0.12em] text-amber-900">
                                {Number(reward.points_cost || 0)} pts
                              </span>
                            </div>
                          </div>
                        ))
                      : (
                          <p className="rounded-2xl border border-stone-200 bg-white p-5 font-sans text-sm leading-7 text-stone-500">
                            Cuando desbloquees beneficios VIP, aparecerán aquí.
                          </p>
                        )}
                  </div>
                </MemberCard>
              </section>
            </div>
          )}
        </div>
      </section>
    </main>
  )
}

function MemberCard({
  icon,
  title,
  subtitle,
  children,
  className = "",
}: {
  icon: ReactNode
  title: string
  subtitle: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`rounded-[36px] border border-stone-200 bg-white/78 p-6 shadow-sm backdrop-blur-2xl sm:p-7 ${className}`}>
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-stone-950 text-cyan-100">
          {icon}
        </span>
        <div>
          <h2 className="text-2xl font-black tracking-[-0.04em] text-stone-950">
            {title}
          </h2>
          <p className="mt-2 font-sans text-sm leading-7 text-stone-500">
            {subtitle}
          </p>
        </div>
      </div>

      <div className="mt-6">
        {children}
      </div>
    </div>
  )
}
