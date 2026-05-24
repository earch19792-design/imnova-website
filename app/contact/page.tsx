export default function ContactPage() {
  return (
    <main className="min-h-screen bg-black text-white px-6 py-24">
      <div className="max-w-4xl mx-auto">
      <a
  href="/"
  className="inline-flex items-center mb-10 text-sm text-zinc-400 hover:text-white transition-colors"
>
  ← Volver al inicio
</a>
        <h1 className="text-5xl font-black">
          Contacto
        </h1>

        <p className="mt-6 text-zinc-400 text-lg">
          Información corporativa y contacto comercial de IMNOVA GROUP LLC.
        </p>

        <div className="mt-12 grid gap-8">

          <div className="rounded-2xl border border-white/10 p-6 bg-white/5">
            <h2 className="text-2xl font-bold mb-4">
              Información Comercial
            </h2>

            <div className="space-y-4 text-zinc-300">

              <p>
                <strong>Empresa:</strong><br />
                IMNOVA GROUP LLC
              </p>

              <p>
                <strong>Correo:</strong><br />
                ceo@vital4life-usa.com
              </p>

              <p>
                <strong>Teléfono:</strong><br />
                +505 5819-9840
              </p>

              <p>
                <strong>Dirección:</strong><br />
                30 N Gould St Ste N<br />
                Sheridan, WY 82801<br />
                United States
              </p>

            </div>
          </div>

        </div>

      </div>
    </main>
  )
}