"use client"

import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
} from "framer-motion"

import {
  useEffect,
  useRef,
  useState,
} from "react"

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
  3D INTERACTION SYSTEM
  ========================================= */

  const cardRef =
    useRef<HTMLDivElement>(null)

  const mouseX =
    useMotionValue(0)

  const mouseY =
    useMotionValue(0)

  const rotateX =
    useSpring(
      useTransform(
        mouseY,
        [-300, 300],
        [10, -10]
      ),
      {
        stiffness: 140,
        damping: 18,
      }
    )

  const rotateY =
    useSpring(
      useTransform(
        mouseX,
        [-300, 300],
        [-10, 10]
      ),
      {
        stiffness: 140,
        damping: 18,
      }
    )

  const glowX =
    useTransform(
      mouseX,
      [-300, 300],
      ["35%", "65%"]
    )

  const glowY =
    useTransform(
      mouseY,
      [-300, 300],
      ["35%", "65%"]
    )

  /* =========================================
  AUTO PROGRESS SYSTEM
  ========================================= */

  const progressMap: Record<
    string,
    number
  > = {

    "⚡ Concepto": 10,

    "🧪 Probando mejoras": 35,

    "🔥 Preparando lanzamiento": 60,

    "🏭 Producción": 80,

    "🌎 Comercialización": 90,

    "🚀 Disponible": 100,
  }

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
  MOUSE TRACKING
  ========================================= */

  const handleMouseMove =
    (
      e: React.MouseEvent<HTMLDivElement>
    ) => {

      const rect =
        cardRef.current?.getBoundingClientRect()

      if (!rect) return

      const x =
        e.clientX -
        rect.left -
        rect.width / 2

      const y =
        e.clientY -
        rect.top -
        rect.height / 2

      mouseX.set(x)
      mouseY.set(y)

    }

  const handleMouseLeave =
    () => {

      mouseX.set(0)
      mouseY.set(0)

    }

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

  const saveChanges =
    async () => {

      const updatedProduct = {
        id: product.id,
        status,
        progress,
        phase,
        nextMilestone,
      }

      localStorage.setItem(
        `product-${product.id}`,
        JSON.stringify(updatedProduct)
      )

      window.dispatchEvent(
        new CustomEvent(
          "productsUpdated",
          {
            detail:
              updatedProduct,
          }
        )
      )

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

    <motion.div
      ref={cardRef}
      onMouseMove={
        handleMouseMove
      }
      onMouseLeave={
        handleMouseLeave
      }
      style={{
        rotateX,
        rotateY,
        transformStyle:
          "preserve-3d",
      }}
      transition={{
        type: "spring",
        stiffness: 140,
        damping: 18,
      }}
      className="
        group
        relative
        overflow-hidden
        rounded-[36px]
        border
        border-white/10
        bg-white/[0.03]
        p-8
        backdrop-blur-md
        transition-all
        duration-500
        hover:border-white/20
        hover:bg-white/[0.05]
        will-change-transform
      "
    >

      {/* =========================================
      REACTIVE LIGHT
      ========================================= */}

      <motion.div
        style={{
          background:
            `radial-gradient(circle at ${glowX} ${glowY},
            rgba(255,255,255,0.10),
            transparent 45%)`,
        }}
        className="
          pointer-events-none
          absolute
          inset-0
          opacity-0
          transition-opacity
          duration-500
          group-hover:opacity-100
        "
      />

      {/* =========================================
      AMBIENT LIGHT
      ========================================= */}

      <div
        className="
          pointer-events-none
          absolute
          inset-0
          bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.04),transparent_60%)]
        "
      />

      {/* =========================================
      NOISE
      ========================================= */}

      <div
        className="
          pointer-events-none
          absolute
          inset-0
          opacity-[0.015]
          bg-[url('/noise.png')]
        "
      />

      {/* =========================================
      CONTENT
      ========================================= */}

      <div
        className="
          relative
          z-10
        "
        style={{
          transform:
            "translateZ(40px)",
        }}
      >

        {/* STATUS */}

        <select
          value={status}
          onChange={(e) =>
            setStatus(
              e.target.value
            )
          }
          className="
            mb-8
            w-full
            rounded-2xl
            border
            border-white/10
            bg-white/[0.03]
            p-4
            text-sm
            text-white/80
            backdrop-blur-md
            outline-none
            transition-all
            duration-300
            hover:border-white/20
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

        {/* TITLE */}

        <h2
          className="
            text-3xl
            font-black
            tracking-[-0.04em]
            text-white
          "
        >

          {product.name}

        </h2>

        {/* CATEGORY */}

        <p
          className="
            mt-3
            text-sm
            uppercase
            tracking-[0.25em]
            text-white/35
          "
        >

          {product.category}

        </p>

        {/* PROGRESS */}

        <div className="mt-10">

          <div
            className="
              text-[10px]
              uppercase
              tracking-[0.35em]
              text-white/40
            "
          >

            DESARROLLO

          </div>

          <div
            className="
              mt-4
              flex
              items-end
              gap-3
            "
          >

            <div
              className="
                text-5xl
                font-black
                tracking-[-0.05em]
                text-white
              "
            >

              {progress}

            </div>

            <div
              className="
                mb-1
                text-lg
                text-white/40
              "
            >

              %

            </div>

          </div>

          {/* PROGRESS BAR */}

          <div
            className="
              mt-6
              h-[6px]
              w-full
              overflow-hidden
              rounded-full
              bg-white/5
            "
          >

            <motion.div
              initial={{
                width: 0,
              }}
              animate={{
                width:
                  `${progress}%`,
              }}
              transition={{
                duration: 1,
              }}
              className="
                h-full
                rounded-full
                bg-white/70
              "
            />

          </div>

        </div>

        {/* DASHBOARD */}

        <div
          className="
            mt-10
            grid
            grid-cols-2
            gap-5
          "
        >

          <div
            className="
              rounded-[28px]
              border
              border-white/10
              bg-white/[0.03]
              p-6
              backdrop-blur-md
            "
          >

            <div
              className="
                text-[10px]
                uppercase
                tracking-[0.30em]
                text-white/35
              "
            >

              ACTIVOS

            </div>

            <div
              className="
                mt-4
                text-5xl
                font-black
                tracking-[-0.05em]
                text-white
              "
            >

              {activeProducts}

            </div>

          </div>

          <div
            className="
              rounded-[28px]
              border
              border-white/10
              bg-white/[0.03]
              p-6
              backdrop-blur-md
            "
          >

            <div
              className="
                text-[10px]
                uppercase
                tracking-[0.30em]
                text-white/35
              "
            >

              MERCADO

            </div>

            <div
              className="
                mt-4
                text-5xl
                font-black
                tracking-[-0.05em]
                text-white
              "
            >

              {comercializando}

            </div>

          </div>

        </div>

        {/* INFO */}

        <div
          className="
            mt-10
            space-y-6
          "
        >

          <div>

            <div
              className="
                text-[10px]
                uppercase
                tracking-[0.30em]
                text-white/35
              "
            >

              FASE ACTUAL

            </div>

            <p
              className="
                mt-3
                text-white/75
                leading-relaxed
              "
            >

              {phase}

            </p>

          </div>

          <div>

            <div
              className="
                text-[10px]
                uppercase
                tracking-[0.30em]
                text-white/35
              "
            >

              PRÓXIMO OBJETIVO

            </div>

            <p
              className="
                mt-3
                text-white/75
                leading-relaxed
              "
            >

              {nextMilestone}

            </p>

          </div>

        </div>

        {/* BUTTON */}

        <button
          onClick={saveChanges}
          className="
            mt-12
            w-full
            rounded-[24px]
            border
            border-white/10
            bg-white
            px-6
            py-4
            text-sm
            font-semibold
            uppercase
            tracking-[0.18em]
            text-black
            transition-all
            duration-300
            hover:scale-[1.01]
            hover:bg-zinc-200
            active:scale-[0.98]
          "
        >

          Guardar Cambios

        </button>

      </div>

    </motion.div>

  )

}