"use client"

import { ArrowLeft, CheckCircle2, Clock3, ExternalLink, ImageOff, Link2,
  PackageSearch, RefreshCw, ShieldCheck, Wifi } from "lucide-react"
import Image from "next/image"
import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"

import type { CommercialMonitorGetDto } from
  "@/lib/ebay/commercial-monitor-readonly-contract"
import { supabase } from "@/lib/supabase"

type Json = Record<string, unknown>
type MonitorPayload = { success?: boolean; monitor?: CommercialMonitorGetDto; error?: string }
type ActionPayload = { success?: boolean; result?: Json; error?: string;
  registryBusinessDataMutations?: number }

function object(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {}
}

function shown(value: unknown) {
  return value === null || value === undefined || value === "" ? "Unproven" : String(value)
}

async function authorizedRequest(path: string, init?: RequestInit) {
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session) throw new Error("AUTH_REQUIRED")
  return fetch(path, { cache: "no-store", ...init, headers: {
    Authorization: `Bearer ${data.session.access_token}`,
    ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers } })
}

async function operationalAction(name: string, input: Json) {
  const response = await authorizedRequest("/api/admin/ebay/operational-readiness", {
    method: "POST", body: JSON.stringify({ action: name, input }) })
  const payload = await response.json() as ActionPayload
  if (!response.ok || !payload.success || !payload.result) {
    throw new Error(payload.error ?? "LUNA_ACTIVATION_ACTION_FAILED")
  }
  return payload.result
}

export default function LunaCaptureActivationPage() {
  const [monitor, setMonitor] = useState<CommercialMonitorGetDto | null>(null)
  const [selectedItemId, setSelectedItemId] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [capture, setCapture] = useState<Json | null>(null)
  const [linkPreview, setLinkPreview] = useState<Json | null>(null)
  const [approvedLink, setApprovedLink] = useState<Json | null>(null)
  const [watcher, setWatcher] = useState<Json | null>(null)
  const [form, setForm] = useState({ sourceUrl: "", productId: "", supplierSku: "",
    variantId: "", supplierTitle: "", variantTitle: "", stock: "", price: "",
    currency: "USD", availability: "UNKNOWN", stockEvidence: "",
    observedAt: "" })

  const load = useCallback(async () => {
    setLoading(true); setError("")
    try {
      const response = await authorizedRequest("/api/admin/ebay/monitor")
      const payload = await response.json() as MonitorPayload
      if (!response.ok || !payload.success || !payload.monitor) {
        throw new Error(payload.error ?? "LUNA_ACTIVATION_READ_FAILED")
      }
      setMonitor(payload.monitor)
      setSelectedItemId((current) => current || payload.monitor?.listings.find((listing) =>
        listing.discovery.livePresence.status === "LIVE_ACTIVE")?.identity.itemId || "")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "LUNA_ACTIVATION_READ_FAILED")
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])
  const listings = useMemo(() => (monitor?.listings ?? []).filter((listing) =>
    listing.discovery.livePresence.status === "LIVE_ACTIVE"), [monitor])
  const listing = listings.find((row) => row.identity.itemId === selectedItemId) ?? null

  async function captureEvidence() {
    if (!listing) return
    setLoading(true); setError(""); setCapture(null); setLinkPreview(null)
    try {
      const visibleStock = form.stock.trim() === "" ? null : Number(form.stock)
      const price = form.price.trim() === "" ? null : Number(form.price)
      const observedAt = form.observedAt.trim() || new Date().toISOString()
      const result = await operationalAction("CAPTURE_LUNA", {
        sourceContractVersion: "LUNA_SOURCE_CONTRACT_V1", parserVersion: "HUMAN_REVIEW_CAPTURE_V1",
        sourceUrl: form.sourceUrl, productId: form.productId || null,
        supplierSku: form.supplierSku || null, variantId: form.variantId || null,
        supplierTitle: form.supplierTitle || null, variantTitle: form.variantTitle || null,
        regularPrice: price, salePrice: null, currency: form.currency || null,
        availability: form.availability === "AVAILABLE" ? true
          : form.availability === "UNAVAILABLE" ? false : null,
        visibleStock: Number.isFinite(visibleStock) ? visibleStock : null,
        stockQuantityAuthoritative: Number.isFinite(visibleStock),
        explicitLowStock: /low stock|only\s+\d+\s+left/i.test(form.stockEvidence),
        stockTextEvidence: form.stockEvidence || null, specifications: {},
        packQuantity: null, includedQuantity: null, sourceNarrative: null,
        marketingClaims: [], imageReferences: [], observedAt,
      })
      setCapture(result)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "LUNA_CAPTURE_FAILED")
    } finally { setLoading(false) }
  }

  async function approveDeterministicPreview() {
    if (!listing || !capture) return
    setLoading(true); setError("")
    try {
      const productIdentity = object(capture.productIdentity)
      const result = await operationalAction("LINK_SUPPLIER_IDENTITY", {
        accountKey: monitor?.marketplace.accountAlias ?? "PROTECTED_ACCOUNT",
        ebayItemId: listing.identity.itemId, ebaySku: listing.identity.sku,
        supplierProductId: productIdentity.productId ?? null,
        supplierSku: productIdentity.supplierSku ?? null,
        supplierVariantId: productIdentity.variantId ?? null,
        evidenceType: "EXPLICIT_APPROVED_MAPPING",
        observedAt: capture.observedAt ?? new Date().toISOString(),
        provenance: "HUMAN_APPROVED_LUNA_ACTIVATION_PREVIEW",
      })
      const pricing = object(capture.pricing)
      const exactLink = {
        accountKey: result.accountKey,
        ebayItemId: result.ebayItemId,
        ebaySku: result.ebaySku,
        listingTitle: listing.identity.title,
        supplierProductId: result.supplierProductId,
        supplierVariantId: result.supplierVariantId,
        supplierSku: result.supplierSku,
        canonicalSourceUrl: form.sourceUrl,
        currency: pricing.currency,
        classification: result.classification,
        humanApproved: true,
        approvedAt: result.observedAt,
        approvalProvenance: result.provenance,
      }
      const prepared = await operationalAction("PREPARE_LUNA_WATCHER", { link: exactLink })
      const authenticated = await operationalAction("RUN_LUNA_AUTHENTICATED_CAPTURE", {
        link: exactLink,
        publishedQuantity: listing.identity.listedQuantity,
        commercialExposureScore: listing.identity.listedQuantity
          ? Math.min(100, listing.identity.listedQuantity * 10) : 0,
      })
      setApprovedLink(exactLink)
      setWatcher({ ...authenticated, runtimeScheduledRecaptureObserved: false,
        scheduleActivation: authenticated.scheduleActivation })
      const authenticatedObservation = object(authenticated.observation)
      setLinkPreview({ ...result, activationState:
        authenticatedObservation.sourceStatus === "SESSION_OK"
          ? "READY_PENDING_REGISTRY_PERSISTENCE"
          : "AUTHENTICATED_CAPTURE_NOT_ACTIVATED",
        watcherPreparation: prepared, persistenceAuthorized: false,
        registryBusinessDataMutations: 0 })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "LUNA_LINK_PREVIEW_FAILED")
    } finally { setLoading(false) }
  }

  async function recaptureAuthenticatedHttp() {
    if (!approvedLink || !listing) return
    setLoading(true); setError("")
    try {
      const result = await operationalAction("RUN_LUNA_AUTHENTICATED_CAPTURE", {
        link: approvedLink,
        publishedQuantity: listing.identity.listedQuantity,
        commercialExposureScore: listing.identity.listedQuantity
          ? Math.min(100, listing.identity.listedQuantity * 10) : 0,
      })
      setWatcher({ ...result, runtimeScheduledRecaptureObserved:
        watcher?.runtimeScheduledRecaptureObserved === true })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "LUNA_AUTHENTICATED_RECAPTURE_FAILED")
    } finally { setLoading(false) }
  }

  const productIdentity = object(capture?.productIdentity)
  const pricing = object(capture?.pricing)
  const stock = object(capture?.stock)
  const watcherObservation = object(watcher?.observation)
  const watcherScheduler = object(watcher?.scheduler)
  const watcherSource = object(watcher?.source)
  const watcherCapture = object(watcher?.capture)
  const watcherResponse = object(watcher?.automaticResponse)

  return <main className="min-h-screen bg-[#eef2f6] p-4 text-slate-950 md:p-7">
    <div className="mx-auto max-w-[1450px] space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5">
        <div><Link href="/admin/ebay/operational-readiness" className="inline-flex items-center gap-2 text-xs font-bold text-cyan-700"><ArrowLeft size={14} />Operational Readiness</Link><h1 className="mt-3 text-2xl font-black">Luna Capture Activation</h1><p className="mt-1 text-sm text-slate-500">Exact supplier product and variant evidence for one authoritative live Item ID. No fuzzy linkage.</p></div>
        <span className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1.5 text-xs font-black text-amber-800"><ShieldCheck size={15} />AUTH HTTP READY · LINK PERSISTENCE NOT ACTIVATED</span>
      </header>
      {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">Stopped safely: {error}</div>}
      <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs"><b>Source mode:</b> server-side authenticated Luna HTTP using the existing protected runtime value. Browser automation is not activated; it may be evaluated only after this path is proven insufficient.</div>

      <section className="grid gap-4 xl:grid-cols-[.85fr_1.15fr]">
        <article className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between"><div><p className="text-[10px] font-black uppercase text-cyan-700">1 · Select live listing</p><h2 className="mt-1 font-black">Authoritative eBay identity</h2></div><button type="button" onClick={() => void load()} aria-label="Refresh listings" className="rounded-lg border border-slate-200 p-2"><RefreshCw size={15} /></button></div>
          <select value={selectedItemId} onChange={(event) => { setSelectedItemId(event.target.value); setCapture(null); setLinkPreview(null); setApprovedLink(null); setWatcher(null) }} className="mt-4 w-full rounded-lg border border-slate-200 p-3 text-sm">
            <option value="">Select a live Item ID</option>{listings.map((row) => <option key={row.identity.itemId} value={row.identity.itemId}>{row.identity.itemId} · {row.identity.title ?? "Untitled listing"}</option>)}
          </select>
          {listing && <div className="mt-4 flex gap-3 rounded-xl bg-slate-50 p-4">{listing.identity.primaryImageUrl ? <Image src={listing.identity.primaryImageUrl} alt="" width={72} height={72} unoptimized className="h-[72px] w-[72px] rounded-lg object-cover" /> : <span className="grid h-[72px] w-[72px] place-items-center rounded-lg bg-slate-200 text-slate-400"><ImageOff /></span>}<div className="min-w-0"><p className="truncate font-black">{listing.identity.title ?? "Untitled listing"}</p><p className="mt-1 text-xs text-slate-500">Item ID {listing.identity.itemId}</p><p className="mt-1 text-xs text-slate-500">eBay SKU {shown(listing.identity.sku)}</p></div></div>}
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-[10px] font-black uppercase text-cyan-700">2 · Identify and capture</p><h2 className="mt-1 font-black">Exact Luna product / variant evidence</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-slate-500 sm:col-span-2">Supplier product URL<input value={form.sourceUrl} onChange={(event) => setForm({ ...form, sourceUrl: event.target.value })} placeholder="https://lunaportex.com/products/..." className="mt-1 w-full rounded-lg border border-slate-200 p-2.5 text-sm text-slate-900" /></label>
            <label className="text-xs text-slate-500">Supplier product ID<input value={form.productId} onChange={(event) => setForm({ ...form, productId: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 p-2.5 text-sm" /></label>
            <label className="text-xs text-slate-500">Exact variant ID<input value={form.variantId} onChange={(event) => setForm({ ...form, variantId: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 p-2.5 text-sm" /></label>
            <label className="text-xs text-slate-500">Supplier title<input value={form.supplierTitle} onChange={(event) => setForm({ ...form, supplierTitle: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 p-2.5 text-sm" /></label>
            <label className="text-xs text-slate-500">Variant identity<input value={form.variantTitle} onChange={(event) => setForm({ ...form, variantTitle: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 p-2.5 text-sm" /></label>
            <label className="text-xs text-slate-500">Supplier SKU<input value={form.supplierSku} onChange={(event) => setForm({ ...form, supplierSku: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 p-2.5 text-sm" /></label>
            <label className="text-xs text-slate-500">Availability<select value={form.availability} onChange={(event) => setForm({ ...form, availability: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 p-2.5 text-sm"><option value="UNKNOWN">Unknown</option><option value="AVAILABLE">Available</option><option value="UNAVAILABLE">Unavailable</option></select></label>
            <label className="text-xs text-slate-500">Authoritative stock<input inputMode="numeric" value={form.stock} onChange={(event) => setForm({ ...form, stock: event.target.value })} placeholder="Leave blank if unknown" className="mt-1 w-full rounded-lg border border-slate-200 p-2.5 text-sm" /></label>
            <label className="text-xs text-slate-500">Price<input inputMode="decimal" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} placeholder="Unproven if blank" className="mt-1 w-full rounded-lg border border-slate-200 p-2.5 text-sm" /></label>
            <label className="text-xs text-slate-500">Currency<input value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase().slice(0, 3) })} className="mt-1 w-full rounded-lg border border-slate-200 p-2.5 text-sm" /></label>
            <label className="text-xs text-slate-500 sm:col-span-2">Observed stock text<input value={form.stockEvidence} onChange={(event) => setForm({ ...form, stockEvidence: event.target.value })} placeholder="Exact observed evidence; no marketing inference" className="mt-1 w-full rounded-lg border border-slate-200 p-2.5 text-sm" /></label>
          </div>
          <button type="button" disabled={loading || !listing || !form.sourceUrl || !form.productId || !form.variantId || !form.supplierSku || !form.supplierTitle} onClick={() => void captureEvidence()} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2.5 text-xs font-black text-white disabled:opacity-40"><PackageSearch size={15} />Capture and review evidence</button>
        </article>
      </section>

      {capture && <section className="rounded-2xl border border-cyan-200 bg-white p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-black uppercase text-cyan-700">3 · Review evidence</p><h2 className="mt-1 font-black">Product, variant, SKU, stock, price and freshness</h2></div><span className="rounded-full bg-cyan-50 px-3 py-1 text-xs font-black text-cyan-800">{shown(capture.sourceHealth)}</span></div><dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4"><div><dt className="text-slate-500">Supplier source</dt><dd className="font-black">LUNA PORTEX</dd></div><div><dt className="text-slate-500">Product identity</dt><dd className="font-black">{shown(productIdentity.productId)}</dd></div><div><dt className="text-slate-500">Variant identity</dt><dd className="font-black">{shown(productIdentity.variantId)}</dd></div><div><dt className="text-slate-500">Supplier SKU</dt><dd className="font-black">{shown(productIdentity.supplierSku)}</dd></div><div><dt className="text-slate-500">Stock state</dt><dd className="font-black">{shown(stock.state)}</dd></div><div><dt className="text-slate-500">Stock</dt><dd className="font-black">{shown(stock.visibleStock)}</dd></div><div><dt className="text-slate-500">Price</dt><dd className="font-black">{shown(pricing.regularPrice)} {shown(pricing.currency)}</dd></div><div><dt className="text-slate-500">Observed at</dt><dd className="font-black">{shown(capture.observedAt)}</dd></div></dl><p className="mt-3 inline-flex items-center gap-2 text-xs text-slate-500"><ExternalLink size={13} />The exact canonical product URL may cross the protected identity boundary; the cookie, raw response, and page content never do.</p><button type="button" disabled={loading} onClick={() => void approveDeterministicPreview()} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-black text-white disabled:opacity-40"><Link2 size={15} />Approve deterministic Item-ID link preview</button></section>}

      {linkPreview && <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5"><div className="flex gap-3"><CheckCircle2 className="shrink-0 text-emerald-700" /><div><p className="text-xs font-black text-emerald-800">{shown(linkPreview.classification)} · {shown(linkPreview.activationState)}</p><h2 className="mt-1 font-black">First deterministic mapping is review-complete</h2><p className="mt-2 text-sm text-emerald-950">The exact link was used for an immediate authenticated capture. Durable automatic server scheduling remains pending because this task does not authorize Registry business-data persistence.</p><p className="mt-2 text-xs font-bold">0 Registry writes · 0 Inventory writes · 0 eBay writes</p></div></div></section>}

      {watcher && <section className="rounded-2xl border border-violet-200 bg-white p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-black uppercase text-violet-700">4 · Authenticated stock watcher</p><h2 className="mt-1 font-black">Sanitized Luna recapture evidence</h2><p className="mt-1 text-xs text-slate-500">No raw session value, raw response, screenshot, or page content crossed this boundary.</p></div><span className={`rounded-full px-3 py-1 text-xs font-black ${watcherObservation.sourceStatus === "SESSION_OK" ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>{shown(watcherObservation.sourceStatus)}</span></div>
        <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-slate-500">Source mode</dt><dd className="font-black">{shown(watcherSource.actualMode)}</dd></div>
          <div><dt className="text-slate-500">Stock state</dt><dd className="font-black">{shown(watcherObservation.stockState)}</dd></div>
          <div><dt className="text-slate-500">Quantity</dt><dd className="font-black">{watcherObservation.quantityExplicit === true ? shown(watcherObservation.quantity) : "Not explicitly exposed"}</dd></div>
          <div><dt className="text-slate-500">Price</dt><dd className="font-black">Regular {shown(watcherObservation.regularPrice)} · Sale {shown(watcherObservation.salePrice)} · {shown(watcherObservation.currency)}</dd></div>
          <div><dt className="text-slate-500">Last observed</dt><dd className="font-black">{shown(watcherScheduler.lastObservedAt)}</dd></div>
          <div><dt className="text-slate-500">Next check</dt><dd className="font-black">{shown(watcherScheduler.nextCheckAt)}</dd></div>
          <div><dt className="text-slate-500">Freshness</dt><dd className="font-black">{shown(watcherObservation.freshness)} · {shown(watcherObservation.ageSeconds)} sec</dd></div>
          <div><dt className="text-slate-500">Scheduler priority</dt><dd className="font-black">{shown(watcherScheduler.priority)} · {shown(watcherScheduler.reason)}</dd></div>
          <div><dt className="text-slate-500">Parser</dt><dd className="font-black">{shown(watcherObservation.parserVersion)}</dd></div>
          <div className="lg:col-span-2"><dt className="text-slate-500">Evidence fingerprint</dt><dd className="break-all font-mono text-[10px] font-bold">{shown(watcherObservation.evidenceFingerprint)}</dd></div>
          <div><dt className="text-slate-500">Scheduled runtime observed</dt><dd className="font-black">{watcher.runtimeScheduledRecaptureObserved === true ? "YES" : "NO · PENDING"}</dd></div>
        </dl>
        <div className="mt-4 grid gap-3 md:grid-cols-2"><div className="rounded-xl bg-slate-50 p-3 text-xs"><p className="font-black">Confirmation policy</p><p className="mt-1 text-slate-600">{shown(watcherObservation.confirmationPolicy)}</p><p className="mt-2 text-slate-600">Auth failure, timeout, missing selector, source change, stale evidence, and unknown never become out of stock or low stock.</p></div><div className="rounded-xl bg-slate-50 p-3 text-xs"><p className="font-black">Automatic response</p><p className="mt-1 text-slate-600">{shown(watcherResponse.responseState)} · WhatsApp send attempted: {shown(watcherResponse.whatsappSendAttempted)}</p><p className="mt-2 text-slate-600">Schedule activation: {shown(watcher.scheduleActivation)}</p></div></div>
        <button type="button" disabled={loading || !approvedLink} onClick={() => void recaptureAuthenticatedHttp()} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-violet-700 px-4 py-2.5 text-xs font-black text-white disabled:opacity-40"><Wifi size={15} />Run protected authenticated recapture</button>
        {watcher.browserFallbackRecommended === true && <p className="mt-3 flex items-center gap-2 rounded-lg bg-amber-50 p-3 text-xs font-bold text-amber-900"><Clock3 size={15} />Server HTTP could not prove the exact rendered structure. The isolated persistent-profile watcher is now an eligible fallback; it will not bypass login, MFA, or CAPTCHA.</p>}
        {Object.keys(object(watcherCapture.serverAttestation)).length > 0 && <p className="mt-3 text-[10px] text-slate-500">Server-only attestation present · protected session value present: {shown(object(watcherCapture.serverAttestation).protectedSessionValuePresent)} · raw response exported: {shown(object(watcherCapture.serverAttestation).rawResponseExported)}</p>}
      </section>}

      <p className="rounded-xl bg-slate-900 p-3 text-xs text-white">Golden path: select listing → exact product → exact variant/SKU → human approval → server-side authenticated capture → Stock Guard evidence. Fuzzy linkage, credential export, and external writes remain disabled.</p>
    </div>
  </main>
}
