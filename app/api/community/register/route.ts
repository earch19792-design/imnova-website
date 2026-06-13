export const runtime = "nodejs"

import { randomUUID } from "crypto"
import { NextResponse } from "next/server"
import {
  createClient,
  type SupabaseClient,
} from "@supabase/supabase-js"

type CommunityRegisterPayload = {
  name?: unknown
  email?: unknown
  whatsapp?: unknown
  country?: unknown
  selectedSubnicheIds?: unknown
  selectedSubnicheNames?: unknown
  objective?: unknown
  source?: unknown
  honeypot?: unknown
}

type PublicSubniche = {
  id: string
  name: string | null
  public_name: string | null
}

type CommunitySubscriberPayload = {
  nombre: string
  telefono: string | null
  email: string | null
  nichos: string[]
  objetivo_principal: string
}

const MAX_SELECTED_SUBNICHES = 25
const MAX_LEGACY_INTEREST_NAMES = 5

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const emailPattern =
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function getSupabaseServerClient() {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL

  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "Supabase no esta configurado para registrar comunidad."
    )
  }

  return createClient(
    supabaseUrl,
    supabaseKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )
}

function getWelcomeWarnings() {
  const warnings: string[] = []

  if (!process.env.WHATSAPP_WELCOME_TEMPLATE_NAME) {
    warnings.push(
      "whatsapp_welcome_not_configured"
    )
  }

  if (
    !process.env.RESEND_API_KEY ||
    !process.env.EMAIL_FROM
  ) {
    warnings.push(
      "email_welcome_not_configured"
    )
  }

  return warnings
}

function getString(
  value: unknown
) {
  return typeof value === "string"
    ? value.trim()
    : ""
}

function getStringArray(
  value: unknown
) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map(getString)
    .filter(Boolean)
}

function getUniqueStringArray(
  value: unknown
) {
  return Array.from(
    new Set(
      getStringArray(value)
    )
  )
}

function normalizeSource(
  value: unknown
) {
  const source =
    getString(value)

  return source ||
    "community_popup"
}

function normalizeEmail(
  value: unknown
) {
  return getString(value).toLowerCase()
}

function normalizeWhatsApp(
  whatsapp: unknown,
  country: unknown
) {
  const phoneDigits =
    getString(whatsapp).replace(/\D/g, "")

  if (!phoneDigits) {
    return ""
  }

  const countryDigits =
    getString(country).replace(/\D/g, "")

  const normalizedDigits =
    countryDigits &&
    !phoneDigits.startsWith(countryDigits) &&
    phoneDigits.length <= 10
      ? `${countryDigits}${phoneDigits}`
      : phoneDigits

  return `+${normalizedDigits}`
}

function isValidWhatsApp(
  value: string
) {
  const digits =
    value.replace(/\D/g, "")

  return digits.length >= 8 &&
    digits.length <= 15
}

function createErrorResponse(
  error: string,
  status = 400
) {
  return NextResponse.json(
    {
      success: false,
      error,
      warnings:
        getWelcomeWarnings(),
    },
    {
      status,
    }
  )
}

async function getValidPublicSubniches(
  selectedSubnicheIds: string[]
) {
  if (selectedSubnicheIds.length === 0) {
    return []
  }

  const supabase =
    getSupabaseServerClient()

  const { data, error } =
    await supabase
      .from("strategic_subniches")
      .select(`
        id,
        name,
        public_name
      `)
      .in(
        "id",
        selectedSubnicheIds
      )
      .eq(
        "is_active",
        true
      )
      .eq(
        "is_public",
        true
      )

  if (error) {
    throw new Error(
      error.message
    )
  }

  return (data || []) as PublicSubniche[]
}

async function getExistingSubscriberId(
  supabase: SupabaseClient,
  email: string,
  whatsapp: string
) {
  if (email) {
    const { data, error } =
      await supabase
        .from("subscribers")
        .select("id")
        .eq(
          "email",
          email
        )
        .maybeSingle()

    if (error) {
      console.warn(
        "COMMUNITY REGISTER EXISTING EMAIL LOOKUP WARNING:",
        error
      )
    }

    if (data?.id) {
      return String(data.id)
    }
  }

  if (whatsapp) {
    const { data, error } =
      await supabase
        .from("subscribers")
        .select("id")
        .eq(
          "telefono",
          whatsapp
        )
        .maybeSingle()

    if (error) {
      console.warn(
        "COMMUNITY REGISTER EXISTING WHATSAPP LOOKUP WARNING:",
        error
      )
    }

    if (data?.id) {
      return String(data.id)
    }
  }

  return null
}

export async function POST(
  req: Request
) {
  let body: CommunityRegisterPayload

  try {
    body =
      await req.json()
  } catch {
    return createErrorResponse(
      "invalid_json"
    )
  }

  const warnings =
    getWelcomeWarnings()

  if (getString(body.honeypot)) {
    return NextResponse.json({
      success: false,
      warnings: [
        ...warnings,
        "spam_detected",
      ],
    })
  }

  const name =
    getString(body.name)

  const email =
    normalizeEmail(body.email)

  const whatsapp =
    normalizeWhatsApp(
      body.whatsapp,
      body.country
    )

  const source =
    normalizeSource(body.source)

  const objective =
    getString(body.objective) ||
    "Registro comunidad IMNOVA"

  const selectedSubnicheIds =
    getUniqueStringArray(
      body.selectedSubnicheIds
    )

  const selectedSubnicheNames =
    getUniqueStringArray(
      body.selectedSubnicheNames
    ).slice(
      0,
      MAX_LEGACY_INTEREST_NAMES
    )

  if (!name) {
    return createErrorResponse(
      "name_required"
    )
  }

  if (!email && !whatsapp) {
    return createErrorResponse(
      "email_or_whatsapp_required"
    )
  }

  if (
    email &&
    !emailPattern.test(email)
  ) {
    return createErrorResponse(
      "invalid_email"
    )
  }

  if (
    whatsapp &&
    !isValidWhatsApp(whatsapp)
  ) {
    return createErrorResponse(
      "invalid_whatsapp"
    )
  }

  if (
    selectedSubnicheIds.length >
    MAX_SELECTED_SUBNICHES
  ) {
    return createErrorResponse(
      "too_many_subniches"
    )
  }

  const invalidUuid =
    selectedSubnicheIds.find(
      subnicheId =>
        !uuidPattern.test(subnicheId)
    )

  if (invalidUuid) {
    return createErrorResponse(
      "invalid_subniches"
    )
  }

  try {
    const supabase =
      getSupabaseServerClient()

    const validPublicSubniches =
      await getValidPublicSubniches(
        selectedSubnicheIds
      )

    const validSubnicheIds =
      new Set(
        validPublicSubniches.map(
          subniche =>
            subniche.id
        )
      )

    const hasInvalidSubniche =
      selectedSubnicheIds.some(
        subnicheId =>
          !validSubnicheIds.has(subnicheId)
      )

    if (hasInvalidSubniche) {
      return createErrorResponse(
        "invalid_subniches"
      )
    }

    const legacyInterestNames =
      selectedSubnicheNames.length > 0
        ? selectedSubnicheNames
        : validPublicSubniches.map(
            subniche =>
              subniche.public_name ||
              subniche.name ||
              ""
          ).filter(Boolean)

    const subscriberPayload: CommunitySubscriberPayload = {
      nombre:
        name,
      telefono:
        whatsapp || null,
      email:
        email || null,
      nichos:
        legacyInterestNames,
      objetivo_principal:
        objective,
    }

    const {
      data: createdSubscriber,
      error: subscriberError,
    } =
      await supabase
        .from("subscribers")
        .insert(subscriberPayload)
        .select("id")
        .single()

    let subscriberId =
      createdSubscriber?.id
        ? String(createdSubscriber.id)
        : ""

    if (subscriberError) {
      console.error(
        "COMMUNITY REGISTER SUBSCRIBER ERROR:",
        subscriberError
      )

      const existingSubscriberId =
        await getExistingSubscriberId(
          supabase,
          email,
          whatsapp
        )

      if (!existingSubscriberId) {
        return createErrorResponse(
          "subscriber_create_failed",
          500
        )
      }

      subscriberId =
        existingSubscriberId

      warnings.push(
        "subscriber_already_registered"
      )

      const { error: subscriberUpdateError } =
        await supabase
          .from("subscribers")
          .update(subscriberPayload)
          .eq(
            "id",
            subscriberId
          )

      if (subscriberUpdateError) {
        console.warn(
          "COMMUNITY REGISTER EXISTING SUBSCRIBER UPDATE WARNING:",
          subscriberUpdateError
        )

        warnings.push(
          "subscriber_update_not_applied"
        )
      }
    }

    if (!subscriberId) {
      return createErrorResponse(
        "subscriber_id_not_returned",
        500
      )
    }

    if (selectedSubnicheIds.length > 0) {
      const interestRows =
        selectedSubnicheIds.map(
          subnicheId => ({
            id:
              randomUUID(),
            subscriber_id:
              subscriberId,
            subniche_id:
              subnicheId,
            source,
          })
        )

      const { error: interestsError } =
        await supabase
          .from("subscriber_interests")
          .upsert(
            interestRows,
            {
              onConflict:
                "subscriber_id,subniche_id",
              ignoreDuplicates:
                true,
            }
          )

      if (interestsError) {
        console.error(
          "COMMUNITY REGISTER INTERESTS ERROR:",
          interestsError
        )

        warnings.push(
          "subscriber_interests_not_saved"
        )
      }
    }

    return NextResponse.json({
      success: true,
      subscriberId,
      warnings,
    })
  } catch (error) {
    console.error(
      "COMMUNITY REGISTER ERROR:",
      error
    )

    return createErrorResponse(
      "community_register_failed",
      500
    )
  }
}
