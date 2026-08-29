import { SellerOsMobileNav } from "../ebay/components/seller-os-mobile-nav"
import { SellerOsDesktopNavigation } from "../ebay/components/seller-os-desktop-navigation"
import { SellerOsDisasterRecoveryCard } from "../ebay/components/seller-os-disaster-recovery-card"
import {
  CommercialMonitorReadonlyEntryCard as CommercialMonitorPanel,
} from "../ebay/monitor/commercial-monitor-readonly-entry-card"

const actions = [
  {
    href: "/admin/ebay/mobile-review",
    eyebrow: "Empieza aquí · móvil",
    title: "Centro de mando",
    copy: "Descubre, valida y prepara el producto con mayor prioridad desde una sola cola.",
    tone: "border-emerald-200/25 bg-emerald-200/[0.08]",
    cta: "Abrir centro →",
  },
  {
    href: "/admin/ebay/opportunity-queue",
    eyebrow: "Vista técnica",
    title: "Cola de oportunidades",
    copy: "Inspecciona análisis, evidencia, controles y orden canónico con más detalle.",
    tone: "border-violet-200/20 bg-violet-200/[0.06]",
    cta: "Ver cola →",
  },
]

const operationLinks = [
  {
    href: "/admin/ebay/monitor",
    title: "Monitor comercial · Solo lectura",
    copy: "Observa identidad, cobertura, métricas, stock, Product Case, experimentos y calidad sin ejecutar cambios.",
    cta: "Abrir monitor →",
  },
  {
    href: "/admin/ebay/listing-optimization",
    title: "Optimizar publicación · Command Center",
    copy: "Cruza Current LIVE, Analytics, StockGuard, experimentos y calidad para priorizar mejoras con evidencia canónica.",
    cta: "Abrir Command Center →",
  },
  {
    href: "/admin/ebay/listings/register",
    title: "Vincular publicación activa",
    copy: "El asistente te ayuda a elegir el producto, confirmar su SKU y verificar el Item ID sin perderte entre pantallas.",
    cta: "Abrir asistente guiado →",
  },
  {
    href: "/admin/ebay/mobile-review?section=in-progress",
    title: "Borradores y revisiones en curso",
    copy: "Continúa validaciones y prepara un borrador únicamente cuando todos los controles estén resueltos.",
    cta: "Ver en curso →",
  },
  {
    href: "/admin/ebay/mobile-review?section=alerts",
    title: "Publicaciones activas y alertas",
    copy: "Sincroniza eBay, revisa vínculos con Luna y atiende riesgos de stock o costo.",
    cta: "Abrir operación →",
  },
  {
    href: "/admin/ebay/seller-performance",
    title: "Rendimiento de publicaciones",
    copy: "Consulta impresiones, CTR, conversión y ventas oficiales para mejorar el ranking.",
    cta: "Ver rendimiento →",
  },
  {
    href: "/admin/ebay/copilot",
    title: "Seller OS Copilot",
    copy: "Pregunta, compara y prioriza con OpenAI sobre evidencia canónica acotada y herramientas exclusivamente de lectura.",
    cta: "Abrir Copilot →",
  },
  {
    href: "/admin/ebay/strategic-review",
    title: "Revisión estratégica de IA",
    copy: "Revisa el resumen diario, señales de coherencia, candidatos de automatización, presupuesto y salud de modelos.",
    cta: "Abrir revisión estratégica →",
  },
]

export default function EbaySellerOsHubPage() {
  return (
    <main className="min-h-screen overflow-x-hidden bg-[#05070d] px-4 pb-28 pt-4 text-white sm:px-6 xl:pl-[248px]">
      <SellerOsDesktopNavigation active="orders" />
      <section className="mx-auto max-w-7xl space-y-4">
        <header className="rounded-3xl border border-white/10 bg-gradient-to-br from-emerald-200/[0.10] via-cyan-200/[0.04] to-black p-5 sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-3"><a href="/admin" className="inline-flex min-h-11 items-center rounded-full border border-white/15 px-4 text-sm font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200">← Inicio</a><span className="rounded-full border border-emerald-200/25 bg-emerald-200/[0.07] px-3 py-2 text-[11px] font-black text-emerald-50">MODO SEGURO</span></div>
          <p className="mt-6 text-xs font-black uppercase tracking-[0.24em] text-emerald-100/60">eBay Seller OS</p>
          <h1 className="mt-2 max-w-3xl text-2xl font-black leading-tight sm:text-3xl">Supervisa la operación; Seller OS ejecuta el trabajo permitido</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-white/65">Luna informa disponibilidad y costo; eBay aporta evidencia propia y de mercado. Tú autorizas las decisiones indispensables.</p>
        </header>

        <section className="rounded-3xl border border-amber-200/20 bg-amber-200/[0.05] p-4">
          <p className="text-xs font-black uppercase tracking-widest text-amber-100/65">Ruta rápida</p>
          <ol className="mt-3 grid grid-cols-2 gap-2 text-center text-[13px] font-black uppercase sm:grid-cols-4"><li className="rounded-xl bg-violet-200 px-2 py-3 text-black">1<br />Descubrir</li><li className="rounded-xl bg-cyan-200 px-2 py-3 text-black">2<br />Validar</li><li className="rounded-xl bg-emerald-200 px-2 py-3 text-black">3<br />Preparar</li><li className="rounded-xl border border-white/15 px-2 py-3 text-white/65">4<br />Borrador manual</li></ol>
        </section>

        <div className="grid gap-3 lg:grid-cols-2">{actions.map((action, index) => <a key={action.href} href={action.href} className={`block min-w-0 rounded-3xl border p-5 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200 active:scale-[0.99] ${action.tone}`}><div className="flex items-start gap-4"><span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-white text-lg font-black text-black">{index + 1}</span><div className="min-w-0"><p className="text-xs font-black uppercase tracking-widest text-white/50">{action.eyebrow}</p><h2 className="mt-2 break-words text-xl font-black">{action.title}</h2><p className="mt-2 text-sm leading-6 text-white/65">{action.copy}</p><span className="mt-4 inline-flex min-h-11 items-center rounded-full bg-white px-4 text-xs font-black text-black">{action.cta}</span></div></div></a>)}</div>

        <section id="operacion" aria-labelledby="operation-heading" className="scroll-mt-4 rounded-3xl border border-cyan-200/20 bg-cyan-200/[0.05] p-4">
          <p className="text-[13px] font-black uppercase tracking-widest text-cyan-100/65">Operación · publicaciones</p>
          <h2 id="operation-heading" className="mt-1 text-xl font-black">De la primera publicación manual a borradores reutilizables</h2>
          <p className="mt-2 text-sm leading-6 text-white/65">Registra lo que eBay aceptó una sola vez; el OS podrá proponer esos campos en productos compatibles, siempre con revisión humana.</p>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {operationLinks.map((item) => (
              <a key={item.href} href={item.href} className="rounded-2xl border border-white/10 bg-black/25 p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200">
                <h3 className="font-black">{item.title}</h3>
                <p className="mt-1 text-sm leading-6 text-white/60">{item.copy}</p>
                <span className="mt-3 inline-flex min-h-11 items-center text-sm font-black text-cyan-50">{item.cta}</span>
              </a>
            ))}
          </div>
        </section>

        <section id="salud" aria-labelledby="health-heading" className="scroll-mt-4 rounded-3xl border border-emerald-200/20 bg-emerald-200/[0.05] p-4">
          <p className="text-xs font-black uppercase tracking-widest text-emerald-100/65">Salud y configuración</p>
          <h2 id="health-heading" className="mt-1 text-xl font-black">Conexiones, límites y auditoría</h2>
          <p className="mt-2 text-sm leading-6 text-white/65">eBay, Luna, captura de investigación de producto, tareas programadas, pausas y cumplimiento se revisan aquí sin exponer credenciales ni nombres técnicos como experiencia principal.</p>
          <div className="mt-4">
            <CommercialMonitorPanel />
          </div>
          <SellerOsDisasterRecoveryCard />
          <details className="mt-4 rounded-2xl border border-white/10 bg-black/25 p-4"><summary className="cursor-pointer font-black">Ver detalles de seguridad</summary><ul className="mt-3 space-y-2 text-sm text-white/60"><li>OpenAI estratégico: lectura y razonamiento acotado</li><li>Generación de imágenes AI: desactivada</li><li>Escrituras eBay: desactivadas</li><li>Producción: sin cambios</li><li>Publicación: requiere autorización separada</li></ul></details>
        </section>

        <aside className="rounded-3xl border border-white/10 bg-white/[0.035] p-4"><h2 className="font-black">Regla de seguridad</h2><p className="mt-2 text-sm leading-6 text-white/60">Los análisis, revisiones y paquetes internos pueden automatizarse. Crear o activar una publicación en eBay requiere una autorización separada y revisión humana.</p></aside>
      </section>

      <SellerOsMobileNav active="orders" />
    </main>
  )
}
