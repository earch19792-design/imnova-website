export const runtime = "nodejs"

import { NextResponse } from "next/server"

type StoreFeaturedProductRow = {
  id: string
  slug: string | null
  name: string | null
  category: string | null
  description: string | null
  short_description?: string | null
  image_url: string | null
  image: string | null
  price: string | number | null
  currency: string | null
  state_id: string | null
  launch_promo_enabled: boolean | null
  launch_discount_percent: string | number | null
  launch_promo_start_at: string | null
  launch_promo_end_at: string | null
  launch_promo_duration_days: string | number | null
  featured?: boolean | null
  visible?: boolean | null
  is_public?: boolean | null
  is_active?: boolean | null
  created_at: string | null
}

const storeImagesBySlug: Record<string, string> = {
  "mash-coffee":
    "/images/products/store/mash-coffee/mash-coffee-lata-250ml-frontal.webp",
  "mash-coffee-6pack":
    "/images/products/store/mash-coffee/mash-coffee-6-pack-frontal.webp",
  "mash-coffee-12pack":
    "/images/products/store/mash-coffee/mash-coffee-12-pack-frontal.webp",
  "mash-nutri-pancake":
    "/images/products/store/mash-nutri-pancake/mash-nutri-pancake-150g-frontal.webp",
  "mash-nutri-pan":
    "/images/products/store/mash-nutri-pan/mash-nutra-pan-proteinico-200g-frontal.webp",
}

function getSupabaseUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || ""
}

function getSupabaseServiceRoleKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || ""
}

function getRestHeaders() {
  const serviceRoleKey =
    getSupabaseServiceRoleKey()

  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  }
}

function getNumberValue(
  value?: number | string | null
) {
  const numberValue =
    Number(value)

  return Number.isFinite(numberValue)
    ? numberValue
    : null
}

function getLaunchPromotion(
  product: StoreFeaturedProductRow,
  now: Date
) {
  const discount =
    getNumberValue(
      product.launch_discount_percent
    )

  const startDate =
    product.launch_promo_start_at
      ? new Date(
          product.launch_promo_start_at
        )
      : null

  const endDate =
    product.launch_promo_end_at
      ? new Date(
          product.launch_promo_end_at
        )
      : null

  const startsAtValid =
    !startDate ||
    (
      !Number.isNaN(
        startDate.getTime()
      ) &&
      startDate.getTime() <=
        now.getTime()
    )

  const endsAtValid =
    !endDate ||
    (
      !Number.isNaN(
        endDate.getTime()
      ) &&
      endDate.getTime() >
        now.getTime()
    )

  const isActive =
    product.launch_promo_enabled === true &&
    Boolean(
      discount &&
        discount > 0
    ) &&
    startsAtValid &&
    endsAtValid

  const remainingMs =
    isActive && endDate
      ? Math.max(
          0,
          endDate.getTime() -
            now.getTime()
        )
      : 0

  return {
    isActive,
    discount:
      discount || 0,
    days:
      Math.floor(
        remainingMs /
          (1000 * 60 * 60 * 24)
      ),
    hours:
      Math.floor(
        (
          remainingMs %
          (1000 * 60 * 60 * 24)
        ) /
          (1000 * 60 * 60)
      ),
  }
}

function getStoreImage(
  product: StoreFeaturedProductRow
) {
  const slug =
    product.slug || ""

  return (
    storeImagesBySlug[slug] ||
    product.image_url ||
    product.image ||
    "/placeholder.jpg"
  )
}

function getProductPriority(
  product: StoreFeaturedProductRow,
  now: Date
) {
  const promotion =
    getLaunchPromotion(
      product,
      now
    )

  if (promotion.isActive) {
    return 4000 + promotion.discount
  }

  if (product.featured === true) {
    return 3000
  }

  const slug =
    product.slug || ""

  if (slug.includes("12pack")) {
    return 2200
  }

  if (slug.includes("6pack")) {
    return 2100
  }

  return 1000
}

function getProductHeadline(
  product: StoreFeaturedProductRow
) {
  const name =
    product.name?.trim() ||
    "Producto IMNOVA"

  return `${name} ya puede comprarse.`
}

function getPromoLabel(
  product: StoreFeaturedProductRow,
  now: Date
) {
  const promotion =
    getLaunchPromotion(
      product,
      now
    )

  if (!promotion.isActive) {
    return "Producto disponible"
  }

  if (promotion.days > 0) {
    return `${promotion.discount}% OFF por ${promotion.days} dias`
  }

  if (promotion.hours > 0) {
    return `${promotion.discount}% OFF por ${promotion.hours} horas`
  }

  return `${promotion.discount}% OFF activo`
}

async function fetchAvailableProducts(
  restUrl: string,
  availableStateId: string,
  includeOptionalColumns: boolean
) {
  const optionalColumns =
    includeOptionalColumns
      ? ",short_description,visible,is_public,is_active,featured"
      : ",short_description,visible,is_public,is_active"

  const response =
    await fetch(
      `${restUrl}/products?select=id,slug,name,category,description,image_url,image,price,currency,state_id,launch_promo_enabled,launch_discount_percent,launch_promo_start_at,launch_promo_end_at,launch_promo_duration_days,created_at${optionalColumns}&state_id=eq.${encodeURIComponent(availableStateId)}&visible=is.true&is_public=is.true&is_active=is.true&order=created_at.desc`,
      {
        headers: getRestHeaders(),
        cache: "no-store",
      }
    )

  if (!response.ok) {
    const details =
      await response
        .text()
        .catch(() => "")

    if (includeOptionalColumns) {
      return fetchAvailableProducts(
        restUrl,
        availableStateId,
        false
      )
    }

    console.error(
      "GET STORE FEATURED PRODUCTS ERROR:",
      details
    )

    throw new Error(
      "store_featured_products_lookup_failed"
    )
  }

  return response
    .json()
    .catch(() => []) as Promise<StoreFeaturedProductRow[]>
}

export async function GET() {
  try {
    const supabaseUrl =
      getSupabaseUrl()

    const serviceRoleKey =
      getSupabaseServiceRoleKey()

    if (
      !supabaseUrl ||
      !serviceRoleKey
    ) {
      throw new Error(
        "store_featured_backend_not_configured"
      )
    }

    const restUrl =
      `${supabaseUrl}/rest/v1`

    const stateResponse =
      await fetch(
        `${restUrl}/product_states?select=id,name&name=eq.Disponible&limit=1`,
        {
          headers: getRestHeaders(),
          cache: "no-store",
        }
      )

    if (!stateResponse.ok) {
      const details =
        await stateResponse
          .text()
          .catch(() => "")

      console.error(
        "GET STORE FEATURED STATE ERROR:",
        details
      )

      return NextResponse.json({
        success: false,
        product: null,
        error: "available_state_lookup_failed",
      })
    }

    const states =
      await stateResponse
        .json()
        .catch(() => []) as Array<{
          id?: string
          name?: string
        }>

    const availableState =
      states[0]

    if (!availableState?.id) {
      return NextResponse.json({
        success: true,
        product: null,
      })
    }

    const now =
      new Date()

    const products =
      await fetchAvailableProducts(
        restUrl,
        availableState.id,
        true
      )

    const selectedProduct =
      [...products].sort(
        (first, second) =>
          getProductPriority(
            second,
            now
          ) -
            getProductPriority(
              first,
              now
            )
      )[0]

    if (!selectedProduct) {
      return NextResponse.json({
        success: true,
        product: null,
      })
    }

    const promotion =
      getLaunchPromotion(
        selectedProduct,
        now
      )

    return NextResponse.json({
      success: true,
      product: {
        id: selectedProduct.id,
        slug: selectedProduct.slug,
        name:
          selectedProduct.name ||
          "Producto IMNOVA",
        category:
          selectedProduct.category ||
          null,
        description:
          selectedProduct.short_description ||
          selectedProduct.description ||
          null,
        image:
          getStoreImage(
            selectedProduct
          ),
        storeHref:
          selectedProduct.slug
            ? `/store/${selectedProduct.slug}`
            : "/store",
        headline:
          getProductHeadline(
            selectedProduct
          ),
        badge:
          promotion.isActive
            ? "Promocion activa"
            : selectedProduct.featured === true
              ? "Producto destacado"
              : "Producto disponible",
        promoLabel:
          getPromoLabel(
            selectedProduct,
            now
          ),
        hasActivePromotion:
          promotion.isActive,
        discount:
          promotion.discount,
      },
    })
  } catch (error) {
    console.error(
      "GET STORE FEATURED ERROR:",
      error
    )

    return NextResponse.json({
      success: false,
      product: null,
      error: "store_featured_failed",
    })
  }
}
