"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import { supabase } from "@/lib/supabase"
import { SellerOsMobileNav } from "../../components/seller-os-mobile-nav"

type SafeDefaults = {
  categoryId?: string
  conditionId?: string
  fulfillmentPolicyId?: string
  paymentPolicyId?: string
  returnPolicyId?: string
}

type Registration = {
  id: string
  ebay_item_id: string
  ebay_url: string
  opportunity_id: string
  candidate_key: string
  supplier_variant_id: string | null
  supplier_sku: string | null
  verification_status: "verified" | "pending_manual_verification"
  verification_method: string
  verification_reason: string
  connector_listing_status: string | null
  connector_ebay_sku: string | null
  safe_defaults: SafeDefaults
  verified_at: string | null
  last_verification_at: string
  updated_at: string
}

type ListingTemplate = {
  id: string
  template_key: string
  fulfillment_policy_id: string | null
  payment_policy_id: string | null
  return_policy_id: string | null
  condition_id: string | null
  category_id: string | null
  verified_source_at: string
  updated_at: string
}

type ApiPayload = {
  success?: boolean
  error?: string
  registrations?: Registration[]
  templates?: ListingTemplate[]
  registration?: Registration
  verification?: {
    status?: "verified" | "pending_manual_verification"
    reason?: string
  }
  templateActivated?: boolean
  configuration?: {
    accountKey?: string | null
    accountAlias?: string | null
    accountScopeConfigured?: boolean
    accountScopeReason?: string | null
    readonlyConnectorConfigured?: boolean
  }
}

type FormState = {
  ebayItemId: string
  ebayUrl: string
  opportunityId: string
  candidateKey: string
  supplierSku: string
  supplierVariantId: string
}

const emptyForm: FormState = {
  ebayItemId: "",
  ebayUrl: "",
  opportunityId: "",
  candidateKey: "",
  supplierSku: "",
  supplierVariantId: "",
}

function dateTime(value: string | null) {
  if (!value) return "Pendiente"
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime())
    ? new Intl.DateTimeFormat("es", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(parsed)
    : value
}

function reasonLabel(reason: string) {
  const labels: Record<string, string> = {
    OWNERSHIP_CONFIRMED_TRADING_READONLY:
      "Propiedad confirmada para este Item ID mediante GetItem y la identidad autenticada de la cuenta oficial.",
    OWNERSHIP_AND_PRODUCT_IDENTITY_CONFIRMED_TRADING_READONLY:
      "Cuenta, Item ID y Custom label/SKU del producto confirmados mediante la lectura oficial de eBay.",
    OWNERSHIP_CONFIRMED_READONLY:
      "Propiedad confirmada en la cuenta oficial mediante acceso de solo lectura.",
    EBAY_READONLY_CONNECTOR_NOT_CONFIGURED:
      "El conector oficial todavía no está configurado; el vínculo quedó guardado, pero no verificado.",
    EBAY_OFFICIAL_ACCOUNT_IDENTITY_NOT_BOUND:
      "Falta vincular la identidad esperada de la cuenta oficial; el sistema no acepta el token por sí solo como prueba.",
    EBAY_AUTHENTICATED_ACCOUNT_IDENTITY_MISMATCH:
      "El token OAuth pertenece a una cuenta distinta de la identidad oficial configurada.",
    EBAY_READONLY_VERIFICATION_UNAVAILABLE:
      "eBay no respondió o rechazó la consulta de solo lectura. Vuelve a verificar.",
    EBAY_ITEM_NOT_CONFIRMED_IN_OFFICIAL_ACCOUNT:
      "El Item ID todavía no aparece en el inventario oficial de esta cuenta.",
    EBAY_ITEM_SELLER_DOES_NOT_MATCH_OFFICIAL_ACCOUNT:
      "El vendedor del Item ID no coincide con la cuenta oficial autenticada.",
    EBAY_ITEM_NOT_ACTIVE_IN_OFFICIAL_ACCOUNT:
      "El Item ID pertenece a la cuenta, pero no está activo; no se habilitó la plantilla.",
    EBAY_CANONICAL_LISTING_PACKAGE_REQUIRED:
      "Falta el paquete canónico de este producto. Regresa al Workspace y prepáralo antes de vincular el Item ID.",
    EBAY_ITEM_CUSTOM_LABEL_REQUIRED:
      "El listing no tiene Custom label/SKU. Agrégale exactamente el SKU reservado que muestra el Workspace y vuelve a verificar.",
    EBAY_ITEM_CUSTOM_LABEL_MISMATCH:
      "El Custom label/SKU observado no corresponde al paquete de este producto Luna. No se activó aprendizaje.",
    EBAY_VERIFICATION_EVIDENCE_NOT_PERSISTED:
      "eBay confirmó la propiedad, pero no se pudo guardar la evidencia; el estado permanece pendiente.",
  }
  return labels[reason] ?? reason
}

function errorLabel(code: string) {
  const labels: Record<string, string> = {
    admin_token_required: "Inicia sesión nuevamente como administrador.",
    admin_unauthorized: "La sesión administrativa expiró.",
    admin_forbidden: "Esta cuenta no tiene permisos de administrador.",
    MANUAL_LISTING_ITEM_ID_INVALID:
      "El Item ID debe contener solamente entre 9 y 20 dígitos.",
    MANUAL_LISTING_URL_INVALID:
      "Usa una URL HTTPS oficial de ebay.com.",
    MANUAL_LISTING_URL_ITEM_MISMATCH:
      "La URL no corresponde al Item ID indicado.",
    MANUAL_LISTING_CANDIDATE_REQUIRED:
      "Indica el Opportunity ID o el Candidate Key del producto Luna.",
    MANUAL_LISTING_OPPORTUNITY_ID_INVALID:
      "El Opportunity ID no tiene formato UUID válido.",
    MANUAL_LISTING_OPPORTUNITY_NOT_FOUND:
      "No se encontró esa oportunidad en la cola Luna.",
    MANUAL_LISTING_CANDIDATE_ALREADY_LINKED:
      "Ese candidato ya está vinculado a otro Item ID.",
    MANUAL_LISTING_ITEM_ALREADY_LINKED:
      "Ese Item ID ya está vinculado a otro candidato.",
    MANUAL_LISTING_CANDIDATE_MISMATCH:
      "El Candidate Key y el Opportunity ID no corresponden al mismo producto.",
    MANUAL_LISTING_SUPPLIER_SKU_MISMATCH:
      "El SKU no coincide con la oportunidad Luna almacenada.",
    MANUAL_LISTING_SUPPLIER_VARIANT_MISMATCH:
      "La variante no coincide con la oportunidad Luna almacenada.",
    MANUAL_LISTING_UNSAFE_DEFAULT_FIELD:
      "La plantilla contiene un campo no permitido.",
    MANUAL_LISTING_LINKS_READ_FAILED:
      "La migración de registro manual aún no está aplicada o Supabase no respondió.",
    MANUAL_LISTING_TEMPLATES_READ_FAILED:
      "No se pudieron cargar las plantillas reutilizables.",
    MANUAL_LISTING_REGISTRATION_WRITE_FAILED:
      "No se pudo guardar el vínculo. Confirma que la migración esté aplicada.",
    MANUAL_LISTING_ACCOUNT_KEY_REQUIRED:
      "Falta configurar EBAY_SELLER_ACCOUNT_KEY para aislar los datos de la cuenta oficial.",
    MANUAL_LISTING_ACCOUNT_KEY_INVALID:
      "EBAY_SELLER_ACCOUNT_KEY no tiene un formato válido para aislar esta cuenta.",
    MANUAL_LISTING_ACCOUNT_SCOPE_INVALID:
      "La identidad configurada no permite construir un alcance seguro para esta cuenta Seller.",
    MANUAL_LISTING_HUMAN_ADMIN_REQUIRED:
      "Esta vinculación manual requiere una sesión humana de administrador.",
    MANUAL_LISTING_OFFICIAL_ACCOUNT_IDENTITY_REQUIRED:
      "Falta configurar la identidad o fingerprint de la cuenta oficial de eBay.",
    MANUAL_LISTING_OFFICIAL_ACCOUNT_IDENTITY_INCONSISTENT:
      "El User ID esperado y el fingerprint configurado no corresponden a la misma cuenta.",
  }
  return labels[code] ?? "No se pudo completar la operación. Intenta nuevamente."
}

function templateFacts(template: ListingTemplate) {
  return [
    ["Categoría", template.category_id],
    ["Condición", template.condition_id],
    ["Envío", template.fulfillment_policy_id],
    ["Pago", template.payment_policy_id],
    ["Devolución", template.return_policy_id],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]))
}

export default function RegisterManualEbayListingPage() {
  const [form, setForm] = useState<FormState>(emptyForm)
  const [registrations, setRegistrations] = useState<Registration[]>([])
  const [templates, setTemplates] = useState<ListingTemplate[]>([])
  const [accountKey, setAccountKey] = useState("Sin configurar")
  const [accountScopeConfigured, setAccountScopeConfigured] = useState<boolean | null>(null)
  const [accountScopeReason, setAccountScopeReason] = useState<string | null>(null)
  const [expectedSellerSku, setExpectedSellerSku] = useState("")
  const [connectorConfigured, setConnectorConfigured] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")

  const verifiedCount = useMemo(
    () => registrations.filter((row) => row.verification_status === "verified").length,
    [registrations],
  )
  const hasProductContext = Boolean(form.opportunityId || form.candidateKey)

  const apiRequest = useCallback(async (
    method: "GET" | "POST",
    body?: Record<string, unknown>,
  ) => {
    const { data, error: sessionError } = await supabase.auth.getSession()
    if (sessionError || !data.session) throw new Error("admin_token_required")
    const response = await fetch("/api/admin/ebay/listings/register", {
      method,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const payload = await response.json() as ApiPayload
    if (!response.ok || !payload.success) {
      throw new Error(payload.error || "MANUAL_LISTING_REQUEST_FAILED")
    }
    return payload
  }, [])

  const loadRegistrations = useCallback(async () => {
    setError("")
    try {
      const payload = await apiRequest("GET")
      setRegistrations(payload.registrations ?? [])
      setTemplates(payload.templates ?? [])
      setAccountKey(
        payload.configuration?.accountAlias ??
        payload.configuration?.accountKey ??
        "Sin configurar",
      )
      setConnectorConfigured(
        Boolean(payload.configuration?.readonlyConnectorConfigured),
      )
      setAccountScopeConfigured(
        Boolean(payload.configuration?.accountScopeConfigured),
      )
      setAccountScopeReason(payload.configuration?.accountScopeReason ?? null)
    } catch (requestError) {
      const code = requestError instanceof Error ? requestError.message : ""
      setError(errorLabel(code))
    } finally {
      setLoading(false)
    }
  }, [apiRequest])

  useEffect(() => {
    const search = new URLSearchParams(window.location.search)
    setForm((current) => ({
      ...current,
      opportunityId: search.get("opportunityId") ?? current.opportunityId,
      candidateKey: search.get("candidateKey") ?? current.candidateKey,
      supplierSku: search.get("supplierSku") ?? current.supplierSku,
      supplierVariantId:
        search.get("supplierVariantId") ?? current.supplierVariantId,
    }))
    setExpectedSellerSku(search.get("expectedSku") ?? "")
    void loadRegistrations()
  }, [loadRegistrations])

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  async function register(payloadForm: FormState) {
    if (saving) return
    setSaving(true)
    setError("")
    setMessage("")
    try {
      const payload = await apiRequest("POST", {
        ebayItemId: payloadForm.ebayItemId,
        ebayUrl: payloadForm.ebayUrl,
        opportunityId: payloadForm.opportunityId,
        candidateKey: payloadForm.candidateKey,
        supplierSku: payloadForm.supplierSku,
        supplierVariantId: payloadForm.supplierVariantId,
        safeDefaults: {},
      })
      const verified = payload.verification?.status === "verified"
      setMessage(
        verified
          ? payload.templateActivated
            ? "Listing verificado y plantilla segura activada para los próximos drafts."
            : "Listing verificado. eBay no devolvió campos operativos reutilizables para crear una plantilla."
          : "Vínculo guardado como pendiente. No se activó ninguna automatización hasta verificar la propiedad.",
      )
      await loadRegistrations()
    } catch (requestError) {
      const code = requestError instanceof Error ? requestError.message : ""
      setError(errorLabel(code))
    } finally {
      setSaving(false)
    }
  }

  function formFromRegistration(row: Registration): FormState {
    return {
      ...emptyForm,
      ebayItemId: row.ebay_item_id,
      ebayUrl: row.ebay_url,
      opportunityId: row.opportunity_id,
      candidateKey: row.candidate_key,
      supplierSku: row.supplier_sku ?? "",
      supplierVariantId: row.supplier_variant_id ?? "",
    }
  }

  async function retryVerification(row: Registration) {
    const retryForm = formFromRegistration(row)
    setForm(retryForm)
    await register(retryForm)
  }

  return (
    <main className="min-h-screen bg-[#05070d] px-4 pb-28 pt-7 text-white sm:px-6 md:px-10">
      <section className="mx-auto flex max-w-6xl flex-col gap-6">
        <nav className="flex flex-wrap gap-3 text-xs font-black uppercase tracking-[0.18em]">
          <a className="rounded-full border border-white/10 px-4 py-2 text-white/65" href="/admin/ebay-seller-os">
            Seller OS
          </a>
          <a className="rounded-full border border-white/10 px-4 py-2 text-white/65" href="/admin/ebay/mobile-review">
            Oportunidades
          </a>
          <a className="rounded-full border border-white/10 px-4 py-2 text-white/65" href="/admin">
            Admin
          </a>
        </nav>

        <header className="rounded-[32px] border border-emerald-300/20 bg-gradient-to-br from-emerald-300/[0.12] via-white/[0.04] to-cyan-300/[0.08] p-6 md:p-9">
          <p className="text-xs font-black uppercase tracking-[0.28em] text-emerald-100/70">
            Primer listing · aprendizaje seguro
          </p>
          <h1 className="mt-4 max-w-4xl text-4xl font-black tracking-tight md:text-6xl">
            Vincular listing manual
          </h1>
          <p className="mt-5 max-w-3xl text-sm leading-7 text-white/65 md:text-base">
            Registra el Item ID publicado en Seller Hub. El sistema confirma que
            pertenece a la cuenta oficial y aprende únicamente configuraciones
            operativas reutilizables para preparar los siguientes drafts. Cuando
            eBay las devuelve, categoría, condición y políticas se capturan sin
            que tengas que volver a copiarlas.
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-xs text-white/45">Cuenta</p>
              <p className="mt-1 break-all font-black">{accountKey}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-xs text-white/45">Conector read-only</p>
              <p className={`mt-1 font-black ${connectorConfigured ? "text-emerald-200" : "text-amber-200"}`}>
                {connectorConfigured ? "Configurado" : "Pendiente"}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-xs text-white/45">Vínculos verificados</p>
              <p className="mt-1 font-black">{verifiedCount}</p>
            </div>
          </div>
        </header>

        {accountScopeConfigured === false && <section role="alert" className="rounded-3xl border border-rose-200/30 bg-rose-200/[0.08] p-5 text-sm leading-6 text-rose-50">
          <p className="font-black">Configura la identidad de la cuenta antes de registrar</p>
          <p className="mt-2">El OS bloqueó el registro para evitar mezclar listings, plantillas o aprendizaje entre cuentas Seller. Configura el alias y el fingerprint/User ID oficial en el servidor y vuelve a pulsar Actualizar.</p>
          {accountScopeReason && <p className="mt-2 text-xs text-rose-100/70">Motivo de configuración: {errorLabel(`MANUAL_LISTING_${accountScopeReason}`)}</p>}
        </section>}

        <section className="rounded-3xl border border-amber-200/20 bg-amber-200/[0.07] p-5 text-sm leading-6 text-amber-50/80">
          <p className="font-black text-amber-100">Qué aprende el OS</p>
          <p className="mt-2">
            Los IDs de categoría, condición y políticas propias que eBay
            devuelve oficialmente. Nunca copia título, descripción, imágenes,
            marca, claims ni valores de aspectos, y tampoco convierte entradas
            manuales del navegador en defaults confiables.
          </p>
        </section>

        {hasProductContext ? <form
          className="grid gap-6"
          onSubmit={(event) => {
            event.preventDefault()
            void register(form)
          }}
        >
          <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 md:p-7">
            <div className="mb-5">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-100/60">Paso 1</p>
              <h2 className="mt-2 text-2xl font-black">Identidad del listing</h2>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="eBay Item ID" required hint="Sólo dígitos; aparece al publicar.">
                <input
                  inputMode="numeric"
                  pattern="[0-9]{9,20}"
                  required
                  value={form.ebayItemId}
                  onChange={(event) => update("ebayItemId", event.target.value.replace(/\D/g, ""))}
                  className={inputClass}
                  placeholder="123456789012"
                />
              </Field>
              <Field label="URL pública de eBay" hint="Opcional; debe corresponder al mismo Item ID.">
                <input
                  type="url"
                  value={form.ebayUrl}
                  onChange={(event) => update("ebayUrl", event.target.value)}
                  className={inputClass}
                  placeholder="https://www.ebay.com/itm/123456789012"
                />
              </Field>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-xs leading-5 text-white/60 md:col-span-2">
                <p className="font-black text-white">Producto seleccionado desde Workspace</p>
                <p className="mt-2 break-all">Candidate: {form.candidateKey || "vinculado por Opportunity ID"}</p>
                <p className="break-all">SKU Luna: {form.supplierSku || "según oportunidad canónica"}</p>
                <p className="break-all">Variante: {form.supplierVariantId || "variante general canónica"}</p>
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 md:p-7">
            <div className="mb-5">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-100/60">Paso 2</p>
              <h2 className="mt-2 text-2xl font-black">Verificación exacta del producto</h2>
              <p className="mt-2 text-sm leading-6 text-white/50">
                El listing debe llevar en Seller Hub el mismo valor que reservó
                el Workspace en el campo <strong>Custom label (SKU)</strong>. El
                servidor lo compara con la lectura oficial de eBay; no confía en
                un SKU escrito en este formulario.
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-emerald-200/25 bg-emerald-200/[0.06] p-4">
                <p className="text-xs font-black uppercase tracking-wider text-emerald-100/60">Custom label esperado</p>
                <p className="mt-2 break-all font-mono text-sm font-black text-emerald-50">
                  {expectedSellerSku || "Abre esta pantalla desde el Workspace del producto"}
                </p>
              </div>
              <div className="rounded-2xl border border-cyan-200/20 bg-cyan-200/[0.05] p-4 text-xs leading-5 text-cyan-50/75">
                Categoría, condición y políticas sólo se automatizan cuando el
                conector las observa en tu listing verificado. Los valores
                escritos manualmente en el navegador nunca se promueven a una
                plantilla global.
              </div>
            </div>
          </section>

          {error ? <p role="alert" className="rounded-2xl border border-rose-300/25 bg-rose-300/[0.08] p-4 text-sm font-bold text-rose-100">{error}</p> : null}
          {message ? <p role="status" className="rounded-2xl border border-emerald-300/25 bg-emerald-300/[0.08] p-4 text-sm font-bold text-emerald-100">{message}</p> : null}

          <button
            type="submit"
            disabled={saving || loading || accountScopeConfigured !== true}
            className="min-h-14 rounded-2xl bg-emerald-300 px-6 font-black text-[#052015] transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving
              ? "Verificando y guardando…"
              : accountScopeConfigured !== true
                ? "Configura la cuenta oficial para continuar"
                : "Vincular y verificar en eBay"}
          </button>
        </form> : <section className="rounded-3xl border border-cyan-200/25 bg-cyan-200/[0.06] p-6 text-center">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-100/60">Falta seleccionar el producto</p>
          <h2 className="mt-2 text-2xl font-black">Abre el listing desde su Workspace</h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-white/60">Así el OS completa Opportunity, candidato, variante y SKU reservado sin pedirte IDs técnicos ni confiar en datos copiados a mano.</p>
          <a href="/admin/ebay/mobile-review?section=in-progress" className="mt-5 inline-flex min-h-12 items-center justify-center rounded-2xl bg-cyan-200 px-5 font-black text-black">Elegir producto en curso</a>
        </section>}

        <section className="rounded-3xl border border-white/10 bg-white/[0.035] p-5 md:p-7">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-white/40">Control</p>
              <h2 className="mt-2 text-2xl font-black">Listings vinculados</h2>
            </div>
            <button type="button" onClick={() => void loadRegistrations()} className="rounded-full border border-white/10 px-4 py-2 text-xs font-black text-white/65">
              Actualizar
            </button>
          </div>
          {loading ? <p className="mt-6 text-sm text-white/50">Cargando vínculos…</p> : null}
          {!loading && !registrations.length ? <p className="mt-6 rounded-2xl border border-dashed border-white/10 p-5 text-sm text-white/45">Todavía no hay listings manuales vinculados.</p> : null}
          <div className="mt-5 grid gap-4">
            {registrations.map((row) => {
              const verified = row.verification_status === "verified"
              return (
                <article key={row.id} className="rounded-2xl border border-white/10 bg-black/25 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <span className={`inline-flex rounded-full px-3 py-1 text-xs font-black ${verified ? "bg-emerald-300/15 text-emerald-200" : "bg-amber-300/15 text-amber-100"}`}>
                        {verified ? "Verificado" : "Pendiente de verificación oficial"}
                      </span>
                      <a href={row.ebay_url} target="_blank" rel="noreferrer" className="mt-3 block text-lg font-black text-cyan-100 hover:underline">
                        Item {row.ebay_item_id}
                      </a>
                      <p className="mt-1 break-all text-xs text-white/45">{row.candidate_key}</p>
                    </div>
                    <button
                      type="button"
                      disabled={saving || accountScopeConfigured !== true}
                      onClick={() => void retryVerification(row)}
                      className="rounded-xl border border-white/10 px-4 py-2 text-xs font-black text-white/70 disabled:opacity-40"
                    >
                      Volver a verificar
                    </button>
                  </div>
                  <p className="mt-4 text-sm leading-6 text-white/65">{reasonLabel(row.verification_reason)}</p>
                  <div className="mt-4 grid gap-2 text-xs text-white/45 sm:grid-cols-3">
                    <p>SKU: <span className="text-white/75">{row.supplier_sku || "No informado"}</span></p>
                    <p>Estado eBay: <span className="text-white/75">{row.connector_listing_status || "No confirmado"}</span></p>
                    <p>Última comprobación: <span className="text-white/75">{dateTime(row.last_verification_at)}</span></p>
                  </div>
                </article>
              )
            })}
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/[0.035] p-5 md:p-7">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-white/40">Automatización</p>
          <h2 className="mt-2 text-2xl font-black">Plantillas verificadas</h2>
          <p className="mt-2 text-sm leading-6 text-white/50">
            Estos defaults pueden precargar los próximos drafts; cada producto aún
            requiere sus propios datos, imágenes autorizadas y revisión humana.
          </p>
          {!templates.length ? <p className="mt-5 rounded-2xl border border-dashed border-white/10 p-5 text-sm text-white/45">No hay plantillas activas hasta verificar un listing con defaults.</p> : null}
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {templates.map((template) => (
              <article key={template.id} className="rounded-2xl border border-emerald-300/15 bg-emerald-300/[0.05] p-5">
                <p className="break-all text-sm font-black text-emerald-100">{template.template_key}</p>
                <dl className="mt-4 grid gap-2 text-xs">
                  {templateFacts(template).map(([label, value]) => (
                    <div key={label} className="flex justify-between gap-4 border-b border-white/[0.06] pb-2">
                      <dt className="text-white/45">{label}</dt>
                      <dd className="break-all text-right font-bold text-white/75">{value}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-4 text-xs text-white/40">Fuente verificada: {dateTime(template.verified_source_at)}</p>
              </article>
            ))}
          </div>
        </section>
      </section>
      <SellerOsMobileNav active="operation" />
    </main>
  )
}

const inputClass =
  "min-h-12 w-full rounded-2xl border border-white/10 bg-white/[0.06] px-4 text-sm text-white outline-none placeholder:text-white/25 focus:border-cyan-200/45"

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string
  hint?: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <label className="grid gap-2 text-sm font-bold text-white/75">
      <span>{label}{required ? " *" : ""}</span>
      {children}
      {hint ? <span className="text-xs font-normal leading-5 text-white/35">{hint}</span> : null}
    </label>
  )
}
