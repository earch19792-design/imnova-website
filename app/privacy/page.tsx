import Link from "next/link"

export const metadata = { title: "Privacidad" }

export default function SellerOsPrivacy() {
  return <main className="min-h-screen bg-[#05070d] px-6 py-12 text-white"><article className="mx-auto max-w-3xl rounded-3xl border border-white/10 bg-white/[0.035] p-6 sm:p-10"><p className="text-xs font-black tracking-[0.24em] text-cyan-200">SELLER OS</p><h1 className="mt-4 text-3xl font-black">Privacidad</h1><div className="mt-6 space-y-5 text-sm leading-7 text-white/65"><p>Seller OS es una herramienta administrativa privada. La portada no registra usuarios, no consulta productos públicos y no carga funciones de comunidad o campañas.</p><p>Las credenciales se validan mediante el proveedor de autenticación configurado. La sesión administrativa del servidor utiliza una cookie segura, HttpOnly y de alcance limitado; no se exponen secretos de servicio al navegador.</p><p>Los datos operativos se procesan sólo para funciones autorizadas de Seller OS y permanecen separados del antiguo dominio de productos.</p></div><Link href="/" className="mt-8 inline-flex rounded-full border border-white/20 px-5 py-3 font-bold">Volver</Link></article></main>
}
