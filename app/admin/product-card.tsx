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

import {
  updateProduct,
} from "@/lib/products-service"

import {
  useToast,
} from "@/hooks/use-toast"

type Product = {
  id: string
  state_id: string | null
  name: string
  image?: string
  image_url?: string
  category: string
  description?: string
  distribution_channels?: DistributionChannel[]

  theme?: {
    border: string
    text: string
    bg: string
  }
}

type DistributionChannel = {
  id: string
  type: string
  name: string
  location: string
  status: string
  url?: string
  note?: string
}

type ProductState = {
  id: string
  name: string
  progress: number
  sort_order?: number
  is_active?: boolean
}

type Props = {
  product: Product
  states: ProductState[]
  onUpdate?: () => void
}

export function ProductCard({
  product,
  states,
  onUpdate,
}: Props) {

  const { toast } = useToast()

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

  const [
    selectedStateId,
    setSelectedStateId,
  ] = useState(
    product.state_id || ""
  )

  const createDistributionChannel =
    (): DistributionChannel => ({
      id: `${Date.now()}-${Math.random()
        .toString(16)
        .slice(2)}`,
      type: "Marketplace",
      name: "",
      location: "",
      status: "Planificado",
      url: "",
      note: "",
    })

  const [
    distributionChannels,
    setDistributionChannels,
  ] = useState<DistributionChannel[]>(
    product.distribution_channels || []
  )

  useEffect(() => {

    setSelectedStateId(
      product.state_id || ""
    )

  }, [product.state_id])

  useEffect(() => {

    setDistributionChannels(
      product.distribution_channels || []
    )

  }, [product.distribution_channels])

  const selectedState =
    states.find(
      (state) =>
        state.id === selectedStateId
    )

  const currentProgress =
    selectedState?.progress || 0

  const currentStatus =
    selectedState?.name || "Sin estado"

  const isCommercial =
    currentStatus.includes(
      "Comercialización"
    )

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

  const saveChanges =
    async () => {

      try {

        if (!selectedStateId) {

          toast({
            title: "⚠️ Estado requerido",
            description:
              "Selecciona un estado antes de guardar.",
          })

          return

        }

        console.log(
          "PRODUCT ID:",
          product.id
        )

        console.log(
          "SELECTED STATE ID:",
          selectedStateId
        )

        console.log(
          "SELECTED STATE:",
          selectedState
        )

        const result =
          await updateProduct(
            product.id,
            {
              state_id:
                selectedStateId,
            }
          )

        console.log(
          "PRODUCT UPDATED:",
          result
        )

        if (!result) {

          toast({
            title: "❌ Error",
            description:
              "No se pudo actualizar el producto en Supabase.",
          })

          return

        }

        toast({
          title: "✅ Producto actualizado",
          description:
            `${product.name} cambió a ${currentStatus}`,
        })

        if (onUpdate) {
          onUpdate()
        }

        const response =
          await fetch(
            "/api/innova-lab",
            {
              method: "POST",

              headers: {
                "Content-Type":
                  "application/json",
              },

              body: JSON.stringify({
                product:
                  product.name,

                status:
                  currentStatus,

                progress:
                  `${currentProgress}%`,

                imageUrl:
                  product.image_url ||
                  product.image ||
                  "",
              }),
            }
          )

        console.log(
          "WHATSAPP RESPONSE STATUS:",
          response.status
        )

        console.log(
          "WHATSAPP RESPONSE OK:",
          response.ok
        )

        const text =
          await response.text()

        console.log(
          "WHATSAPP RESPONSE BODY:",
          text
        )

      } catch (error) {

        console.error(
          "ERROR GUARDANDO PRODUCTO:",
          error
        )

        toast({
          title: "❌ Error",
          description:
            "No se pudo guardar el cambio.",
        })

      }

    }

  const updateDistributionChannel =
    (
      id: string,
      field: keyof DistributionChannel,
      value: string
    ) => {

      setDistributionChannels(
        channels =>
          channels.map(
            channel =>
              channel.id === id
                ? {
                    ...channel,
                    [field]: value,
                  }
                : channel
          )
      )

    }

  const removeDistributionChannel =
    (id: string) => {

      setDistributionChannels(
        channels =>
          channels.filter(
            channel =>
              channel.id !== id
          )
      )

    }

  const saveDistributionChannels =
    async () => {

      const cleanedChannels =
        distributionChannels.filter(
          channel =>
            channel.name.trim() ||
            channel.location.trim()
        )

      const result =
        await updateProduct(
          product.id,
          {
            distribution_channels:
              cleanedChannels,
          }
        )

      if (!result) {

        toast({
          title: "❌ Error",
          description:
            "No se pudo guardar la distribución. Verifica que exista la columna distribution_channels en Supabase.",
        })

        return

      }

      setDistributionChannels(
        cleanedChannels
      )

      toast({
        title: "✅ Distribución actualizada",
        description:
          "Los canales comerciales ya pueden mostrarse en la web.",
      })

      if (onUpdate) {
        onUpdate()
      }

    }

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

      <div
        className="
          pointer-events-none
          absolute
          inset-0
          bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.04),transparent_60%)]
        "
      />

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

        <select
          value={selectedStateId}
          onChange={(e) =>
            setSelectedStateId(
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

          <option value="">
            Seleccionar estado
          </option>

          {
            states.map(
              (state) => (

                <option
                  key={state.id}
                  value={state.id}
                >
                  {state.name}
                </option>

              )
            )
          }

        </select>

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

        <div className="mt-10">

          <div
            className="
              text-[10px]
              uppercase
              tracking-[0.35em]
              text-white/40
            "
          >
            PROGRESO
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
              {currentProgress}
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
                  `${currentProgress}%`,
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
              ESTADO
            </div>

            <p
              className="
                mt-3
                text-white/75
                leading-relaxed
              "
            >
              {currentStatus}
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
              PRÓXIMA ETAPA
            </div>

            <p
              className="
                mt-3
                text-white/75
                leading-relaxed
              "
            >
              {
                currentStatus === "Disponible"
                  ? "Producto listo para comercialización"
                  : "Continuar avance dentro del flujo IMNOVA"
              }
            </p>

          </div>

        </div>

        {isCommercial && (
          <div
            className="
              mt-10
              rounded-[28px]
              border
              border-cyan-400/15
              bg-cyan-400/[0.035]
              p-5
            "
          >

            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div
                  className="
                    text-[10px]
                    uppercase
                    tracking-[0.30em]
                    text-cyan-300/70
                  "
                >
                  DISTRIBUCIÓN
                </div>

                <p className="mt-3 text-sm leading-6 text-white/60">
                  Define dónde se comercializa este producto: países, mercados,
                  establecimientos o marketplaces.
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  setDistributionChannels(
                    channels => [
                      ...channels,
                      createDistributionChannel(),
                    ]
                  )
                }
                className="
                  rounded-2xl
                  border
                  border-cyan-400/20
                  bg-cyan-400/10
                  px-4
                  py-3
                  text-xs
                  font-semibold
                  uppercase
                  tracking-[0.18em]
                  text-cyan-200
                  transition-all
                  duration-300
                  hover:bg-cyan-400/20
                "
              >
                + Canal
              </button>
            </div>

            <div className="mt-6 space-y-5">
              {distributionChannels.length === 0 && (
                <div
                  className="
                    rounded-2xl
                    border
                    border-white/10
                    bg-black/20
                    p-5
                    text-sm
                    leading-6
                    text-white/45
                  "
                >
                  Aún no hay canales definidos para este producto.
                </div>
              )}

              {distributionChannels.map(
                channel => (
                  <div
                    key={channel.id}
                    className="
                      rounded-2xl
                      border
                      border-white/10
                      bg-black/25
                      p-4
                    "
                  >
                    <div className="grid gap-3 md:grid-cols-2">
                      <select
                        value={channel.type}
                        onChange={(event) =>
                          updateDistributionChannel(
                            channel.id,
                            "type",
                            event.target.value
                          )
                        }
                        className="rounded-xl border border-white/10 bg-black/60 p-3 text-sm text-white outline-none"
                      >
                        <option value="País">
                          País
                        </option>
                        <option value="Mercado">
                          Mercado
                        </option>
                        <option value="Establecimiento">
                          Establecimiento
                        </option>
                        <option value="Marketplace">
                          Marketplace
                        </option>
                      </select>

                      <select
                        value={channel.status}
                        onChange={(event) =>
                          updateDistributionChannel(
                            channel.id,
                            "status",
                            event.target.value
                          )
                        }
                        className="rounded-xl border border-white/10 bg-black/60 p-3 text-sm text-white outline-none"
                      >
                        <option value="Planificado">
                          Planificado
                        </option>
                        <option value="En negociación">
                          En negociación
                        </option>
                        <option value="Activo">
                          Activo
                        </option>
                      </select>

                      <input
                        value={channel.name}
                        onChange={(event) =>
                          updateDistributionChannel(
                            channel.id,
                            "name",
                            event.target.value
                          )
                        }
                        placeholder="Nombre del canal"
                        className="rounded-xl border border-white/10 bg-black/60 p-3 text-sm text-white outline-none placeholder:text-white/30"
                      />

                      <input
                        value={channel.location}
                        onChange={(event) =>
                          updateDistributionChannel(
                            channel.id,
                            "location",
                            event.target.value
                          )
                        }
                        placeholder="País, ciudad o mercado"
                        className="rounded-xl border border-white/10 bg-black/60 p-3 text-sm text-white outline-none placeholder:text-white/30"
                      />

                      <input
                        value={channel.url || ""}
                        onChange={(event) =>
                          updateDistributionChannel(
                            channel.id,
                            "url",
                            event.target.value
                          )
                        }
                        placeholder="URL opcional"
                        className="rounded-xl border border-white/10 bg-black/60 p-3 text-sm text-white outline-none placeholder:text-white/30 md:col-span-2"
                      />

                      <textarea
                        value={channel.note || ""}
                        onChange={(event) =>
                          updateDistributionChannel(
                            channel.id,
                            "note",
                            event.target.value
                          )
                        }
                        placeholder="Nota comercial opcional"
                        className="min-h-24 rounded-xl border border-white/10 bg-black/60 p-3 text-sm text-white outline-none placeholder:text-white/30 md:col-span-2"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        removeDistributionChannel(
                          channel.id
                        )
                      }
                      className="mt-3 text-xs uppercase tracking-[0.18em] text-red-300/70 transition-colors hover:text-red-200"
                    >
                      Eliminar canal
                    </button>
                  </div>
                )
              )}
            </div>

            <button
              type="button"
              onClick={saveDistributionChannels}
              className="
                mt-6
                w-full
                rounded-2xl
                border
                border-cyan-400/20
                bg-cyan-400/15
                px-5
                py-4
                text-xs
                font-semibold
                uppercase
                tracking-[0.18em]
                text-cyan-100
                transition-all
                duration-300
                hover:bg-cyan-400/25
              "
            >
              Guardar distribución
            </button>

          </div>
        )}

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
