export function CommercialMonitorReadonlyEntryCard() {
  return (
    <a
      href="/admin/ebay/monitor"
      className="block rounded-3xl border border-cyan-200/25 bg-cyan-200/[0.07] p-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-black uppercase tracking-widest text-cyan-100/60">
            Commercial Monitor V1
          </p>
          <h3 className="mt-1 text-lg font-black">Abrir cockpit READ-ONLY</h3>
        </div>
        <span className="rounded-full bg-cyan-100 px-3 py-1.5 text-[10px] font-black text-black">
          GET ONLY
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-white/65">
        Consulta listings, métricas, stock, Product Case, experimentos, blockers
        y alert candidates sin handlers de ejecución ni dispatch externo.
      </p>
      <span className="mt-4 inline-flex min-h-11 items-center font-black text-cyan-50">
        Ver estado comercial →
      </span>
    </a>
  )
}
