import Link from "next/link"

export default function Retired888LotsPage() {
  return <main className="mx-auto max-w-4xl space-y-5 p-5 text-white sm:p-8">
    <section className="rounded-3xl border border-amber-200/20 bg-amber-200/[0.08] p-6">
      <p className="text-xs font-black uppercase tracking-[0.16em] text-amber-100/60">
        Proveedor retirado
      </p>
      <h1 className="mt-2 text-3xl font-black">888lots ya no forma parte del abastecimiento</h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-white/60">
        El proveedor está en proceso de cierre. Seller OS no actualizará su
        catálogo, no propondrá productos nuevos y no utilizará sus costos ni su
        inventario para decisiones. El historial anterior se conserva sólo para
        auditoría y aprendizaje.
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <Link href="/admin/marketplace/amazon/connie"
          className="min-h-11 rounded-xl bg-emerald-200 px-4 py-3 font-black text-emerald-950">
          Ir a Amazon · Connie
        </Link>
        <Link href="/admin"
          className="min-h-11 rounded-xl border border-white/15 px-4 py-3 font-bold">
          Volver al Dashboard
        </Link>
      </div>
    </section>
    <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
      <h2 className="text-xl font-black">Qué cambia</h2>
      <ul className="mt-3 grid gap-2 text-sm text-white/60">
        <li>• 0 productos nuevos recomendados desde 888lots.</li>
        <li>• 0 lecturas nuevas del catálogo del proveedor.</li>
        <li>• Los expedientes existentes permanecen como historial de sólo lectura.</li>
        <li>• El trabajo activo pasa al flujo general de Amazon con Connie y sus distribuidores.</li>
      </ul>
    </section>
  </main>
}
