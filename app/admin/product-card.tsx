"use client"

import { useEffect, useState } from "react"

type Product = {
  id: number
  name: string
  image: string
  category: string
  status: string
  progress: number
  phase: string
  nextMilestone: string
  theme: {
    border: string
    text: string
    bg: string
  }
}

type Props = {
  product: Product
}

export function ProductCard({
  product,
}: Props) {

  /* =========================================
  AUTO PROGRESS SYSTEM
  ========================================= */

  const progressMap: Record<string, number> = {

  "⚡ Concepto": 10,

  "🧪 Probando mejoras": 35,

  "🔥 Preparando lanzamiento": 60,

  "🏭 Producción": 80,

  "🌎 Comercialización": 90,

  "🚀 Disponible": 100,
}

  /* =========================================
  PRODUCT STATUS LIST
  ========================================= */

 const statuses = [
  "⚡ Concepto",
  "🧪 Probando mejoras",
  "🔥 Preparando lanzamiento",
  "🏭 Producción",
  "🌎 Comercialización",
  "🚀 Disponible",
]

  /* =========================================
  STATES
  ========================================= */

  const [status, setStatus] =
    useState(product.status)

  const [progress, setProgress] =
    useState<number>(
      progressMap[
        product.status
      ] || 0
    )

  const [phase, setPhase] =
    useState(product.phase)

  const [
    nextMilestone,
    setNextMilestone,
  ] = useState(
    product.nextMilestone
  )

  /* =========================================
  AUTO UPDATE PROGRESS
  ========================================= */

  useEffect(() => {

    setProgress(
      progressMap[status] || 0
    )

  }, [status])

  /* =========================================
  LOAD SAVED DATA
  ========================================= */

  useEffect(() => {

    const saved =
      localStorage.getItem(
        `product-${product.id}`
      )

    if (saved) {

      const parsed =
        JSON.parse(saved)

      setStatus(
        parsed.status
      )

      setProgress(
        progressMap[
          parsed.status
        ] || 0
      )

      setPhase(
        parsed.phase
      )

      setNextMilestone(
        parsed.nextMilestone
      )

    }

  }, [product.id])

  /* =========================================
  SAVE DATA
  ========================================= */

  const saveChanges = async () => {

    const updatedProduct = {
      id: product.id,
      status,
      progress,
      phase,
      nextMilestone,
    }

    /* SAVE LOCAL */

    localStorage.setItem(
      `product-${product.id}`,
      JSON.stringify(updatedProduct)
    )

    /* REALTIME UPDATE */

    window.dispatchEvent(
      new CustomEvent(
        "productsUpdated",
        {
          detail:
            updatedProduct,
        }
      )
    )

    /* =========================================
    PROGRESS BAR VISUAL
    ========================================= */

    const progressBar =
      "█".repeat(
        Math.floor(progress / 10)
      ) +
      "░".repeat(
        10 -
        Math.floor(progress / 10)
      )

    /* =========================================
    WHATSAPP MESSAGE PREMIUM
    ========================================= */

    const whatsappMessage = `

🚀 *IMNOVA LABS*

━━━━━━━━━━━━━━━

🧬 *PRODUCTO*
${product.name}

🌎 *ESTADO ACTUAL*
${status.toUpperCase()}

📊 *DESARROLLO*
${progressBar} ${progress}%

⚡ *ACTUALIZACIÓN*
${phase}

🔮 *PRÓXIMA FASE*
${nextMilestone}

${
  progress === 100
    ? "🔥 Tu producto ya se encuentra en comercialización activa y disponible para expansión de mercado."
    : "⚙️ Nuestro equipo continúa optimizando tu innovación."
}

━━━━━━━━━━━━━━━

© IMNOVA LABS

`

    /* =========================================
    IMAGE URL
    SOLO EN COMERCIALIZACIÓN
    ========================================= */

    const imageUrl =
      status ===
      "🌎 Comercialización"
        ? product.image
        : undefined

    /* =========================================
    WHATSAPP API
    ========================================= */

    try {

      const response = await fetch(
        "/api/innova-lab",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            message:
              whatsappMessage,

            imageUrl,
          }),
        }
      )

      if (!response.ok) {

        throw new Error(
          `HTTP ERROR ${response.status}`
        )

      }

      const data =
        await response.json()

      console.log(
        "WhatsApp enviado:",
        data
      )

    } catch (error) {

      console.error(
        "ERROR WHATSAPP:",
        error
      )

      alert(
        "Error enviando WhatsApp"
      )

    }

    alert(
      "Cambios guardados"
    )

  }

  /* =========================================
  DASHBOARD ACTIVE PRODUCTS
  ========================================= */

  const activeStatuses = [
    "⚡ Concepto",
    "🧪 Probando mejoras",
    "🔥 Preparando lanzamiento",
    "🚀 Disponible",
    "🏭 Producción",
    "🌎 Comercialización",
  ]

  const activeProducts =
    activeStatuses.includes(status)
      ? 1
      : 0

  const comercializando =
    status ===
    "🌎 Comercialización"
      ? 1
      : 0

  return (

    <div
      className={`
        relative
        overflow-hidden
        rounded-[40px]
        border
        ${product.theme.border}
        bg-black/60
        p-8
        backdrop-blur-2xl
        transition-all
        duration-500
        hover:scale-[1.01]
        hover:border-cyan-400/40
      `}
    >

      {/* STATUS SELECTOR */}

      <select
        value={status}
        onChange={(e) =>
          setStatus(
            e.target.value
          )
        }
        className="
          mb-6
          w-full
          rounded-2xl
          border
          border-white/10
          bg-black/40
          p-4
          text-white
        "
      >

        {statuses.map((s) => (

          <option
            key={s}
            value={s}
          >
            {s}
          </option>

        ))}

      </select>

      {/* PRODUCT NAME */}

      <h2
        className="
          text-3xl
          font-black
          text-white
        "
      >
        {product.name}
      </h2>

      {/* PROGRESS */}

      <div className="mt-8">

        <div className="
          text-sm
          uppercase
          tracking-[0.3em]
          text-zinc-400
        ">
          Desarrollo
        </div>

        <div className="
          mt-3
          text-2xl
          font-bold
          text-white
        ">
          {progress}%
        </div>

        <div className="
          mt-4
          font-mono
          text-cyan-300
        ">
          {
            "█".repeat(
              Math.floor(progress / 10)
            ) +
            "░".repeat(
              10 -
              Math.floor(progress / 10)
            )
          }
        </div>

      </div>

      {/* DASHBOARD */}

      <div className="
        mt-10
        grid
        grid-cols-2
        gap-4
      ">

        <div
          className="
            rounded-3xl
            border
            border-white/10
            bg-black/40
            p-6
          "
        >

          <div className="
            text-xs
            uppercase
            tracking-[0.3em]
            text-zinc-500
          ">
            ACTIVOS
          </div>

          <div className="
            mt-3
            text-4xl
            font-black
            text-white
          ">
            {activeProducts}
          </div>

        </div>

        <div
          className="
            rounded-3xl
            border
            border-cyan-400/10
            bg-black/40
            p-6
          "
        >

          <div className="
            text-xs
            uppercase
            tracking-[0.3em]
            text-zinc-500
          ">
            EN COMERCIALIZACIÓN
          </div>

          <div className="
            mt-3
            text-4xl
            font-black
            text-cyan-300
          ">
            {comercializando}
          </div>

        </div>

      </div>

      {/* SAVE BUTTON */}

      <button
        onClick={saveChanges}
        className="
          mt-10
          w-full
          rounded-3xl
          bg-cyan-400
          px-6
          py-4
          font-black
          text-black
          transition-all
          hover:scale-[1.02]
        "
      >
        GUARDAR CAMBIOS
      </button>

    </div>

  )

}