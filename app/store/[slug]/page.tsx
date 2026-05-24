"use client"

/* 
================================================
MENÚ PRINCIPAL
SECCIÓN: PRODUCTOS
COMPONENTE: ProductPage
================================================
*/

import Image from "next/image"
import Link from "next/link"
import { notFound } from "next/navigation"
import products from "../../../lib/products"

const productExperiences: Record<string, any> = {
  "mash-coffee": {
    badge: "TECNOLOGÍA PARA EL RENDIMIENTO HUMANO",

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
        title: "Energía Limpia",
        text: "Cafeína funcional con energía sostenida y sin crash.",
      },

      {
        title: "Enfoque Mental",
        text: "Claridad mental para productividad y rendimiento diario.",
      },

      {
        title: "Bienestar Funcional",
        text: "Ingredientes diseñados para apoyar rendimiento integral.",
      },
    ],
  },

  "mash-pancake": {
    badge: "NUTRICIÓN FUNCIONAL IMNOVA",

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
        title: "Alta en Proteína",
        text: "Ideal para energía sostenida y estilos de vida activos.",
      },

      {
        title: "Bajo en Grasa",
        text: "Formulado para desayunos más ligeros y balanceados.",
      },

      {
        title: "Fácil de Preparar",
        text: "Solo agrega leche y huevo para pancakes suaves y deliciosos.",
      },
    ],
  },

  "mash-bread": {
    badge: "BIENESTAR NUTRICIONAL AVANZADO",

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
        title: "Raíz Konjac",
        text: "Ingrediente funcional reconocido por su alta fibra soluble y apoyo digestivo.",
      },

      {
        title: "Bajo en Carbohidratos",
        text: "Diseñado para estilos de vida conscientes y alimentación balanceada.",
      },

      {
        title: "Mayor Saciedad",
        text: "Ayuda a mantener sensación de satisfacción por más tiempo.",
      },
    ],
  },
}

function formatPrice(
  price: string,
  currency = "USD"
) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(Number(price))
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {

  const { slug } = await params

  const product = products.find(
    (p) => p.slug === slug
  )

  if (!product) {
    notFound()
  }

  const experience = productExperiences[product.slug]

  const preparationSteps: Record<string, any[]> = {
    "mash-pancake": [
      {
        step: "01",
        title: "Mezcla",
        text: "Agrega leche y huevo a la mezcla.",
      },

      {
        step: "02",
        title: "Cocina",
        text: "Cocina por pocos minutos hasta lograr textura suave.",
      },

      {
        step: "03",
        title: "Disfruta",
        text: "Sirve y disfruta un desayuno funcional y delicioso.",
      },
    ],

    "mash-bread": [
      {
        step: "01",
        title: "Preparación",
        text: "Agrega agua y levadura junto a la mezcla.",
      },

      {
        step: "02",
        title: "Mezcla",
        text: "Utiliza bread maker o mezcla manualmente.",
      },

      {
        step: "03",
        title: "Hornea",
        text: "Obtén pan funcional alto en fibra y bajo en carbohidratos.",
      },
    ],
  }

  return (
    <div className="min-h-screen overflow-hidden bg-gradient-to-b from-[#050505] via-black to-[#050505] text-white">

      {/* BACK BUTTON */}
      <div className="fixed left-6 top-6 z-50">
        <Link
          href="/"
          className="rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-white backdrop-blur-xl transition-all duration-500 hover:bg-white/10"
        >
          ← Volver
        </Link>
      </div>

      {/* HERO */}
      <section className="relative isolate overflow-hidden px-6 pt-40 pb-32">

        {/* Background */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#0a0a0a] via-black to-black" />

        {/* Glow */}
        <div className="absolute left-1/2 top-0 h-[600px] w-[600px] -translate-x-1/2 rounded-full bg-amber-400/20 blur-3xl animate-pulse" />

        <div className="relative z-10 mx-auto grid max-w-7xl gap-24 lg:grid-cols-2 lg:items-center">

          {/* LEFT */}
          <div>

            <span className="inline-flex rounded-full border border-amber-400/20 bg-amber-400/10 px-5 py-2 text-xs uppercase tracking-[0.4em] text-amber-300 backdrop-blur-xl">
              {experience.badge}
            </span>

            <h1 className="mt-8 text-7xl font-black leading-none tracking-[-0.04em] sm:text-8xl">
              {product.name}
            </h1>

            <p className="mt-8 max-w-2xl text-xl leading-9 text-zinc-300">
              {experience.headline}
            </p>

            {/* BENEFITS */}
            <div className="mt-14 grid gap-5 sm:grid-cols-2">

              {product.bullets?.slice(0, 4).map(
                (bullet: string, index: number) => (
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
                    <div className="mb-4 h-2 w-2 rounded-full bg-amber-300" />

                    <p className="text-zinc-200 leading-relaxed">
                      {bullet}
                    </p>
                  </div>
                )
              )}
            </div>

            {/* CTA */}
            <div className="mt-16 flex flex-wrap gap-4">

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

              <button
                className="
                  rounded-2xl
                  border
                  border-white/15
                  bg-white/[0.05]
                  px-8
                  py-4
                  text-lg
                  font-semibold
                  text-white
                  transition-all
                  duration-500
                  hover:bg-white/[0.08]
                "
              >
                Agregar a selección
              </button>

            </div>
          </div>

          {/* RIGHT */}
          <div className="relative">

            <div className="absolute inset-0 rounded-full bg-amber-400/20 blur-3xl" />

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

              <div className="relative h-[700px] w-full animate-float">
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

      {/* WHY IT EXISTS */}
      <section className="relative px-6 py-36">

        <div
          className="
            mx-auto
            max-w-6xl
            rounded-[48px]
            border
            border-white/10
            bg-gradient-to-br
            from-white/[0.04]
            to-white/[0.02]
            p-14
            backdrop-blur-xl
            shadow-[0_0_100px_rgba(251,191,36,0.04)]
          "
        >

          <div className="grid gap-14 lg:grid-cols-2 lg:items-center">

            <div>

              <span className="text-xs uppercase tracking-[0.35em] text-amber-300">
                Por Qué Existe
              </span>

              <h2 className="mt-6 text-5xl font-black leading-tight">
                {experience.whyTitle}
              </h2>

            </div>

            <div>

              <p className="text-lg leading-9 text-zinc-300">
                {experience.whyText}
              </p>

            </div>

          </div>
        </div>
      </section>

      {/* EXPERIENCE */}
      <section className="px-6 py-36">

        <div className="mx-auto max-w-7xl">

          <div className="mb-24 text-center">

            <span className="text-xs uppercase tracking-[0.35em] text-amber-300">
              Experiencia
            </span>

            <h2 className="mt-6 text-5xl font-black">
              {experience.experienceTitle}
            </h2>

          </div>

          <div className="grid gap-8 lg:grid-cols-3">

            {experience.cards.map((card: any, index: number) => (
              <div
                key={index}
                className="
                  rounded-[36px]
                  border
                  border-white/10
                  bg-white/[0.03]
                  p-10
                  backdrop-blur-xl
                  transition-all
                  duration-500
                  hover:-translate-y-2
                  hover:border-amber-400/20
                  hover:bg-white/[0.05]
                "
              >

                <h3 className="text-3xl font-black text-white">
                  {card.title}
                </h3>

                <p className="mt-6 text-lg leading-8 text-zinc-400">
                  {card.text}
                </p>

              </div>
            ))}

          </div>
        </div>
      </section>
    </div>
  )
}