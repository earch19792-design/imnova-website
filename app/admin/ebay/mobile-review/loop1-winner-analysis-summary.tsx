"use client"

import type { EbaySellerKeywordDemandReport } from "@/lib/ebay/ebay-seller-keyword-demand-validation"
import type { SanitizedWinnerEvidenceDecisionPackage } from "@/lib/ebay/ebay-winner-evidence-v2-service"
import { getLoop1DecisionExplanation } from "@/lib/ebay/ebay-loop1-winner-analysis-ux"

type Props = {
  decisionPackage: SanitizedWinnerEvidenceDecisionPackage | null
  keywordReport: EbaySellerKeywordDemandReport | null
  saveState: "IDLE" | "SAVING" | "SAVED" | "READING" | "VERIFIED" | "ERROR"
  saveError: string
  packageStored: boolean
  readbackVerified: boolean
  saveDisabledReason: string | null
  onSave: () => void
  onRead: () => void
}

const label = (value: string) => value.replaceAll("_", " ")
const money = (value: number | null | undefined) => value == null ? "N/D" : `$${value.toFixed(2)}`
const percent = (value: number | null | undefined) => value == null ? "N/D" : `${value.toFixed(1)}%`

function Cohort({
  title,
  rows,
}: {
  title: string
  rows: SanitizedWinnerEvidenceDecisionPackage["comparables"]["classified"]
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-black/20 p-3">
      <h4 className="text-sm font-black">{title} · {rows.length}</h4>
      {rows.length ? (
        <ul className="mt-2 grid gap-2 text-xs">
          {rows.map((row) => (
            <li key={row.comparableKey} className="rounded-xl bg-white/[0.04] p-2">
              <strong>{label(row.classification)}</strong>
              <span className="mt-1 block text-white/65">
                {label(row.source)} · precio total {money(row.pricing.landedPrice)}
              </span>
              <span className="mt-1 block text-white/45">
                {row.classificationReasons.map(label).join(" · ") || "Sin explicación adicional"}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-white/55">N/D · no existe evidencia exacta utilizable en esta cohorte.</p>
      )}
    </section>
  )
}

export function Loop1WinnerAnalysisSummary({
  decisionPackage,
  keywordReport,
  saveState,
  saveError,
  packageStored,
  readbackVerified,
  saveDisabledReason,
  onSave,
  onRead,
}: Props) {
  if (!decisionPackage) {
    return (
      <section className="rounded-3xl border border-white/15 bg-white/[0.035] p-4">
        <h3 className="font-black">Resultado y paquete de decisión</h3>
        <p className="mt-2 text-sm text-white/65">Pendiente · confirma Luna y ejecuta “Analizar mercado eBay”.</p>
      </section>
    )
  }

  const cohorts = decisionPackage.comparables.cohorts
  const excluded = decisionPackage.comparables.classified.filter((row) =>
    row.cohort === null || row.classification !== "EXACT_MATCH"
  )
  const economics = decisionPackage.economics
  const target = economics.targetEconomics
  const verifiedKeywords = keywordReport?.keywordEvidenceGroups.verifiedHistoricalMultiSeller ?? []
  const estimatedKeywords = keywordReport?.keywordEvidenceGroups.estimatedMultiSellerSignal ?? []
  const activeKeywords = keywordReport?.keywordEvidenceGroups.activeListingFrequencyOnly ?? []
  const visual = decisionPackage.visualEvidenceAnalysis
  const verdictTone = decisionPackage.decision.verdict === "GO"
    ? "border-emerald-200/35 bg-emerald-200/[0.09]"
    : decisionPackage.decision.verdict === "GO_WITH_CHANGES"
      ? "border-amber-200/35 bg-amber-200/[0.09]"
      : "border-rose-200/35 bg-rose-200/[0.09]"

  return (
    <section aria-labelledby="loop1-decision-package-heading" className="space-y-4 rounded-3xl border border-violet-200/25 bg-violet-200/[0.05] p-4">
      <div>
        <p className="text-xs font-black uppercase tracking-widest text-violet-100/65">Paquete auditable · {decisionPackage.packageVersion}</p>
        <h3 id="loop1-decision-package-heading" className="mt-1 text-lg font-black">Decisión completa del producto</h3>
      </div>

      <section className="rounded-2xl border border-cyan-200/20 bg-cyan-200/[0.06] p-3">
        <h4 className="font-black">Identidad y fingerprint</h4>
        <dl className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
          <div><dt className="text-white/50">Producto normalizado</dt><dd className="font-bold">{decisionPackage.productIdentity.identity.normalizedProductName ?? "N/D"}</dd></div>
          <div><dt className="text-white/50">Marca</dt><dd className="font-bold">{decisionPackage.productIdentity.identity.manufacturerBrand ?? "N/D"}</dd></div>
          <div><dt className="text-white/50">GTIN válido</dt><dd className="font-bold">{decisionPackage.productIdentity.identity.gtinValid ? "SÍ" : "NO / N/D"}</dd></div>
          <div><dt className="text-white/50">Variante</dt><dd className="font-bold">{decisionPackage.productIdentity.identity.variant ?? "N/D"}</dd></div>
          <div className="sm:col-span-2"><dt className="text-white/50">Fingerprint</dt><dd className="break-all font-mono text-[11px]">{decisionPackage.productIdentity.fingerprint}</dd></div>
        </dl>
      </section>

      <div className="grid gap-3 lg:grid-cols-2">
        <Cohort title="Comparables activos exactos" rows={cohorts.ACTIVE_EXACT_MATCHES} />
        <Cohort title="Vendidos/completados exactos" rows={cohorts.SOLD_OR_COMPLETED_EXACT_MATCHES} />
        <Cohort title="Señales estimadas separadas" rows={cohorts.ESTIMATED_DEMAND_SIGNALS} />
        <Cohort title="Comparables excluidos" rows={excluded} />
      </div>

      <section className="rounded-2xl border border-emerald-200/20 bg-emerald-200/[0.05] p-3">
        <h4 className="font-black">Precio y rentabilidad</h4>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
          <div><dt className="text-white/50">Mínimo seguro</dt><dd className="font-black">{money(economics.minimumSafePrice)}</dd></div>
          <div><dt className="text-white/50">Recomendado</dt><dd className="font-black">{money(economics.targetPrice)}</dd></div>
          <div><dt className="text-white/50">Mercado activo</dt><dd className="font-black">{money(economics.activeMarketMedian)}</dd></div>
          <div><dt className="text-white/50">Beneficio</dt><dd className="font-black">{money(target?.estimatedProfit)}</dd></div>
          <div><dt className="text-white/50">ROI</dt><dd className="font-black">{percent(target?.estimatedRoiPercent)}</dd></div>
          <div><dt className="text-white/50">Margen</dt><dd className="font-black">{percent(target?.estimatedNetMarginPercent)}</dd></div>
        </dl>
      </section>

      <section className="rounded-2xl border border-white/10 bg-black/20 p-3">
        <h4 className="font-black">Keywords, vendedores y patrones de títulos</h4>
        <dl className="mt-3 grid gap-2 text-sm">
          <div><dt className="text-white/50">Vendedores analizados</dt><dd className="font-black">{keywordReport?.sellersAnalyzed ?? "N/D"}</dd></div>
          <div><dt className="text-white/50">Keywords con historial confirmado</dt><dd>{verifiedKeywords.map((entry) => entry.term).join(" · ") || "N/D"}</dd></div>
          <div><dt className="text-white/50">Keywords con señal estimada</dt><dd>{estimatedKeywords.map((entry) => entry.term).join(" · ") || "N/D"}</dd></div>
          <div><dt className="text-white/50">Frecuencia en activos</dt><dd>{activeKeywords.slice(0, 12).map((entry) => entry.term).join(" · ") || "N/D"}</dd></div>
          <div><dt className="text-white/50">Patrón de título</dt><dd>{keywordReport?.recommendedListingKeywordStructure.titleFormula ?? "N/D"}</dd></div>
        </dl>
      </section>

      <section className="rounded-2xl border border-sky-200/20 bg-sky-200/[0.06] p-3">
        <h4 className="font-black">Patrones visuales del mercado</h4>
        <p className="mt-1 text-xs text-white/60">Patrón asociado, no causalidad · muestra {visual.visualPatternConfidence.sampleSize} · confianza {visual.visualPatternConfidence.level}.</p>
        {visual.status === "AVAILABLE" ? (
          <ul className="mt-3 grid gap-2 text-xs">
            {[...visual.mainImagePatterns, ...visual.secondaryImagePatterns].map((pattern) => (
              <li key={pattern.pattern} className="rounded-xl bg-black/20 p-2">
                <strong>{label(pattern.pattern)}</strong>
                <span className="mt-1 block text-white/60">Vendidos {pattern.soldOrCompletedExactMatches.count}/{pattern.soldOrCompletedExactMatches.observed || "N/D"} · activos {pattern.activeExactMatches.count}/{pattern.activeExactMatches.observed || "N/D"}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-amber-100">N/D · no existen observaciones visuales estructuradas suficientes.</p>
        )}
        <h4 className="mt-4 font-black">Estrategia original de seis imágenes</h4>
        <ol className="mt-2 grid gap-2 text-xs">
          {visual.recommendedSixImageStrategy.map((entry) => (
            <li key={entry.slot} className="rounded-xl bg-black/20 p-2">
              <strong>{entry.position}. {label(entry.slot)}</strong>
              <span className="mt-1 block text-white/65">{entry.strategy}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className={`rounded-2xl border p-4 ${verdictTone}`}>
        <p className="text-xs font-black uppercase tracking-widest">Veredicto Loop 1</p>
        <p className="mt-1 text-2xl font-black">{decisionPackage.decision.verdict}</p>
        <p className="mt-2 text-sm leading-6">{getLoop1DecisionExplanation(decisionPackage)}</p>
        {decisionPackage.decision.blockers.length > 0 && (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-xs">
            {decisionPackage.decision.blockers.map((entry) => <li key={entry}>{label(entry)}</li>)}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-white/15 bg-black/25 p-3">
        <h4 className="font-black">Guardar paquete de decisión</h4>
        <p className="mt-1 text-xs text-white/60">Guarda una versión idempotente y la relee server-side para comprobar hash, versión y account scope.</p>
        <button type="button" onClick={onSave} disabled={Boolean(saveDisabledReason)} className="mt-3 min-h-12 w-full rounded-2xl bg-violet-200 px-4 font-black text-black disabled:opacity-40">{saveState === "SAVING" ? "Guardando…" : packageStored ? "Guardar nueva versión idempotente" : "Guardar paquete de decisión"}</button>
        {saveDisabledReason && <p className="mt-2 text-xs font-bold text-amber-100">{saveDisabledReason}</p>}
        {packageStored && <button type="button" onClick={onRead} disabled={saveState === "READING"} className="mt-2 min-h-11 w-full rounded-2xl border border-violet-200/30 px-4 font-black disabled:opacity-40">{saveState === "READING" ? "Releyendo…" : "Releer paquete guardado"}</button>}
        {readbackVerified && <p className="mt-2 text-sm font-black text-emerald-100">✓ Paquete releído: hash y versión coinciden.</p>}
        {saveError && <p role="alert" className="mt-2 text-sm font-bold text-rose-100">{saveError}</p>}
        <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div><dt className="text-white/50">canPublish</dt><dd className="font-black">false</dd></div>
          <div><dt className="text-white/50">OpenAI calls</dt><dd className="font-black">0</dd></div>
          <div><dt className="text-white/50">Imágenes generadas</dt><dd className="font-black">0</dd></div>
          <div><dt className="text-white/50">Drafts</dt><dd className="font-black">0</dd></div>
          <div><dt className="text-white/50">Publicaciones</dt><dd className="font-black">0</dd></div>
          <div><dt className="text-white/50">Escrituras eBay</dt><dd className="font-black">0</dd></div>
        </dl>
      </section>
    </section>
  )
}
