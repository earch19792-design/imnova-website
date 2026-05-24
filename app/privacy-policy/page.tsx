{/* 
================================================
MENÚ PRINCIPAL
SECCIÓN: POLÍTICA DE PRIVACIDAD
COMPONENTE: PrivacyPolicyPage
================================================
*/}

export const metadata = {
  title: "Política de Privacidad | IMNOVA GROUP LLC",
  description:
    "Política de privacidad y manejo de información de IMNOVA GROUP LLC.",
}

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-black via-zinc-950 to-black text-white px-6 py-24">
      <div className="mx-auto max-w-5xl">

        {/* Back Button */}
        <a
          href="/"
          className="inline-flex items-center mb-12 text-sm text-zinc-500 hover:text-white transition-colors tracking-wide"
        >
          ← Volver al inicio
        </a>

        {/* Hero */}
        <section className="relative">

          <p className="uppercase tracking-[0.35em] text-zinc-500 text-sm">
            Seguridad · Transparencia · Confianza
          </p>

          <h1 className="mt-6 text-5xl md:text-7xl font-black leading-tight">
            Política de Privacidad
          </h1>

          <div className="mt-8 h-[2px] w-28 rounded-full bg-white/10" />

          <p className="mt-10 max-w-4xl text-lg md:text-xl leading-relaxed text-zinc-400">
            En IMNOVA GROUP LLC valoramos la privacidad y la protección de la
            información de nuestros usuarios, clientes, proveedores y socios
            comerciales.
          </p>

        </section>

        {/* Content */}
        <section className="mt-20">

          <div className="space-y-8">

            {/* Card 1 */}
            <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-8 backdrop-blur-2xl">
              <h2 className="text-2xl font-bold">
                Compromiso con la Privacidad
              </h2>

              <p className="mt-5 text-zinc-400 leading-relaxed">
                Nos comprometemos a manejar toda la información de manera
                responsable, segura y conforme a las buenas prácticas digitales,
                comerciales y operativas aplicables al entorno de ecommerce
                internacional y desarrollo empresarial.
              </p>
            </div>

            {/* Card 2 */}
            <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-8 backdrop-blur-2xl">
              <h2 className="text-2xl font-bold">
                Información Recopilada
              </h2>

              <p className="mt-5 text-zinc-400 leading-relaxed">
                La información recopilada a través de este sitio web puede
                incluir datos de contacto, consultas comerciales, solicitudes
                de información, comunicaciones relacionadas con productos y
                datos vinculados a operaciones de comercio electrónico,
                innovación y desarrollo de marcas.
              </p>
            </div>

            {/* Card 3 */}
            <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-8 backdrop-blur-2xl">
              <h2 className="text-2xl font-bold">
                Uso de la Información
              </h2>

              <p className="mt-5 text-zinc-400 leading-relaxed">
                La información proporcionada mediante formularios de contacto
                o canales de comunicación podrá utilizarse para atención al
                cliente, coordinación con proveedores, soporte comercial,
                desarrollo de productos, procesos operativos y actividades
                relacionadas con marketplaces digitales, comercio internacional
                y plataformas de ecommerce.
              </p>
            </div>

            {/* Card 4 */}
            <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-8 backdrop-blur-2xl">
              <h2 className="text-2xl font-bold">
                Protección de Datos
              </h2>

              <p className="mt-5 text-zinc-400 leading-relaxed">
                IMNOVA GROUP LLC no vende, alquila ni comparte información
                personal con terceros para fines comerciales no autorizados.
                Implementamos medidas razonables de protección para preservar
                la seguridad y confidencialidad de la información recibida.
              </p>
            </div>

            {/* Card 5 */}
            <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-8 backdrop-blur-2xl">
              <h2 className="text-2xl font-bold">
                Cookies y Herramientas Analíticas
              </h2>

              <p className="mt-5 text-zinc-400 leading-relaxed">
                Este sitio web puede utilizar cookies y herramientas analíticas
                con el objetivo de mejorar la experiencia del usuario,
                optimizar el rendimiento de la plataforma y comprender de forma
                general la interacción de los visitantes con nuestros servicios.
              </p>
            </div>

            {/* Contact Card */}
            <div className="rounded-[32px] border border-cyan-400/10 bg-white/[0.05] p-10 backdrop-blur-2xl shadow-[0_0_80px_rgba(0,255,255,0.05)]">

              <p className="text-sm uppercase tracking-[0.3em] text-cyan-300">
                Contacto de Privacidad
              </p>

              <h2 className="mt-5 text-3xl font-black">
                IMNOVA GROUP LLC
              </h2>

              <div className="mt-8 space-y-4 text-zinc-400 leading-relaxed">

                <p>
                  ceo@vital4life-usa.com
                </p>

                <p>
                  30 N Gould St Ste N <br />
                  Sheridan, WY 82801 <br />
                  United States
                </p>

              </div>

            </div>

          </div>

        </section>

      </div>
    </main>
  )
}