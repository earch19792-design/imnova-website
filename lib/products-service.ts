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

export async function updateProduct(
  productId: string,
  updates: {
    state_id?: string | null
    distribution_channels?: Array<{
      id: string
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
      {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
      }
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
