export const runtime = "nodejs"

import { randomUUID } from "crypto"
import { NextResponse } from "next/server"
import {
  createClient,
  type SupabaseClient,
} from "@supabase/supabase-js"
import {
  sendWhatsAppWelcome,
} from "@/lib/whatsapp"

type CommunityRegisterPayload = {
  name?: unknown
  email?: unknown
  whatsapp?: unknown
  country?: unknown
  selectedSubnicheIds?: unknown
  selectedSubnicheNames?: unknown
  selectedAreaKeys?: unknown
  selectedAreaLabels?: unknown
  whatsappOptIn?: unknown
  emailOptIn?: unknown
  preferredChannel?: unknown
  frequencyPreference?: unknown
  consentText?: unknown
  referralCode?: unknown
  objective?: unknown
  source?: unknown
  honeypot?: unknown
}

type CommunityRegisterSource =
  | "community_popup"
  | "admin_manual"

type PublicSubniche = {
  id: string
  name: string | null
  public_name: string | null
}

type CommunityInterestArea = {
  id: string
  key: string
  label: string
  description: string | null
}

type CommunitySubscriberPayload = {
  nombre: string
  telefono: string | null
  email: string | null
  nichos: string[]
  objetivo_principal: string
}

type CommunicationChannel =
  | "whatsapp"
  | "email"

type CommunicationPreferenceInput = {
  channel: CommunicationChannel
  optedIn: boolean
}

type CommunicationFrequencyPreference =
  | "important_only"
  | "weekly"
  | "twice_monthly"

const MAX_SELECTED_SUBNICHES = 25
const MAX_LEGACY_INTEREST_NAMES = 5
const MAX_SELECTED_AREAS = 3
const DEFAULT_COMMUNITY_CONSENT_TEXT =
  "Acepto recibir avisos de IMNOVA por los canales seleccionados, conectados a mis intereses. Sin spam ni mensajes genericos."
const DEFAULT_COMMUNICATION_FREQUENCY: CommunicationFrequencyPreference =
  "important_only"

const publicInterestAreas = [
  {
    key:
      "bienestar_salud_natural",
    label:
      "Bienestar y Salud Natural",
  },
  {
    key:
      "fitness_rendimiento_recuperacion",
    label:
      "Fitness, Rendimiento y Recuperacion",
  },
  {
    key:
      "salud_funcionalidad_especifica",
    label:
      "Salud y Funcionalidad Especifica",
  },
  {
    key:
      "cuidado_belleza_natural",
    label:
      "Cuidado Personal y Belleza Natural",
  },
  {
    key:
      "bienestar_animal_mascotas",
    label:
      "Bienestar Animal y Cuidado de Mascotas",
  },
]

const publicInterestNameMap =
  new Map(
    publicInterestAreas.map(
      area => [
        normalizePublicInterestName(area.label),
        area.label,
      ]
    )
  )

const publicInterestKeyMap =
  new Map(
    publicInterestAreas.flatMap(
      area => [
        [
          area.key,
          area.key,
        ],
        [
          normalizePublicInterestName(area.label)
            .replace(/\s+/g, "_"),
          area.key,
        ],
      ]
    )
  )

const publicInterestLabelToKeyMap =
  new Map(
    publicInterestAreas.map(
      area => [
        normalizePublicInterestName(area.label),
        area.key,
      ]
    )
  )

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const areaKeyPattern =
  /^[a-z0-9_]+$/

const emailPattern =
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const referralCodePattern =
  /^[A-Z0-9]{6,16}$/

function getSupabaseUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL
}

function getSupabaseServiceRoleKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || ""
}

function getSupabaseAdminClient() {
  const supabaseUrl =
    getSupabaseUrl()

  const supabaseServiceRoleKey =
    getSupabaseServiceRoleKey()

  if (
    !supabaseUrl ||
    !supabaseServiceRoleKey
  ) {
    throw new Error(
      "Supabase service role no esta configurado para registrar comunidad normalizada."
    )
  }

  return createClient(
    supabaseUrl,
    supabaseServiceRoleKey,
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

  if (!isCommunityWelcomeEnabled()) {
    warnings.push(
      "whatsapp_welcome_disabled"
    )
  }

  if (!hasWhatsAppWelcomeConfig()) {
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

function isCommunityWelcomeEnabled() {
  return process.env.COMMUNITY_WELCOME_MESSAGES_ENABLED ===
    "true"
}

function hasWhatsAppWelcomeConfig() {
  return Boolean(
    process.env.WHATSAPP_ACCESS_TOKEN?.trim() &&
    process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() &&
    process.env.WHATSAPP_WELCOME_TEMPLATE_NAME?.trim()
  )
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

function getBoolean(
  value: unknown,
  fallback = false
) {
  if (typeof value === "boolean") {
    return value
  }

  if (typeof value === "number") {
    return value === 1
  }

  const normalizedValue =
    getString(value)
      .toLowerCase()

  if (
    [
      "true",
      "1",
      "yes",
      "si",
      "on",
    ].includes(normalizedValue)
  ) {
    return true
  }

  if (
    [
      "false",
      "0",
      "no",
      "off",
    ].includes(normalizedValue)
  ) {
    return false
  }

  return fallback
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

function normalizePublicInterestName(
  value: string
) {
  return value
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .toLowerCase()
    .trim()
}

function getCanonicalPublicInterestName(
  value: string
) {
  return publicInterestNameMap.get(
    normalizePublicInterestName(value)
  ) || null
}

function getCanonicalPublicInterestAreaKey(
  value: string
) {
  const normalizedValue =
    normalizePublicInterestName(value)
      .replace(/\s+/g, "_")

  return publicInterestKeyMap.get(value) ||
    publicInterestKeyMap.get(normalizedValue) ||
    publicInterestLabelToKeyMap.get(
      normalizePublicInterestName(value)
    ) ||
    null
}

function normalizeSource(
  value: unknown
): CommunityRegisterSource | null {
  const source =
    getString(value)

  if (!source) {
    return "community_popup"
  }

  if (
    source === "community_popup" ||
    source === "admin_manual"
  ) {
    return source
  }

  return null
}

function normalizeEmail(
  value: unknown
) {
  return getString(value).toLowerCase()
}

function normalizeReferralCode(
  value: unknown
) {
  const code =
    getString(value)
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")

  return referralCodePattern.test(code)
    ? code
    : ""
}

function generateReferralCode(
  subscriberId: string,
  name: string
) {
  const namePrefix =
    normalizePublicInterestName(name)
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 4)
      .toUpperCase() || "IMNV"

  const idSuffix =
    subscriberId
      .replace(/-/g, "")
      .slice(0, 6)
      .toUpperCase()

  return `${namePrefix}${idSuffix}`.slice(0, 12)
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

function normalizePreferredChannel(
  value: unknown,
  whatsappOptIn: boolean,
  emailOptIn: boolean
): CommunicationChannel | null {
  const preferredChannel =
    getString(value).toLowerCase()

  if (
    preferredChannel === "whatsapp" &&
    whatsappOptIn
  ) {
    return "whatsapp"
  }

  if (
    preferredChannel === "email" &&
    emailOptIn
  ) {
    return "email"
  }

  if (whatsappOptIn) {
    return "whatsapp"
  }

  if (emailOptIn) {
    return "email"
  }

  return null
}

function normalizeFrequencyPreference(
  value: unknown
): CommunicationFrequencyPreference {
  const frequency =
    getString(value)
      .toLowerCase()
      .replace(/\s+/g, "_")

  if (
    frequency === "weekly" ||
    frequency === "twice_monthly" ||
    frequency === "important_only"
  ) {
    return frequency
  }

  return DEFAULT_COMMUNICATION_FREQUENCY
}

function createErrorResponse(
  error: string,
  status = 400,
  warnings = getWelcomeWarnings()
) {
  return NextResponse.json(
    {
      success: false,
      error,
      warnings,
    },
    {
      status,
    }
  )
}

function createCommunityBackendConfigErrorResponse(
  warnings: string[]
) {
  const code =
    getSupabaseUrl()
      ? "missing_service_role_key"
      : "missing_supabase_url"

  return NextResponse.json(
    {
      success: false,
      error:
        "community_backend_not_configured",
      code,
      message:
        "No se puede guardar la comunidad normalizada sin SUPABASE_SERVICE_ROLE_KEY configurada en el backend.",
      warnings,
    },
    {
      status: 500,
    }
  )
}

async function getValidPublicSubniches(
  supabase: SupabaseClient,
  selectedSubnicheIds: string[]
) {
  if (selectedSubnicheIds.length === 0) {
    return []
  }

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

async function getValidCommunityInterestAreas(
  supabase: SupabaseClient,
  selectedAreaKeys: string[]
) {
  if (selectedAreaKeys.length === 0) {
    return []
  }

  const { data, error } =
    await supabase
      .from("community_interest_areas")
      .select(`
        id,
        key,
        label,
        description
      `)
      .in(
        "key",
        selectedAreaKeys
      )
      .eq(
        "is_active",
        true
      )

  if (error) {
    throw new Error(
      error.message
    )
  }

  return (data || []) as CommunityInterestArea[]
}

function getBearerToken(
  req: Request
) {
  const authorization =
    req.headers.get("authorization") ||
    ""

  const [
    scheme,
    token,
  ] =
    authorization.split(" ")

  if (
    scheme?.toLowerCase() !== "bearer" ||
    !token
  ) {
    return ""
  }

  return token.trim()
}

function getSupabaseAuthenticatedClient(
  token: string
) {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL

  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Supabase Auth no esta configurado para validar Admin."
    )
  }

  return createClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      global: {
        headers: {
          Authorization:
            `Bearer ${token}`,
        },
      },
    }
  )
}

async function validateAdminRegisterRequest(
  req: Request
) {
  const token =
    getBearerToken(req)

  if (!token) {
    return {
      ok: false,
      status: 401,
      error:
        "admin_token_required",
    }
  }

  const authenticatedSupabase =
    getSupabaseAuthenticatedClient(
      token
    )

  const {
    data: userData,
    error: userError,
  } =
    await authenticatedSupabase.auth.getUser(
      token
    )

  if (
    userError ||
    !userData.user
  ) {
    return {
      ok: false,
      status: 401,
      error:
        "admin_unauthorized",
    }
  }

  const {
    data: isAdmin,
    error: adminError,
  } =
    await authenticatedSupabase.rpc(
      "is_admin"
    )

  if (
    adminError ||
    isAdmin !== true
  ) {
    return {
      ok: false,
      status: 403,
      error:
        "admin_forbidden",
    }
  }

  return {
    ok: true,
    status: 200,
    error: null,
  }
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

async function createMissingSubscriberInterests(
  supabase: SupabaseClient,
  subscriberId: string,
  selectedSubnicheIds: string[],
  source: CommunityRegisterSource
) {
  if (selectedSubnicheIds.length === 0) {
    return {
      saved: true,
      addedCount: 0,
      error: null,
    }
  }

  const {
    data: existingInterests,
    error: existingInterestsError,
  } =
    await supabase
      .from("subscriber_interests")
      .select("subniche_id")
      .eq(
        "subscriber_id",
        subscriberId
      )
      .in(
        "subniche_id",
        selectedSubnicheIds
      )

  if (existingInterestsError) {
    return {
      saved: false,
      addedCount: 0,
      error:
        existingInterestsError,
    }
  }

  const existingSubnicheIds =
    new Set(
      (existingInterests || [])
        .map(
          interest =>
            String(interest.subniche_id)
        )
    )

  const missingSubnicheIds =
    selectedSubnicheIds.filter(
      subnicheId =>
        !existingSubnicheIds.has(
          subnicheId
        )
    )

  if (missingSubnicheIds.length === 0) {
    return {
      saved: true,
      addedCount: 0,
      error: null,
    }
  }

  const interestRows =
    missingSubnicheIds.map(
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
      .insert(interestRows)

  if (interestsError) {
    return {
      saved: false,
      addedCount: 0,
      error:
        interestsError,
    }
  }

  return {
    saved: true,
    addedCount:
      missingSubnicheIds.length,
    error: null,
  }
}

async function createMissingSubscriberAreaInterests(
  supabase: SupabaseClient,
  subscriberId: string,
  selectedAreas: CommunityInterestArea[],
  source: CommunityRegisterSource
) {
  if (selectedAreas.length === 0) {
    return {
      saved: true,
      addedCount: 0,
      error: null,
    }
  }

  const selectedAreaIds =
    selectedAreas.map(
      area =>
        area.id
    )

  const {
    data: existingAreaInterests,
    error: existingAreaInterestsError,
  } =
    await supabase
      .from("subscriber_area_interests")
      .select("area_id")
      .eq(
        "subscriber_id",
        subscriberId
      )
      .in(
        "area_id",
        selectedAreaIds
      )

  if (existingAreaInterestsError) {
    return {
      saved: false,
      addedCount: 0,
      error:
        existingAreaInterestsError,
    }
  }

  const existingAreaIds =
    new Set(
      (existingAreaInterests || [])
        .map(
          interest =>
            String(interest.area_id)
        )
    )

  const missingAreas =
    selectedAreas.filter(
      area =>
        !existingAreaIds.has(area.id)
    )

  if (missingAreas.length === 0) {
    return {
      saved: true,
      addedCount: 0,
      error: null,
    }
  }

  const areaInterestRows =
    missingAreas.map(
      area => ({
        id:
          randomUUID(),
        subscriber_id:
          subscriberId,
        area_id:
          area.id,
        source,
      })
    )

  const { error: areaInterestsError } =
    await supabase
      .from("subscriber_area_interests")
      .insert(areaInterestRows)

  if (areaInterestsError) {
    return {
      saved: false,
      addedCount: 0,
      error:
        areaInterestsError,
    }
  }

  return {
    saved: true,
    addedCount:
      missingAreas.length,
    error: null,
  }
}

async function upsertCommunicationPreferences(
  supabase: SupabaseClient,
  subscriberId: string,
  preferences: CommunicationPreferenceInput[],
  source: CommunityRegisterSource,
  consentText: string,
  frequencyPreference: CommunicationFrequencyPreference
) {
  if (preferences.length === 0) {
    return {
      saved: true,
      count: 0,
      error: null,
    }
  }

  const now =
    new Date().toISOString()

  const preferenceRows =
    preferences.map(
      preference => ({
        subscriber_id:
          subscriberId,
        channel:
          preference.channel,
        opted_in:
          preference.optedIn,
        opted_in_at:
          preference.optedIn
            ? now
            : null,
        opted_out_at:
          preference.optedIn
            ? null
            : now,
        source,
        consent_text:
          consentText,
        frequency_preference:
          frequencyPreference,
        updated_at:
          now,
      })
    )

  const { error } =
    await supabase
      .from("communication_preferences")
      .upsert(
        preferenceRows,
        {
          onConflict:
            "subscriber_id,channel",
        }
      )

  if (error) {
    const errorMessage =
      [
        error.message,
        error.details,
        error.hint,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()

    if (
      errorMessage.includes(
        "frequency_preference"
      )
    ) {
      const fallbackRows =
        preferenceRows.map(
          ({
            frequency_preference,
            ...preferenceRow
          }) => preferenceRow
        )

      const { error: fallbackError } =
        await supabase
          .from("communication_preferences")
          .upsert(
            fallbackRows,
            {
              onConflict:
                "subscriber_id,channel",
            }
          )

      return {
        saved:
          !fallbackError,
        count:
          fallbackError
            ? 0
            : fallbackRows.length,
        error:
          fallbackError || error,
      }
    }

    return {
      saved: false,
      count: 0,
      error,
    }
  }

  return {
    saved: true,
    count:
      preferenceRows.length,
    error: null,
  }
}

async function ensureCommunityReferralCode(
  supabase: SupabaseClient,
  subscriberId: string,
  name: string
) {
  const code =
    generateReferralCode(
      subscriberId,
      name
    )

  const { data, error } =
    await supabase
      .from("community_referral_codes")
      .upsert(
        {
          subscriber_id:
            subscriberId,
          code,
          is_active:
            true,
          updated_at:
            new Date().toISOString(),
        },
        {
          onConflict:
            "subscriber_id",
        }
      )
      .select("code")
      .single()

  if (error) {
    return {
      code: "",
      error,
    }
  }

  return {
    code:
      String(data?.code || code),
    error: null,
  }
}

async function awardCommunityPoints(
  supabase: SupabaseClient,
  subscriberId: string,
  eventType: string,
  points: number,
  source: string,
  description: string,
  idempotencyKey: string
) {
  const { error } =
    await supabase
      .from("community_points_ledger")
      .upsert(
        {
          subscriber_id:
            subscriberId,
          event_type:
            eventType,
          points,
          source,
          description,
          idempotency_key:
            idempotencyKey,
        },
        {
          onConflict:
            "idempotency_key",
          ignoreDuplicates:
            true,
        }
      )

  if (error) {
    return {
      awarded: false,
      error,
    }
  }

  const { data: pointRows } =
    await supabase
      .from("community_points_ledger")
      .select("points")
      .eq(
        "subscriber_id",
        subscriberId
      )

  const pointsTotal =
    (pointRows || []).reduce(
      (total, row) =>
        total + Number(row.points || 0),
      0
    )

  const { data: levels } =
    await supabase
      .from("community_levels")
      .select("key,min_points")
      .eq(
        "is_active",
        true
      )
      .order(
        "min_points",
        {
          ascending: false,
        }
      )

  const levelKey =
    levels?.find(
      level =>
        pointsTotal >=
        Number(level.min_points || 0)
    )?.key || "miembro"

  const { data: referralCode } =
    await supabase
      .from("community_referral_codes")
      .select("code")
      .eq(
        "subscriber_id",
        subscriberId
      )
      .maybeSingle()

  const { error: statusError } =
    await supabase
      .from("community_member_status")
      .upsert(
        {
          subscriber_id:
            subscriberId,
          points_total:
            pointsTotal,
          level_key:
            levelKey,
          is_vip:
            levelKey === "vip",
          referral_code:
            referralCode?.code || null,
          last_activity_at:
            new Date().toISOString(),
          updated_at:
            new Date().toISOString(),
        },
        {
          onConflict:
            "subscriber_id",
        }
      )

  return {
    awarded: !statusError,
    error:
      statusError || null,
  }
}

async function createCommunityReferralIfNeeded(
  supabase: SupabaseClient,
  referralCode: string,
  referredSubscriberId: string,
  source: CommunityRegisterSource
) {
  if (!referralCode) {
    return {
      saved: false,
      skipped: true,
      error: null,
    }
  }

  const {
    data: referralCodeRow,
    error: codeLookupError,
  } =
    await supabase
      .from("community_referral_codes")
      .select("subscriber_id, code")
      .eq(
        "code",
        referralCode
      )
      .eq(
        "is_active",
        true
      )
      .maybeSingle()

  if (codeLookupError) {
    return {
      saved: false,
      skipped: false,
      error:
        codeLookupError,
    }
  }

  const referrerSubscriberId =
    referralCodeRow?.subscriber_id
      ? String(referralCodeRow.subscriber_id)
      : ""

  if (
    !referrerSubscriberId ||
    referrerSubscriberId === referredSubscriberId
  ) {
    return {
      saved: false,
      skipped: true,
      error: null,
    }
  }

  const { error: referralError } =
    await supabase
      .from("community_referrals")
      .upsert(
        {
          referrer_subscriber_id:
            referrerSubscriberId,
          referred_subscriber_id:
            referredSubscriberId,
          referral_code:
            referralCode,
          source,
          status:
            "registered",
        },
        {
          onConflict:
            "referrer_subscriber_id,referred_subscriber_id",
          ignoreDuplicates:
            true,
        }
      )

  if (referralError) {
    return {
      saved: false,
      skipped: false,
      error:
        referralError,
    }
  }

  await awardCommunityPoints(
    supabase,
    referrerSubscriberId,
    "referral",
    25,
    source,
    "Referido registrado en comunidad IMNOVA",
    `referral:${referrerSubscriberId}:${referredSubscriberId}`
  )

  return {
    saved: true,
    skipped: false,
    error: null,
  }
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

  const source =
    normalizeSource(body.source)

  if (!source) {
    return createErrorResponse(
      "invalid_source"
    )
  }

  const warnings =
    source === "community_popup"
      ? getWelcomeWarnings()
      : []

  if (
    source === "community_popup" &&
    getString(body.honeypot)
  ) {
    return NextResponse.json({
      success: false,
      warnings: [
        ...warnings,
        "spam_detected",
      ],
    })
  }

  if (source === "admin_manual") {
    const adminValidation =
      await validateAdminRegisterRequest(
        req
      )

    if (!adminValidation.ok) {
      return createErrorResponse(
        adminValidation.error ||
          "admin_validation_failed",
        adminValidation.status || 403,
        warnings,
      )
    }
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

  const whatsappOptIn =
    Boolean(whatsapp) &&
    getBoolean(
      body.whatsappOptIn,
      false
    )

  const emailOptIn =
    Boolean(email) &&
    getBoolean(
      body.emailOptIn,
      false
    )

  const preferredChannel =
    normalizePreferredChannel(
      body.preferredChannel,
      whatsappOptIn,
      emailOptIn
    )

  const consentText =
    getString(body.consentText) ||
    DEFAULT_COMMUNITY_CONSENT_TEXT

  const frequencyPreference =
    normalizeFrequencyPreference(
      body.frequencyPreference
    )

  const objective =
    getString(body.objective) ||
    "Registro comunidad IMNOVA"

  const referralCode =
    normalizeReferralCode(
      body.referralCode
    )

  const rawSelectedSubnicheIds =
    getUniqueStringArray(
      body.selectedSubnicheIds
    )

  const rawSelectedSubnicheNames =
    getUniqueStringArray(
      body.selectedSubnicheNames
    )

  const rawSelectedAreaKeys =
    getUniqueStringArray(
      body.selectedAreaKeys
    )

  const rawSelectedAreaLabels =
    getUniqueStringArray(
      body.selectedAreaLabels
    )

  const canonicalAreaKeys =
    Array.from(
      new Set(
        [
          ...rawSelectedAreaKeys,
          ...rawSelectedAreaLabels,
          ...(
            source === "community_popup"
              ? rawSelectedSubnicheNames
              : []
          ),
        ]
          .map(getCanonicalPublicInterestAreaKey)
          .filter(
            (
              areaKey
            ): areaKey is string =>
              Boolean(areaKey)
          )
      )
    )

  const selectedAreaKeys =
    canonicalAreaKeys

  const selectedSubnicheIds =
    source === "community_popup" &&
    selectedAreaKeys.length > 0
      ? []
      : rawSelectedSubnicheIds

  const selectedSubnicheNames =
    (
      source === "admin_manual"
        ? rawSelectedSubnicheNames
        : rawSelectedSubnicheNames
            .map(getCanonicalPublicInterestName)
            .filter(
              (
                name
              ): name is string =>
                Boolean(name)
            )
    ).slice(
      0,
      MAX_LEGACY_INTEREST_NAMES
    )

  if (!name) {
    return createErrorResponse(
      "name_required",
      400,
      warnings
    )
  }

  if (!email && !whatsapp) {
    return createErrorResponse(
      "email_or_whatsapp_required",
      400,
      warnings
    )
  }

  if (
    email &&
    !emailPattern.test(email)
  ) {
    return createErrorResponse(
      "invalid_email",
      400,
      warnings
    )
  }

  if (
    whatsapp &&
    !isValidWhatsApp(whatsapp)
  ) {
    return createErrorResponse(
      "invalid_whatsapp",
      400,
      warnings
    )
  }

  if (
    selectedSubnicheIds.length >
    MAX_SELECTED_SUBNICHES
  ) {
    return createErrorResponse(
      "too_many_subniches",
      400,
      warnings
    )
  }

  const invalidUuid =
    selectedSubnicheIds.find(
      subnicheId =>
        !uuidPattern.test(subnicheId)
    )

  if (invalidUuid) {
    return createErrorResponse(
      "invalid_subniches",
      400,
      warnings
    )
  }

  if (
    selectedAreaKeys.length >
    MAX_SELECTED_AREAS
  ) {
    return createErrorResponse(
      "too_many_area_interests",
      400,
      warnings
    )
  }

  const invalidAreaKey =
    selectedAreaKeys.find(
      areaKey =>
        !areaKeyPattern.test(areaKey)
    )

  if (invalidAreaKey) {
    return createErrorResponse(
      "invalid_area_interests",
      400,
      warnings
    )
  }

  const communicationPreferences: CommunicationPreferenceInput[] =
    [
      ...(whatsapp
        ? [
            {
              channel:
                "whatsapp" as const,
              optedIn:
                whatsappOptIn,
            },
          ]
        : []),
      ...(email
        ? [
            {
              channel:
                "email" as const,
              optedIn:
                emailOptIn,
            },
          ]
        : []),
    ]

  if (
    !getSupabaseUrl() ||
    !getSupabaseServiceRoleKey()
  ) {
    return createCommunityBackendConfigErrorResponse(
      warnings
    )
  }

  try {
    const supabase =
      getSupabaseAdminClient()

    const validCommunityAreas =
      await getValidCommunityInterestAreas(
        supabase,
        selectedAreaKeys
      )

    const validAreaKeys =
      new Set(
        validCommunityAreas.map(
          area =>
            area.key
        )
      )

    const hasInvalidArea =
      selectedAreaKeys.some(
        areaKey =>
          !validAreaKeys.has(areaKey)
      )

    if (hasInvalidArea) {
      return createErrorResponse(
        "invalid_area_interests",
        400,
        warnings
      )
    }

    const validPublicSubniches =
      await getValidPublicSubniches(
        supabase,
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
        "invalid_subniches",
        400,
        warnings
      )
    }

    const legacyInterestNames =
      validCommunityAreas.length > 0
        ? validCommunityAreas.map(
            area =>
              area.label
          )
        : selectedSubnicheNames.length > 0
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

    let subscriberAlreadyRegistered =
      false

    let interestsSaved =
      selectedSubnicheIds.length === 0

    let interestsAddedCount =
      0

    let areaInterestsSaved =
      selectedAreaKeys.length === 0

    let areaInterestsAddedCount =
      0

    let communityReferralCode:
      string | null =
        null

    let communityReferralCodeSaved =
      false

    let communityReferralSaved =
      false

    let communityJoinPointsAwarded =
      false

    let whatsappWelcomeSent =
      false

    let whatsappWelcomeMessageId:
      string | null =
      null

    let whatsappWelcomeStatus:
      string | null =
      null

    let whatsappWelcomeTo:
      string | null =
      null

    let subscriberId =
      await getExistingSubscriberId(
        supabase,
        email,
        whatsapp
      ) || ""

    if (subscriberId) {
      subscriberAlreadyRegistered =
        true

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
    } else {
      const {
        data: createdSubscriber,
        error: subscriberError,
      } =
        await supabase
          .from("subscribers")
          .insert(subscriberPayload)
          .select("id")
          .single()

      subscriberId =
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
            500,
            warnings
          )
        }

        subscriberId =
          existingSubscriberId

        subscriberAlreadyRegistered =
          true

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
            "COMMUNITY REGISTER DUPLICATE SUBSCRIBER UPDATE WARNING:",
            subscriberUpdateError
          )

          warnings.push(
            "subscriber_update_not_applied"
          )
        }
      }
    }

    if (!subscriberId) {
      return createErrorResponse(
        "subscriber_id_not_returned",
        500,
        warnings
      )
    }

    if (selectedSubnicheIds.length > 0) {
      const interestSaveResult =
        await createMissingSubscriberInterests(
          supabase,
          subscriberId,
          selectedSubnicheIds,
          source
        )

      interestsSaved =
        interestSaveResult.saved

      interestsAddedCount =
        interestSaveResult.addedCount

      if (interestSaveResult.error) {
        console.error(
          "COMMUNITY REGISTER INTERESTS ERROR:",
          interestSaveResult.error
        )

        warnings.push(
          "subscriber_interests_not_saved"
        )
      }
    }

    if (validCommunityAreas.length > 0) {
      const areaInterestSaveResult =
        await createMissingSubscriberAreaInterests(
          supabase,
          subscriberId,
          validCommunityAreas,
          source
        )

      areaInterestsSaved =
        areaInterestSaveResult.saved

      areaInterestsAddedCount =
        areaInterestSaveResult.addedCount

      if (areaInterestSaveResult.error) {
        console.error(
          "COMMUNITY REGISTER AREA INTERESTS ERROR:",
          areaInterestSaveResult.error
        )

        warnings.push(
          "subscriber_area_interests_not_saved"
        )
      }
    }

    const preferenceSaveResult =
      await upsertCommunicationPreferences(
        supabase,
        subscriberId,
        communicationPreferences,
        source,
        consentText,
        frequencyPreference
      )

    if (!preferenceSaveResult.saved) {
      console.warn(
        "COMMUNITY REGISTER COMMUNICATION PREFERENCES WARNING:",
        preferenceSaveResult.error
      )

      warnings.push(
        "communication_preferences_not_saved"
      )
    }

    try {
      const referralCodeResult =
        await ensureCommunityReferralCode(
          supabase,
          subscriberId,
          name
        )

      if (referralCodeResult.error) {
        console.warn(
          "COMMUNITY REGISTER REFERRAL CODE WARNING:",
          referralCodeResult.error
        )

        warnings.push(
          "community_referral_code_not_saved"
        )
      } else {
        communityReferralCode =
          referralCodeResult.code

        communityReferralCodeSaved =
          true
      }

      const pointsResult =
        await awardCommunityPoints(
          supabase,
          subscriberId,
          "join",
          10,
          source,
          "Registro en comunidad IMNOVA",
          `join:${subscriberId}`
        )

      if (pointsResult.error) {
        console.warn(
          "COMMUNITY REGISTER POINTS WARNING:",
          pointsResult.error
        )

        warnings.push(
          "community_points_not_saved"
        )
      } else {
        communityJoinPointsAwarded =
          pointsResult.awarded
      }

      const referralResult =
        await createCommunityReferralIfNeeded(
          supabase,
          referralCode,
          subscriberId,
          source
        )

      if (referralResult.error) {
        console.warn(
          "COMMUNITY REGISTER REFERRAL WARNING:",
          referralResult.error
        )

        warnings.push(
          "community_referral_not_saved"
        )
      } else {
        communityReferralSaved =
          referralResult.saved
      }
    } catch (growthError) {
      console.warn(
        "COMMUNITY REGISTER GROWTH WARNING:",
        growthError
      )

      warnings.push(
        "community_growth_not_saved"
      )
    }

    if (
      source === "community_popup" &&
      whatsapp
    ) {
      if (!whatsappOptIn) {
        warnings.push(
          "whatsapp_consent_not_granted"
        )
      } else if (
        isCommunityWelcomeEnabled() &&
        hasWhatsAppWelcomeConfig()
      ) {
        const welcomeResult =
          await sendWhatsAppWelcome({
            phone:
              whatsapp,
            name,
          })

        if (!welcomeResult.success) {
          console.error(
            "COMMUNITY REGISTER WHATSAPP WELCOME ERROR:",
            welcomeResult
          )

          warnings.push(
            "whatsapp_welcome_failed"
          )
        } else {
          whatsappWelcomeSent =
            true

          whatsappWelcomeMessageId =
            welcomeResult.messageId ||
            null

          whatsappWelcomeStatus =
            welcomeResult.messageStatus ||
            welcomeResult.data?.messages?.[0]?.message_status ||
            null

          whatsappWelcomeTo =
            welcomeResult.waId ||
            welcomeResult.phone ||
            null

          console.info(
            "COMMUNITY REGISTER WHATSAPP WELCOME SENT:",
            {
              subscriberId,
              whatsappWelcomeTo,
              whatsappWelcomeMessageId,
              whatsappWelcomeStatus,
            }
          )
        }
      } else if (!isCommunityWelcomeEnabled()) {
        if (
          !warnings.includes(
            "whatsapp_welcome_disabled"
          )
        ) {
          warnings.push(
            "whatsapp_welcome_disabled"
          )
        }
      } else if (
        !warnings.includes(
          "whatsapp_welcome_not_configured"
        )
      ) {
        warnings.push(
          "whatsapp_welcome_not_configured"
        )
      }
    }

    return NextResponse.json({
      success: true,
      subscriberId,
      subscriber_already_registered:
        subscriberAlreadyRegistered,
      interests_saved:
        interestsSaved,
      interests_added_count:
        interestsAddedCount,
      area_interests_saved:
        areaInterestsSaved,
      area_interests_added_count:
        areaInterestsAddedCount,
      communication_preferences_saved:
        preferenceSaveResult.saved,
      communication_preferences_count:
        preferenceSaveResult.count,
      preferred_channel:
        preferredChannel,
      frequency_preference:
        frequencyPreference,
      whatsapp_welcome_sent:
        whatsappWelcomeSent,
      whatsapp_welcome_message_id:
        whatsappWelcomeMessageId,
      whatsapp_welcome_status:
        whatsappWelcomeStatus,
      whatsapp_welcome_to:
        whatsappWelcomeTo,
      community_referral_code:
        communityReferralCode,
      community_referral_code_saved:
        communityReferralCodeSaved,
      community_referral_saved:
        communityReferralSaved,
      community_join_points_awarded:
        communityJoinPointsAwarded,
      warnings,
    })
  } catch (error) {
    console.error(
      "COMMUNITY REGISTER ERROR:",
      error
    )

    return createErrorResponse(
      "community_register_failed",
      500,
      warnings
    )
  }
}
