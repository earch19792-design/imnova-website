const cards = [
  {
    title: "Descubrir oportunidades",
    detail:
      "Señales nuevas del catálogo y del mercado para revisar con calma.",
  },
  {
    title: "Cambios de stock/precio",
    detail:
      "Cambios importantes antes de decidir si un producto vuelve a cola.",
  },
  {
    title: "Sin stock detectado",
    detail:
      "Productos que no deben avanzar hasta que exista stock confiable.",
  },
  {
    title: "Señales del proveedor",
    detail:
      "Stock, descuentos y alertas de Luna Portex como contexto inicial.",
  },
]

export default function MarketRadarHubPage() {
  return (
    <main className="min-h-screen bg-[#05070d] px-6 py-10 text-white md:px-10">
      <section className="mx-auto flex max-w-6xl flex-col gap-8">
        <a
          href="/admin"
          className="w-fit rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-100/70"
        >
          Volver a Admin
        </a>

        <div className="rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.05] p-7">
          <p className="text-xs font-black uppercase tracking-[0.3em] text-cyan-100/55">
            Módulo ligero
          </p>
          <h1 className="mt-4 text-4xl font-black text-white">
            Market Radar
          </h1>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-white/65">
            Descubre oportunidades, stock, descuentos y señales del mercado.
            Este hub es ligero y no carga el panel completo automáticamente.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {cards.map((card) => (
            <article
              key={card.title}
              className="rounded-2xl border border-white/10 bg-white/[0.035] p-5"
            >
              <h2 className="text-lg font-black text-white">
                {card.title}
              </h2>
              <p className="mt-3 text-sm leading-6 text-white/60">
                {card.detail}
              </p>
            </article>
          ))}
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/25 p-5">
          <p className="text-sm leading-7 text-white/65">
            Market Radar descubre señales. No prepara listings, no publica y no
            decide cómo se vende un producto en eBay.
          </p>
          <a
            href="/admin"
            className="mt-4 inline-flex rounded-full border border-cyan-300/20 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-cyan-100/80"
          >
            Abrir dashboard actual
          </a>
        </div>
      </section>
    </main>
  )
}
