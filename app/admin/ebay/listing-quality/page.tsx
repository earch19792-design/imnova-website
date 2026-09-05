import { OwnerListingQualityReportControl } from
  "@/app/admin/owner-listing-quality-report-control"

export default function SellerOsListingQualityPage() {
  return <main className="min-h-screen bg-[#05070d] px-4 pb-28 pt-5 text-white sm:px-6">
    <div className="mx-auto max-w-6xl">
      <header className="border-b border-white/10 pb-5">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-100/60">
          Listings LIVE · Listing Quality
        </p>
        <h1 className="mt-2 text-3xl font-black">Calidad del portafolio</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-white/55">
          El informe se reconcilia con el conjunto LIVE oficial. Un reporte
          ausente o vencido nunca se convierte en cero.
        </p>
      </header>
      <OwnerListingQualityReportControl />
    </div>
  </main>
}
