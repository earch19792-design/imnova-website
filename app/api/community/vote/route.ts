export const runtime = "nodejs"

import { createHash } from "crypto"
import { NextResponse } from "next/server"
import {
  createClient,
  type SupabaseClient,
} from "@supabase/supabase-js"

type CommunityIdeaVotePayload = {
  product_id?: unknown
  idea_key?: unknown
  idea_title?: unknown
  vote_type?: unknown
  source?: unknown
  email?: unknown
  phone?: unknown
  subscriber_id?: unknown
  client_vote_key?: unknown
  strategic_niche_id?: unknown
  subniche_id?: unknown
  area_id?: unknown
  honeypot?: unknown
}

type CommunityIdeaVoteType =
  | "interested"
  | "not_interested"
  | "would_buy"
  | "wants_trial"

type ProductVoteTarget = {
  id: string
  name: string | null
  strategic_niche_id: string | null
  primary_subniche_id: string | null
}

type ExistingVote = {
  id: string
}

const allowedVoteTypes: CommunityIdeaVoteType[] = [
  "interested",
  "not_interested",
  "would_buy",
  "wants_trial",
]

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const emailPattern =
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function getString(
  value: unknown
) {
  return typeof value === "string"
    ? value.trim()
    : ""
}

function normalizeEmail(
  value: unknown
) {
  return getString(value).toLowerCase()
}

function normalizePhone(
  value: unknown
) {
  const normalizedPhone =
    getString(value)
      .replace(/\s+/g, "")

  if (!normalizedPhone) {
    return ""
  }

  return normalizedPhone.startsWith("+")
    ? `+${normalizedPhone.replace(/\D/g, "")}`
    : normalizedPhone.replace(/\D/g, "")
}

function isValidPhone(
  value: string
) {
  const digits =
    value.replace(/\D/g, "")

  return digits.length >= 8 &&
    digits.length <= 15
}

function normalizeIdeaKey(
  value: unknown
) {
  return getString(value)
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 160)
}

function normalizeSource(
  value: unknown
) {
  const source =
    getString(value)

  if (!source) {
    return "idea_active"
  }

  return source
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 80) ||
    "idea_active"
}

function getVoteType(
  value: unknown
): CommunityIdeaVoteType | null {
  const voteType =
    getString(value)

  return allowedVoteTypes.includes(
    voteType as CommunityIdeaVoteType
  )
    ? voteType as CommunityIdeaVoteType
    : null
}

function hashText(
  value: string
) {
  return createHash("sha256")
    .update(value)
    .digest("hex")
}

function getSupabaseUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || ""
}

function getSupabaseServiceRoleKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || ""
}

function getSupabaseAdminClient() {
  const supabaseUrl =
    getSupabaseUrl()

  const serviceRoleKey =
    getSupabaseServiceRoleKey()

  if (
    !supabaseUrl ||
    !serviceRoleKey
  ) {
    throw new Error(
      "missing_service_role_key"
    )
  }

  return createClient(
    supabaseUrl,
    serviceRoleKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )
}

function createErrorResponse(
  error: string,
  status = 400,
  details?: Record<string, unknown>
) {
  return NextResponse.json(
    {
      ok: false,
      error,
      ...details,
    },
    {
      status,
    }
  )
}

function createBackendConfigErrorResponse() {
  return NextResponse.json(
    {
      ok: false,
      error:
        "community_backend_not_configured",
      code:
        getSupabaseUrl()
          ? "missing_service_role_key"
          : "missing_supabase_url",
    },
    {
      status: 500,
    }
  )
}

async function getProductVoteTarget(
  supabase: SupabaseClient,
  productId: string
) {
  const { data, error } =
    await supabase
      .from("products")
      .select(`
        id,
        name,
        strategic_niche_id,
        primary_subniche_id
      `)
      .eq(
        "id",
        productId
      )
      .maybeSingle()

  if (error) {
    throw new Error(
      error.message
    )
  }

  return data as ProductVoteTarget | null
}

async function recordExistsById(
  supabase: SupabaseClient,
  tableName: string,
  id: string
) {
  const { data, error } =
    await supabase
      .from(tableName)
      .select("id")
      .eq(
        "id",
        id
      )
      .maybeSingle()

  if (error) {
    throw new Error(
      error.message
    )
  }

  return Boolean(data)
}

function getClientIpHash(
  req: Request
) {
  const forwardedFor =
    req.headers
      .get("x-forwarded-for")
      ?.split(",")[0]
      ?.trim() ||
    req.headers
      .get("x-real-ip")
      ?.trim() ||
    ""

  return forwardedFor
    ? hashText(forwardedFor)
    : null
}

function createDedupeIdentity({
  subscriberId,
  email,
  phone,
  clientVoteKey,
}: {
  subscriberId: string
  email: string
  phone: string
  clientVoteKey: string
}) {
  if (subscriberId) {
    return {
      type: "subscriber",
      value: subscriberId,
    }
  }

  if (email) {
    return {
      type: "email",
      value: email,
    }
  }

  if (phone) {
    return {
      type: "phone",
      value: phone,
    }
  }

  if (clientVoteKey) {
    return {
      type: "anon",
      value: clientVoteKey,
    }
  }

  return null
}

function createDedupeKey({
  identityType,
  identityValue,
  productId,
  ideaKey,
}: {
  identityType: string
  identityValue: string
  productId: string
  ideaKey: string
}) {
  const targetType =
    productId
      ? "product"
      : "idea"

  const targetValue =
    productId ||
    hashText(ideaKey)

  return {
    dedupeKey:
      [
        identityType,
        hashText(identityValue),
        targetType,
        targetValue,
      ].join(":"),
    dedupeStrategy:
      `${identityType}/${targetType}`,
  }
}

export async function POST(
  req: Request
) {
  let body: CommunityIdeaVotePayload

  try {
    body =
      await req.json() as CommunityIdeaVotePayload
  } catch {
    return createErrorResponse(
      "invalid_json",
      400
    )
  }

  if (getString(body.honeypot)) {
    return createErrorResponse(
      "honeypot_not_empty",
      400
    )
  }

  const voteType =
    getVoteType(
      body.vote_type
    )

  if (!voteType) {
    return createErrorResponse(
      "invalid_vote_type",
      400,
      {
        allowed_vote_types:
          allowedVoteTypes,
      }
    )
  }

  const ideaTitle =
    getString(
      body.idea_title
    ).slice(
      0,
      180
    )

  if (!ideaTitle) {
    return createErrorResponse(
      "idea_title_required",
      400
    )
  }

  const productId =
    getString(
      body.product_id
    )

  if (
    productId &&
    !uuidPattern.test(productId)
  ) {
    return createErrorResponse(
      "invalid_product_id",
      400
    )
  }

  const ideaKey =
    normalizeIdeaKey(
      body.idea_key
    )

  if (
    !productId &&
    !ideaKey
  ) {
    return createErrorResponse(
      "idea_or_product_required",
      400
    )
  }

  const subscriberId =
    getString(
      body.subscriber_id
    )

  if (
    subscriberId &&
    !uuidPattern.test(subscriberId)
  ) {
    return createErrorResponse(
      "invalid_subscriber_id",
      400
    )
  }

  const email =
    normalizeEmail(
      body.email
    )

  if (
    email &&
    !emailPattern.test(email)
  ) {
    return createErrorResponse(
      "invalid_email",
      400
    )
  }

  const phone =
    normalizePhone(
      body.phone
    )

  if (
    phone &&
    !isValidPhone(phone)
  ) {
    return createErrorResponse(
      "invalid_phone",
      400
    )
  }

  const clientVoteKey =
    getString(
      body.client_vote_key
    ).slice(
      0,
      200
    )

  const dedupeIdentity =
    createDedupeIdentity({
      subscriberId,
      email,
      phone,
      clientVoteKey,
    })

  if (!dedupeIdentity) {
    return createErrorResponse(
      "insufficient_dedupe_identity",
      400
    )
  }

  if (
    !getSupabaseUrl() ||
    !getSupabaseServiceRoleKey()
  ) {
    return createBackendConfigErrorResponse()
  }

  const source =
    normalizeSource(
      body.source
    )

  const strategicNicheIdInput =
    getString(
      body.strategic_niche_id
    )

  const subnicheIdInput =
    getString(
      body.subniche_id
    )

  const areaId =
    getString(
      body.area_id
    )

  for (const [
    fieldName,
    idValue,
  ] of [
    [
      "strategic_niche_id",
      strategicNicheIdInput,
    ],
    [
      "subniche_id",
      subnicheIdInput,
    ],
    [
      "area_id",
      areaId,
    ],
  ] as const) {
    if (
      idValue &&
      !uuidPattern.test(idValue)
    ) {
      return createErrorResponse(
        `invalid_${fieldName}`,
        400
      )
    }
  }

  try {
    const supabase =
      getSupabaseAdminClient()

    let product: ProductVoteTarget | null = null

    if (productId) {
      product =
        await getProductVoteTarget(
          supabase,
          productId
        )

      if (!product) {
        return createErrorResponse(
          "product_not_found",
          404
        )
      }
    }

    if (
      subscriberId &&
      !await recordExistsById(
        supabase,
        "subscribers",
        subscriberId
      )
    ) {
      return createErrorResponse(
        "subscriber_not_found",
        404
      )
    }

    if (
      strategicNicheIdInput &&
      !await recordExistsById(
        supabase,
        "strategic_niches",
        strategicNicheIdInput
      )
    ) {
      return createErrorResponse(
        "strategic_niche_not_found",
        404
      )
    }

    if (
      subnicheIdInput &&
      !await recordExistsById(
        supabase,
        "strategic_subniches",
        subnicheIdInput
      )
    ) {
      return createErrorResponse(
        "subniche_not_found",
        404
      )
    }

    if (
      areaId &&
      !await recordExistsById(
        supabase,
        "community_interest_areas",
        areaId
      )
    ) {
      return createErrorResponse(
        "area_not_found",
        404
      )
    }

    const strategicNicheId =
      strategicNicheIdInput ||
      product?.strategic_niche_id ||
      null

    const subnicheId =
      subnicheIdInput ||
      product?.primary_subniche_id ||
      null

    const {
      dedupeKey,
      dedupeStrategy,
    } =
      createDedupeKey({
        identityType:
          dedupeIdentity.type,
        identityValue:
          dedupeIdentity.value,
        productId,
        ideaKey,
      })

    const { data: existingVote, error: existingVoteError } =
      await supabase
        .from("community_idea_votes")
        .select("id")
        .eq(
          "dedupe_key",
          dedupeKey
        )
        .maybeSingle()

    if (existingVoteError) {
      console.error(
        "COMMUNITY IDEA VOTE LOOKUP ERROR:",
        existingVoteError
      )

      return createErrorResponse(
        "community_idea_vote_lookup_failed",
        500
      )
    }

    const votePayload = {
      product_id:
        productId || null,
      idea_key:
        ideaKey || null,
      idea_title:
        ideaTitle,
      subscriber_id:
        subscriberId || null,
      email:
        email || null,
      phone:
        phone || null,
      vote_type:
        voteType,
      source,
      strategic_niche_id:
        strategicNicheId,
      subniche_id:
        subnicheId,
      area_id:
        areaId || null,
      dedupe_key:
        dedupeKey,
      user_agent:
        req.headers.get("user-agent")?.slice(0, 400) ||
        null,
      ip_hash:
        getClientIpHash(req),
    }

    if (existingVote) {
      const { error: updateError } =
        await supabase
          .from("community_idea_votes")
          .update({
            ...votePayload,
            updated_at:
              new Date().toISOString(),
          })
          .eq(
            "id",
            (existingVote as ExistingVote).id
          )

      if (updateError) {
        console.error(
          "COMMUNITY IDEA VOTE UPDATE ERROR:",
          updateError
        )

        return createErrorResponse(
          "community_idea_vote_update_failed",
          500
        )
      }

      return NextResponse.json({
        ok: true,
        created: false,
        updated: true,
        vote_type:
          voteType,
        idea_title:
          ideaTitle,
        dedupe_strategy:
          dedupeStrategy,
      })
    }

    const { data: createdVote, error: insertError } =
      await supabase
        .from("community_idea_votes")
        .insert(votePayload)
        .select("id")
        .single()

    if (insertError) {
      console.error(
        "COMMUNITY IDEA VOTE INSERT ERROR:",
        insertError
      )

      return createErrorResponse(
        "community_idea_vote_insert_failed",
        500
      )
    }

    return NextResponse.json({
      ok: true,
      created: true,
      updated: false,
      vote_id:
        (createdVote as ExistingVote | null)?.id ||
        null,
      vote_type:
        voteType,
      idea_title:
        ideaTitle,
      dedupe_strategy:
        dedupeStrategy,
    })
  } catch (error) {
    console.error(
      "COMMUNITY IDEA VOTE ERROR:",
      error
    )

    return createErrorResponse(
      "community_idea_vote_failed",
      500
    )
  }
}
