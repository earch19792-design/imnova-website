import { MarketplaceFulfillmentPanel } from
  "../mobile-review/marketplace-fulfillment-panel"

export default function SellerOsSalesPage() {
  return <main className="min-h-screen bg-[#05070d] px-4 pb-28 pt-5 text-white sm:px-6">
    <div className="mx-auto max-w-6xl">
      <header className="border-b border-white/10 pb-5">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-violet-100/60">
          Ventas
        </p>
        <h1 className="mt-2 text-3xl font-black">Órdenes, fulfillment y tracking</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-white/55">
          Una cola común respaldada por órdenes y receipts oficiales. Las
          decisiones comerciales siguen siendo owner-gated.
        </p>
      </header>
      <section className="mt-5">
        <MarketplaceFulfillmentPanel />
      </section>
    </div>
  </main>
}
