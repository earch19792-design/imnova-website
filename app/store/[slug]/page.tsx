"use client"

/* 
================================================
MENÚ PRINCIPAL
SECCIÓN: PRODUCTOS
COMPONENTE: ProductPage
NEXT.JS 16 FIXED VERSION
================================================
*/

import { use } from "react"

import Image from "next/image"
import Link from "next/link"

import { notFound } from "next/navigation"

import products from "../../../lib/products"

/* =================================================
PRODUCT EXPERIENCES
================================================= */

const productExperiences: Record<string, any> = {

  /* =========================================
  MASH COFFEE
  ========================================= */

  "mash-coffee": {

    badge:
      "TECNOLOGÍA PARA EL RENDIMIENTO HUMANO",

    headline:
      "Café funcional diseñado para claridad mental y energía sostenida.",

    whyTitle:
      "Diseñado para productividad y rendimiento diario.",

    whyText:
      "Mash Coffee+ fue creado para personas que necesitan enfoque, energía limpia y bienestar funcional sin recurrir a bebidas tradicionales cargadas de azúcar.",

    experienceTitle:
      "Diseñado para mantenerte enfocado.",

    cards: [

      {
        title:
          "Energía Limpia",

        text:
          "Cafeína funcional con energía sostenida y sin crash.",
      },

      {
        title:
          "Enfoque Mental",

        text:
          "Claridad mental para productividad y rendimiento diario.",
      },

      {
        title:
          "Bienestar Funcional",

        text:
          "Ingredientes diseñados para apoyar rendimiento integral.",
      },

    ],

  },

  /* =========================================
  MASH PANCAKE
  ========================================= */

  "mash-nutri-pancake": {

    badge:
      "NUTRICIÓN FUNCIONAL IMNOVA",

    headline:
      "Mezcla premium alta en proteína diseñada para desayunos funcionales, ligeros y deliciosos.",

    whyTitle:
      "Desayunos funcionales para estilos de vida activos.",

    whyText:
      "Mash Pancake+ transforma el desayuno tradicional en una experiencia alta en proteína, baja en grasa y diseñada para personas que buscan nutrición inteligente sin sacrificar sabor ni textura.",

    experienceTitle:
      "Diseñado para energía y nutrición diaria.",

    cards: [

      {
        title:
          "Alta en Proteína",

        text:
          "Ideal para energía sostenida y estilos de vida activos.",
      },

      {
        title:
          "Bajo en Grasa",

        text:
          "Formulado para desayunos más ligeros y balanceados.",
      },

      {
        title:
          "Fácil de Preparar",

        text:
          "Solo agrega leche y huevo para pancakes suaves y deliciosos.",
      },

    ],

  },

  /* =========================================
  MASH BREAD
  ========================================= */

  "mash-nutri-pan": {

    badge:
      "BIENESTAR NUTRICIONAL AVANZADO",

    headline:
      "Pan funcional avanzado elaborado con raíz Konjac para una alimentación más ligera, balanceada y consciente.",

    whyTitle:
      "Pan funcional diseñado para bienestar diario.",

    whyText:
      "Mash Bread Flour+ combina los beneficios funcionales de la raíz Konjac con una experiencia moderna de panificación, ofreciendo una alternativa alta en fibra, low carb y diseñada para bienestar diario sin sacrificar sabor ni textura.",

    experienceTitle:
      "Diseñado para alimentación funcional moderna.",

    cards: [

      {
        title:
          "Raíz Konjac",

        text:
          "Ingrediente funcional reconocido por su alta fibra soluble y apoyo digestivo.",
      },

      {
        title:
          "Bajo en Carbohidratos",

        text:
          "Diseñado para estilos de vida conscientes y alimentación balanceada.",
      },

      {
        title:
          "Mayor Saciedad",

        text:
          "Ayuda a mantener sensación de satisfacción por más tiempo.",
      },

    ],

  },

}

/* =================================================
PRICE FORMATTER
================================================= */

function formatPrice(
  price: string,
  currency = "USD"
) {

  return new Intl.NumberFormat(
    "en-US",
    {
      style: "currency",
      currency,
    }
  ).format(Number(price))

}

/* =================================================
PRODUCT PAGE
================================================= */

export default function ProductPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {

  /* =========================================
  NEXT.JS 16 PARAMS FIX
  ========================================= */

  const { slug } =
    use(params)

  /* =========================================
  FIND PRODUCT
  ========================================= */

  const product =
    products.find(
      (p) =>
        p.slug === slug
    )

  if (!product) {
    notFound()
  }

  /* =========================================
  EXPERIENCE DATA
  ========================================= */

  const experience =
    productExperiences[
      product.slug
    ]

  if (!experience) {
    notFound()
  }

  return (

    <div
      className="
        min-h-screen
        overflow-hidden
        bg-gradient-to-b
        from-[#050505]
        via-black
        to-[#050505]
        text-white
      "
    >

      {/* =========================================
      BACK BUTTON
      ========================================= */}

      <div
        className="
          fixed
          left-6
          top-6
          z-50
        "
      >

        <Link
          href="/"
          className="
            rounded-full
            border
            border-white/10
            bg-white/5
            px-5
            py-3
            text-sm
            font-semibold
            text-white
            backdrop-blur-xl
            transition-all
            duration-500
            hover:bg-white/10
          "
        >

          ← Volver

        </Link>

      </div>

      {/* =========================================
      HERO
      ========================================= */}

      <section
        className="
          relative
          isolate
          overflow-hidden
          px-6
          pb-32
          pt-40
        "
      >

        {/* BACKGROUND */}

        <div
          className="
            absolute
            inset-0
            bg-gradient-to-b
            from-[#0a0a0a]
            via-black
            to-black
          "
        />

        {/* GLOW */}

        <div
          className="
            absolute
            left-1/2
            top-0
            h-[600px]
            w-[600px]
            -translate-x-1/2
            rounded-full
            bg-amber-400/20
            blur-3xl
            animate-pulse
          "
        />

        <div
          className="
            relative
            z-10
            mx-auto
            grid
            max-w-7xl
            gap-24
            lg:grid-cols-2
            lg:items-center
          "
        >

          {/* LEFT */}

          <div>

            <span
              className="
                inline-flex
                rounded-full
                border
                border-amber-400/20
                bg-amber-400/10
                px-5
                py-2
                text-xs
                uppercase
                tracking-[0.4em]
                text-amber-300
                backdrop-blur-xl
              "
            >

              {experience.badge}

            </span>

            <h1
              className="
                mt-8
                text-7xl
                font-black
                leading-none
                tracking-[-0.04em]
                sm:text-8xl
              "
            >

              {product.name}

            </h1>

            <p
              className="
                mt-8
                max-w-2xl
                text-xl
                leading-9
                text-zinc-300
              "
            >

              {experience.headline}

            </p>

            {/* BENEFITS */}

            <div
              className="
                mt-14
                grid
                gap-5
                sm:grid-cols-2
              "
            >

              {product.bullets?.slice(0, 4).map(
                (
                  bullet: string,
                  index: number
                ) => (

                  <div
                    key={index}
                    className="
                      rounded-[32px]
                      border
                      border-white/10
                      bg-white/[0.03]
                      p-6
                      backdrop-blur-xl
                      transition-all
                      duration-500
                      hover:-translate-y-2
                      hover:border-amber-400/20
                    "
                  >

                    <div
                      className="
                        mb-4
                        h-2
                        w-2
                        rounded-full
                        bg-amber-300
                      "
                    />

                    <p
                      className="
                        leading-relaxed
                        text-zinc-200
                      "
                    >

                      {bullet}

                    </p>

                  </div>

                )
              )}

            </div>

            {/* CTA */}

            <div
              className="
                mt-16
                flex
                flex-wrap
                gap-4
              "
            >

              <Link
                href="/store"
                className="
                  rounded-2xl
                  bg-gradient-to-r
                  from-amber-400
                  to-orange-500
                  px-8
                  py-4
                  text-lg
                  font-black
                  text-black
                  transition-all
                  duration-500
                  hover:scale-[1.03]
                  hover:shadow-[0_0_60px_rgba(251,191,36,0.35)]
                "
              >

                Ver Presentaciones

              </Link>

            </div>

          </div>

          {/* RIGHT */}

          <div className="relative">

            <div
              className="
                absolute
                inset-0
                rounded-full
                bg-amber-400/20
                blur-3xl
              "
            />

            <div
              className="
                relative
                overflow-hidden
                rounded-[48px]
                border
                border-white/10
                bg-white/[0.03]
                p-16
                backdrop-blur-xl
                shadow-[0_0_120px_rgba(251,191,36,0.10)]
              "
            >

              <div
                className="
                  relative
                  h-[700px]
                  w-full
                "
              >

                <Image
                  src={product.image}
                  alt={product.name}
                  fill
                  className="object-contain"
                  priority
                />

              </div>

            </div>

          </div>

        </div>

      </section>

    </div>

  )

}