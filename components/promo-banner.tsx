"use client"

/* 
================================================
MENÚ PRINCIPAL
SECCIÓN: PROMO BANNER
COMPONENTE: PromoBanner
ESTILO: ULTRA PREMIUM · CINEMÁTICO · WELLNESS TECH
================================================
*/

import Link from "next/link"
import { motion } from "framer-motion"

export function PromoBanner() {
  return (
    <section className="relative overflow-hidden py-44 md:py-52">

      {/* =================================================
      BACKGROUND ATMOSPHERE
      ================================================= */}

      <div className="absolute inset-0 overflow-hidden">

        {/* Main Gradient */}
        <div className="absolute inset-0 bg-gradient-to-b from-black via-[#050505] to-black" />

        {/* Ambient Glow Left */}
        <div className="absolute top-0 left-0 h-[700px] w-[700px] rounded-full bg-amber-500/10 blur-[180px]" />

        {/* Ambient Glow Right */}
        <div className="absolute bottom-0 right-0 h-[700px] w-[700px] rounded-full bg-orange-500/10 blur-[180px]" />

        {/* Center Glow */}
        <div className="absolute left-1/2 top-1/2 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-400/5 blur-[140px]" />

        {/* Grid */}
        <div className="absolute inset-0 opacity-[0.02] bg-[linear-gradient(rgba(251,191,36,0.10)_1px,transparent_1px),linear-gradient(90deg,rgba(251,191,36,0.10)_1px,transparent_1px)] bg-[size:90px_90px]" />

      </div>

      {/* =================================================
      MAIN CONTAINER
      ================================================= */}

      <div className="relative z-10 mx-6 overflow-hidden rounded-[52px] border border-white/10 bg-black/40 shadow-[0_30px_140px_rgba(0,0,0,0.45)] backdrop-blur-3xl">

        {/* Gradient Overlay */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.18),transparent_35%),radial-gradient(circle_at_bottom_right,rgba(249,115,22,0.14),transparent_40%)]" />

        {/* Overlay */}
        <div className="absolute inset-0 bg-gradient-to-r from-[#050505]/95 via-[#0a0704]/80 to-[#050505]/95" />

        {/* Noise */}
        <div className="absolute inset-0 opacity-[0.02] bg-[url('/noise.png')]" />

        {/* Floating Glow */}
        <div className="absolute top-10 left-10 h-72 w-72 rounded-full bg-amber-400/10 blur-[120px]" />

        <div className="absolute bottom-10 right-10 h-72 w-72 rounded-full bg-orange-500/10 blur-[120px]" />

        {/* =================================================
        CONTENT
        ================================================= */}

        <div className="relative z-10 mx-auto flex max-w-7xl flex-col gap-16 p-8 md:p-12 lg:flex-row lg:items-center lg:justify-between">

          {/* =================================================
          LEFT SIDE
          ================================================= */}

          <motion.div
            initial={{
              opacity: 0,
              y: 40,
            }}
            whileInView={{
              opacity: 1,
              y: 0,
            }}
            transition={{
              duration: 0.9,
            }}
            viewport={{ once: true }}
            className="max-w-3xl"
          >

            {/* Badge */}
            <div
              className="
                inline-flex
                items-center
                gap-3
                rounded-full
                border
                border-amber-400/30
                bg-amber-400/10
                px-5
                py-3
                backdrop-blur-xl
              "
            >

              <span className="text-amber-300">
                ✦
              </span>

              <span
                className="
                  text-xs
                  uppercase
                  tracking-[0.45em]
                  text-amber-300
                "
              >

                NUEVO LANZAMIENTO

              </span>

            </div>

            {/* Headline */}
            <h2
              className="
                mt-10
                text-5xl
                font-black
                leading-[0.95]
                tracking-[-0.05em]
                text-white
                sm:text-7xl
              "
            >

              Presentamos oficialmente{" "}

              <span className="block bg-gradient-to-r from-amber-300 via-orange-400 to-orange-500 bg-clip-text text-transparent">

                MASH COFFEE+

              </span>

            </h2>

            {/* Description */}
            <p
              className="
                mt-10
                max-w-2xl
                text-xl
                leading-9
                text-zinc-300
              "
            >

              Una nueva generación de café funcional
              diseñada para potenciar energía limpia,
              enfoque mental y rendimiento moderno
              mediante nutrición inteligente.

            </p>

            {/* =================================================
            PROMO BOX
            ================================================= */}

            <motion.div
              whileHover={{
                y: -6,
              }}
              className="
                mt-10
                flex
                flex-col
                gap-6
                rounded-[36px]
                border
                border-amber-400/20
                bg-black/40
                p-6
                shadow-[0_0_80px_rgba(251,191,36,0.08)]
                backdrop-blur-2xl
                sm:flex-row
                sm:items-center
                sm:justify-between
              "
            >

              {/* Left */}
              <div>

                <p
                  className="
                    text-xs
                    uppercase
                    tracking-[0.35em]
                    text-amber-300
                  "
                >

                  PROMOCIÓN DE LANZAMIENTO

                </p>

                <h3
                  className="
                    mt-3
                    text-5xl
                    font-black
                    tracking-[-0.04em]
                    text-white
                  "
                >

                  10% · 15% OFF

                </h3>

                <p className="mt-2 text-sm text-zinc-400">

                  Disponible por tiempo limitado
                  o hasta agotar existencias.

                </p>

              </div>

              {/* Price */}
              <div
                className="
                  rounded-[28px]
                  border
                  border-white/10
                  bg-black/40
                  px-6
                  py-5
                  text-center
                  backdrop-blur-xl
                "
              >

                <p className="text-sm text-zinc-400">
                  Desde
                </p>

                <p
                  className="
                    mt-1
                    text-5xl
                    font-black
                    tracking-[-0.04em]
                    text-amber-300
                  "
                >

                  $17.98

                </p>

                <p className="mt-1 text-xs text-zinc-500">

                  Pack de 6 latas

                </p>

              </div>

            </motion.div>

            {/* =================================================
            CTA BUTTONS
            ================================================= */}

            <div className="mt-10 flex flex-col gap-5 sm:flex-row">

              {/* Primary CTA */}
              <motion.div
                whileHover={{
                  scale: 1.03,
                  y: -3,
                }}
              >

                <Link
                  href="/store"
                  className="
                    inline-flex
                    items-center
                    justify-center
                    rounded-3xl
                    bg-gradient-to-r
                    from-amber-400
                    to-orange-500
                    px-9
                    py-5
                    text-sm
                    font-black
                    uppercase
                    tracking-[0.2em]
                    text-black
                    shadow-[0_0_60px_rgba(251,191,36,0.30)]
                    transition-all
                    duration-500
                    hover:shadow-[0_0_90px_rgba(251,191,36,0.45)]
                  "
                >

                  Ir a la Tienda →

                </Link>

              </motion.div>

              {/* Secondary CTA */}
              <div
                className="
                  inline-flex
                  items-center
                  justify-center
                  rounded-3xl
                  border
                  border-amber-400/20
                  bg-black/30
                  px-7
                  py-5
                  text-sm
                  font-semibold
                  uppercase
                  tracking-[0.18em]
                  text-amber-200
                  backdrop-blur-xl
                "
              >

                10% OFF 6 PACK · 15% OFF 12 PACK

              </div>

            </div>

            {/* =================================================
            BENEFITS
            ================================================= */}

            <div className="mt-10 flex flex-wrap gap-4">

              {[
                "✓ Energía limpia",
                "✓ Zero Azúcar",
                "✓ Enfoque y rendimiento",
                "✓ Colágeno Marino",
                "✓ Vitaminas esenciales",
              ].map((item) => (

                <motion.span
                  key={item}
                  whileHover={{
                    y: -3,
                  }}
                  className="
                    rounded-full
                    border
                    border-white/10
                    bg-white/[0.04]
                    px-5
                    py-3
                    text-sm
                    text-zinc-200
                    backdrop-blur-xl
                    transition-all
                    duration-300
                    hover:border-amber-400/20
                  "
                >

                  {item}

                </motion.span>

              ))}

            </div>

            {/* =================================================
            TRUST INDICATORS
            ================================================= */}

            <div
              className="
                mt-10
                flex
                flex-wrap
                gap-6
                text-xs
                uppercase
                tracking-[0.3em]
                text-zinc-500
              "
            >

              <span>Envío Internacional</span>
              <span>•</span>

              <span>Stock Limitado</span>
              <span>•</span>

              <span>Lanzamiento Oficial</span>

            </div>

          </motion.div>

          {/* =================================================
          RIGHT SIDE MOCKUPS
          ================================================= */}

          <motion.div
            initial={{
              opacity: 0,
              scale: 0.92,
            }}
            whileInView={{
              opacity: 1,
              scale: 1,
            }}
            transition={{
              duration: 1,
            }}
            viewport={{ once: true }}
            className="
              relative
              flex
              items-end
              justify-center
              gap-6
              lg:w-[55%]
            "
          >

            {/* LEFT MOCKUP */}
            <motion.div
              whileHover={{
                y: -8,
                scale: 1.03,
              }}
              className="relative translate-y-4"
            >

              {/* Discount Badge */}
              <div
                className="
                  absolute
                  right-0
                  top-4
                  z-20
                  rounded-full
                  border
                  border-white/10
                  bg-amber-400
                  px-5
                  py-2
                  text-sm
                  font-black
                  text-black
                  backdrop-blur-xl
                  shadow-[0_0_40px_rgba(251,191,36,0.35)]
                "
              >

                10% OFF

              </div>

              {/* Glow */}
              <div className="absolute inset-0 rounded-full bg-amber-400/10 blur-[80px]" />

              {/* Image */}
              <img
                src="/images/mash-6pack.png"
                alt="Mash Coffee 6 Pack"
                className="
                  relative
                  z-10
                  w-[270px]
                  drop-shadow-[0_0_60px_rgba(255,140,0,0.30)]
                  transition-all
                  duration-700
                "
              />

            </motion.div>

            {/* RIGHT MOCKUP */}
            <motion.div
              whileHover={{
                y: -8,
                scale: 1.03,
              }}
              className="relative -translate-y-4"
            >

              {/* Discount Badge */}
              <div
                className="
                  absolute
                  right-0
                  top-4
                  z-20
                  rounded-full
                  border
                  border-white/10
                  bg-orange-500
                  px-5
                  py-2
                  text-sm
                  font-black
                  text-black
                  backdrop-blur-xl
                  shadow-[0_0_40px_rgba(249,115,22,0.35)]
                "
              >

                15% OFF

              </div>

              {/* Glow */}
              <div className="absolute inset-0 rounded-full bg-orange-500/10 blur-[90px]" />

              {/* Image */}
              <img
                src="/images/mash-12pack.png"
                alt="Mash Coffee 12 Pack"
                className="
                  relative
                  z-10
                  w-[360px]
                  drop-shadow-[0_0_80px_rgba(255,140,0,0.35)]
                  transition-all
                  duration-700
                "
              />

            </motion.div>

          </motion.div>

        </div>

      </div>

    </section>
  )
}

export default PromoBanner