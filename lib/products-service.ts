import { supabase } from "./supabase"

export async function getProducts() {

  const { data, error } = await supabase
    .from("products")
    .select("*")

  console.log("SUPABASE PRODUCTS DATA:", data)
  console.log("SUPABASE PRODUCTS ERROR:", error)

  return data || []
}

export async function getProductStates() {

  const { data, error } = await supabase
    .from("product_states")
    .select("*")

  console.log("SUPABASE STATES DATA:", data)
  console.log("SUPABASE STATES ERROR:", error)

  return data || []
}

export async function updateProduct(
  id: string | number,
  updates: {
    progress?: number
  }
) {

  console.log("UPDATE PRODUCT PAYLOAD:", { id, updates })

  const { data, error } = await supabase
    .from("products")
    .update(updates)
    .eq("id", id)
    .select()

  if (error) {
    console.error("UPDATE PRODUCT ERROR CODE:", error.code)
    console.error("UPDATE PRODUCT ERROR MESSAGE:", error.message)
    console.error("UPDATE PRODUCT ERROR DETAILS:", error)
    return null
  }

  console.log("PRODUCT UPDATED:", data)
  return data
}

export async function updateProductState(
  id: string | number,
  updates: {
    name?: string
    progress?: number
  }
) {

  console.log("UPDATE STATE PAYLOAD:", { id, updates })

  const { data, error } = await supabase
    .from("product_states")
    .update(updates)
    .eq("id", id)
    .select()

  if (error) {
    console.error("UPDATE STATE ERROR CODE:", error.code)
    console.error("UPDATE STATE ERROR MESSAGE:", error.message)
    console.error("UPDATE STATE ERROR DETAILS:", error)
    return null
  }

  console.log("STATE UPDATED:", data)
  return data
}
