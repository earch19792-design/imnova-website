import type { SellerOsAvailability } from "@/lib/seller-os/status-presentation"

const DEFAULT_COPY: Record<
  Exclude<SellerOsAvailability, "AVAILABLE">,
  { title: string; message: string }
> = {
  LOADING: {
    title: "Consultando información",
    message: "Seller OS está leyendo la fuente autorizada.",
  },
  PARTIAL: {
    title: "Información parcial",
    message: "Se muestran sólo los datos confirmados por la fuente.",
  },
  UNAVAILABLE: {
    title: "Fuente no disponible",
    message: "No se reemplazó la ausencia de datos con ceros.",
  },
  ERROR: {
    title: "No se pudo completar la consulta",
    message: "Los últimos datos confirmados permanecen sin cambios.",
  },
}

export function PartialDataState({
  availability,
  title,
  message,
  className = "",
}: {
  availability: SellerOsAvailability
  title?: string
  message?: string
  className?: string
}) {
  if (availability === "AVAILABLE") return null
  const copy = DEFAULT_COPY[availability]
  const critical = availability === "ERROR"

  return (
    <div
      role={critical ? "alert" : "status"}
      aria-busy={availability === "LOADING" ? true : undefined}
      className={`rounded-2xl border p-3 text-sm ${
        critical
          ? "border-rose-200/30 bg-rose-200/[0.08] text-rose-50"
          : "border-amber-200/25 bg-amber-200/[0.07] text-amber-50"
      } ${className}`}
    >
      <strong className="block">{title ?? copy.title}</strong>
      <span className="mt-1 block text-xs leading-5 opacity-75">
        {message ?? copy.message}
      </span>
    </div>
  )
}
