"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Activity, ArrowLeft, BadgeCheck, BarChart3, Box, Check,
  CheckCircle2, ChevronDown, CircleDashed, Clock3, DollarSign,
  ExternalLink, FileText, Gauge, Layers3, LoaderCircle, PackageCheck,
  Printer, RefreshCw, Search, ShieldCheck, Sparkles, Tag,
  TriangleAlert, XCircle,
} from "lucide-react"

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from
  "@/components/ui/collapsible"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { supabase } from "@/lib/supabase"
import { buildCommercialTracePresentationV1, humanCommercialCodeV1,
  humanComparableReasonV1, type CommercialTraceEventV1,
  type CommercialTraceRecordV1 } from
  "@/lib/ebay/seller-os-commercial-trace-presentation-v1"

const DEFAULT_PRODUCT_URL = ""
type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function display(value: unknown, fallback = "No demostrado") {
  if (value === null || value === undefined || value === "") return fallback
  if (typeof value === "number") return Number.isInteger(value)
    ? String(value) : value.toFixed(2)
  return String(value)
}

function money(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return "No demostrado"
  }
  const amount = Number(value)
  return Number.isFinite(amount) ? new Intl.NumberFormat("es-US", {
    style: "currency", currency: "USD" }).format(amount) : "No demostrado"
}

function dateTime(value: unknown) {
  const valueText = typeof value === "string" ? value : ""
  const parsed = Date.parse(valueText)
  return Number.isFinite(parsed) ? new Intl.DateTimeFormat("es-NI", {
    dateStyle: "medium", timeStyle: "short" }).format(new Date(parsed))
    : "No demostrado"
}

function itemId(value: unknown) {
  const raw = display(value, "")
  return raw.match(/^v1\|(\d+)\|/)?.[1] ?? raw
}

const surface = "rounded-[1.6rem] border border-white/[0.09] bg-[#111b29]/80 shadow-[0_22px_70px_rgba(0,0,0,0.24)] backdrop-blur-xl"

function StatusMark({ status }: { status: string }) {
  const config = status === "RUNNING"
    ? { label: "En curso", icon: LoaderCircle,
      style: "border-sky-300/25 bg-sky-300/10 text-sky-100" }
    : status === "PASS"
      ? { label: "Completado", icon: CheckCircle2,
        style: "border-emerald-300/25 bg-emerald-300/10 text-emerald-100" }
      : status === "WARN"
        ? { label: "Con observaciones", icon: TriangleAlert,
          style: "border-amber-300/25 bg-amber-300/10 text-amber-100" }
        : status === "FAIL"
          ? { label: "No completado", icon: XCircle,
            style: "border-rose-300/25 bg-rose-300/10 text-rose-100" }
          : { label: "Pendiente", icon: CircleDashed,
            style: "border-white/10 bg-white/[0.04] text-white/45" }
  const Icon = config.icon
  return <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold", config.style)}>
    <Icon className={cn("size-3.5", status === "RUNNING" && "animate-spin")} />
    {config.label}
  </span>
}

function ProvenanceBadge({ value }: { value: unknown }) {
  if (value === "FRESH_QUERY") return <span className="inline-flex items-center gap-1 rounded-full border border-sky-300/20 bg-sky-300/10 px-2 py-1 text-[10px] font-bold text-sky-100">
    <RefreshCw className="size-3" />Consultado ahora
  </span>
  if (value === "DURABLE_REUSE" || value === "CONFIRMED_DURABLE_SOLD") {
    return <span className="inline-flex items-center gap-1 rounded-full border border-violet-300/20 bg-violet-300/10 px-2 py-1 text-[10px] font-bold text-violet-100">
      <Clock3 className="size-3" />Evidencia reciente reutilizada
    </span>
  }
  if (value === "EBAY_MARKETPLACE_INSIGHTS_SOLD_HISTORY") {
    return <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2 py-1 text-[10px] font-bold text-emerald-100">
      <BadgeCheck className="size-3" />Historial SOLD verificado
    </span>
  }
  return null
}

function Metric({ label, value, detail, icon: Icon }: { label: string;
  value: string; detail?: string; icon?: typeof Activity }) {
  return <div className="rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4 transition-colors hover:bg-white/[0.055]">
    <div className="flex items-center justify-between gap-3">
      <p className="text-[11px] font-bold uppercase tracking-[0.13em] text-slate-400">{label}</p>
      {Icon && <Icon className="size-4 text-sky-200/65" />}
    </div>
    <p className="mt-2 text-xl font-semibold tracking-tight text-white">{value}</p>
    {detail && <p className="mt-1 text-xs leading-5 text-slate-400">{detail}</p>}
  </div>
}

function SectionTitle({ eyebrow, title, description, icon: Icon }: {
  eyebrow?: string; title: string; description?: string; icon?: typeof Activity
}) {
  return <div className="flex items-start gap-3">
    {Icon && <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl border border-sky-300/15 bg-sky-300/[0.07] text-sky-100">
      <Icon className="size-4" />
    </span>}
    <div>{eyebrow && <p className="text-[10px] font-black uppercase tracking-[0.18em] text-sky-200/55">{eyebrow}</p>}
      <h2 className="text-lg font-semibold tracking-tight text-white sm:text-xl">{title}</h2>
      {description && <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-400">{description}</p>}
    </div>
  </div>
}

function LoadingWorkspace() {
  return <div className="space-y-5" aria-label="Cargando análisis">
    <Skeleton className="h-48 rounded-[1.8rem] bg-white/[0.06]" />
    <div className="grid gap-5 lg:grid-cols-[1.35fr_.65fr]">
      <Skeleton className="h-[32rem] rounded-[1.8rem] bg-white/[0.06]" />
      <div className="space-y-5"><Skeleton className="h-60 rounded-[1.8rem] bg-white/[0.06]" />
        <Skeleton className="h-60 rounded-[1.8rem] bg-white/[0.06]" /></div>
    </div>
  </div>
}

function HumanTimeline({ view, newSequences }: {
  view: ReturnType<typeof buildCommercialTracePresentationV1>
  newSequences: ReadonlySet<number>
}) {
  return <section className={cn(surface, "p-5 sm:p-6")}>
    <SectionTitle eyebrow="Recorrido en vivo" title="Qué está haciendo Seller OS"
      description="Cada paso se reconstruye desde eventos durables. Puedes salir y volver sin perder el recorrido."
      icon={Activity} />
    <ol className="mt-7">
      {view.steps.map((step, index) => {
        const isNew = view.events.some((event) => newSequences.has(event.sequence) &&
          step.stages.includes(event.stage as never))
        return <li key={step.id} className="relative grid grid-cols-[2rem_1fr] gap-3 pb-6 last:pb-0">
          {index < view.steps.length - 1 && <span className="absolute left-[.94rem] top-8 h-[calc(100%-1rem)] w-px bg-gradient-to-b from-white/15 to-white/[0.04]" />}
          <span className={cn("relative z-10 mt-0.5 grid size-8 place-items-center rounded-full border transition-all duration-500",
            step.status === "RUNNING" && "border-sky-300/50 bg-sky-300/15 shadow-[0_0_24px_rgba(125,211,252,.18)]",
            step.status === "PASS" && "border-emerald-300/35 bg-emerald-300/10",
            step.status === "WARN" && "border-amber-300/35 bg-amber-300/10",
            step.status === "FAIL" && "border-rose-300/35 bg-rose-300/10",
            step.status === "PENDING" && "border-white/10 bg-[#0c1522]") }>
            {step.status === "RUNNING" ? <LoaderCircle className="size-4 animate-spin text-sky-200" />
              : step.status === "PASS" ? <Check className="size-4 text-emerald-200" />
                : step.status === "WARN" ? <TriangleAlert className="size-4 text-amber-200" />
                  : step.status === "FAIL" ? <XCircle className="size-4 text-rose-200" />
                    : <span className="size-1.5 rounded-full bg-white/20" />}
          </span>
          <article className={cn("rounded-2xl border border-transparent px-3 py-1 transition-all duration-500",
            step.status === "RUNNING" && "border-sky-300/15 bg-sky-300/[0.055] py-3",
            isNew && "animate-in fade-in slide-in-from-bottom-1 bg-white/[0.07] duration-500") }>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className={cn("font-semibold", step.status === "PENDING" ? "text-slate-500" : "text-slate-100")}>{step.label}</h3>
              <StatusMark status={step.status} />
            </div>
            <p className={cn("mt-1.5 text-sm leading-6", step.status === "PENDING" ? "text-slate-600" : "text-slate-400")}>{step.message}</p>
          </article>
        </li>
      })}
    </ol>
  </section>
}

function ProductSnapshot({ view }: {
  view: ReturnType<typeof buildCommercialTracePresentationV1>
}) {
  const product = view.product
  const stockLabel = !product.title ? "En validación" : product.stockAvailable
    ? product.stockQuantity === null ? "Disponible" : `${product.stockQuantity} disponibles`
    : "No disponible"
  return <section className={cn(surface, "p-5")}>
    <SectionTitle eyebrow="Producto" title={product.title ?? "Identificando producto…"}
      icon={Box} />
    <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
      <div className="rounded-xl bg-white/[0.035] p-3"><dt className="text-xs text-slate-500">SKU</dt><dd className="mt-1 font-semibold text-slate-100">{display(product.sku)}</dd></div>
      <div className="rounded-xl bg-white/[0.035] p-3"><dt className="text-xs text-slate-500">Modelo</dt><dd className="mt-1 font-semibold text-slate-100">{display(product.model)}</dd></div>
      <div className="rounded-xl bg-white/[0.035] p-3"><dt className="text-xs text-slate-500">Stock</dt><dd className="mt-1 font-semibold text-slate-100">{stockLabel}</dd></div>
      <div className="rounded-xl bg-white/[0.035] p-3"><dt className="text-xs text-slate-500">Identidad</dt><dd className="mt-1 flex items-center gap-1.5 font-semibold text-slate-100">{product.identityConfirmed ? <><BadgeCheck className="size-4 text-emerald-300" />Confirmada</> : "En validación"}</dd></div>
    </dl>
    <div className="mt-4"><ProvenanceBadge value={view.dossier.provenance.product} /></div>
  </section>
}

function EconomicsSnapshot({ view }: {
  view: ReturnType<typeof buildCommercialTracePresentationV1>
}) {
  const economics = view.economics
  return <section className={cn(surface, "p-5")}>
    <SectionTitle eyebrow="Economics" title="Costo y viabilidad" icon={DollarSign} />
    <div className="mt-5 grid grid-cols-3 gap-2">
      <div><p className="text-[11px] text-slate-500">Producto</p><p className="mt-1 font-semibold">{money(economics.productCost)}</p></div>
      <div><p className="text-[11px] text-slate-500">Shipping</p><p className="mt-1 font-semibold">{money(economics.shipping)}</p></div>
      <div><p className="text-[11px] text-slate-500">Costo puesto</p><p className="mt-1 font-semibold text-sky-100">{money(economics.landed)}</p></div>
    </div>
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <ProvenanceBadge value={view.dossier.provenance.shipping} />
      {economics.feesExact === false && <span className="text-xs text-amber-100/70">Fees exactos aún no confirmados</span>}
      <span className="text-xs text-amber-100/70">Shipping qty1: {economics.shippingStatus} · Fee: {economics.feeAuthorityStatus}</span>
    </div>
  </section>
}

function DecisionLoopPanel({ view }: {
  view: ReturnType<typeof buildCommercialTracePresentationV1>
}) {
  const loop = view.dossier.decisionLoop
  const blockers = Array.isArray(loop.blockers) ? loop.blockers.map(String) : []
  const cta = asRecord(loop.ownerCta)
  const state = String(loop.state ?? (view.decision.tone === "REJECT"
    ? "REJECT" : view.decision.tone === "HOLD" ? "HOLD" : "ANALYZING"))
  const active = ["APPROVED_FOR_PUBLICATION", "LISTING_PACKAGE_READY"]
    .includes(state)
  const reason = active
    ? "El paquete pasó los requisitos comerciales. El clic inicia el preflight existente; no omite ninguna validación."
    : state === "REJECT"
      ? view.decision.explanation
      : blockers.length
        ? blockers.map(humanCommercialCodeV1).join(" · ")
        : state === "HOLD" ? view.decision.explanation
          : "El análisis todavía está reuniendo la evidencia necesaria para habilitar publicación."
  const href = typeof cta.href === "string" && cta.href
    ? cta.href : "/admin/ebay/publish"
  return <section id="publication-action" className={cn(surface,
    "border-sky-200/15 bg-gradient-to-br from-[#111b29] to-[#0c1725] p-5 sm:p-6")}>
    <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
      <div className="max-w-3xl"><SectionTitle eyebrow="Acción final"
        title="Publicar listing"
      icon={PackageCheck} />
        <p className="mt-3 text-sm leading-6 text-slate-400">{reason}</p>
        <p className="mt-2 text-xs text-slate-500">Estado comercial: <strong className="text-slate-300">{state}</strong> · AUTO_PUBLISH {loop.autoPublish === true ? "activado" : "desactivado"}</p>
      </div>
      {active ? <a href={href} className="inline-flex min-h-12 shrink-0 items-center justify-center rounded-xl bg-emerald-200 px-6 text-sm font-black text-emerald-950 shadow-[0_12px_34px_rgba(167,243,208,.12)] transition hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-200/20">Publicar listing</a>
        : <button type="button" disabled aria-describedby="publication-disabled-reason" className="inline-flex min-h-12 shrink-0 cursor-not-allowed items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] px-6 text-sm font-black text-slate-500">Publicar listing</button>}
    </div>
    {!active && <p id="publication-disabled-reason" className="sr-only">{reason}</p>}
  </section>
}

function MarketFunnel({ view }: {
  view: ReturnType<typeof buildCommercialTracePresentationV1>
}) {
  const market = view.marketFunnel
  const nodes = [
    { label: "Encontrados", value: market.found, detail: `${market.returned} devueltos por eBay` },
    { label: "Revisados", value: market.reviewed, detail: "Muestra enriquecida" },
    { label: "Aceptados", value: market.accepted,
      detail: `${market.exact} exactos · ${market.nearExact} mismo formato · ${market.functional} funcionales` },
    { label: "Descartados", value: market.excluded, detail: "Con razón documentada" },
  ]
  return <section className={cn(surface, "p-5 sm:p-6")}>
    <div className="flex flex-wrap items-start justify-between gap-4">
      <SectionTitle eyebrow="Mercado" title="Embudo de evidencia reconciliado"
        description="Los revisados siempre equivalen a aceptados más descartados."
        icon={BarChart3} />
      <ProvenanceBadge value={view.dossier.provenance.market} />
    </div>
    <div className="mt-6 grid gap-2 sm:grid-cols-4">
      {nodes.map((node, index) => <div key={node.label} className="relative rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4">
        <p className="text-xs text-slate-500">{node.label}</p>
        <p className="mt-1 text-2xl font-semibold tracking-tight">{node.value.toLocaleString("en-US")}</p>
        <p className="mt-1 text-[11px] leading-4 text-slate-500">{node.detail}</p>
        {index < nodes.length - 1 && <span className="absolute -right-2.5 top-1/2 z-10 hidden size-5 -translate-y-1/2 place-items-center rounded-full border border-white/10 bg-[#111b29] text-slate-500 sm:grid">›</span>}
      </div>)}
    </div>
    <div className={cn("mt-4 flex items-center gap-2 rounded-xl px-3 py-2 text-xs",
      market.reconciled ? "bg-emerald-300/[0.06] text-emerald-100/80" : "bg-rose-300/[0.08] text-rose-100") }>
      {market.reconciled ? <CheckCircle2 className="size-4" /> : <TriangleAlert className="size-4" />}
      {market.reconciled
        ? `${market.reviewed} revisados = ${market.accepted} aceptados + ${market.excluded} descartados.`
        : "La clasificación todavía está en curso; el embudo se cerrará al completar la muestra."}
    </div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <Metric label="Ventas confirmadas" value={String(market.confirmedSales)}
        detail={`${market.confirmedListings} listings con evidencia durable`} icon={BadgeCheck} />
      <Metric label="Ventas estimadas" value={String(market.estimatedSales)}
        detail={`${market.estimatedListings} listings; separadas de las confirmadas`} icon={Gauge} />
    </div>
  </section>
}

function ClaimsPanel({ view }: {
  view: ReturnType<typeof buildCommercialTracePresentationV1>
}) {
  const truth = view.productTruth
  const safe = truth.safeClaims
  const doNotUse = truth.doNotUseClaims
  return <section className={cn(surface, "p-5 sm:p-6")}>
    <SectionTitle eyebrow="Product Truth" title="Qué sabemos y qué no publicaremos"
      description="Seller OS conserva un subconjunto seguro cuando las fuentes se contradicen."
      icon={ShieldCheck} />
    <div className="mt-6 grid gap-5 lg:grid-cols-2">
      <div><p className="text-xs font-bold uppercase tracking-wider text-emerald-200/70">Confirmado</p>
        <div className="mt-3 flex flex-wrap gap-2">{safe.length ? safe.map((claim, index) => <span key={`${claim.value}:${index}`} className="rounded-full border border-emerald-300/15 bg-emerald-300/[0.07] px-3 py-1.5 text-xs text-emerald-50">{display(claim.value)}</span>)
          : <p className="text-sm text-slate-500">Aún validando atributos.</p>}</div>
      </div>
      <div><p className="text-xs font-bold uppercase tracking-wider text-rose-200/70">No usar en el listing</p>
        <div className="mt-3 space-y-2">{doNotUse.length ? doNotUse.map((claim, index) => <div key={`${claim.value}:${index}`} className="rounded-xl border border-rose-300/10 bg-rose-300/[0.05] p-3 text-sm text-rose-50/85">{display(claim.value)}</div>)
          : <p className="text-sm text-slate-500">No hay claims prohibidos documentados.</p>}</div>
      </div>
    </div>
    {truth.conflictExplanations.length > 0 && <div className="mt-6 space-y-3">
      <p className="text-xs font-bold uppercase tracking-wider text-amber-200/70">Cómo resolvió Seller OS las inconsistencias</p>
      {truth.conflictExplanations.map((message, index) => <div key={`${message}:${index}`} className="flex gap-3 rounded-2xl border border-amber-300/10 bg-amber-300/[0.055] p-4 text-sm leading-6 text-amber-50/85">
        <TriangleAlert className="mt-1 size-4 shrink-0 text-amber-200" />{message}
      </div>)}
    </div>}
  </section>
}

function ComparableCard({ item, accepted }: { item: JsonRecord; accepted: boolean }) {
  const enrichment = asRecord(item.nearExactSoldEnrichment)
  const isNearExact = item.comparableClass === "NEAR_EXACT_PRODUCT"
  const directConfirmed = Math.max(Number(item.confirmedSoldQuantity ?? 0),
    Number(item.verifiedSoldQuantity ?? 0))
  const enrichedConfirmed = Number(enrichment.confirmedSoldQuantity ?? 0)
  const confirmed = Math.max(directConfirmed, enrichedConfirmed)
  const estimated = Number(item.estimatedSoldQuantity ?? 0)
  const totalPrice = item.totalPrice ?? (Number(item.price ?? 0) +
    Number(item.shippingCost ?? 0))
  const provenance = enrichment.provenance ?? item.soldHistorySource
  const contributed = item.usedForPricing === true ||
    enrichment.contributedToPricing === true
  return <article className={cn("rounded-2xl border p-4 transition-colors",
    accepted ? "border-emerald-300/10 bg-emerald-300/[0.035] hover:bg-emerald-300/[0.055]"
      : "border-rose-300/10 bg-rose-300/[0.035] hover:bg-rose-300/[0.055]") }>
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0"><p className="line-clamp-2 font-medium leading-6 text-slate-100">{display(item.title)}</p>
        <p className="mt-1 text-xs text-slate-500">Item {itemId(item.comparableId)} · total {money(totalPrice)}</p></div>
      {accepted ? <CheckCircle2 className="size-5 shrink-0 text-emerald-300" />
        : <XCircle className="size-5 shrink-0 text-rose-300" />}
    </div>
    <p className={cn("mt-3 text-sm leading-5", accepted ? "text-emerald-100/75" : "text-rose-100/75")}>{humanComparableReasonV1(item)}</p>
    <div className="mt-3 flex flex-wrap gap-2">
      {confirmed > 0 && <><ProvenanceBadge value={provenance} /><span className="text-xs text-slate-400">{confirmed} venta{confirmed === 1 ? "" : "s"} verificada{confirmed === 1 ? "" : "s"}</span></>}
      {confirmed === 0 && estimated > 0 && <><ProvenanceBadge value="FRESH_QUERY" /><span className="text-xs text-slate-400">{estimated} ventas estimadas</span></>}
      {confirmed === 0 && estimated === 0 && <span className="text-xs text-slate-500">Sin señal de ventas; no define pricing.</span>}
    </div>
    {isNearExact && <dl className="mt-4 grid gap-2 rounded-xl border border-white/[0.06] bg-black/15 p-3 text-xs sm:grid-cols-3">
      <div><dt className="text-slate-500">Similitud</dt><dd className="mt-1 font-semibold text-slate-200">{display(item.similarity ?? enrichment.similarity, "0")}%</dd></div>
      <div><dt className="text-slate-500">Última venta</dt><dd className="mt-1 font-semibold text-slate-200">{dateTime(enrichment.lastSoldDate ?? item.lastSoldDate)}</dd></div>
      <div><dt className="text-slate-500">Aportó a pricing</dt><dd className="mt-1 font-semibold text-slate-200">{contributed ? "Sí" : "No"}</dd></div>
      <div><dt className="text-slate-500">SOLD confirmado</dt><dd className="mt-1 font-semibold text-slate-200">{confirmed}</dd></div>
      <div><dt className="text-slate-500">SOLD estimado</dt><dd className="mt-1 font-semibold text-slate-200">{estimated}</dd></div>
      <div><dt className="text-slate-500">Provenance</dt><dd className="mt-1 break-words font-semibold text-slate-200">{display(provenance)}</dd></div>
    </dl>}
    <details className="group mt-3 text-xs text-slate-500">
      <summary className="flex min-h-9 cursor-pointer list-none items-center gap-1 font-medium text-slate-400">Provenance y datos exactos <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" /></summary>
      <dl className="grid gap-2 rounded-xl bg-black/15 p-3 sm:grid-cols-2">
        <div><dt>Fuente de ventas</dt><dd className="mt-0.5 break-words text-slate-300">{display(item.soldHistorySource)}</dd></div>
        <div><dt>Última venta</dt><dd className="mt-0.5 text-slate-300">{dateTime(item.lastSoldDate)}</dd></div>
        <div><dt>Precio realizado</dt><dd className="mt-0.5 text-slate-300">{display(item.realizedPriceStatus)}</dd></div>
        <div><dt>Usado para pricing</dt><dd className="mt-0.5 text-slate-300">{item.usedForPricing === true ? "Sí" : "No"}</dd></div>
      </dl>
    </details>
  </article>
}

function ComparablesPanel({ view }: {
  view: ReturnType<typeof buildCommercialTracePresentationV1>
}) {
  return <section className={cn(surface, "p-5 sm:p-6")}>
    <SectionTitle eyebrow="Transparencia" title="Productos comparables"
      description="Cada aceptación y descarte conserva una explicación legible; la evidencia técnica está disponible al expandir."
      icon={Layers3} />
    <div className="mt-6 grid gap-6 lg:grid-cols-2">
      <div><div className="flex items-center justify-between"><h3 className="font-semibold text-emerald-100">Aceptados</h3><span className="text-sm text-slate-500">{view.accepted.length}</span></div>
        <div className="mt-3 space-y-3">{view.accepted.length ? view.accepted.map((item, index) => <ComparableCard key={`${item.comparableId}:${index}`} item={item} accepted />)
          : <p className="rounded-2xl border border-dashed border-white/10 p-5 text-sm text-slate-500">Aún no hay comparables aceptados.</p>}</div>
      </div>
      <div><div className="flex items-center justify-between"><h3 className="font-semibold text-rose-100">Descartados</h3><span className="text-sm text-slate-500">{view.excluded.length}</span></div>
        <div className="mt-3 space-y-3">{view.excluded.length ? view.excluded.map((item, index) => <ComparableCard key={`${item.comparableId}:${index}`} item={item} accepted={false} />)
          : <p className="rounded-2xl border border-dashed border-white/10 p-5 text-sm text-slate-500">Aún no hay resultados descartados.</p>}</div>
      </div>
    </div>
  </section>
}

const dossierNav = [
  ["dossier-overview", "Overview"], ["dossier-truth", "Product Truth"],
  ["dossier-market", "Market"], ["dossier-keywords", "Keywords"],
  ["dossier-economics", "Economics"], ["dossier-pricing", "Pricing"],
  ["dossier-listing", "Listing Strategy"], ["dossier-visual", "Visual Strategy"],
  ["dossier-risks", "Risks"], ["dossier-technical", "Technical Evidence"],
] as const

function DossierSection({ id, title, children, icon: Icon }: { id: string;
  title: string; children: React.ReactNode; icon: typeof Activity }) {
  return <section id={id} className={cn(surface, "scroll-mt-28 p-5 sm:p-6")}>
    <SectionTitle title={title} icon={Icon} />
    <div className="mt-5">{children}</div>
  </section>
}

function DefinitionGrid({ items }: { items: Array<readonly [string, string]> }) {
  return <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{items.map(([label, value]) => <div key={label} className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4">
    <dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1.5 font-medium leading-6 text-slate-100">{value}</dd>
  </div>)}</dl>
}

function TechnicalEvidence({ view, error }: {
  view: ReturnType<typeof buildCommercialTracePresentationV1>; error: string
}) {
  const [open, setOpen] = useState(false)
  return <Collapsible open={open} onOpenChange={setOpen}>
    <CollapsibleTrigger className="flex min-h-12 w-full items-center justify-between gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.025] px-4 text-left text-sm font-semibold text-slate-200 transition-colors hover:bg-white/[0.05]">
      <span className="flex items-center gap-2"><FileText className="size-4 text-sky-200" />Ver detalles técnicos</span>
      <ChevronDown className={cn("size-4 transition-transform duration-200", open && "rotate-180")} />
    </CollapsibleTrigger>
    <CollapsibleContent className="animate-in fade-in slide-in-from-top-1 duration-200">
      <div className="mt-3 rounded-2xl border border-white/[0.08] bg-black/20 p-4 font-mono text-xs text-slate-400">
        <DefinitionGrid items={[
          ["TRACE_ID", display(view.dossier.technical.traceId)],
          ["GTIN", display(view.dossier.technical.gtin)],
          ["MPN", display(view.dossier.technical.mpn)],
          ["MODEL", display(view.dossier.technical.model)],
          ["RAW DECISION CODE", display(view.dossier.technical.rawDecisionCode)],
          ["LAST READ ERROR", error || "NONE"],
        ]} />
        <details className="mt-4"><summary className="cursor-pointer py-2 font-semibold text-slate-300">Thresholds, RPC y gateway evidence</summary>
          <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-black/30 p-3">{JSON.stringify({ thresholds: view.dossier.technical.thresholds,
            marketSearches: view.dossier.technical.marketSearches,
            nearExactSoldEnrichment:
              view.dossier.technical.nearExactSoldEnrichment,
            rawKeywordEvidence: view.dossier.technical.rawKeywordEvidence }, null, 2)}</pre>
        </details>
        <div className="mt-5 space-y-3">{view.events.map((event) => <details key={event.sequence} className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3">
          <summary className="cursor-pointer list-none"><span className="text-sky-200">SEQ {event.sequence}</span> · {event.stage} · {event.status} · {dateTime(event.observed_at)}</summary>
          <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/30 p-3">{JSON.stringify({ eventType: "TRACE_EVENT", stage: event.stage,
            status: event.status, timestamp: event.observed_at,
            narrative: event.narrative, evidence: event.evidence }, null, 2)}</pre>
        </details>)}</div>
      </div>
    </CollapsibleContent>
  </Collapsible>
}

function CommercialDossier({ view, error }: {
  view: ReturnType<typeof buildCommercialTracePresentationV1>; error: string
}) {
  const dossier = view.dossier
  if (!dossier.generated) return <section className={cn(surface, "p-8 text-center")}>
    <LoaderCircle className="mx-auto size-8 animate-spin text-sky-200" />
    <h2 className="mt-4 text-xl font-semibold">El expediente se está preparando</h2>
    <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-400">Se generará automáticamente con la evidencia de este mismo trace. No se ejecutará un segundo análisis.</p>
  </section>
  return <div className="grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
    <aside className="lg:relative"><nav aria-label="Secciones del expediente" className={cn(surface, "sticky top-5 flex gap-1 overflow-x-auto p-2 lg:block lg:space-y-1")}>
      {dossierNav.map(([id, label]) => <a key={id} href={`#${id}`} className="block shrink-0 rounded-xl px-3 py-2.5 text-sm text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-white">{label}</a>)}
    </nav></aside>
    <article className="min-w-0 space-y-5">
      <DossierSection id="dossier-overview" title="Executive Summary" icon={Sparkles}>
        <div className="rounded-2xl border border-sky-300/15 bg-gradient-to-br from-sky-300/[0.08] to-violet-300/[0.04] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-2xl font-semibold tracking-tight">{dossier.decision.label}</span><span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-slate-300">Confianza {display(dossier.confidence)}</span></div>
          <p className="mt-3 max-w-3xl leading-7 text-slate-300">{dossier.executiveSummary}</p>
        </div>
        <DefinitionGrid items={[
          ["Producto", display(dossier.product.title)],
          ["SKU / Modelo", `${display(dossier.product.sku)} / ${display(dossier.product.model)}`],
          ["Objetivo preliminar (no autorizado)", money(dossier.pricing.recommendedPrice)],
          ["Costo puesto", money(dossier.economics.landed)],
          ["Spread bruto", money(dossier.economics.grossSpread)],
          ["Margen estimado", dossier.economics.marginPercent === null ? "No demostrado" : `${display(dossier.economics.marginPercent)}%`],
        ]} />
      </DossierSection>

      <DossierSection id="dossier-truth" title="Product Truth" icon={PackageCheck}>
        <p className="text-sm leading-6 text-slate-400">{display(dossier.product.title)} · identidad {dossier.product.identityConfirmed ? "confirmada para análisis" : "todavía en validación"}.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2"><div><h3 className="text-sm font-semibold text-emerald-100">Claims confirmados</h3><ul className="mt-2 space-y-2 text-sm text-slate-300">{dossier.productTruth.safeClaims.map((claim, index) => <li key={`${claim.value}:${index}`} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-emerald-300" />{display(claim.value)}</li>)}</ul></div>
          <div><h3 className="text-sm font-semibold text-rose-100">Claims no verificados o prohibidos</h3><ul className="mt-2 space-y-2 text-sm text-slate-300">{dossier.productTruth.doNotUseClaims.length ? dossier.productTruth.doNotUseClaims.map((claim, index) => <li key={`${claim.value}:${index}`} className="flex gap-2"><XCircle className="mt-0.5 size-4 shrink-0 text-rose-300" />{display(claim.value)}</li>) : <li>Ninguno documentado.</li>}</ul></div></div>
      </DossierSection>

      <DossierSection id="dossier-market" title="Market & Competitive Positioning" icon={BarChart3}>
        <p className="rounded-2xl bg-white/[0.035] p-4 text-sm leading-6 text-slate-300">{dossier.market.competitivePosition}</p>
        <div className="mt-4"><DefinitionGrid items={[
          ["Resultados encontrados", dossier.market.found.toLocaleString("en-US")],
          ["Muestra revisada", String(dossier.market.reviewed)],
          ["Modelo exacto", String(dossier.market.exact)],
          ["Mismo producto/formato", String(dossier.market.nearExact)],
          ["Equivalentes funcionales", String(dossier.market.functional)],
          ["Ventas confirmadas", String(dossier.market.confirmedSales)],
          ["Ventas estimadas", String(dossier.market.estimatedSales)],
        ]} /></div>
        <p className="mt-4 text-sm text-slate-400">Demanda: {dossier.market.demand}.</p>
      </DossierSection>

      <DossierSection id="dossier-keywords" title="Keyword Strategy" icon={Tag}>
        <DefinitionGrid items={[
          ["Familia principal", display(dossier.keywords.primary)],
          ["Intención de compra", display(dossier.keywords.purchaseIntent)],
          ["Keywords secundarias", dossier.keywords.secondary.length ? dossier.keywords.secondary.join(", ") : "No respaldadas todavía"],
          ["Long-tail", dossier.keywords.longTail.length ? dossier.keywords.longTail.join(", ") : "No respaldadas todavía"],
          ["Diferenciadores", dossier.keywords.differentiators.length ? dossier.keywords.differentiators.join(", ") : "No demostrados"],
          ["Términos excluidos", dossier.keywords.unsupportedOrExcluded.length ? dossier.keywords.unsupportedOrExcluded.join(", ") : "Ninguno documentado"],
          ["Título final eBay (≤80)", display(dossier.keywords.finalEbayTitle)],
        ]} />
      </DossierSection>

      <DossierSection id="dossier-economics" title="Economics" icon={DollarSign}>
        <DefinitionGrid items={[
          ["Costo producto", money(dossier.economics.productCost)],
          ["Shipping qty=1", money(dossier.economics.shipping)],
          ["Autoridad shipping", display(dossier.economics.shippingStatus)],
          ["Recibo qty1", display(dossier.economics.shippingReceiptId)],
          ["Vigente hasta", display(dossier.economics.shippingFreshUntil)],
          ["Costo puesto", money(dossier.economics.landed)],
          ["Autoridad fee", display(dossier.economics.feeAuthorityStatus)],
          ["Fees estimados", money(dossier.economics.feeEstimate)],
          ["Utilidad neta estimada", money(dossier.economics.netProfit)],
          ["Margen estimado", dossier.economics.marginPercent === null ? "No demostrado" : `${display(dossier.economics.marginPercent)}%`],
          ["ROI estimado", dossier.economics.roiPercent === null ? "No demostrado" : `${display(dossier.economics.roiPercent)}%`],
        ]} />
        {Object.keys(dossier.economics.floor).length > 0 && <details className="mt-4 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4"><summary className="cursor-pointer font-semibold text-slate-200">Ver ecuación completa del piso económico</summary><div className="mt-4"><DefinitionGrid items={[
          ["Gate vinculante", display(dossier.economics.floor.bindingGate)],
          ["Piso de utilidad", money(asRecord(dossier.economics.floor.candidateFloors).minimumNetProfitPrice)],
          ["Piso de margen", money(asRecord(dossier.economics.floor.candidateFloors).minimumNetMarginPrice)],
          ["Piso de ROI", money(asRecord(dossier.economics.floor.candidateFloors).minimumRoiPrice)],
          ["Fee allowance", money(asRecord(dossier.economics.floor.policyAssumptions).marketplaceFeeAllowance)],
          ["Fee fijo", money(asRecord(dossier.economics.floor.policyAssumptions).fixedOrderFee)],
          ["Reserva publicidad", money(asRecord(dossier.economics.floor.policyAssumptions).advertisingReserve)],
          ["Reserva devoluciones/riesgo", money(asRecord(dossier.economics.floor.policyAssumptions).returnsRiskReserve)],
        ]} /></div><p className="mt-3 text-xs leading-5 text-slate-500">Costo y shipping son evidencia observada. Fees, reservas y floors son supuestos de política visibles; no se presentan como datos observados.</p></details>}
      </DossierSection>

      <DossierSection id="dossier-pricing" title="Pricing Strategy" icon={Gauge}>
        <DefinitionGrid items={[
          ["Rango observado", Object.keys(dossier.pricing.range).length ? `${money(dossier.pricing.range.minimum)} – ${money(dossier.pricing.range.maximum)}` : "No demostrado"],
          ["Mediana", money(dossier.pricing.range.median)],
          ["Objetivo preliminar", money(dossier.pricing.recommendedPrice)],
          ["Precio final autorizado", money(dossier.pricing.finalAuthorizedPrice)],
          ["Autorización de precio", dossier.pricing.priceAuthorized ? "Sí" : "No"],
          ["Fallback de prueba", money(dossier.pricing.fallbackPrice)],
          ["Piso económico estimado", money(dossier.pricing.minimumMarginSafePrice)],
          ["Razón comercial", dossier.pricing.rationale],
          ["Calidad de evidencia", display(dossier.pricing.evidenceQuality.classification)],
        ]} />
      </DossierSection>

      <DossierSection id="dossier-listing" title="Listing Strategy" icon={FileText}>
        <DefinitionGrid items={[
          ["Título recomendado", display(dossier.listingStrategy.recommendedTitle)],
          ["Categoría", display(dossier.listingStrategy.category)],
          ["Shipping", dossier.listingStrategy.shipping],
          ["Posicionamiento", dossier.listingStrategy.positioning],
        ]} />
        <div className="mt-4 grid gap-4 sm:grid-cols-2"><div className="rounded-2xl bg-emerald-300/[0.045] p-4"><h3 className="text-sm font-semibold text-emerald-100">Claims seguros</h3><p className="mt-2 text-sm leading-6 text-slate-400">{dossier.listingStrategy.safeClaims.join(", ") || "No demostrados"}</p></div>
          <div className="rounded-2xl bg-rose-300/[0.045] p-4"><h3 className="text-sm font-semibold text-rose-100">Claims a evitar</h3><p className="mt-2 text-sm leading-6 text-slate-400">{dossier.listingStrategy.claimsToAvoid.join(", ") || "Ninguno documentado"}</p></div></div>
      </DossierSection>

      <DossierSection id="dossier-visual" title="Visual Strategy" icon={Sparkles}>
        <DefinitionGrid items={[
          ["HERO", dossier.visualStrategy.hero],
          ["Imágenes secundarias", dossier.visualStrategy.secondaryThemes.join(", ") || "Mostrar únicamente atributos confirmados"],
          ["Infografías", dossier.visualStrategy.informationGraphics.join(", ") || "No requeridas por la evidencia actual"],
          ["No mostrar", dossier.visualStrategy.avoid.join(", ") || "Ningún elemento adicional no verificado"],
        ]} />
      </DossierSection>

      <DossierSection id="dossier-risks" title="Risks / Uncertainties" icon={TriangleAlert}>
        <ul className="space-y-3">{dossier.risks.length ? dossier.risks.map((risk, index) => <li key={`${risk}:${index}`} className="flex gap-3 rounded-2xl border border-amber-300/10 bg-amber-300/[0.045] p-4 text-sm leading-6 text-amber-50/80"><TriangleAlert className="mt-1 size-4 shrink-0 text-amber-200" />{risk}</li>) : <li className="text-sm text-slate-500">No hay riesgos documentados.</li>}</ul>
        <div className="mt-5 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5"><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Final Commercial Recommendation</p><p className="mt-2 text-lg font-semibold">RECOMMENDATION: {dossier.decision.label}</p><p className="mt-2 leading-7 text-slate-400">{dossier.recommendation}</p></div>
      </DossierSection>

      <DossierSection id="dossier-technical" title="Technical Evidence" icon={FileText}>
        <TechnicalEvidence view={view} error={error} />
      </DossierSection>
    </article>
  </div>
}

export function CommercialTraceWorkspace({ requestedTraceId, embedded = false }: {
  requestedTraceId: string
  embedded?: boolean
}) {
  const [activeTraceId, setActiveTraceId] = useState(requestedTraceId)
  const [trace, setTrace] = useState<CommercialTraceRecordV1 | null>(null)
  const [events, setEvents] = useState<CommercialTraceEventV1[]>([])
  const [productUrl, setProductUrl] = useState(DEFAULT_PRODUCT_URL)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [newSequences, setNewSequences] = useState<ReadonlySet<number>>(new Set())
  const [activeView, setActiveView] = useState("live")
  const lastSequence = useRef(0)
  const highlightTimer = useRef<number | null>(null)

  const request = useCallback(async (url: string, init?: RequestInit) => {
    const session = await supabase.auth.getSession()
    if (session.error || !session.data.session) throw new Error(
      "ADMIN_SESSION_UNAVAILABLE")
    const response = await fetch(url, { ...init, cache: "no-store",
      headers: { ...init?.headers,
        Authorization: `Bearer ${session.data.session.access_token}` } })
    const payload = await response.json().catch(() => null)
    if (!response.ok || !payload?.success) throw new Error(
      payload?.error ?? "LIVE_COMMERCIAL_TRACE_REQUEST_FAILED")
    return payload
  }, [])

  const load = useCallback(async (traceOverride?: string | null) => {
    try {
      const selectedId = traceOverride === undefined
        ? activeTraceId : traceOverride ?? ""
      const query = selectedId
        ? `?traceId=${encodeURIComponent(selectedId)}` : ""
      const payload = await request(`/api/admin/ebay/commercial-trace${query}`)
      const incomingTrace = (payload.trace ?? null) as CommercialTraceRecordV1 | null
      const incomingEvents = (payload.events ?? []) as CommercialTraceEventV1[]
      const maximum = Math.max(0, ...incomingEvents.map((event) => event.sequence))
      if (lastSequence.current > 0 && maximum > lastSequence.current) {
        setNewSequences(new Set(incomingEvents.filter((event) =>
          event.sequence > lastSequence.current).map((event) => event.sequence)))
        if (highlightTimer.current) window.clearTimeout(highlightTimer.current)
        highlightTimer.current = window.setTimeout(() =>
          setNewSequences(new Set()), 1_800)
      }
      lastSequence.current = maximum
      setTrace(incomingTrace); setEvents(incomingEvents)
      if (incomingTrace?.product_url && !busy) {
        setProductUrl((current) => current || incomingTrace.product_url)
      }
      if (incomingTrace && !busy && !activeTraceId) {
        setActiveTraceId(incomingTrace.trace_id)
      }
      setError("")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message
        : "LIVE_COMMERCIAL_TRACE_READ_FAILED")
    } finally { setLoading(false) }
  }, [activeTraceId, busy, request])

  useEffect(() => {
    setActiveTraceId(requestedTraceId)
    lastSequence.current = 0
  }, [requestedTraceId])

  useEffect(() => {
    void load(busy ? null : undefined)
    const interval = window.setInterval(() => void load(busy ? null : undefined),
      trace?.state === "RUNNING" || busy ? 1_200 : 10_000)
    const reconnect = () => void load(busy ? null : undefined)
    const visible = () => {
      if (document.visibilityState === "visible") reconnect()
    }
    window.addEventListener("online", reconnect)
    window.addEventListener("focus", reconnect)
    document.addEventListener("visibilitychange", visible)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener("online", reconnect)
      window.removeEventListener("focus", reconnect)
      document.removeEventListener("visibilitychange", visible)
    }
  }, [busy, load, trace?.state])

  useEffect(() => () => {
    if (highlightTimer.current) window.clearTimeout(highlightTimer.current)
  }, [])

  async function start() {
    if (!productUrl.trim()) return
    setBusy(true); setError(""); setActiveTraceId("")
    setTrace(null); setEvents([]); lastSequence.current = 0
    try {
      const operation = request("/api/admin/ebay/commercial-trace", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "START", productUrl: productUrl.trim() }),
      })
      window.setTimeout(() => void load(null), 350)
      const payload = await operation
      setActiveTraceId(payload.traceId)
      window.history.replaceState({}, "",
        embedded
          ? `/admin/ebay-seller-os?traceId=${payload.traceId}`
          : `/admin/ebay/commercial-trace?traceId=${payload.traceId}`)
      await load(payload.traceId)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message
        : "LIVE_COMMERCIAL_TRACE_REQUEST_FAILED")
      await load(null)
    } finally { setBusy(false) }
  }

  const view = useMemo(() => buildCommercialTracePresentationV1({ trace,
    events }), [trace, events])
  const friendlyError = error
    ? error === "ADMIN_SESSION_UNAVAILABLE"
      ? "Tu sesión de administración expiró. Vuelve a iniciar sesión para continuar."
      : "No pude actualizar el análisis en este momento. La evidencia durable permanece segura y puedes reintentar."
    : ""
  const completed = trace?.state === "COMPLETED"
  const currentLabel = completed ? "Análisis finalizado" : view.currentStage

  return <section className={cn("bg-[#08111d] text-slate-100",
    embedded ? "rounded-[1.8rem] border border-sky-200/15 p-3 sm:p-5"
      : "min-h-screen px-4 py-5 pb-24 sm:px-7 lg:px-9")}>
    <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden"><div className="absolute -left-40 top-0 size-[34rem] rounded-full bg-sky-500/[0.07] blur-[120px]" /><div className="absolute -right-40 top-1/3 size-[30rem] rounded-full bg-violet-500/[0.055] blur-[130px]" /></div>
    <div className="relative mx-auto max-w-[1480px]">
      {!embedded && <nav className="flex items-center justify-between text-sm text-slate-500">
        <a href="/admin/ebay/quick-pick" className="inline-flex min-h-10 items-center gap-2 font-medium transition-colors hover:text-white"><ArrowLeft className="size-4" />Preparar productos</a>
        <span className="hidden items-center gap-2 text-xs sm:flex"><ShieldCheck className="size-4 text-emerald-300" />Solo análisis · sin escrituras</span>
      </nav>}

      <header className={cn(surface, embedded ? "overflow-hidden p-5 sm:p-6" : "mt-3 overflow-hidden p-5 sm:p-7")}>
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl"><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-sky-200/60"><span className="size-1.5 rounded-full bg-sky-300 shadow-[0_0_10px_rgba(125,211,252,.8)]" />Live Commercial Analysis</div>
            <h1 className={cn("mt-3 font-semibold tracking-[-0.035em] text-white", embedded ? "text-2xl sm:text-3xl" : "text-3xl sm:text-4xl")}>Una evaluación comercial que puedes seguir y auditar.</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">Seller OS identifica el producto, consulta el mercado, explica sus descartes y entrega un expediente listo para decisión del Owner.</p>
          </div>
          <div className="w-full max-w-xl"><label htmlFor="commercial-product-url" className="text-xs font-medium text-slate-400">Producto de Luna</label>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row"><input id="commercial-product-url" value={productUrl} onChange={(event) => setProductUrl(event.target.value)} disabled={busy || trace?.state === "RUNNING"}
              className="min-h-12 min-w-0 flex-1 rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-slate-200 outline-none transition focus:border-sky-300/40 focus:ring-4 focus:ring-sky-300/[0.06] disabled:opacity-50" placeholder="https://lunaportex.com/products/…" />
              <button onClick={() => void start()} disabled={busy || trace?.state === "RUNNING" || !productUrl.trim()}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-sky-100 px-5 text-sm font-bold text-slate-950 shadow-[0_10px_30px_rgba(186,230,253,.12)] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-45">
                {busy || trace?.state === "RUNNING" ? <><LoaderCircle className="size-4 animate-spin" />Analizando</> : <><Search className="size-4" />{trace ? "Nueva evaluación" : "Iniciar análisis"}</>}
              </button></div>
          </div>
        </div>

        <div className="mt-7 grid gap-4 border-t border-white/[0.07] pt-5 lg:grid-cols-[1fr_auto] lg:items-end">
          <div><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs text-slate-500">Etapa actual</p><p className="mt-1 font-semibold text-white">{currentLabel}</p></div><StatusMark status={trace?.state === "RUNNING" || busy ? "RUNNING" : completed ? "PASS" : trace?.state === "FAILED" ? "FAIL" : "PENDING"} /></div>
            <Progress value={view.progress} className="mt-3 h-2 bg-white/[0.06] [&_[data-slot=progress-indicator]]:bg-gradient-to-r [&_[data-slot=progress-indicator]]:from-sky-400 [&_[data-slot=progress-indicator]]:to-cyan-200 [&_[data-slot=progress-indicator]]:duration-700" />
          </div>
          <p className="text-right text-xs tabular-nums text-slate-500">{view.progress}% completado</p>
        </div>
      </header>

      {friendlyError && <div role="alert" className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300/15 bg-amber-300/[0.06] p-4 text-sm text-amber-50/85"><span className="flex items-center gap-2"><TriangleAlert className="size-4" />{friendlyError}</span><button onClick={() => void load()} className="rounded-lg border border-amber-200/20 px-3 py-1.5 font-semibold">Reintentar</button></div>}

      {loading && !trace ? <div className="mt-6"><LoadingWorkspace /></div> : <Tabs value={activeView} onValueChange={setActiveView} className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList className="h-11 rounded-xl border border-white/[0.08] bg-[#111b29]/80 p-1">
            <TabsTrigger value="live" className="rounded-lg px-4 text-slate-400 data-[state=active]:bg-white/[0.08] data-[state=active]:text-white"><Activity className="size-4" />Análisis en vivo</TabsTrigger>
            <TabsTrigger value="dossier" className="rounded-lg px-4 text-slate-400 data-[state=active]:bg-white/[0.08] data-[state=active]:text-white"><FileText className="size-4" />Expediente comercial</TabsTrigger>
          </TabsList>
          {completed && <button onClick={() => {
            setActiveView("dossier")
            window.setTimeout(() => window.print(), 120)
          }} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-white/10 px-3 text-xs font-semibold text-slate-300 transition hover:bg-white/[0.05]"><Printer className="size-4" />Imprimir expediente</button>}
        </div>

        <TabsContent value="live" className="mt-4 space-y-5">
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.28fr)_minmax(20rem,.72fr)]">
            <HumanTimeline view={view} newSequences={newSequences} />
            <div className="space-y-5"><ProductSnapshot view={view} /><EconomicsSnapshot view={view} />
              <section className={cn(surface, "p-5")}><SectionTitle eyebrow="Recomendación" title={view.decision.label} icon={Sparkles} /><p className="mt-4 text-sm leading-6 text-slate-400">{view.decision.explanation}</p>{trace?.product_url && <a href={trace.product_url} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-sky-200 hover:text-white">Ver producto fuente <ExternalLink className="size-3.5" /></a>}</section>
            </div>
          </div>
          <MarketFunnel view={view} />
          <ClaimsPanel view={view} />
          <ComparablesPanel view={view} />
          <TechnicalEvidence view={view} error={error} />
        </TabsContent>

        <TabsContent value="dossier" className="mt-4">
          <CommercialDossier view={view} error={error} />
        </TabsContent>
      </Tabs>}

      <div className="mt-5"><DecisionLoopPanel view={view} /></div>

      <footer className="mt-8 flex flex-col gap-2 border-t border-white/[0.07] py-5 text-xs text-slate-600 sm:flex-row sm:items-center sm:justify-between">
        <span>Actualización automática · replay durable después de refresh · reconexión segura</span>
        <span>0 publicaciones · 0 escrituras eBay · compra deshabilitada · sin direcciones ni credenciales</span>
      </footer>
    </div>
  </section>
}
