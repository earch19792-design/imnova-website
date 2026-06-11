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
  slug?: string
  state_id: string | null
  name: string
  image?: string
  image_url?: string
  category: string
  commercial_category?: string | null
  strategic_niche_id?: string | null
  primary_subniche_id?: string | null
  target_customer?: string | null
  usage_moment?: string | null
  main_benefit?: string | null
  description?: string
  nicho?: string | null
  problema_resuelve?: string | null
  lifestyle_image?: string | null
  lifestyle_images?: string[] | string | null
  distribution_channels?: DistributionChannel[]

  theme?: {
    border: string
    text: string
    bg: string
  }
}

type DistributionChannel = {
  id: string
  country?: string
  city?: string
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
  onUpdate?: () => void | Promise<void>
}

const countryOptions = [
  "Nicaragua",
  "Estados Unidos",
  "Costa Rica",
  "Panamá",
  "México",
  "Colombia",
  "España",
  "Global",
]

const cityOptionsByCountry: Record<string, string[]> = {
  Nicaragua: [
    "Managua",
    "León",
    "Granada",
    "Masaya",
    "Estelí",
  ],
  "Estados Unidos": [
    "Miami",
    "Los Angeles",
    "New York",
    "Houston",
  ],
  "Costa Rica": [
    "San José",
  ],
  Panamá: [
    "Ciudad de Panamá",
  ],
  México: [
    "Ciudad de México",
  ],
  Colombia: [
    "Bogotá",
  ],
  España: [
    "Madrid",
  ],
  Global: [
    "Online",
  ],
}

const channelTypes = [
  "Marketplace",
  "Mercado",
  "Tienda de conveniencia",
]

const marketplaceOptions = [
  "eBay",
  "Amazon",
  "Facebook Marketplace",
]

const marketOptions = [
  "Mercados Managua",
  "Distribuidor regional",
  "Mayorista autorizado",
]

function normalizeImageList(
  value?: string[] | string | null
) {

  if (!value) {
    return []
  }

  if (Array.isArray(value)) {
    return value
      .map(item => item.trim())
      .filter(Boolean)
  }

  const trimmedValue =
    value.trim()

  if (!trimmedValue) {
    return []
  }

  try {

    const parsed =
      JSON.parse(trimmedValue)

    if (Array.isArray(parsed)) {
      return parsed
        .map(item =>
          String(item).trim()
        )
        .filter(Boolean)
    }

  } catch {
    // Allows comma or line separated values while migrating older content.
  }

  return trimmedValue
    .split(/,|\n/)
    .map(item => item.trim())
    .filter(Boolean)

}

function getInitialLifestyleImages(
  product: Product
) {

  const images = [
    ...normalizeImageList(
      product.lifestyle_images
    ),
    ...normalizeImageList(
      product.lifestyle_image
    ),
  ]

  const uniqueImages =
    Array.from(
      new Set(images)
    ).slice(
      0,
      3
    )

  return [
    uniqueImages[0] || "",
    uniqueImages[1] || "",
    uniqueImages[2] || "",
  ]

}

function getChannelNameOptions(
  type: string
) {

  if (type === "Marketplace") {
    return marketplaceOptions
  }

  if (type === "Mercado") {
    return marketOptions
  }

  return []

}

function createMarketplaceChannel(
  name: string
): DistributionChannel {

  return {
    id: `marketplace-${name
      .toLowerCase()
      .replace(/\s+/g, "-")}-${Date.now()}`,
    country: "Nicaragua",
    city: "Managua",
    type: "Marketplace",
    name,
    location: "Managua, Nicaragua",
    status: "Planificado",
    url: "",
    note: "",
  }

}

export function ProductCard({
  product,
  states,
  onUpdate,
}: Props) {

  const { toast } = useToast()

  const cardRef =
    useRef<HTMLDivElement>(null)

  const isSavingRef =
    useRef(false)

  const isSendingWhatsAppRef =
    useRef(false)

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

  const [
    isSaving,
    setIsSaving,
  ] = useState(false)

  const [
    isSendingWhatsApp,
    setIsSendingWhatsApp,
  ] = useState(false)

  const [
    niche,
    setNiche,
  ] = useState(
    product.nicho || ""
  )

  const [
    problemSolved,
    setProblemSolved,
  ] = useState(
    product.problema_resuelve || ""
  )

  const [
    lifestyleImages,
    setLifestyleImages,
  ] = useState<string[]>(
    getInitialLifestyleImages(product)
  )

  const createDistributionChannel =
    (): DistributionChannel => ({
      id: `${Date.now()}-${Math.random()
        .toString(16)
        .slice(2)}`,
      country: "Nicaragua",
      city: "Managua",
      type: "Marketplace",
      name: "Amazon",
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

    setNiche(
      product.nicho || ""
    )

    setProblemSolved(
      product.problema_resuelve || ""
    )

  }, [
    product.nicho,
    product.problema_resuelve,
  ])

  useEffect(() => {

    setLifestyleImages(
      getInitialLifestyleImages(product)
    )

  }, [
    product.lifestyle_image,
    product.lifestyle_images,
  ])

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

  const sendWhatsAppNotification =
    async () => {

      if (isSendingWhatsAppRef.current) {
        return false
      }

      isSendingWhatsAppRef.current =
        true

      setIsSendingWhatsApp(true)

      toast({
        title:
          "Enviando WhatsApp...",
        description:
          `${product.name} cambio a ${currentStatus}.`,
      })

      try {

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

        let payload:
          | {
              success?: boolean
              error?: string
            }
          | null = null

        if (text) {

          try {
            payload =
              JSON.parse(text)
          } catch (error) {
            console.error(
              "WHATSAPP RESPONSE PARSE ERROR:",
              error
            )
          }

        }

        if (
          !response.ok ||
          payload?.success !== true
        ) {

          console.error(
            "WHATSAPP SEND ERROR:",
            payload || text
          )

          toast({
            title:
              "Error al enviar WhatsApp",
            description:
              "No se pudo enviar la notificacion WhatsApp.",
          })

          return false
        }

        toast({
          title:
            "WhatsApp enviado",
          description:
            `${product.name} fue notificado como ${currentStatus}.`,
        })

        return true
      } catch (error) {

        console.error(
          "WHATSAPP SEND ERROR:",
          error
        )

        toast({
          title:
            "Error al enviar WhatsApp",
          description:
            "No se pudo enviar la notificacion WhatsApp.",
        })

        return false
      } finally {

        setIsSendingWhatsApp(false)

        isSendingWhatsAppRef.current =
          false

      }

    }

  const saveChanges =
    async () => {

      if (
        isSavingRef.current ||
        isSendingWhatsAppRef.current
      ) {
        return
      }

      isSavingRef.current =
        true

      setIsSaving(true)

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

        const stateChanged =
          (
            product.state_id || ""
          ) !== selectedStateId

        const updates: Parameters<
          typeof updateProduct
        >[1] = {
          state_id:
            selectedStateId,
        }

        if ("nicho" in product) {
          updates.nicho =
            niche.trim() ||
            null
        }

        if ("problema_resuelve" in product) {
          updates.problema_resuelve =
            problemSolved.trim() ||
            null
        }

        const result =
          await updateProduct(
            product.id,
            updates
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

        setIsSaving(false)

        toast({
          title:
            "Guardado correctamente",
          description: stateChanged
            ? "Estado guardado. Envía la notificación desde el detalle del producto."
            : "Cambios guardados sin enviar WhatsApp.",
        })

        if (onUpdate) {
          await onUpdate()
        }

      } catch (error) {

        console.error(
          "ERROR GUARDANDO PRODUCTO:",
          error
        )

        toast({
          title:
            "Error",
          description:
            "No se pudo guardar el cambio.",
        })

      } finally {

        setIsSaving(false)

        isSavingRef.current =
          false

      }

    }

  const updateLifestyleImage =
    (
      index: number,
      value: string
    ) => {

      setLifestyleImages(
        currentImages => {
          const nextImages = [
            ...currentImages,
          ]

          nextImages[index] =
            value

          return [
            nextImages[0] || "",
            nextImages[1] || "",
            nextImages[2] || "",
          ]
        }
      )

    }

  const saveLifestyleImages =
    async () => {

      const canSaveLifestyleImages =
        "lifestyle_images" in product ||
        "lifestyle_image" in product

      if (!canSaveLifestyleImages) {

        toast({
          title: "Migración requerida",
          description:
            "Agrega la columna lifestyle_images en Supabase antes de guardar estas imágenes.",
        })

        return

      }

      const cleanImages =
        lifestyleImages
          .map(image => image.trim())
          .filter(Boolean)
          .slice(
            0,
            3
          )

      const updates: Parameters<
        typeof updateProduct
      >[1] = {}

      if ("lifestyle_images" in product) {
        updates.lifestyle_images =
          cleanImages
      }

      if ("lifestyle_image" in product) {
        updates.lifestyle_image =
          cleanImages[0] ||
          null
      }

      const result =
        await updateProduct(
          product.id,
          updates
        )

      if (!result) {

        toast({
          title: "Error",
          description:
            "No se pudieron guardar las imágenes lifestyle.",
        })

        return

      }

      toast({
        title: "Lifestyle actualizado",
        description:
          "Las imágenes de uso quedaron guardadas para la Home pública.",
      })

      if (onUpdate) {
        onUpdate()
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
            channel => {

              if (channel.id !== id) {
                return channel
              }

              if (field === "country") {
                const cities =
                  cityOptionsByCountry[value] ||
                  []

                return {
                  ...channel,
                  country: value,
                  city:
                    cities[0] ||
                    "",
                }
              }

              if (field === "type") {
                const options =
                  getChannelNameOptions(value)

                return {
                  ...channel,
                  type: value,
                  name:
                    options[0] ||
                    "",
                }
              }

              return {
                ...channel,
                [field]: value,
              }

            }
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

      toast({
        title: "Mensaje enviado",
        description: "La configuración fue actualizada.",
      })

    }

  const getMarketplaceChannel =
    (name: string) =>
      distributionChannels.find(
        channel =>
          channel.type === "Marketplace" &&
          channel.name === name
      )

  const setMarketplaceEnabled =
    (
      name: string,
      enabled: boolean
    ) => {

      setDistributionChannels(
        channels => {

          const exists =
            channels.some(
              channel =>
                channel.type === "Marketplace" &&
                channel.name === name
            )

          if (enabled && !exists) {
            return [
              ...channels,
              createMarketplaceChannel(name),
            ]
          }

          if (!enabled) {
            return channels.filter(
              channel =>
                !(
                  channel.type === "Marketplace" &&
                  channel.name === name
                )
            )
          }

          return channels

        }
      )

      toast({
        title: "Mensaje enviado",
        description: enabled
          ? `${name} activado para este producto.`
          : `${name} desactivado para este producto.`,
      })

    }

  const updateMarketplaceChannel =
    (
      name: string,
      field: keyof DistributionChannel,
      value: string
    ) => {

      setDistributionChannels(
        channels =>
          channels.map(
            channel =>
              channel.type === "Marketplace" &&
              channel.name === name
                ? {
                    ...channel,
                    [field]: value,
                  }
                : channel
          )
      )

    }

  const createPhysicalChannel =
    (): DistributionChannel => ({
      id: `physical-${Date.now()}-${Math.random()
        .toString(16)
        .slice(2)}`,
      country: "Nicaragua",
      city: "Managua",
      type: "Mercado",
      name: "",
      location: "Managua, Nicaragua",
      status: "Planificado",
      url: "",
      note: "",
    })

  const addPhysicalChannel =
    () => {

      setDistributionChannels(
        channels => [
          ...channels,
          createPhysicalChannel(),
        ]
      )

      toast({
        title: "Mensaje enviado",
        description: "Nuevo punto físico agregado.",
      })

    }

  const saveDistributionChannels =
    async () => {

      if (!("distribution_channels" in product)) {

        toast({
          title: "⚠️ Columna no disponible",
          description:
            "No se puede guardar distribución porque la columna distribution_channels no está disponible en Supabase.",
        })

        return

      }

      const cleanedChannels =
        distributionChannels
          .map((channel) => {

            const country =
              channel.country?.trim() ||
              ""

            const city =
              channel.city?.trim() ||
              ""

            const location =
              [
                city,
                country,
              ]
                .filter(Boolean)
                .join(", ") ||
              channel.location.trim()

            return {
              ...channel,
              country,
              city,
              location,
            }

          })
          .filter(
            channel =>
              channel.name.trim() ||
              channel.country ||
              channel.city ||
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
        title: "Mensaje enviado",
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

        <section
          className="
            rounded-[28px]
            border
            border-white/10
            bg-black/20
            p-5
          "
        >

          <div className="text-[10px] uppercase tracking-[0.30em] text-cyan-200/70">
            Identidad del producto
          </div>

          <div className="mt-5 grid gap-5 md:grid-cols-[112px_1fr] md:items-center">
            <div className="flex h-28 w-28 items-center justify-center overflow-hidden rounded-3xl border border-white/10 bg-white/[0.04]">
              {(product.image_url || product.image) ? (
                <img
                  src={product.image_url || product.image}
                  alt={product.name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="px-3 text-center text-[9px] uppercase tracking-[0.18em] text-white/30">
                  Imagen
                </span>
              )}
            </div>

            <div>
              <div className="inline-flex rounded-full border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 text-[10px] uppercase tracking-[0.22em] text-cyan-100">
                {currentStatus}
              </div>

              <h2
                className="
                  mt-4
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

              {product.description && (
                <p className="mt-4 text-sm leading-6 text-white/55">
                  {product.description}
                </p>
              )}
            </div>
          </div>

        </section>

        <section
          className="
            mt-6
            rounded-[28px]
            border
            border-white/10
            bg-white/[0.025]
            p-5
          "
        >

          <div className="text-[10px] uppercase tracking-[0.30em] text-white/45">
            Estado y progreso
          </div>

          <p className="mt-3 text-sm leading-6 text-white/50">
            {(selectedStateId && (product.state_id || "") !== selectedStateId)
              ? "Al guardar este cambio de estado, el flujo actual puede enviar WhatsApp despues de confirmar el guardado."
              : "Actualiza el estado oficial del producto y revisa el avance dentro del flujo IMNOVA."}
          </p>

          <select
            value={selectedStateId}
            onChange={(e) =>
              setSelectedStateId(
                e.target.value
              )
            }
            className="
              mt-5
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

          <div className="mt-8">

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
              mt-8
              grid
              gap-4
              md:grid-cols-2
            "
          >

            <div className="rounded-2xl border border-white/10 bg-black/25 p-4">

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

            <div className="rounded-2xl border border-white/10 bg-black/25 p-4">

              <div
                className="
                  text-[10px]
                  uppercase
                  tracking-[0.30em]
                  text-white/35
                "
              >
                PROXIMA ETAPA
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
                    ? "Producto listo para comercializacion"
                    : "Continuar avance dentro del flujo IMNOVA"
                }
              </p>

            </div>

          </div>

        </section>

        <div
          className="
            mt-10
            rounded-[28px]
            border
            border-amber-300/15
            bg-amber-300/[0.035]
            p-5
          "
        >

          <div
            className="
              text-[10px]
              uppercase
              tracking-[0.30em]
              text-amber-200/70
            "
          >
            Validacion comunitaria
          </div>

          <p className="mt-3 text-sm leading-6 text-white/50">
            El nicho, el problema humano y el interes de la comunidad ayudan
            a decidir si la idea avanza.
          </p>

          <div className="mt-5 space-y-4">
            <div>
              <label className="text-[10px] uppercase tracking-[0.24em] text-white/35">
                Nicho
              </label>
              <input
                value={niche}
                onChange={(event) =>
                  setNiche(event.target.value)
                }
                placeholder="Ej: energia diaria, enfoque, rendimiento"
                className="
                  mt-2
                  w-full
                  rounded-2xl
                  border
                  border-white/10
                  bg-black/35
                  px-4
                  py-3
                  text-sm
                  text-white
                  outline-none
                  placeholder:text-white/25
                "
              />
            </div>

            <div>
              <label className="text-[10px] uppercase tracking-[0.24em] text-white/35">
                Problema que resuelve
              </label>
              <textarea
                value={problemSolved}
                onChange={(event) =>
                  setProblemSolved(event.target.value)
                }
                placeholder="Describe la necesidad humana que esta idea busca resolver."
                rows={4}
                className="
                  mt-2
                  w-full
                  resize-none
                  rounded-2xl
                  border
                  border-white/10
                  bg-black/35
                  px-4
                  py-3
                  text-sm
                  leading-6
                  text-white
                  outline-none
                  placeholder:text-white/25
                "
              />
            </div>
          </div>

        </div>

        <div
          className="
            mt-10
            rounded-[28px]
            border
            border-emerald-300/15
            bg-emerald-300/[0.035]
            p-5
          "
        >

          <div
            className="
              text-[10px]
              uppercase
              tracking-[0.30em]
              text-emerald-200/70
            "
          >
            Contenido y lifestyle
          </div>

          <p className="mt-3 text-sm leading-6 text-white/50">
            Organiza las imagenes lifestyle, beneficios y uso sugerido que
            alimentan la experiencia publica.
          </p>

          <div className="mt-5 grid gap-4">
            {lifestyleImages.map(
              (image, index) => (
                <div
                  key={index}
                  className="grid gap-3 rounded-2xl border border-white/10 bg-black/25 p-4 md:grid-cols-[96px_1fr]"
                >
                  <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-black/45">
                    {image.trim() ? (
                      <img
                        src={image}
                        alt={`Lifestyle ${index + 1}`}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="px-3 text-center text-[9px] uppercase tracking-[0.18em] text-white/30">
                        Imagen {index + 1}
                      </span>
                    )}
                  </div>

                  <label className="grid content-center gap-2">
                    <span className="text-[10px] uppercase tracking-[0.22em] text-white/35">
                      URL lifestyle {index + 1}
                    </span>
                    <input
                      value={image}
                      onChange={(event) =>
                        updateLifestyleImage(
                          index,
                          event.target.value
                        )
                      }
                      placeholder={`/images/lifestyle/${product.name
                        .toLowerCase()
                        .replace(/[^a-z0-9]+/g, "-")
                        .replace(/(^-|-$)/g, "")}-${index + 1}.webp`}
                      className="
                        w-full
                        rounded-xl
                        border
                        border-white/10
                        bg-black/60
                        px-4
                        py-3
                        text-sm
                        text-white
                        outline-none
                        placeholder:text-white/25
                      "
                    />
                  </label>
                </div>
              )
            )}
          </div>

          <button
            type="button"
            onClick={saveLifestyleImages}
            className="
              mt-5
              w-full
              rounded-2xl
              border
              border-emerald-400/20
              bg-emerald-400/15
              px-5
              py-4
              text-xs
              font-semibold
              uppercase
              tracking-[0.18em]
              text-emerald-100
              transition-all
              duration-300
              hover:bg-emerald-400/25
            "
          >
            Guardar lifestyle
          </button>

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
                  Comercializacion y distribucion
                </div>

                <p className="mt-3 text-sm leading-6 text-white/60">
                  Organiza marketplaces, paises, ciudades, canales y links
                  comerciales sin cambiar la estructura actual.
                </p>
              </div>

              <button
                type="button"
                onClick={addPhysicalChannel}
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
                + Lugar
              </button>
            </div>

            <div className="mt-6 space-y-6">
              <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                <p className="text-[10px] uppercase tracking-[0.28em] text-cyan-300/70">
                  Marketplaces
                </p>

                <p className="mt-2 text-sm leading-6 text-white/45">
                  Activa cada plataforma y agrega su URL directa de compra.
                </p>

                <div className="mt-4 space-y-4">
                  {marketplaceOptions.map(
                    marketplace => {
                      const channel =
                        getMarketplaceChannel(
                          marketplace
                        )

                      const enabled =
                        Boolean(channel)

                      return (
                        <div
                          key={marketplace}
                          className="rounded-2xl border border-white/10 bg-black/35 p-4"
                        >
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <label className="flex items-center gap-3">
                              <input
                                type="checkbox"
                                checked={enabled}
                                onChange={(event) =>
                                  setMarketplaceEnabled(
                                    marketplace,
                                    event.target.checked
                                  )
                                }
                                className="h-4 w-4 accent-cyan-300"
                              />

                              <span className="text-sm font-semibold text-white">
                                {marketplace}
                              </span>
                            </label>

                            {enabled && (
                              <select
                                value={channel?.status || "Planificado"}
                                onChange={(event) =>
                                  updateMarketplaceChannel(
                                    marketplace,
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
                            )}
                          </div>

                          {enabled && (
                            <div className="mt-4 grid gap-3">
                              <input
                                value={channel?.url || ""}
                                onChange={(event) =>
                                  updateMarketplaceChannel(
                                    marketplace,
                                    "url",
                                    event.target.value
                                  )
                                }
                                placeholder={`URL del producto en ${marketplace}`}
                                className="rounded-xl border border-white/10 bg-black/60 p-3 text-sm text-white outline-none placeholder:text-white/30"
                              />

                              <textarea
                                value={channel?.note || ""}
                                onChange={(event) =>
                                  updateMarketplaceChannel(
                                    marketplace,
                                    "note",
                                    event.target.value
                                  )
                                }
                                placeholder="Nota opcional de esta plataforma"
                                className="min-h-20 rounded-xl border border-white/10 bg-black/60 p-3 text-sm text-white outline-none placeholder:text-white/30"
                              />
                            </div>
                          )}
                        </div>
                      )
                    }
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.28em] text-cyan-300/70">
                      Lugares físicos
                    </p>

                    <p className="mt-2 text-sm leading-6 text-white/45">
                      Registra mercados, establecimientos o centros de distribución.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={addPhysicalChannel}
                    className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200 transition-all duration-300 hover:bg-cyan-400/20"
                  >
                    + Lugar
                  </button>
                </div>

                <div className="mt-4 space-y-4">
                  {distributionChannels.filter(
                    channel =>
                      channel.type !== "Marketplace"
                  ).length === 0 && (
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-5 text-sm leading-6 text-white/45">
                      Aún no hay lugares físicos definidos para este producto.
                    </div>
                  )}

                  {distributionChannels
                    .filter(
                      channel =>
                        channel.type !== "Marketplace"
                    )
                    .map(
                      channel => (
                        <div
                          key={channel.id}
                          className="rounded-2xl border border-white/10 bg-black/35 p-4"
                        >
                          <div className="grid gap-3 md:grid-cols-2">
                            <select
                              value={channel.country || ""}
                              onChange={(event) =>
                                updateDistributionChannel(
                                  channel.id,
                                  "country",
                                  event.target.value
                                )
                              }
                              className="rounded-xl border border-white/10 bg-black/60 p-3 text-sm text-white outline-none"
                            >
                              <option value="">
                                País
                              </option>

                              {countryOptions.map(
                                country => (
                                  <option
                                    key={country}
                                    value={country}
                                  >
                                    {country}
                                  </option>
                                )
                              )}
                            </select>

                            <select
                              value={channel.city || ""}
                              onChange={(event) =>
                                updateDistributionChannel(
                                  channel.id,
                                  "city",
                                  event.target.value
                                )
                              }
                              className="rounded-xl border border-white/10 bg-black/60 p-3 text-sm text-white outline-none"
                            >
                              <option value="">
                                Ciudad
                              </option>

                              {(cityOptionsByCountry[channel.country || ""] || []).map(
                                city => (
                                  <option
                                    key={city}
                                    value={city}
                                  >
                                    {city}
                                  </option>
                                )
                              )}
                            </select>

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
                              <option value="Mercado">
                                Mercado
                              </option>
                              <option value="Tienda de conveniencia">
                                Tienda de conveniencia
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
                              placeholder="Nombre del lugar físico"
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
                              placeholder="Nota opcional del lugar"
                              className="min-h-20 rounded-xl border border-white/10 bg-black/60 p-3 text-sm text-white outline-none placeholder:text-white/30 md:col-span-2"
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
                            Eliminar lugar
                          </button>
                        </div>
                      )
                    )}
                </div>
              </div>
            </div>

            <div className="hidden">
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
                        value={channel.country || ""}
                        onChange={(event) =>
                          updateDistributionChannel(
                            channel.id,
                            "country",
                            event.target.value
                          )
                        }
                        className="rounded-xl border border-white/10 bg-black/60 p-3 text-sm text-white outline-none placeholder:text-white/30"
                      >
                        <option value="">
                          1. Seleccionar país
                        </option>

                        {countryOptions.map(
                          country => (
                            <option
                              key={country}
                              value={country}
                            >
                              {country}
                            </option>
                          )
                        )}
                      </select>

                      <select
                        value={channel.city || ""}
                        onChange={(event) =>
                          updateDistributionChannel(
                            channel.id,
                            "city",
                            event.target.value
                          )
                        }
                        className="rounded-xl border border-white/10 bg-black/60 p-3 text-sm text-white outline-none"
                      >
                        <option value="">
                          2. Seleccionar ciudad
                        </option>

                        {(cityOptionsByCountry[channel.country || ""] || []).map(
                          city => (
                            <option
                              key={city}
                              value={city}
                            >
                              {city}
                            </option>
                          )
                        )}
                      </select>

                      <select
                        value={channel.type}
                        onChange={(event) =>
                          updateDistributionChannel(
                            channel.id,
                            "type",
                            event.target.value
                          )
                        }
                        className="rounded-xl border border-white/10 bg-black/60 p-3 text-sm text-white outline-none placeholder:text-white/30"
                      >
                        {channelTypes.map(
                          type => (
                            <option
                              key={type}
                              value={type}
                            >
                              3. {type}
                            </option>
                          )
                        )}
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

                      {getChannelNameOptions(channel.type).length > 0 ? (
                        <select
                          value={channel.name}
                          onChange={(event) =>
                            updateDistributionChannel(
                              channel.id,
                              "name",
                              event.target.value
                            )
                          }
                          className="rounded-xl border border-white/10 bg-black/60 p-3 text-sm text-white outline-none md:col-span-2"
                        >
                          {getChannelNameOptions(channel.type).map(
                            option => (
                              <option
                                key={option}
                                value={option}
                              >
                                4. {option}
                              </option>
                            )
                          )}
                        </select>
                      ) : (
                        <input
                          value={channel.name}
                          onChange={(event) =>
                            updateDistributionChannel(
                              channel.id,
                              "name",
                              event.target.value
                            )
                          }
                          placeholder="4. Nombre del establecimiento"
                          className="rounded-xl border border-white/10 bg-black/60 p-3 text-sm text-white outline-none placeholder:text-white/30 md:col-span-2"
                        />
                      )}

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

        <section
          className="
            mt-10
            rounded-[28px]
            border
            border-sky-300/15
            bg-sky-300/[0.035]
            p-5
          "
        >

          <div className="text-[10px] uppercase tracking-[0.30em] text-sky-200/70">
            Notificaciones
          </div>

          <p className="mt-3 text-sm leading-6 text-white/50">
            Las notificaciones manuales se envían desde el detalle del producto.
          </p>

          <div className="mt-5 rounded-2xl border border-white/10 bg-black/25 p-4 text-sm leading-6 text-white/60">
            ProductCard solo guarda cambios. Para notificar, revisa el preview
            y envía WhatsApp desde el detalle.
          </div>

          {product.slug && (
            <a
              href={`/admin/products/${product.slug}`}
              className="mt-4 inline-flex rounded-2xl border border-sky-200/20 px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-sky-100 transition-colors hover:border-sky-200/45 hover:bg-sky-200/10"
            >
              Ver detalle
            </a>
          )}

        </section>

        <section
          className="
            mt-10
            rounded-[28px]
            border
            border-white/10
            bg-white/[0.025]
            p-5
          "
        >

          <div className="text-[10px] uppercase tracking-[0.30em] text-white/45">
            Acciones
          </div>

          <p className="mt-3 text-sm leading-6 text-white/50">
            Guarda los cambios del producto usando el flujo actual.
          </p>

          <button
            type="button"
            onClick={saveChanges}
            disabled={
              isSaving
            }
            className="
              mt-5
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
              disabled:cursor-not-allowed
              disabled:opacity-60
              disabled:hover:scale-100
            "
          >
            {
              isSaving
                ? "Guardando..."
                : "Guardar cambios"
            }
          </button>

        </section>

      </div>

    </motion.div>

  )

}
