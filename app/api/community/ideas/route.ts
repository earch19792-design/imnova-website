export const runtime = "nodejs"

import { NextResponse } from "next/server"

type ProductIdeaRow = {
  id: string
  slug: string | null
  name: string | null
  category: string | null
  description: string | null
  problema_resuelve: string | null
  expected_benefit: string | null
  main_benefit: string | null
  created_at: string | null
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

function normalizeIdeaKey(
  value: string
) {
  return value
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 160)
}

function getMarketingProblem(
  product: ProductIdeaRow,
  title: string,
  tag: string
) {
  const storedProblem =
    product.problema_resuelve?.trim()

  if (storedProblem) {
    return storedProblem
  }

  const searchText =
    [
      product.slug,
      title,
      tag,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()

  if (
    searchText.includes("6pack") ||
    searchText.includes("6-pack") ||
    searchText.includes("6 pack")
  ) {
    return "Personas interesadas en cafe funcional que no quieren comprar una unidad aislada cada vez, sino mantener una rutina semanal mas practica, conveniente y facil de repetir."
  }

  if (
    searchText.includes("pancake") ||
    searchText.includes("nutri")
  ) {
    return "Personas que quieren desayunar rico y sentirse satisfechas, pero no quieren depender de opciones pesadas, poco nutritivas o complicadas de preparar."
  }

  if (
    searchText.includes("pan") ||
    searchText.includes("nutra")
  ) {
    return "Personas que aman el pan, pero buscan una alternativa mas funcional para tostadas, sandwiches y comidas practicas sin sentir que rompen su rutina."
  }

  if (searchText.includes("coffee")) {
    return "Personas que quieren energia y cafe en su dia, pero buscan una opcion mas funcional, clara y alineada con una rutina moderna."
  }

  return `Personas que buscan una solucion mas simple y funcional dentro de ${tag.toLowerCase()}, pero aun no encuentran una opcion clara, practica y facil de adoptar.`
}

function getMarketingSolution(
  product: ProductIdeaRow,
  title: string,
  tag: string
) {
  const storedSolution =
    product.expected_benefit?.trim() ||
    product.main_benefit?.trim()

  if (storedSolution) {
    return storedSolution
  }

  const searchText =
    [
      product.slug,
      title,
      tag,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()

  if (
    searchText.includes("6pack") ||
    searchText.includes("6-pack") ||
    searchText.includes("6 pack")
  ) {
    return "Un pack semanal de MASH Coffee+ para validar si la comunidad prefiere comprar su cafe funcional por rutina, con mayor conveniencia y disponibilidad durante varios dias."
  }

  if (
    searchText.includes("pancake") ||
    searchText.includes("nutri")
  ) {
    return "Una mezcla para pancakes y waffles proteicos que convierte el desayuno en una opcion mas practica, rica y funcional, sin exigir recetas largas ni decisiones complicadas."
  }

  if (
    searchText.includes("pan") ||
    searchText.includes("nutra")
  ) {
    return "Una mezcla para pan alto en proteina que permite disfrutar pan casero con un perfil mas funcional y facil de integrar a comidas diarias."
  }

  if (product.description?.trim()) {
    return `Una propuesta IMNOVA para convertir esta oportunidad en una solucion concreta: ${product.description.trim()}`
  }

  return "Una propuesta IMNOVA para transformar esa necesidad en una experiencia concreta, entendible y validada por la comunidad antes de avanzar."
}

function mapProductIdea(
  product: ProductIdeaRow
) {
  const title =
    product.name?.trim() ||
    "Idea IMNOVA"

  const tag =
    product.category?.trim() ||
    "Idea en validacion"

  const problem =
    getMarketingProblem(
      product,
      title,
      tag
    )

  const solution =
    getMarketingSolution(
      product,
      title,
      tag
    )

  return {
    id: product.id,
    key:
      product.slug?.trim() ||
      normalizeIdeaKey(title) ||
      product.id,
    title,
    tag,
    description:
      "Idea en etapa inicial. Tu voto ayuda a decidir si esta oportunidad avanza, se ajusta o se pausa.",
    signal:
      `Si ${title} conecta con tu rutina, tu respuesta ayuda a priorizarla dentro de IMNOVA.`,
    problem,
    solution,
  }
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
        "community_ideas_backend_not_configured"
      )
    }

    const restUrl =
      `${supabaseUrl}/rest/v1`

    const ideaStateResponse =
      await fetch(
        `${restUrl}/product_states?select=id,name&name=eq.Idea&limit=1`,
        {
          headers: getRestHeaders(),
          cache: "no-store",
        }
      )

    if (!ideaStateResponse.ok) {
      const details =
        await ideaStateResponse
          .text()
          .catch(() => "")

      console.error(
        "GET COMMUNITY IDEAS STATE ERROR:",
        details
      )

      return NextResponse.json({
        success: false,
        ideas: [],
        error: "idea_state_lookup_failed",
      })
    }

    const ideaStates =
      await ideaStateResponse
        .json()
        .catch(() => []) as Array<{
          id?: string
          name?: string
        }>

    const ideaState =
      ideaStates[0]

    if (!ideaState?.id) {
      return NextResponse.json({
        success: true,
        ideas: [],
      })
    }

    const productsResponse =
      await fetch(
        `${restUrl}/public_products?select=id,slug,name,category,description,problema_resuelve,expected_benefit,main_benefit,created_at&state_id=eq.${encodeURIComponent(ideaState.id)}&order=created_at.desc&limit=24`,
        {
          headers: getRestHeaders(),
          cache: "no-store",
        }
      )

    if (!productsResponse.ok) {
      const details =
        await productsResponse
          .text()
          .catch(() => "")

      console.error(
        "GET COMMUNITY IDEAS PRODUCTS ERROR:",
        details
      )

      return NextResponse.json({
        success: false,
        ideas: [],
        error: "idea_products_lookup_failed",
      })
    }

    const products =
      await productsResponse
        .json()
        .catch(() => []) as ProductIdeaRow[]

    return NextResponse.json({
      success: true,
      ideas: products.map(mapProductIdea),
    })
  } catch (error) {
    console.error(
      "GET COMMUNITY IDEAS ERROR:",
      error
    )

    return NextResponse.json({
      success: false,
      ideas: [],
      error: "community_ideas_failed",
    })
  }
}
