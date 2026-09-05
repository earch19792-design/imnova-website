import { PostSaleReadModel } from "./post-sale-read-model"

export default function SellerOsPostSalePage() {
  return <main className="min-h-screen bg-[#05070d] px-4 pb-28 pt-5 text-white sm:px-6">
    <div className="mx-auto max-w-6xl">
      <header className="border-b border-white/10 pb-5">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-100/60">
          Postventa
        </p>
        <h1 className="mt-2 text-3xl font-black">
          Comunicación, alertas y excepciones
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-white/55">
          Estado respaldado por órdenes oficiales y receipts de entrega. Un
          mecanismo armado no se presenta como una entrega realizada.
        </p>
      </header>
      <section className="mt-5"><PostSaleReadModel /></section>
    </div>
  </main>
}
