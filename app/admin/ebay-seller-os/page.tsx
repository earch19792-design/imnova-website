import { SellerOsMobileNav } from "../ebay/components/seller-os-mobile-nav"

const actions = [
  {
    href: "/admin/ebay/mobile-review",
    eyebrow: "Empieza aquí · móvil",
    title: "Seller Command Center",
    copy: "Descubre, valida y prepara el producto con mayor prioridad desde una sola cola.",
    tone: "border-emerald-200/25 bg-emerald-200/[0.08]",
    cta: "Abrir centro →",
  },
  {
    href: "/admin/ebay/opportunity-queue",
    eyebrow: "Vista técnica",
    title: "Opportunity Queue",
    copy: "Inspecciona scans, evidencia, guardas y orden canónico con más detalle.",
    tone: "border-violet-200/20 bg-violet-200/[0.06]",
    cta: "Ver cola →",
  },
]

const operationLinks = [
  {
    href: "/admin/ebay/listings/register",
    title: "Vincular listing activo",
    copy: "El asistente te ayuda a elegir el producto, confirmar su SKU y verificar el Item ID sin perderte entre pantallas.",
    cta: "Abrir asistente guiado →",
  },
  {
    href: "/admin/ebay/mobile-review?section=in-progress",
    title: "Drafts y revisiones en curso",
    copy: "Continúa validaciones y prepara un draft únicamente cuando todas las guardas estén resueltas.",
    cta: "Ver en curso →",
  },
  {
    href: "/admin/ebay/mobile-review?section=alerts",
    title: "Listings activos y alertas",
    copy: "Sincroniza eBay, revisa vínculos con Luna y atiende riesgos de stock o costo.",
    cta: "Abrir operación →",
  },
  {
    href: "/admin/ebay/seller-performance",
    title: "Rendimiento de listings",
    copy: "Consulta impresiones, CTR, conversión y ventas oficiales para mejorar el ranking.",
    cta: "Ver rendimiento →",
  },
]

export default function EbaySellerOsHubPage() {
  return (
    <main className="min-h-screen bg-[#05070d] px-4 pb-28 pt-4 text-white sm:px-6">
      <section className="mx-auto max-w-xl space-y-4">
        <header className="rounded-3xl border border-white/10 bg-gradient-to-br from-emerald-200/[0.10] via-cyan-200/[0.04] to-black p-5">
          <div className="flex items-center justify-between gap-3"><a href="/admin" className="inline-flex min-h-11 items-center rounded-full border border-white/15 px-4 text-sm font-bold">← Admin</a><span className="rounded-full border border-emerald-200/25 bg-emerald-200/[0.07] px-3 py-2 text-[11px] font-black text-emerald-50">MODO SEGURO</span></div>
          <p className="mt-6 text-xs font-black uppercase tracking-[0.24em] text-emerald-100/60">eBay Seller OS</p>
          <h1 className="mt-2 text-3xl font-black leading-tight">Tu operación de ventas, en el teléfono</h1>
          <p className="mt-3 text-sm leading-6 text-white/65">Luna informa disponibilidad y costo; eBay aporta evidencia de mercado. El sistema te muestra la siguiente acción sin publicar automáticamente.</p>
        </header>

        <section className="rounded-3xl border border-amber-200/20 bg-amber-200/[0.05] p-4">
          <p className="text-xs font-black uppercase tracking-widest text-amber-100/65">Ruta rápida</p>
          <ol className="mt-3 grid grid-cols-4 gap-1 text-center text-[10px] font-black uppercase"><li className="rounded-xl bg-violet-200 px-1 py-3 text-black">1<br />Descubrir</li><li className="rounded-xl bg-cyan-200 px-1 py-3 text-black">2<br />Validar</li><li className="rounded-xl bg-emerald-200 px-1 py-3 text-black">3<br />Preparar</li><li className="rounded-xl border border-white/15 px-1 py-3 text-white/65">4<br />Draft / manual</li></ol>
        </section>

        <div className="space-y-3">{actions.map((action, index) => <a key={action.href} href={action.href} className={`block rounded-3xl border p-5 transition active:scale-[0.99] ${action.tone}`}><div className="flex items-start gap-4"><span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-white text-lg font-black text-black">{index + 1}</span><div className="min-w-0"><p className="text-xs font-black uppercase tracking-widest text-white/50">{action.eyebrow}</p><h2 className="mt-2 text-xl font-black">{action.title}</h2><p className="mt-2 text-sm leading-6 text-white/65">{action.copy}</p><span className="mt-4 inline-flex min-h-11 items-center rounded-full bg-white px-4 text-xs font-black text-black">{action.cta}</span></div></div></a>)}</div>

        <section id="operacion" aria-labelledby="operation-heading" className="scroll-mt-4 rounded-3xl border border-cyan-200/20 bg-cyan-200/[0.05] p-4">
          <p className="text-xs font-black uppercase tracking-widest text-cyan-100/65">Operación · listings</p>
          <h2 id="operation-heading" className="mt-1 text-xl font-black">Del primer listing manual a drafts reutilizables</h2>
          <p className="mt-2 text-sm leading-6 text-white/65">Registra lo que eBay aceptó una sola vez; el OS podrá proponer esos campos en productos compatibles, siempre con revisión humana.</p>
          <div className="mt-4 grid gap-3">
            {operationLinks.map((item) => (
              <a key={item.href} href={item.href} className="rounded-2xl border border-white/10 bg-black/25 p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200">
                <h3 className="font-black">{item.title}</h3>
                <p className="mt-1 text-sm leading-6 text-white/60">{item.copy}</p>
                <span className="mt-3 inline-flex min-h-11 items-center text-sm font-black text-cyan-50">{item.cta}</span>
              </a>
            ))}
          </div>
        </section>

        <aside className="rounded-3xl border border-white/10 bg-white/[0.035] p-4"><h2 className="font-black">Regla de seguridad</h2><p className="mt-2 text-sm leading-6 text-white/60">Los scans, revisiones y paquetes internos pueden automatizarse. Crear o publicar un listing en eBay requiere una autorización separada y revisión humana.</p></aside>
      </section>

      <SellerOsMobileNav active="home" />
    </main>
  )
}
