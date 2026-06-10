import { supabase } from "./supabase"

export async function getProducts() {

  const { data, error } =
    await supabase
      .from("products")
      .select("*")
      .order(
        "created_at",
        {
          ascending: false,
        }
      )

  if (error) {

    console.error(
      "GET PRODUCTS ERROR:",
      error
    )

    return []

  }

  return data || []

}

export async function getProductStates() {

  const { data, error } =
    await supabase
      .from("product_states")
      .select("*")
      .eq(
        "is_active",
        true
      )
      .order(
        "sort_order",
        {
          ascending: true,
        }
      )

  if (error) {

    console.error(
      "GET PRODUCT STATES ERROR:",
      error
    )

    return []

  }

  return data || []

}

export async function getProductBySlug(
  slug: string
) {

  const { data, error } =
    await supabase
      .from("products")
      .select("*")
      .eq(
        "slug",
        slug
      )
      .single()

  if (error) {

    console.error(
      "GET PRODUCT BY SLUG ERROR:",
      error
    )

    return null

  }

  return data

}

function serializeSupabaseError(
  error: unknown
) {

  if (!error) {
    return null
  }

  if (error instanceof Error) {
    return {
      name:
        error.name,
      message:
        error.message,
      stack:
        error.stack,
    }
  }

  if (
    typeof error === "object" &&
    error !== null
  ) {
    const entries =
      Object.getOwnPropertyNames(error)
        .map(
          key => [
            key,
            (error as Record<string, unknown>)[key],
          ]
        )

    return {
      ...Object.fromEntries(entries),
      raw:
        error,
    }
  }

  return {
    message:
      String(error),
  }

}

export async function updateProduct(
  productId: string,
  updates: {
    state_id?: string | null
    nicho?: string | null
    problema_resuelve?: string | null
    lifestyle_image?: string | null
    lifestyle_images?: string[]
    distribution_channels?: Array<{
      id: string
      country?: string
      city?: string
      type: string
      name: string
      location: string
      status: string
      url?: string
      note?: string
    }>
  }
) {

  console.log(
    "UPDATE PRODUCT:",
    {
      productId,
      updates,
    }
  )

  const { error, count } =
    await supabase
      .from("products")
      .update(
        updates,
        {
          count: "exact",
        }
      )
      .eq(
        "id",
        productId
      )

  if (error) {

    console.error(
      "UPDATE PRODUCT ERROR:",
      serializeSupabaseError(error)
    )

    return null

  }

  const data = {
    id: productId,
    ...updates,
    count,
  }

  console.log(
    "PRODUCT UPDATED:",
    data
  )

  return data

}
