"use client"

import {
  useEffect,
  useState,
} from "react"

import {
  useParams,
  useRouter,
} from "next/navigation"

import {
  getProductBySlug,
  getProductStates,
} from "@/lib/products-service"

type Product = {
  id: string
  slug: string
  state_id: string | null
  name: string
  category: string
  description?: string
  image_url?: string
  price?: number
  currency?: string
  direct_url?: string
  amazon_url?: string
  ebay_url?: string
  tiktok_url?: string
  bullets?: string[]
}

type ProductState = {
  id: string
  name: string
  progress: number
}

export default function ProductDetailPage() {
  const router = useRouter()
  const params = useParams()

  const slug = String(params.slug || "")

  const [product, setProduct] =
    useState<Product | null>(null)

  const [states, setStates] =
    useState<ProductState[]>([])

  useEffect(() => {
    async function loadData() {
      const productData =
        await getProductBySlug(slug)

      const statesData =
        await getProductStates()

      setProduct(productData)
      setStates(statesData)
    }

    loadData()
  }, [slug])

  if (!product) {
    return (
      <main className="min-h-screen bg-black p-10 text-white">
        Cargando producto...
      </main>
    )
  }

  const state =
    states.find(
      item => item.id === product.state_id
    )

  return (
    <main className="min-h-screen bg-black px-8 py-10 text-white">
      <button
        onClick={() => router.push("/admin")}
        className="rounded-2xl border border-white/10 px-5 py-3 text-white/70"
      >
        ← Volver al Admin
      </button>

      <section className="mt-12 rounded-[36px] border border-white/10 bg-white/[0.03] p-10">
        <p className="text-[10px] uppercase tracking-[0.35em] text-cyan-300/70">
          Detalle de producto
        </p>

        <h1 className="mt-6 text-6xl font-black tracking-[-0.05em]">
          {product.name}
        </h1>

        <p className="mt-4 text-xl uppercase tracking-[0.25em] text-white/40">
          {product.category}
        </p>

        <div className="mt-10 grid gap-6 md:grid-cols-3">
          <div className="rounded-3xl border border-white/10 p-6">
            <p className="text-white/40">Estado</p>
            <h3 className="mt-3 text-2xl font-bold">
              {state?.name || "Sin estado"}
            </h3>
          </div>

          <div className="rounded-3xl border border-white/10 p-6">
            <p className="text-white/40">Progreso</p>
            <h3 className="mt-3 text-2xl font-bold">
              {state?.progress || 0}%
            </h3>
          </div>

          <div className="rounded-3xl border border-white/10 p-6">
            <p className="text-white/40">Slug</p>
            <h3 className="mt-3 text-lg text-white/70">
              {product.slug}
            </h3>
          </div>
        </div>

        <div className="mt-10">
          <h2 className="text-3xl font-bold">
            Descripción
          </h2>

          <p className="mt-4 max-w-4xl text-white/60">
            {product.description || "Sin descripción registrada."}
          </p>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-2">
          <p className="text-white/50">
            Direct URL: {product.direct_url || "N/A"}
          </p>

          <p className="text-white/50">
            Amazon: {product.amazon_url || "N/A"}
          </p>

          <p className="text-white/50">
            eBay: {product.ebay_url || "N/A"}
          </p>

          <p className="text-white/50">
            TikTok: {product.tiktok_url || "N/A"}
          </p>
        </div>
      </section>
    </main>
  )
}