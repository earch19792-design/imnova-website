import { supabase } from "./supabase"

export async function getProducts() {

  const { data, error } = await supabase
    .from("products")
    .select("*")

  console.log("SUPABASE DATA:", data)
  console.log("SUPABASE ERROR:", error)

  return data || []
}