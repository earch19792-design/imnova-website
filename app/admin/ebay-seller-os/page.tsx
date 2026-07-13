const queuePriority =
  "Sin stock → Proteger → Revisar stock → Margen → Bloqueados → Vender ahora → Monitorear"

const cards = [
  "Colas del vendedor",
  "Vender ahora",
  "Revisar stock",
  "Margen",
  "Bloqueados",
  "Rescates / packs",
  "Proteger",
]

export default function EbaySellerOsHubPage() {
  return (
    <main className="min-h-screen bg-[#05070d] px-6 py-10 text-white md:px-10">
      <section className="mx-auto flex max-w-6xl flex-col gap-8">
        <a
          href="/admin"
          className="w-fit rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-100/70"
        >
          Volver a Admin
        </a>

        <div className="rounded-2xl border border-emerald-300/15 bg-emerald-300/[0.05] p-7">
          <p className="text-xs font-black uppercase tracking-[0.3em] text-emerald-100/55">
            Módulo ligero
          </p>
          <h1 className="mt-4 text-4xl font-black text-white">
            eBay Seller OS
          </h1>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-white/65">
            Organiza el flujo operativo del vendedor. Este hub no prepara
            listings ni publica; organiza decisiones operativas.
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/25 p-5">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-white/45">
            Cola prioritaria
          </p>
          <p className="mt-3 text-lg font-black text-white">
            {queuePriority}
          </p>
        </div>

        <a
          href="/admin/ebay/opportunity-queue"
          className="group rounded-3xl border border-violet-200/20 bg-violet-200/[0.07] p-6 transition hover:border-violet-200/40 hover:bg-violet-200/[0.10]"
        >
          <p className="text-xs font-black uppercase tracking-[0.24em] text-violet-100/55">
            eBay-first × Luna Portex
          </p>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-2xl font-black text-white">
                Cola automática de oportunidades
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-white/60">
                Recorre todas las variantes Luna, cruza demanda y comparables de
                eBay, acumula velocidad y vigila cambios de precio y stock.
              </p>
            </div>
            <span className="rounded-full bg-violet-200 px-4 py-2 text-xs font-black uppercase tracking-wider text-black">
              Abrir cola →
            </span>
          </div>
        </a>

        <a
          href="/admin/ebay/seller-performance"
          className="group rounded-3xl border border-cyan-200/20 bg-cyan-200/[0.07] p-6 transition hover:border-cyan-200/40 hover:bg-cyan-200/[0.10]"
        >
          <p className="text-xs font-black uppercase tracking-[0.24em] text-cyan-100/55">
            Analytics oficial · read-only
          </p>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-2xl font-black text-white">
                Estadísticas de Seller Performance
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-white/60">
                Consulta impresiones, vistas, CTR, transacciones y conversión de
                tu propia cuenta mediante eBay Traffic Report.
              </p>
            </div>
            <span className="rounded-full bg-cyan-200 px-4 py-2 text-xs font-black uppercase tracking-wider text-black">
              Abrir panel →
            </span>
          </div>
        </a>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {cards.map((card) => (
            <article
              key={card}
              className="rounded-2xl border border-white/10 bg-white/[0.035] p-5"
            >
              <h2 className="text-lg font-black text-white">
                {card}
              </h2>
              <p className="mt-3 text-sm leading-6 text-white/60">
                Ruta operativa para decidir el siguiente paso sin ejecutar
                acciones externas.
              </p>
            </article>
          ))}
        </div>

        <a
          href="/admin"
          className="w-fit rounded-full border border-emerald-300/20 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-emerald-100/80"
        >
          Abrir Pipeline actual
        </a>
      </section>
    </main>
  )
}
