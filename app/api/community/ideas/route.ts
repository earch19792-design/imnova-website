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

type PublicIdea = ReturnType<typeof mapProductIdea>

type CommunityIdeaVoteRow = {
  product_id: string | null
  idea_key: string | null
  vote_type: string | null
}

type IdeaVoteSummary = {
  total_votes: number
  interested_count: number
  would_buy_count: number
  wants_trial_count: number
  not_interested_count: number
}

function createEmptyVoteSummary(): IdeaVoteSummary {
  return {
    total_votes: 0,
    interested_count: 0,
    would_buy_count: 0,
    wants_trial_count: 0,
    not_interested_count: 0,
  }
}

function getIdeaSummaryKey(
  idea: PublicIdea
) {
  return idea.id
    ? `product:${idea.id}`
    : `idea:${idea.key}`
}

async function getIdeaVoteSummaries(
  restUrl: string,
  ideas: PublicIdea[]
) {
  const productIds =
    ideas
      .map(idea => idea.id)
      .filter(Boolean) as string[]

  const summaries =
    new Map<string, IdeaVoteSummary>()

  ideas.forEach(idea => {
    summaries.set(
      getIdeaSummaryKey(idea),
      createEmptyVoteSummary()
    )
  })

  if (productIds.length === 0) {
    return summaries
  }

  const response =
    await fetch(
      `${restUrl}/community_idea_votes?select=product_id,idea_key,vote_type&product_id=in.(${productIds.map(encodeURIComponent).join(",")})`,
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

    console.error(
      "GET COMMUNITY IDEAS VOTE SUMMARY ERROR:",
      details
    )

    return summaries
  }

  const votes =
    await response
      .json()
      .catch(() => []) as CommunityIdeaVoteRow[]

  votes.forEach(vote => {
    const summaryKey =
      vote.product_id
        ? `product:${vote.product_id}`
        : vote.idea_key
          ? `idea:${vote.idea_key}`
          : ""

    const summary =
      summaries.get(summaryKey)

    if (!summary) {
      return
    }

    summary.total_votes += 1

    if (vote.vote_type === "interested") {
      summary.interested_count += 1
    }

    if (vote.vote_type === "would_buy") {
      summary.would_buy_count += 1
    }

    if (vote.vote_type === "wants_trial") {
      summary.wants_trial_count += 1
    }

    if (vote.vote_type === "not_interested") {
      summary.not_interested_count += 1
    }
  })

  return summaries
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

    const ideas =
      products.map(mapProductIdea)

    const voteSummaries =
      await getIdeaVoteSummaries(
        restUrl,
        ideas
      )

    const ideasWithVoteCounts =
      ideas.map(idea => ({
          ...idea,
          ...(voteSummaries.get(
            getIdeaSummaryKey(idea)
          ) || createEmptyVoteSummary()),
        }))

    return NextResponse.json({
      success: true,
      ideas: ideasWithVoteCounts,
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
