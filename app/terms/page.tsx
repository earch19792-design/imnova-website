import Link from "next/link"

export const metadata = { title: "Términos de uso" }

export default function SellerOsTerms() {
  return <main className="min-h-screen bg-[#05070d] px-6 py-12 text-white"><article className="mx-auto max-w-3xl rounded-3xl border border-white/10 bg-white/[0.035] p-6 sm:p-10"><p className="text-xs font-black tracking-[0.24em] text-cyan-200">SELLER OS</p><h1 className="mt-4 text-3xl font-black">Términos de uso</h1><div className="mt-6 space-y-5 text-sm leading-7 text-white/65"><p>Seller OS es una plataforma privada destinada exclusivamente a usuarios administradores autorizados. No ofrece creación pública de cuentas ni servicios de comercio para visitantes.</p><p>Las automatizaciones operan con controles humanos. El acceso no autoriza por sí mismo publicaciones, cambios en marketplaces ni uso de información sin procedencia.</p><p>La plataforma es independiente para gestión de vendedores y no está afiliada ni respaldada oficialmente por eBay.</p></div><Link href="/" className="mt-8 inline-flex rounded-full border border-white/20 px-5 py-3 font-bold">Volver</Link></article></main>
}
