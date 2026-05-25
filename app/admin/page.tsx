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
          ml-[280px]
          px-10
          py-10
        "
      >

        {/* =========================================
        HEADER
        ========================================= */}

        <div
          className="
            flex
            items-start
            justify-between
            gap-10
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

              Dashboard

            </h1>

            <p
              className="
                mt-6
                max-w-2xl
                text-lg
                leading-relaxed
                text-white/50
              "
            >

              Sistema operativo inteligente
              diseñado para monitorear,
              desarrollar y expandir el
              ecosistema IMNOVA™.

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

                Analytics

              </h2>

            </div>

          )
        }

      </motion.div>

    </main>

  )

}