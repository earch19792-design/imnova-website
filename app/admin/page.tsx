"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

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
        min-h-screen
        overflow-hidden
        bg-black
        text-white
      "
    >

      {/* BACKGROUND */}

      <div
        className="
          fixed
          inset-0
          pointer-events-none
          bg-[radial-gradient(circle_at_top,#0f172a_0%,#000_45%)]
        "
      />

      <div
        className="
          fixed
          inset-0
          pointer-events-none
          opacity-[0.04]
          bg-[linear-gradient(rgba(0,255,255,0.2)_1px,transparent_1px),linear-gradient(90deg,rgba(0,255,255,0.2)_1px,transparent_1px)]
          bg-[size:40px_40px]
        "
      />

      {/* SIDEBAR */}

      <Sidebar
        selectedMenu={selectedMenu}
        setSelectedMenu={setSelectedMenu}
      />

      {/* CONTENT */}

      <div
        className="
          relative
          z-10
          ml-[280px]
          px-10
          py-10
        "
      >

        {/* HEADER */}

        <div
          className="
            flex
            items-center
            justify-between
          "
        >

          <div>

            <p
              className="
                text-xs
                uppercase
                tracking-[0.45em]
                text-cyan-300
              "
            >

              IMNOVA LABS // CORE SYSTEM

            </p>

            <h1
              className="
                mt-4
                text-6xl
                font-black
                tracking-wider
                text-white
                drop-shadow-[0_0_20px_rgba(0,255,255,0.35)]
              "
            >

              Dashboard

            </h1>

            <p
              className="
                mt-4
                max-w-xl
                text-sm
                leading-relaxed
                text-zinc-400
              "
            >

              Tecnología • Nutrición • Evolución

            </p>

            <div
              className="
                mt-8
                flex
                gap-4
              "
            >

              <button
                onClick={() =>
                  router.push("/")
                }
                className="
                  flex
                  items-center
                  gap-3
                  rounded-2xl
                  border
                  border-cyan-400/20
                  bg-cyan-400/10
                  px-6
                  py-4
                  text-sm
                  font-medium
                  text-cyan-300
                  backdrop-blur-xl
                  transition-all
                  duration-300
                  hover:scale-[1.02]
                  hover:border-cyan-400/40
                  hover:bg-cyan-400/20
                "
              >

                ← Regresar al sitio principal

              </button>

              <button
                onClick={handleLogout}
                className="
                  rounded-2xl
                  border
                  border-red-400/20
                  bg-red-500/10
                  px-6
                  py-4
                  text-sm
                  font-medium
                  text-red-300
                  backdrop-blur-xl
                  transition-all
                  duration-300
                  hover:scale-[1.02]
                  hover:border-red-400/40
                  hover:bg-red-500/20
                "
              >

                Cerrar sesión

              </button>

            </div>

          </div>

          {/* SYSTEM STATUS */}

          <div
            className="
              rounded-3xl
              border
              border-cyan-400/20
              bg-white/[0.03]
              px-8
              py-6
              backdrop-blur-2xl
              shadow-[0_0_40px_rgba(0,255,255,0.08)]
            "
          >

            <p
              className="
                text-xs
                uppercase
                tracking-[0.35em]
                text-cyan-300
              "
            >

              SYSTEM STATUS

            </p>

            <div
              className="
                mt-4
                flex
                items-center
                gap-3
              "
            >

              <div
                className="
                  h-3
                  w-3
                  animate-pulse
                  rounded-full
                  bg-cyan-400
                  shadow-[0_0_15px_rgba(34,211,238,1)]
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

        </div>

        {/* DASHBOARD */}

        {
          selectedMenu === "dashboard" && (

            <>
              <div className="mt-14">

                <Metrics />

              </div>

              <div className="mt-14">

                <div
                  className="
                    mb-8
                    flex
                    items-center
                    justify-between
                  "
                >

                  <div>

                    <p
                      className="
                        text-xs
                        uppercase
                        tracking-[0.35em]
                        text-cyan-300
                      "
                    >

                      LIVE PRODUCTS

                    </p>

                    <h2
                      className="
                        mt-3
                        text-4xl
                        font-black
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

                    <div
                      key={product.id}
                      className="
                        rounded-[32px]
                        border
                        border-cyan-400/15
                        bg-white/[0.03]
                        p-2
                        backdrop-blur-2xl
                        transition-all
                        duration-500
                        hover:-translate-y-1
                        hover:border-cyan-400/35
                      "
                    >

                      <ProductCard
                        product={product}
                      />

                    </div>

                  ))}

                </div>

              </div>

              <div className="mt-14 pb-20">

                <div
                  className="
                    rounded-[32px]
                    border
                    border-cyan-400/15
                    bg-white/[0.03]
                    p-8
                    backdrop-blur-2xl
                  "
                >

                  <ActivityFeed />

                </div>

              </div>
            </>

          )
        }

        {
          selectedMenu === "products" && (

            <div className="mt-14">

              <h2
                className="
                  text-5xl
                  font-black
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

            <div className="mt-14">

              <h2
                className="
                  text-5xl
                  font-black
                  text-white
                "
              >

                Analytics

              </h2>

            </div>

          )
        }

      </div>

    </main>

  )

}