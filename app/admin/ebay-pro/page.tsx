const cards = [
  {
    title: "Market Radar eBay",
    detail:
      "Senales, stock, descuentos y oportunidades eBay.",
    href: "/admin/market-radar",
    status: "staging/lab",
  },
  {
    title: "eBay Seller OS",
    detail:
      "Colas operativas, rescates, packs y decisiones.",
    href: "/admin/ebay-seller-os",
    status: "staging/lab",
  },
  {
    title: "eBay Listing",
    detail:
      "Registra el primer listing manual y verifica que pertenece a la cuenta OAuth.",
    href: "/admin/ebay/listings/register",
    status: "operativo · read-only",
  },
  {
    title: "Listing Package",
    detail:
      "Cola real, paquete editable, revisión humana y Offer no publicado con aprobación.",
    href: "/admin/ebay/mobile-review",
    status: "operativo · gated",
  },
  {
    title: "Imagenes eBay",
    detail:
      "Fondo blanco 1600×1600 desde fuente autorizada, hash y aprobación humana.",
    href: "/admin/ebay-image-generator",
    status: "optimizador operativo",
  },
]

const disabledCards = [
  {
    title: "WhatsApp Seller Alerts",
    detail:
      "Canal implementado; envíos reales esperan aprobación de templates por Meta.",
  },
  {
    title: "Sandbox futuro",
    detail:
      "Conector draft-only disponible cuando OAuth, cuenta y feature flags estén configurados.",
  },
  {
    title: "VM Lab futuro",
    detail:
      "Workers y pruebas pesadas con BD separada.",
  },
]

export default function EbayProPage() {
  return (
    <main className="min-h-screen bg-[#05070b] px-6 py-10 text-white lg:px-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10">
        <section className="border-b border-white/10 pb-8">
          <p className="text-xs font-black uppercase tracking-[0.28em] text-cyan-200/70">
            staging/lab-only
          </p>
          <h1 className="mt-4 text-3xl font-black tracking-normal text-white md:text-4xl">
            eBay Professional Seller Suite
          </h1>
          <p className="mt-4 max-w-3xl text-sm leading-6 text-white/60">
            Centro profesional para investigar, preparar y revisar listings.
            La publicación automática permanece prohibida; cualquier Offer no
            publicado exige configuración, preflight y aprobación de un solo uso.
          </p>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {cards.map((card) => (
            <a
              key={card.href}
              href={card.href}
              className="rounded-lg border border-white/10 bg-white/[0.035] p-5 transition hover:border-cyan-300/30 hover:bg-cyan-300/[0.06]"
            >
              <span className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-100/55">
                {card.status}
              </span>
              <h2 className="mt-3 text-base font-black text-white">
                {card.title}
              </h2>
              <p className="mt-2 text-sm leading-6 text-white/55">
                {card.detail}
              </p>
            </a>
          ))}

          {disabledCards.map((card) => (
            <div
              key={card.title}
              className="rounded-lg border border-white/10 bg-white/[0.02] p-5 opacity-70"
            >
              <span className="text-[10px] font-black uppercase tracking-[0.22em] text-white/35">
                futuro
              </span>
              <h2 className="mt-3 text-base font-black text-white">
                {card.title}
              </h2>
              <p className="mt-2 text-sm leading-6 text-white/45">
                {card.detail}
              </p>
            </div>
          ))}
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          {[
            {
              label: "Production",
              value: "IMNOVA Core only",
            },
            {
              label: "Staging",
              value: "eBay Pro Suite",
            },
            {
              label: "Local VM",
              value: "Heavy lab processing",
            },
          ].map((item) => (
            <div
              key={item.label}
              className="rounded-lg border border-cyan-300/15 bg-cyan-300/[0.045] p-5"
            >
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-cyan-100/55">
                {item.label}
              </p>
              <p className="mt-3 text-sm font-black text-white">
                {item.value}
              </p>
            </div>
          ))}
        </section>
      </div>
    </main>
  )
}
