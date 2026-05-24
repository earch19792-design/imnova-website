{/* 
================================================
MENÚ PRINCIPAL
SECCIÓN: TÉRMINOS Y CONDICIONES
COMPONENTE: TermsPage
================================================
*/}

export const metadata = {
  title: "Términos y Condiciones | IMNOVA GROUP LLC",
  description:
    "Términos y condiciones legales de IMNOVA GROUP LLC relacionados con el uso de la plataforma, productos y servicios.",
}

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-black via-zinc-950 to-black text-white px-6 py-24">

      <div className="mx-auto max-w-5xl">

        {/* Back Button */}
        <a
          href="/"
          className="
            inline-flex
            items-center
            mb-12
            text-sm
            uppercase
            tracking-[0.25em]
            text-zinc-500
            transition-colors
            duration-300
            hover:text-cyan-300
          "
        >
          ← Volver al inicio
        </a>

        {/* HERO */}
        <section className="relative isolate overflow-hidden">

          {/* Background Glow */}
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(0,255,255,0.08),transparent_55%)]" />

          <div className="relative z-10">

            {/* Badge */}
            <div className="inline-flex items-center rounded-full border border-cyan-400/20 bg-white/[0.04] px-5 py-2 backdrop-blur-2xl">
              <span className="text-xs uppercase tracking-[0.35em] text-cyan-300">
                Legal · IMNOVA
              </span>
            </div>

            {/* Title */}
            <h1 className="mt-10 text-5xl font-black leading-[1.02] tracking-[-0.04em] sm:text-6xl md:text-7xl">

              Términos y{" "}

              <span className="bg-gradient-to-r from-cyan-200 via-cyan-400 to-white bg-clip-text text-transparent">
                Condiciones
              </span>

            </h1>

            {/* Divider */}
            <div className="mt-10 h-[2px] w-28 rounded-full bg-white/10" />

            {/* Description */}
            <p className="mt-10 max-w-3xl text-lg leading-relaxed text-zinc-400 md:text-xl">
              Transparencia, innovación y compromiso con el desarrollo
              de tecnología, bienestar y marcas orientadas al futuro.
            </p>

          </div>

        </section>

        {/* CONTENT */}
        <section className="mt-20 space-y-8">

          {/* Card 1 */}
          <div
            className="
              rounded-[36px]
              border
              border-white/10
              bg-white/[0.04]
              p-10
              backdrop-blur-2xl
              shadow-[0_0_80px_rgba(0,255,255,0.03)]
            "
          >

            <h2 className="text-2xl font-bold text-white">
              Uso de la Plataforma
            </h2>

            <p className="mt-6 text-zinc-400 leading-relaxed">
              Este sitio web es operado por{" "}
              <strong className="text-white">
                IMNOVA GROUP LLC
              </strong>.
            </p>

            <p className="mt-6 text-zinc-400 leading-relaxed">
              El contenido presentado tiene fines informativos,
              comerciales y relacionados con innovación,
              tecnología, nutrición funcional, wellness
              y desarrollo de productos premium.
            </p>

            <p className="mt-6 text-zinc-400 leading-relaxed">
              El acceso y uso de esta plataforma implica
              la aceptación de los presentes términos
              y condiciones por parte del usuario.
            </p>

          </div>

          {/* Card 2 */}
          <div
            className="
              rounded-[36px]
              border
              border-white/10
              bg-white/[0.04]
              p-10
              backdrop-blur-2xl
              shadow-[0_0_80px_rgba(0,255,255,0.03)]
            "
          >

            <h2 className="text-2xl font-bold text-white">
              Productos y Desarrollo
            </h2>

            <p className="mt-6 text-zinc-400 leading-relaxed">
              Las marcas, conceptos, productos,
              prototipos y soluciones exhibidas
              en esta plataforma pueden encontrarse
              en fase de desarrollo, validación comercial,
              pruebas de laboratorio o expansión internacional.
            </p>

            <p className="mt-6 text-zinc-400 leading-relaxed">
              IMNOVA GROUP LLC trabaja continuamente
              en innovación, diseño y optimización
              de experiencias orientadas al ecommerce
              global y tecnologías enfocadas en bienestar
              y rendimiento humano.
            </p>

          </div>

          {/* Card 3 */}
          <div
            className="
              rounded-[36px]
              border
              border-white/10
              bg-white/[0.04]
              p-10
              backdrop-blur-2xl
              shadow-[0_0_80px_rgba(0,255,255,0.03)]
            "
          >

            <h2 className="text-2xl font-bold text-white">
              Modificaciones y Actualizaciones
            </h2>

            <p className="mt-6 text-zinc-400 leading-relaxed">
              IMNOVA GROUP LLC se reserva el derecho
              de actualizar, modificar, reemplazar
              o discontinuar contenido, servicios,
              productos, información o funcionalidades
              presentadas en esta plataforma
              sin previo aviso.
            </p>

            <p className="mt-6 text-zinc-400 leading-relaxed">
              La empresa podrá realizar mejoras continuas
              relacionadas con diseño, experiencia digital,
              innovación tecnológica y estrategias comerciales.
            </p>

          </div>

          {/* Corporate Card */}
          <div
            className="
              rounded-[40px]
              border
              border-cyan-400/10
              bg-cyan-400/[0.03]
              p-12
              backdrop-blur-2xl
              shadow-[0_0_120px_rgba(0,255,255,0.05)]
            "
          >

            <p className="text-xs uppercase tracking-[0.35em] text-cyan-300">
              Información Corporativa
            </p>

            <h2 className="mt-6 text-4xl font-black text-white">
              IMNOVA GROUP LLC
            </h2>

            <div className="mt-8 space-y-3 text-zinc-300 leading-relaxed">

              <p>
                30 N Gould St Ste N
              </p>

              <p>
                Sheridan, WY 82801
              </p>

              <p>
                United States
              </p>

            </div>

          </div>

        </section>

        {/* Bottom Indicators */}
        <section className="mt-20">

          <div className="flex flex-wrap items-center justify-center gap-6 text-center text-xs uppercase tracking-[0.3em] text-zinc-600">

            <span>Innovación</span>
            <span>•</span>
            <span>Legal</span>
            <span>•</span>
            <span>Transparencia</span>
            <span>•</span>
            <span>Ecommerce Global</span>

          </div>

        </section>

      </div>

    </main>
  )
}