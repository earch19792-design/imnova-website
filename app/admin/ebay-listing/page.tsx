const listingPackageHref =
  "/admin/" + "ebay-listing" + "-package"

const cards = [
  {
    title: "Preparar listing",
    detail:
      "Título, descripción, item specifics y estructura comercial del listing.",
  },
  {
    title: "Revisar y aprobar",
    detail:
      "Gates humanos antes de cualquier acción externa.",
  },
  {
    title: "Imágenes del listing",
    detail:
      "Imagen principal y seis imágenes secundarias planeadas desde fuente aprobada.",
  },
  {
    title: "Payload dry run",
    detail:
      "Vista local de lo que se prepararía sin enviar nada a eBay.",
  },
]

export default function EbayListingHubPage() {
  return (
    <main className="min-h-screen bg-[#05070d] px-6 py-10 text-white md:px-10">
      <section className="mx-auto flex max-w-6xl flex-col gap-8">
        <a
          href="/admin"
          className="w-fit rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-100/70"
        >
          Volver a Admin
        </a>

        <div className="rounded-2xl border border-violet-300/15 bg-violet-300/[0.05] p-7">
          <p className="text-xs font-black uppercase tracking-[0.3em] text-violet-100/55">
            Módulo ligero
          </p>
          <h1 className="mt-4 text-4xl font-black text-white">
            eBay Listing
          </h1>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-white/65">
            Prepara y revisa listings antes de cualquier acción externa.
            Listing usa Pipeline por referencia y no recalcula rentabilidad.
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
            eBay Listing usa Products como fuente de verdad. No duplica la
            verdad del Pipeline y no publica.
          </p>
          <a
            href={listingPackageHref}
            className="mt-4 inline-flex rounded-full border border-violet-300/20 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-violet-100/80"
          >
            Abrir paquete de listing actual
          </a>
        </div>
      </section>
    </main>
  )
}
