import Link from "next/link"

const capabilities = [
  ["Oportunidades verificables", "Discovery, Product Research, evidencia vendida, Luna matching y Top 20 en un solo flujo."],
  ["Listings con control humano", "Ficha técnica, rentabilidad y preparación auditables antes de cualquier aprobación."],
  ["Operación diaria", "Órdenes, fulfillment, inventario, costos, alertas y monitoreo comercial desde un panel privado."],
]

export default function SellerOsPublicHome() {
  return (
    <main className="min-h-screen bg-[#05070d] text-white">
      <section className="mx-auto flex min-h-screen max-w-6xl flex-col justify-between px-6 py-8 sm:px-10 lg:px-12">
        <header className="flex items-center justify-between border-b border-white/10 pb-6">
          <div>
            <p className="text-sm font-black tracking-[0.28em] text-cyan-200">SELLER OS</p>
            <p className="mt-1 text-xs text-white/50">Operación profesional para marketplaces</p>
          </div>
          <Link href="/admin/login" className="rounded-full border border-white/20 px-5 py-3 text-sm font-bold hover:bg-white hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200">
            Acceder al panel
          </Link>
        </header>

        <div className="grid items-center gap-12 py-16 lg:grid-cols-[1.1fr_.9fr]">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.25em] text-emerald-200">Plataforma privada de operación</p>
            <h1 className="mt-5 max-w-3xl text-4xl font-black leading-tight sm:text-6xl">Decisiones eBay claras, trazables y bajo control humano.</h1>
            <p className="mt-6 max-w-2xl text-base leading-8 text-white/65 sm:text-lg">Seller OS organiza la investigación, preparación de listings y operación comercial diaria sin exponer datos internos ni ejecutar publicaciones sin autorización.</p>
            <Link href="/admin/login" className="mt-8 inline-flex min-h-12 items-center rounded-full bg-cyan-200 px-6 font-black text-black hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-200">
              Iniciar sesión como administrador
            </Link>
          </div>

          <div aria-label="Vista conceptual del panel Seller OS" className="rounded-[2rem] border border-white/10 bg-gradient-to-br from-cyan-200/[0.10] via-white/[0.03] to-emerald-200/[0.08] p-5 shadow-2xl shadow-cyan-950/30">
            <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/35 p-4">
              <div><p className="text-xs text-white/45">Estado del sistema</p><p className="mt-1 font-black">Operación protegida</p></div>
              <span className="rounded-full bg-emerald-200 px-3 py-1 text-xs font-black text-black">CONTROL HUMANO</span>
            </div>
            <div className="mt-4 grid gap-3">
              {capabilities.map(([title, copy], index) => (
                <article key={title} className="rounded-2xl border border-white/10 bg-black/25 p-4">
                  <div className="flex gap-4"><span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white text-sm font-black text-black">0{index + 1}</span><div><h2 className="font-black">{title}</h2><p className="mt-1 text-sm leading-6 text-white/55">{copy}</p></div></div>
                </article>
              ))}
            </div>
          </div>
        </div>

        <footer className="border-t border-white/10 pt-6 text-xs leading-6 text-white/45">
          Plataforma independiente para gestión de vendedores. No afiliada ni respaldada oficialmente por eBay.
        </footer>
      </section>
    </main>
  )
}
