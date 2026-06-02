"use client"

import {
  useEffect,
  useState,
} from "react"

import { useRouter } from "next/navigation"

import {
  motion,
} from "framer-motion"
import { products } from "@/data/products"

import { Sidebar } from "@/app/admin/sidebar"
import { Metrics } from "@/app/admin/metrics"
import { ProductCard } from "@/app/admin/product-card"
import { ActivityFeed } from "@/app/admin/activity-feed"

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

export default function AdminPage() {

  const router = useRouter()

  const [
    isAuthenticated,
    setIsAuthenticated,
  ] = useState(false)

  const [
    liveProducts,
    setLiveProducts,
  ] = useState<Product[]>(products)

  const [
    selectedMenu,
    setSelectedMenu,
  ] = useState("dashboard")
  const [
  showCampaignModal,
  setShowCampaignModal,
] = useState(false)
const [campaigns, setCampaigns] = useState([
  {
    id: 1,
    name: "Mash Coffee TikTok",
    product: "Mash Coffee",
    channel: "TikTok",
    status: "Active",
    leads: 42,
  },
  {
    id: 2,
    name: "Bienes y Raíces Facebook",
    product: "Casas Premium",
    channel: "Facebook",
    status: "Draft",
    leads: 0,
  },
])
const [campaignName, setCampaignName] = useState("")
const [validationIdea, setValidationIdea] =useState("")
const [campaignProduct, setCampaignProduct] = useState("")
const [campaignChannel, setCampaignChannel] = useState("TikTok")
const [campaignBudget, setCampaignBudget] = useState("")
const [campaignType, setCampaignType] = useState("validation")
const createCampaign = () => {

const newCampaign = {

  id: Date.now(),

  name:
    campaignType === "validation"
      ? `${validationIdea} ${campaignChannel}`
      : `${campaignProduct} ${campaignChannel}`,

  product: campaignProduct,

  channel: campaignChannel,

  status: "Draft",

  leads: 0,

}
  

  setCampaigns([
    ...campaigns,
    newCampaign,
  ])

  setCampaignName("")
  setCampaignProduct("")
  setCampaignChannel("TikTok")
  setCampaignBudget("")

  setShowCampaignModal(false)

}
  /* =========================================
  AUTH
  ========================================= */

  useEffect(() => {

    const auth =
      localStorage.getItem(
        "imnova-admin"
      )

    if (
      auth !== "authenticated"
    ) {

      router.push(
        "/admin/login"
      )

      return

    }

    setIsAuthenticated(true)

  }, [router])

  /* =========================================
  REALTIME PRODUCT UPDATE
  ========================================= */

  useEffect(() => {

    const handleUpdate = (
      event: Event
    ) => {

      const customEvent =
        event as CustomEvent

      const updated =
        customEvent.detail

      setLiveProducts(
        (prevProducts) =>

          prevProducts.map(
            (product) =>

              product.id === updated.id

                ? {
                    ...product,

                    status:
                      updated.status,

                    progress:
                      updated.progress,

                    phase:
                      updated.phase,

                    nextMilestone:
                      updated.nextMilestone,
                  }

                : product
          )
      )

    }

    window.addEventListener(
      "productsUpdated",
      handleUpdate as EventListener
    )

    return () => {

      window.removeEventListener(
        "productsUpdated",
        handleUpdate as EventListener
      )

    }

  }, [])

  /* =========================================
  LOGOUT
  ========================================= */

  const handleLogout = () => {

    localStorage.removeItem(
      "imnova-admin"
    )

    router.push(
      "/admin/login"
    )

  }

  /* =========================================
  LOADING SCREEN
  ========================================= */

  if (!isAuthenticated) {

    return (

      <div
        className="
          min-h-screen
          bg-black
        "
      />

    )

  }

  return (

    <main
      className="
        relative
        min-h-screen
        overflow-hidden
        bg-black
        text-white
      "
    >

      {/* =========================================
      GLOBAL BACKGROUND
      ========================================= */}

      <div className="fixed inset-0 bg-black" />

      {/* =========================================
      AMBIENT LIGHTING
      ========================================= */}

      <motion.div
        animate={{
          opacity: [0.4, 0.7, 0.4],
        }}
        transition={{
          duration: 8,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        className="
          pointer-events-none
          fixed
          left-1/2
          top-0
          h-[900px]
          w-[900px]
          -translate-x-1/2
          rounded-full
          bg-white/[0.03]
          blur-[180px]
        "
      />

      {/* =========================================
      GRID
      ========================================= */}

      <div
        className="
          pointer-events-none
          fixed
          inset-0
          opacity-[0.015]
          bg-[linear-gradient(rgba(255,255,255,0.10)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.10)_1px,transparent_1px)]
          bg-[size:60px_60px]
        "
      />

      {/* =========================================
      SIDEBAR
      ========================================= */}

      <Sidebar
        selectedMenu={selectedMenu}
        setSelectedMenu={setSelectedMenu}
      />

      {/* =========================================
      CONTENT
      ========================================= */}

      <motion.div
        initial={{
          opacity: 0,
          y: 20,
        }}
        animate={{
          opacity: 1,
          y: 0,
        }}
        transition={{
          duration: 1,
          ease: [0.22, 1, 0.36, 1],
        }}
        className="
  relative
  z-10
  ml-0
  lg:ml-[280px]
  px-4
  sm:px-6
  lg:px-10
  py-6
  lg:py-10
"
        
      >

        {/* =========================================
        HEADER
        ========================================= */}

        <div
      className="
  flex
  flex-col
  lg:flex-row
  lg:items-start
  lg:justify-between
  gap-6
  lg:gap-10
"
        >

          <div>

            <div
              className="
                inline-flex
                items-center
                gap-3
                rounded-full
                border
                border-white/10
                bg-white/[0.03]
                px-5
                py-3
                text-[10px]
                uppercase
                tracking-[0.35em]
                text-white/60
                backdrop-blur-md
              "
            >

              IMNOVA LABS • CORE SYSTEM

            </div>

            <h1
  className="
    mt-8
    text-7xl
    font-black
    leading-none
    tracking-[-0.06em]
    text-white
  "
>
  {
    selectedMenu === "dashboard"
      ? "Dashboard"
      : selectedMenu === "products"
      ? "Productos"
      : selectedMenu === "campaigns"
      ? "Campañas"
      : selectedMenu === "analytics"
      ? "Analytics"
      : "IMNOVA"
  }
</h1>

           <p
  className="
    mt-8
    max-w-4xl
    text-2xl
    text-white/50
  "
>
  {
    selectedMenu === "dashboard"
      ? "Sistema operativo inteligente diseñado para monitorear, desarrollar y expandir el ecosistema IMNOVA."
      : selectedMenu === "products"
      ? "Gestión centralizada de productos y proyectos."
      : selectedMenu === "campaigns"
      ? "Centro de gestión de campañas y generación de leads."
      : selectedMenu === "analytics"
      ? "Métricas, rendimiento y crecimiento del ecosistema."
      : "IMNOVA OS"
  }
</p>

            {/* =========================================
            ACTIONS
            ========================================= */}

            <div
              className="
                mt-10
                flex
                flex-wrap
                gap-4
              "
            >

              <button
                onClick={() =>
                  router.push("/")
                }
                className="
                  rounded-2xl
                  border
                  border-white/10
                  bg-white
                  px-7
                  py-4
                  text-sm
                  font-semibold
                  text-black
                  transition-all
                  duration-300
                  hover:scale-[1.02]
                  hover:bg-zinc-200
                "
              >

                Regresar al Sitio

              </button>

              <button
                onClick={handleLogout}
                className="
                  rounded-2xl
                  border
                  border-white/10
                  bg-white/[0.03]
                  px-7
                  py-4
                  text-sm
                  font-semibold
                  text-white
                  backdrop-blur-md
                  transition-all
                  duration-300
                  hover:bg-white/[0.06]
                  hover:border-white/20
                "
              >

                Cerrar Sesión

              </button>

            </div>

          </div>

          {/* =========================================
          SYSTEM STATUS
          ========================================= */}

          <motion.div
            animate={{
              y: [-4, 4, -4],
            }}
            transition={{
              duration: 5,
              repeat: Infinity,
              ease: "easeInOut",
            }}
            className="
              relative
              overflow-hidden
              rounded-[32px]
              border
              border-white/10
              bg-white/[0.03]
              px-8
              py-7
              backdrop-blur-md
            "
          >

            <div
              className="
                absolute
                inset-0
                bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.04),transparent_60%)]
              "
            />

            <div className="relative z-10">

              <p
                className="
                  text-[10px]
                  uppercase
                  tracking-[0.35em]
                  text-white/40
                "
              >

                SYSTEM STATUS

              </p>

              <div
                className="
                  mt-5
                  flex
                  items-center
                  gap-4
                "
              >

                <div
                  className="
                    h-3
                    w-3
                    rounded-full
                    bg-green-400
                    shadow-[0_0_15px_rgba(74,222,128,0.7)]
                  "
                />

                <p
                  className="
                    text-lg
                    font-semibold
                    text-white
                  "
                >

                  IMNOVA CORE ACTIVE

                </p>

              </div>

            </div>

          </motion.div>

        </div>

        {/* =========================================
        DASHBOARD
        ========================================= */}

        {
          selectedMenu === "dashboard" && (

            <>

              {/* METRICS */}

              <div className="mt-16">

                <Metrics />

              </div>

              {/* PRODUCTS */}

              <div className="mt-16">

                <div
                  className="
                    mb-10
                    flex
                    items-end
                    justify-between
                  "
                >

                  <div>

                    <p
                      className="
                        text-[10px]
                        uppercase
                        tracking-[0.35em]
                        text-white/35
                      "
                    >

                      LIVE PRODUCTS

                    </p>

                    <h2
                      className="
                        mt-4
                        text-5xl
                        font-black
                        tracking-[-0.05em]
                        text-white
                      "
                    >

                      Ecosistema IMNOVA

                    </h2>

                  </div>

                </div>

                <div
                  className="
                    grid
                    grid-cols-1
                    gap-8
                    xl:grid-cols-2
                  "
                >

                  {liveProducts.map((product) => (

                    <motion.div
                      key={product.id}
                      initial={{
                        opacity: 0,
                        y: 40,
                      }}
                      animate={{
                        opacity: 1,
                        y: 0,
                      }}
                      transition={{
                        duration: 0.7,
                      }}
                      className="
                        rounded-[36px]
                        border
                        border-white/10
                        bg-white/[0.03]
                        p-2
                        backdrop-blur-md
                        transition-all
                        duration-500
                        hover:-translate-y-1
                        hover:border-white/20
                        hover:bg-white/[0.04]
                      "
                    >

                      <ProductCard
                        product={product}
                      />

                    </motion.div>

                  ))}

                </div>

              </div>

              {/* ACTIVITY */}

              <div className="mt-16 pb-20">

                <div
                  className="
                    relative
                    overflow-hidden
                    rounded-[36px]
                    border
                    border-white/10
                    bg-white/[0.03]
                    p-8
                    backdrop-blur-md
                  "
                >

                  <div
                    className="
                      absolute
                      inset-0
                      bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.04),transparent_60%)]
                    "
                  />

                  <div className="relative z-10">

                    <ActivityFeed />

                  </div>

                </div>

              </div>

            </>

          )
        }

        {
          selectedMenu === "products" && (

            <div className="mt-16">

              <h2
                className="
                  text-6xl
                  font-black
                  tracking-[-0.05em]
                  text-white
                "
              >

                Productos

              </h2>

            </div>

          )
        }
         {
  selectedMenu === "campaigns" && (

    <div className="mt-16">

      <div
        className="
          mt-10
          grid
          grid-cols-1
          gap-6
          md:grid-cols-4
        "
      >

        <div
          className="
            rounded-3xl
            border
            border-white/10
            bg-white/[0.03]
            p-6
          "
        >
          <h3>Total Campañas</h3>

          <p className="mt-3 text-4xl font-bold">
         {campaigns.length}
         </p>

        </div>

        <div
          className="
            rounded-3xl
            border
            border-white/10
            bg-white/[0.03]
            p-6
          "
        >
          <h3>Activas</h3>

         <p className="mt-3 text-4xl font-bold">
  {
    campaigns.filter(
      campaign =>
        campaign.status === "Active"
    ).length
  }
</p>

        </div>

        <div
          className="
            rounded-3xl
            border
            border-white/10
            bg-white/[0.03]
            p-6
          "
        >
          <h3>Leads</h3>

         <p className="mt-3 text-4xl font-bold">
  {
    campaigns.reduce(
      (total, campaign) =>
        total + campaign.leads,
      0
    )
  }
</p>


        </div>

      </div>

      {/* TABLA DE CAMPAÑAS */}

      <div
        className="
          mt-12
          overflow-hidden
          rounded-3xl
          border
          border-white/10
          bg-white/[0.03]
        "
      >

        <div
          className="
            flex
            items-center
            justify-between
            border-b
            border-white/10
            p-6
          "
        >

          <h3
            className="
              text-2xl
              font-bold
              text-white
            "
          >
            Campañas Activas
          </h3>

          <button
  onClick={() =>
    setShowCampaignModal(true)
  }
  className="
  rounded-2xl
  border
  border-cyan-400/20
  bg-cyan-400/10
  px-3
  sm:px-5
  py-2
  text-xs
  sm:text-sm
  text-cyan-300
"

>
  + Nueva Campaña
</button>

        </div>

        <table className="w-full">

          <thead>

            <tr
              className="
                border-b
                border-white/10
                text-left
              "
            >

              <th className="p-5 text-white/60">
                Campaña
              </th>

              <th className="p-5 text-white/60">
                Producto
              </th>

              <th className="p-5 text-white/60">
                Canal
              </th>

              <th className="p-5 text-white/60">
                Estado
              </th>

              <th className="p-5 text-white/60">
                Leads
              </th>

            </tr>

          </thead>

          <tbody>

  {campaigns.map((campaign) => (

    <tr
      key={campaign.id}
      className="
        border-b
        border-white/5
      "
    >

      <td className="p-5 text-white">
        {campaign.name}
      </td>

      <td className="p-5 text-white/70">
  {campaign.product || "Idea en Validación"}
</td>

      <td className="p-5 text-white/70">
        {campaign.channel}
      </td>

      <td className="p-5">

        <span
          className="
            rounded-full
            bg-yellow-500/20
            px-3
            py-1
            text-yellow-400
          "
        >
          {campaign.status}
        </span>

      </td>

      <td className="p-5 text-white">
        {campaign.leads}
      </td>

    </tr>

  ))}

</tbody>

        </table>

      </div>

    </div>

  )
}
      
                {
  selectedMenu === "analytics" && (

    <div className="mt-16">

      <h2
        className="
          text-6xl
          font-black
          tracking-[-0.05em]
          text-white
        "
      >
       
      </h2>

     

      <div
        className="
          mt-10
          grid
          grid-cols-1
          gap-6
          md:grid-cols-4
        "
      >

        <div
          className="
            rounded-3xl
            border
            border-white/10
            bg-white/[0.03]
            p-6
          "
        >
          <h3>Total Campañas</h3>
          <p className="mt-3 text-4xl font-bold">
         {campaigns.length}
          </p>
        </div>

        <div
          className="
            rounded-3xl
            border
            border-white/10
            bg-white/[0.03]
            p-6
          "
        >
          <h3>Activas</h3>
          <p className="mt-3 text-4xl font-bold">
  {
    campaigns.filter(
      campaign =>
        campaign.status === "Active"
    ).length
  }
</p>
        </div>

        <div
          className="
            rounded-3xl
            border
            border-white/10
            bg-white/[0.03]
            p-6
          "
        >
          <h3>Leads</h3>
          <p className="mt-3 text-4xl font-bold">
  {
    campaigns.reduce(
      (total, campaign) =>
        total + campaign.leads,
      0
    )
  }
</p>
        </div>
        <div
  className="
    rounded-3xl
    border
    border-white/10
    bg-white/[0.03]
    p-6
  "
>
  <h3>Productos</h3>

  <p className="mt-3 text-4xl font-bold">
    {products.length}
  </p>

</div>
<div
  className="
    mt-10
    w-full
    rounded-3xl
    border
    border-white/10
    bg-white/[0.03]
    p-8
  "
>

  <h3
    className="
      text-2xl
      font-bold
      text-white
    "
  >
    Rendimiento por Canal
  </h3>

  <div className="mt-6 space-y-4">

    <div className="flex justify-between text-white">
      <span>TikTok</span>
      <span>
        {
          campaigns.filter(
            c => c.channel === "TikTok"
          ).length
        }
      </span>
    </div>

    <div className="flex justify-between text-white">
      <span>Facebook</span>
      <span>
        {
          campaigns.filter(
            c => c.channel === "Facebook"
          ).length
        }
      </span>
    </div>

    <div className="flex justify-between text-white">
      <span>Instagram</span>
      <span>
        {
          campaigns.filter(
            c => c.channel === "Instagram"
          ).length
        }
      </span>
    </div>

    <div className="flex justify-between text-white">
      <span>Google Ads</span>
      <span>
        {
          campaigns.filter(
            c => c.channel === "Google Ads"
          ).length
        }
      </span>
    </div>

  </div>

</div>

      </div>

    </div>

  )
}
                


      </motion.div>
     { 
     
  showCampaignModal && (

    <div
      className="
        fixed
        inset-0
        z-[999]
        flex
        items-center
        justify-center
        bg-black/80
        backdrop-blur-md
      "
    >

      <div
        className="
          w-full
          max-w-2xl
          rounded-3xl
          border
          border-white/10
          bg-[#050505]
          p-8
        "
      >

        <div
          className="
            flex
            items-center
            justify-between
          "
        >

          <h2
            className="
              text-4xl
              font-black
              text-white
            "
          >
            Nueva Campaña
          </h2>

          <button
            onClick={() =>
              setShowCampaignModal(false)
            }
            className="text-white"
          >
            ✕
          </button>

        </div>

        <div
  className="
    mt-8
    grid
    gap-5
  "
>
 <select
  value={campaignType}
  onChange={(e) =>
    setCampaignType(
      e.target.value
    )
  }
  className="
    w-full
    rounded-2xl
    border
    border-white/10
    bg-[#0b0b0b]
    p-4
    text-white
  "
>
  <option value="validation">
    Validación
  </option>

  <option value="product">
    Producto Existente
  </option>
</select>

{campaignType === "validation" && (
  <input
    value={validationIdea}
    onChange={(e) =>
      setValidationIdea(
        e.target.value
      )
    }
    placeholder="Idea o producto a validar"
    className="
      w-full
      rounded-2xl
      border
      border-white/10
      bg-white/[0.03]
      p-4
      text-white
    "
  />
)}
  {campaignType === "product" && (
    <select
      value={campaignProduct}
      onChange={(e) =>
        setCampaignProduct(e.target.value)
      }
      className="
        w-full
        rounded-2xl
        border
        border-white/10
        bg-[#0b0b0b]
        p-4
        text-white
      "
    >
      <option value="">
        Seleccionar producto
      </option>

      {products.map((product) => (
        <option
          key={product.id}
          value={product.name}
        >
          {product.name}
        </option>
      ))}
    </select>
  )}

<select
  value={campaignChannel}
  onChange={(e) =>
    setCampaignChannel(e.target.value)
  }
  className="
    w-full
    rounded-2xl
    border
    border-white/10
    bg-[#0b0b0b]
    p-4
    text-white
  "
>
  <option value="TikTok">TikTok</option>
  <option value="Facebook">Facebook</option>
  <option value="Instagram">Instagram</option>
  <option value="Google Ads">Google Ads</option>
</select>

<input
  value={campaignBudget}
  onChange={(e) =>
    setCampaignBudget(e.target.value)
  }
  placeholder="Presupuesto"
  className="
    w-full
    rounded-2xl
    border
    border-white/10
    bg-white/[0.03]
    p-4
    text-white
  "
/>
</div>

<div
  className="
    mt-8
    flex
    justify-end
    gap-4
  "
>
  <button
    onClick={() =>
      setShowCampaignModal(false)
    }
    className="
      rounded-2xl
      border
      border-white/10
      px-6
      py-3
      text-white
    "
  >
    Cancelar
  </button>

  <button
    onClick={createCampaign}
    className="
      rounded-2xl
      bg-cyan-500
      px-6
      py-3
      font-bold
      text-black
    "
  >
    Crear Campaña
  </button>
</div>

      </div>
    </div>
  )
}

    </main>
  )
}