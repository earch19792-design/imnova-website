```tsx
"use client"

import Link from "next/link"

import {
  motion,
} from "framer-motion"

import {
  ArrowRight,
  ChevronDown,
  Zap,
  Globe,
  FlaskConical,
  Rocket,
  MapPin,
} from "lucide-react"

import { products } from "@/data/products"

export function HeroSection() {

  /* =========================================
  STATUS CONFIG
  ========================================= */

  const statusConfig: Record<
    string,
    {
      progress: number
      label: string
    }
  > = {

    "💡 Idea inicial": {
      progress: 10,
      label: "Idea inicial",
    },

    "⚙️ Desarrollo": {
      progress: 35,
      label: "Desarrollo",
    },

    "🧪 Probando mejoras": {
      progress: 65,
      label: "Probando mejoras",
    },

    "🔥 Preparando lanzamiento": {
      progress: 90,
      label: "Preparando lanzamiento",
    },

    "🌎 Comercialización": {
      progress: 100,
      label: "Comercialización",
    },

  }

  /* =========================================
  LIVE PRODUCT METRICS
  ========================================= */

  const launchingProducts =
    products.filter(
      p =>
        p.status ===
        "🔥 Preparando lanzamiento"
    ).length

  const activeProducts =
    products.length

  const commercialProducts =
    products.filter(
      p =>
        p.status ===
        "🌎 Comercialización"
    ).length

  const testingProducts =
    products.filter(
      p =>
        p.status ===
        "🧪 Probando mejoras"
    ).length

  const productsInDevelopment =
    products
      .filter(
        p =>
          p.status !==
          "🌎 Comercialización"
      )
      .slice(0, 3)

  const commercializationCities = [
    "Managua",
    "León",
    "MercadosX",
  ]

  /* =========================================
  HERO
  ========================================= */

  return (

    <section
      className="
        relative
        min-h-screen
        overflow-hidden
        bg-black
        px-6
        pt-10
        text-white
      "
    >

      {/* BACKGROUND FX */}

      <div
        className="
          absolute
          inset-0
          bg-[radial-gradient(circle_at_top,rgba(0,255,255,0.15),transparent_40%)]
        "
      />

      <div
        className="
          absolute
          inset-0
          opacity-[0.04]
          [background-image:linear-gradient(to_right,#00ffff_1px,transparent_1px),linear-gradient(to_bottom,#00ffff_1px,transparent_1px)]
          [background-size:80px_80px]
        "
      />

      {/* NAVBAR */}

      <div
        className="
          relative
          z-20
          mx-auto
          flex
          max-w-7xl
          items-center
          justify-between
          rounded-[36px]
          border
          border-cyan-400/10
          bg-black/50
          px-8
          py-6
          backdrop-blur-2xl
        "
      >

        <div className="flex items-center gap-5">

          <div
            className="
              flex
              h-16
              w-16
              items-center
              justify-center
              rounded-3xl
              bg-gradient-to-br
              from-cyan-400
              to-blue-500
              text-3xl
              font-black
            "
          >
            I
          </div>

          <div>

            <div
              className="
                text-4xl
                font-black
                tracking-tight
              "
            >
              IMNOVA
            </div>

            <div
              className="
                text-sm
                uppercase
                tracking-[0.45em]
                text-cyan-300
              "
            >
              Tecnología · Nutrición · Bienestar
            </div>

          </div>

        </div>

        <div className="flex items-center gap-4">

          <Link
            href="/labs"
            className="
              rounded-2xl
              border
              border-white/10
              px-6
              py-4
              text-sm
              uppercase
              tracking-[0.35em]
              text-white/80
              transition-all
              hover:border-cyan-400/30
              hover:text-cyan-300
            "
          >
            IMNOVA LABS
          </Link>

          <button
            className="
              flex
              items-center
              gap-4
              rounded-2xl
              border
              border-white/10
              px-6
              py-4
              text-sm
              uppercase
              tracking-[0.35em]
              text-white/80
              transition-all
              hover:border-cyan-400/30
              hover:text-cyan-300
            "
          >

            MENU

            <div className="space-y-1">

              <div className="h-[2px] w-6 bg-white" />
              <div className="h-[2px] w-6 bg-white" />
              <div className="h-[2px] w-6 bg-white" />

            </div>

          </button>

        </div>

      </div>

      {/* HERO CONTENT */}

      <div
        className="
          relative
          z-10
          mx-auto
          mt-24
          grid
          max-w-7xl
          gap-16
          lg:grid-cols-2
        "
      >

        {/* LEFT */}

        <motion.div
          initial={{
            opacity: 0,
            y: 40,
          }}
          animate={{
            opacity: 1,
            y: 0,
          }}
          transition={{
            duration: 1,
          }}
        >

          <div
            className="
              inline-flex
              items-center
              gap-3
              rounded-full
              border
              border-cyan-400/20
              bg-cyan-400/5
              px-5
              py-2
              text-sm
              uppercase
              tracking-[0.35em]
              text-cyan-300
            "
          >

            <Zap className="h-4 w-4" />

            Innovación inteligente

          </div>

          <h1
            className="
              mt-8
              text-6xl
              font-black
              leading-[0.95]
              tracking-tight
              md:text-8xl
            "
          >

            Construimos

            <span
              className="
                bg-gradient-to-r
                from-cyan-300
                via-white
                to-cyan-500
                bg-clip-text
                text-transparent
              "
            >
              {" "}
              tecnología,
            </span>

            <br />

            nutrición y bienestar moderno.

          </h1>

          <p
            className="
              mt-10
              max-w-2xl
              text-2xl
              leading-relaxed
              text-zinc-400
            "
          >

            Innovaciones enfocadas en bienestar,
            innovación funcional y tecnología aplicada
            para consumidores globales que buscan una
            vida más inteligente, eficiente y equilibrada.

          </p>

          {/* CTA */}

          <div className="mt-12 flex flex-wrap gap-5">

            <Link
              href="/labs"
              className="
                flex
                items-center
                gap-3
                rounded-3xl
                bg-cyan-400
                px-8
                py-5
                text-lg
                font-black
                text-black
                transition-all
                hover:scale-105
              "
            >

              Explorar innovaciones

              <ArrowRight className="h-5 w-5" />

            </Link>

            <Link
              href="/admin"
              className="
                rounded-3xl
                border
                border-white/10
                px-8
                py-5
                text-lg
                font-semibold
                text-white
                transition-all
                hover:border-cyan-400/30
                hover:text-cyan-300
              "
            >
              IMNOVA CORE
            </Link>

          </div>

          {/* FLOATING DEVELOPMENT PRODUCTS */}

          <div
            className="
              mt-14
              rounded-[32px]
              border
              border-cyan-400/10
              bg-black/40
              p-6
              backdrop-blur-2xl
            "
          >

            <div className="flex items-center justify-between">

              <div>

                <div className="text-xl font-black">
                  3 productos en desarrollo
                </div>

                <div className="mt-1 text-sm text-zinc-400">
                  Progreso automático según estado del producto
                </div>

              </div>

              <div
                className="
                  rounded-2xl
                  bg-cyan-400/10
                  px-4
                  py-2
                  text-sm
                  font-bold
                  text-cyan-300
                "
              >
                LIVE
              </div>

            </div>

            <div className="mt-6 space-y-5">

              {productsInDevelopment.map((product, index) => {

                const config =
                  statusConfig[
                    product.status
                  ] || {
                    progress: 0,
                    label: "Sin estado",
                  }

                return (

                  <motion.div
                    key={index}
                    whileHover={{
                      scale: 1.01,
                    }}
                    className="
                      rounded-3xl
                      border
                      border-white/5
                      bg-white/[0.03]
                      p-5
                    "
                  >

                    <div className="flex items-center justify-between gap-5">

                      <div>

                        <div className="text-lg font-bold text-white">
                          {product.name}
                        </div>

                        <div className="mt-1 text-sm text-zinc-400">
                          {config.label}
                        </div>

                      </div>

                      <div className="text-right">

                        <div className="text-2xl font-black text-cyan-300">
                          {config.progress}%
                        </div>

                        <div className="text-xs uppercase tracking-[0.3em] text-zinc-500">
                          progreso
                        </div>

                      </div>

                    </div>

                    <div className="mt-4 h-3 overflow-hidden rounded-full bg-white/5">

                      <motion.div
                        initial={{
                          width: 0,
                        }}
                        animate={{
                          width: `${config.progress}%`,
                        }}
                        transition={{
                          duration: 1,
                        }}
                        className="
                          h-full
                          rounded-full
                          bg-gradient-to-r
                          from-cyan-400
                          to-blue-500
                        "
                      />

                    </div>

                  </motion.div>

                )

              })}

            </div>

            <div
              className="
                mt-6
                rounded-3xl
                border
                border-emerald-400/10
                bg-emerald-400/5
                p-5
              "
            >

              <div className="flex items-center gap-3 text-emerald-300">

                <MapPin className="h-5 w-5" />

                <span className="font-bold">
                  Distribución activa
                </span>

              </div>

              <div className="mt-4 flex flex-wrap gap-3">

                {commercializationCities.map((city, index) => (

                  <div
                    key={index}
                    className="
                      rounded-2xl
                      border
                      border-white/10
                      bg-black/30
                      px-4
                      py-2
                      text-sm
                      font-semibold
                      text-white
                    "
                  >
                    {city}
                  </div>

                ))}

              </div>

            </div>

          </div>

          {/* METRICS */}

          <div className="mt-20 grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">

            <motion.div
              whileHover={{
                scale: 1.04,
                y: -6,
              }}
              className="
                group
                relative
                overflow-hidden
                rounded-[34px]
                border
                border-cyan-400/10
                bg-black/40
                p-8
                backdrop-blur-2xl
              "
            >

              <div className="relative z-10">

                <div
                  className="
                    mb-6
                    flex
                    h-16
                    w-16
                    items-center
                    justify-center
                    rounded-2xl
                    bg-cyan-400/10
                    text-cyan-300
                  "
                >
                  <Rocket className="h-8 w-8" />
                </div>

                <div className="text-6xl font-black text-white">
                  {launchingProducts}+
                </div>

                <div
                  className="
                    mt-4
                    text-sm
                    uppercase
                    tracking-[0.35em]
                    text-zinc-400
                  "
                >
                  Marca en lanzamiento
                </div>

              </div>

            </motion.div>

            <motion.div
              whileHover={{
                scale: 1.04,
                y: -6,
              }}
              className="
                group
                relative
                overflow-hidden
                rounded-[34px]
                border
                border-purple-400/10
                bg-black/40
                p-8
                backdrop-blur-2xl
              "
            >

              <div className="relative z-10">

                <div
                  className="
                    mb-6
                    flex
                    h-16
                    w-16
                    items-center
                    justify-center
                    rounded-2xl
                    bg-purple-400/10
                    text-purple-300
                  "
                >
                  <Zap className="h-8 w-8" />
                </div>

                <div className="text-6xl font-black text-white">
                  {activeProducts}
                </div>

                <div
                  className="
                    mt-4
                    text-sm
                    uppercase
                    tracking-[0.35em]
                    text-zinc-400
                  "
                >
                  Innovaciones activas
                </div>

              </div>

            </motion.div>

            <motion.div
              whileHover={{
                scale: 1.04,
                y: -6,
              }}
              className="
                group
                relative
                overflow-hidden
                rounded-[34px]
                border
                border-yellow-400/10
                bg-black/40
                p-8
                backdrop-blur-2xl
              "
            >

              <div className="relative z-10">

                <div
                  className="
                    mb-6
                    flex
                    h-16
                    w-16
                    items-center
                    justify-center
                    rounded-2xl
                    bg-yellow-400/10
                    text-yellow-300
                  "
                >
                  <FlaskConical className="h-8 w-8" />
                </div>

                <div className="text-6xl font-black text-white">
                  {testingProducts}
                </div>

                <div
                  className="
                    mt-4
                    text-sm
                    uppercase
                    tracking-[0.35em]
                    text-zinc-400
                  "
                >
                  En laboratorio
                </div>

              </div>

            </motion.div>

            <motion.div
              whileHover={{
                scale: 1.04,
                y: -6,
              }}
              className="
                group
                relative
                overflow-hidden
                rounded-[34px]
                border
                border-emerald-400/10
                bg-black/40
                p-8
                backdrop-blur-2xl
              "
            >

              <div className="relative z-10">

                <div
                  className="
                    mb-6
                    flex
                    h-16
                    w-16
                    items-center
                    justify-center
                    rounded-2xl
                    bg-emerald-400/10
                    text-emerald-300
                  "
                >
                  <Globe className="h-8 w-8" />
                </div>

                <div className="text-6xl font-black text-white">

                  {commercialProducts > 0
                    ? "Global"
                    : "Soon"}

                </div>

                <div
                  className="
                    mt-4
                    text-sm
                    uppercase
                    tracking-[0.35em]
                    text-zinc-400
                  "
                >
                  Expansión internacional
                </div>

              </div>

            </motion.div>

          </div>

        </motion.div>

        {/* RIGHT VISUAL */}

        <motion.div
          initial={{
            opacity: 0,
            scale: 0.9,
          }}
          animate={{
            opacity: 1,
            scale: 1,
          }}
          transition={{
            duration: 1.2,
          }}
          className="
            relative
            hidden
            items-center
            justify-center
            lg:flex
          "
        >

          <div
            className="
              absolute
              h-[550px]
              w-[550px]
              rounded-full
              bg-cyan-400/10
              blur-[120px]
            "
          />

          <div
            className="
              relative
              flex
              h-[520px]
              w-[520px]
              items-center
              justify-center
              rounded-full
              border
              border-cyan-400/10
              bg-black/40
              backdrop-blur-3xl
            "
          >

            <div
              className="
                absolute
                inset-10
                rounded-full
                border
                border-cyan-400/10
              "
            />

            <div
              className="
                absolute
                inset-20
                rounded-full
                border
                border-cyan-400/10
              "
            />

            <div
              className="
                absolute
                inset-32
                rounded-f
```
