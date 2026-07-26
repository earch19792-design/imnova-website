"use client"

import { useCallback, useEffect, useState } from "react"

import { supabase } from "@/lib/supabase"
import {
  buildSellerOsOperationReadModel,
  errorSellerOsOperationReadModel,
  loadingSellerOsOperationReadModel,
  type SellerOsMetric,
  type SellerOsOperationReadModel,
} from "@/lib/seller-os/operation-read-model"
import { PartialDataState } from "./partial-data-state"
import { StatusBadge } from "./status-badge"

const POLL_INTERVAL_MS = 30_000

function metricText(metric: SellerOsMetric<number>) {
  return metric.availability === "AVAILABLE" && metric.value != null
    ? new Intl.NumberFormat("es-US").format(metric.value)
    : "No disponible"
}

function consultedLabel(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "No disponible"
  return new Intl.DateTimeFormat("es", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value))
}

function emptyActivityTitle(
  state: SellerOsOperationReadModel["operationalState"],
) {
  if (state === "ACCOUNT_SCOPE_MISMATCH") return "Cuenta fuera del alcance"
  if (state === "SOURCE_UNAVAILABLE") return "Actividad no disponible"
  return "Sin lote operativo"
}

function emptyActivityMessage(
  state: SellerOsOperationReadModel["operationalState"],
) {
  if (state === "ACCOUNT_SCOPE_MISMATCH") {
    return "Revisa la cuenta de eBay configurada. No se mezclaron datos de otra cuenta."
  }
  if (state === "SOURCE_UNAVAILABLE") {
    return "No fue posible confirmar el lote durable. No se mostraron ceros ni progreso supuesto."
  }
  return "La consulta confirmó que no existe un lote operativo para esta cuenta."
}

export function GlobalActivityDock({
  className = "",
  journeyHref = "/admin#today-launch",
}: {
  className?: string
  journeyHref?: string
}) {
  const [activity, setActivity] = useState<SellerOsOperationReadModel>(
    loadingSellerOsOperationReadModel,
  )

  const load = useCallback(async () => {
    try {
      const { data } = await supabase.auth.getSession()
      const accessToken = data.session?.access_token
      if (!accessToken) {
        setActivity(errorSellerOsOperationReadModel(
          "Inicia sesión nuevamente para consultar la actividad.",
        ))
        return
      }

      const response = await fetch("/api/admin/ebay/listing-factory", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        setActivity(errorSellerOsOperationReadModel(
          "No fue posible consultar la actividad de Seller OS.",
        ))
        return
      }
      setActivity(buildSellerOsOperationReadModel(payload))
    } catch {
      setActivity(errorSellerOsOperationReadModel())
    }
  }, [])

  useEffect(() => {
    let interval: number | null = null

    const stopPolling = () => {
      if (interval != null) window.clearInterval(interval)
      interval = null
    }
    const startPolling = () => {
      stopPolling()
      if (document.visibilityState !== "visible") return
      interval = window.setInterval(() => {
        void load()
      }, POLL_INTERVAL_MS)
    }
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void load()
        startPolling()
      } else {
        stopPolling()
      }
    }

    void load()
    startPolling()
    document.addEventListener("visibilitychange", handleVisibility)
    return () => {
      stopPolling()
      document.removeEventListener("visibilitychange", handleVisibility)
    }
  }, [load])

  const batch = activity.batch
  const completed = batch?.completedCount.value
  const determinedFiveSlotProgress = batch?.completedCount.availability === "AVAILABLE" &&
    completed != null &&
    completed >= 0 &&
    completed <= batch.targetSlots

  return (
    <aside
      aria-label="Actividad global de Seller OS"
      className={`rounded-3xl border border-cyan-200/20 bg-[#07141a]/95 p-4 text-white shadow-[0_18px_70px_rgba(0,0,0,0.28)] ${className}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-100/60">
            Actividad de Seller OS
          </p>
          <h2 className="mt-1 text-base font-black">
            {batch ? "Último lote observado" : emptyActivityTitle(activity.operationalState)}
          </h2>
        </div>
        {batch
          ? <StatusBadge state={batch.visualState} />
          : <StatusBadge state="NOT_STARTED" />}
      </div>

      <PartialDataState
        availability={activity.availability}
        message={activity.message}
        className="mt-3"
      />

      {batch && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <div className="rounded-xl bg-white/[0.05] p-3">
              <span className="text-white/45">Completados</span>
              <strong className="mt-1 block text-lg">
                {metricText(batch.completedCount)}
                {determinedFiveSlotProgress ? ` de ${batch.targetSlots}` : ""}
              </strong>
            </div>
            <div className="rounded-xl bg-white/[0.05] p-3">
              <span className="text-white/45">Decisiones tuyas</span>
              <strong className="mt-1 block text-sm">
                {metricText(batch.pendingHumanDecisions)}
              </strong>
            </div>
            <div className="rounded-xl bg-white/[0.05] p-3">
              <span className="text-white/45">Cuarentena abierta</span>
              <strong className="mt-1 block text-lg">
                {metricText(activity.openQuarantineCount)}
              </strong>
            </div>
            <div className="rounded-xl bg-white/[0.05] p-3">
              <span className="text-white/45">Consultado</span>
              <strong className="mt-1 block text-xs">
                {consultedLabel(activity.consultedAt)}
              </strong>
            </div>
          </div>

          {determinedFiveSlotProgress && (
            <div
              className="mt-3"
              role="progressbar"
              aria-label="Productos completados en el lote de cinco"
              aria-valuemin={0}
              aria-valuemax={batch.targetSlots}
              aria-valuenow={completed!}
              aria-valuetext={`${completed} de ${batch.targetSlots} productos completados`}
            >
              <div aria-hidden="true" className="grid grid-cols-5 gap-1">
                {Array.from({ length: batch.targetSlots }, (_, index) => (
                  <span
                    key={index}
                    className={`h-2 rounded-full ${
                      index < completed! ? "bg-emerald-200" : "bg-white/10"
                    }`}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3 text-xs leading-5">
            <p><strong>Producto activo:</strong> No disponible en esta fuente agregada.</p>
            <p><strong>Fase activa:</strong> No disponible en esta fuente agregada.</p>
            <p><strong>Actividad viva:</strong> No confirmada; este resumen no expone heartbeat ni lease.</p>
          </div>
        </>
      )}

      {activity.availability !== "LOADING" && !batch && (
        <p
          className="mt-3 text-sm leading-6 text-white/60"
          role="status"
          aria-live="polite"
        >
          {emptyActivityMessage(activity.operationalState)}
        </p>
      )}

      <a
        href={journeyHref}
        className="mt-4 inline-flex min-h-11 items-center rounded-xl border border-cyan-200/30 px-4 text-sm font-black text-cyan-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-100"
      >
        Ver recorrido
      </a>
    </aside>
  )
}
