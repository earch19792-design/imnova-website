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
  {
    href: "/admin/ebay/seller-performance",
    eyebrow: "eBay oficial · read-only",
    title: "Rendimiento de la cuenta",
    copy: "Consulta impresiones, vistas, CTR, transacciones y conversión de tus listings.",
    tone: "border-cyan-200/20 bg-cyan-200/[0.06]",
    cta: "Ver analytics →",
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
          <ol className="mt-3 grid grid-cols-4 gap-1 text-center text-[10px] font-black uppercase"><li className="rounded-xl bg-violet-200 px-1 py-3 text-black">1<br />Descubrir</li><li className="rounded-xl bg-cyan-200 px-1 py-3 text-black">2<br />Validar</li><li className="rounded-xl bg-emerald-200 px-1 py-3 text-black">3<br />Preparar</li><li className="rounded-xl border border-white/15 px-1 py-3 text-white/45">4<br />Aprobar</li></ol>
        </section>

        <div className="space-y-3">{actions.map((action, index) => <a key={action.href} href={action.href} className={`block rounded-3xl border p-5 transition active:scale-[0.99] ${action.tone}`}><div className="flex items-start gap-4"><span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-white text-lg font-black text-black">{index + 1}</span><div className="min-w-0"><p className="text-xs font-black uppercase tracking-widest text-white/50">{action.eyebrow}</p><h2 className="mt-2 text-xl font-black">{action.title}</h2><p className="mt-2 text-sm leading-6 text-white/65">{action.copy}</p><span className="mt-4 inline-flex min-h-11 items-center rounded-full bg-white px-4 text-xs font-black text-black">{action.cta}</span></div></div></a>)}</div>

        <aside className="rounded-3xl border border-white/10 bg-white/[0.035] p-4"><h2 className="font-black">Regla de seguridad</h2><p className="mt-2 text-sm leading-6 text-white/60">Los scans, revisiones y paquetes internos pueden automatizarse. Crear o publicar un listing en eBay requiere una autorización separada y revisión humana.</p></aside>
      </section>

      <nav aria-label="Navegación Seller OS" className="fixed inset-x-0 bottom-0 z-40 border-t border-white/15 bg-[#070b12]/95 px-2 pb-[env(safe-area-inset-bottom)] pt-2 backdrop-blur"><div className="mx-auto grid max-w-xl grid-cols-4 gap-1"><a href="/admin/ebay-seller-os" aria-current="page" className="flex min-h-14 flex-col items-center justify-center rounded-xl bg-white text-[11px] font-black text-black"><span className="text-lg">⌂</span>Inicio</a><a href="/admin/ebay/mobile-review" className="flex min-h-14 flex-col items-center justify-center rounded-xl text-[11px] font-black text-white/65"><span className="text-lg">⌕</span>Oportunidades</a><a href="/admin/ebay/mobile-review?section=in-progress" className="flex min-h-14 flex-col items-center justify-center rounded-xl text-[11px] font-black text-white/65"><span className="text-lg">◷</span>En curso</a><a href="/admin/ebay/mobile-review?section=alerts" className="flex min-h-14 flex-col items-center justify-center rounded-xl text-[11px] font-black text-white/65"><span className="text-lg">!</span>Alertas</a></div></nav>
    </main>
  )
}
