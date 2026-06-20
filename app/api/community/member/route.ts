export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

type MemberProfilePayload = {
  subscriberId?: unknown
  subscriber_id?: unknown
  referralCode?: unknown
  referral_code?: unknown
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const referralCodePattern =
  /^[A-Z0-9]{6,16}$/

function getString(value: unknown) {
  return typeof value === "string"
    ? value.trim()
    : ""
}

function normalizeReferralCode(value: unknown) {
  return getString(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
}

function getSupabaseAdminClient() {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL

  const supabaseServiceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error(
      "member_backend_not_configured"
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

function createErrorResponse(
  error: string,
  status = 400
) {
  return NextResponse.json(
    {
      success: false,
      error,
    },
    {
      status,
    }
  )
}

function sortByCreatedAtDesc<T extends { created_at?: string | null }>(
  rows: T[]
) {
  return [...rows].sort(
    (a, b) =>
      new Date(b.created_at || 0).getTime() -
      new Date(a.created_at || 0).getTime()
  )
}

export async function POST(req: Request) {
  let body: MemberProfilePayload

  try {
    body =
      await req.json()
  } catch {
    return createErrorResponse(
      "invalid_json"
    )
  }

  const subscriberId =
    getString(
      body.subscriberId ||
      body.subscriber_id
    )

  const referralCode =
    normalizeReferralCode(
      body.referralCode ||
      body.referral_code
    )

  if (
    !subscriberId ||
    !uuidPattern.test(subscriberId) ||
    !referralCode ||
    !referralCodePattern.test(referralCode)
  ) {
    return createErrorResponse(
      "member_identity_required",
      401
    )
  }

  try {
    const supabase =
      getSupabaseAdminClient()

    const {
      data: referralCodeRow,
      error: referralCodeError,
    } =
      await supabase
        .from("community_referral_codes")
        .select("subscriber_id, code, is_active")
        .eq(
          "subscriber_id",
          subscriberId
        )
        .eq(
          "code",
          referralCode
        )
        .maybeSingle()

    if (referralCodeError) {
      console.error(
        "COMMUNITY MEMBER REFERRAL LOOKUP ERROR:",
        referralCodeError
      )

      return createErrorResponse(
        "member_referral_lookup_failed",
        500
      )
    }

    if (
      !referralCodeRow ||
      referralCodeRow.is_active === false
    ) {
      return createErrorResponse(
        "member_not_found",
        404
      )
    }

    const [
      subscriberResult,
      statusResult,
      levelResult,
      areaInterestsResult,
      specificInterestsResult,
      votesResult,
      pointsResult,
      referralsResult,
      rewardsResult,
    ] =
      await Promise.all([
        supabase
          .from("subscribers")
          .select("id,nombre,nichos,created_at")
          .eq(
            "id",
            subscriberId
          )
          .maybeSingle(),
        supabase
          .from("community_member_status")
          .select("points_total,level_key,is_vip,referral_code,last_activity_at,updated_at")
          .eq(
            "subscriber_id",
            subscriberId
          )
          .maybeSingle(),
        supabase
          .from("community_levels")
          .select("key,label,description,benefits,min_points,display_order")
          .eq(
            "is_active",
            true
          )
          .order(
            "display_order",
            {
              ascending: true,
            }
          ),
        supabase
          .from("subscriber_area_interests")
          .select("id,area_id,source,created_at")
          .eq(
            "subscriber_id",
            subscriberId
          )
          .order(
            "created_at",
            {
              ascending: false,
            }
          ),
        supabase
          .from("subscriber_interests")
          .select("id,subniche_id,source,created_at")
          .eq(
            "subscriber_id",
            subscriberId
          )
          .order(
            "created_at",
            {
              ascending: false,
            }
          ),
        supabase
          .from("community_idea_votes")
          .select("id,product_id,idea_key,idea_title,vote_type,source,created_at,updated_at")
          .eq(
            "subscriber_id",
            subscriberId
          )
          .order(
            "updated_at",
            {
              ascending: false,
            }
          )
          .limit(20),
        supabase
          .from("community_points_ledger")
          .select("id,event_type,points,source,description,created_at")
          .eq(
            "subscriber_id",
            subscriberId
          )
          .order(
            "created_at",
            {
              ascending: false,
            }
          )
          .limit(12),
        supabase
          .from("community_referrals")
          .select("id", {
            count: "exact",
            head: true,
          })
          .eq(
            "referrer_subscriber_id",
            subscriberId
          ),
        supabase
          .from("community_vip_rewards")
          .select("id,title,description,points_cost,required_level_key,discount_type,discount_value,ends_at,is_active")
          .eq(
            "is_active",
            true
          )
          .order(
            "points_cost",
            {
              ascending: true,
            }
          )
          .limit(6),
      ])

    if (subscriberResult.error) {
      console.error(
        "COMMUNITY MEMBER SUBSCRIBER LOOKUP ERROR:",
        subscriberResult.error
      )

      return createErrorResponse(
        "member_subscriber_lookup_failed",
        500
      )
    }

    if (!subscriberResult.data) {
      return createErrorResponse(
        "member_not_found",
        404
      )
    }

    const levels =
      levelResult.error
        ? []
        : levelResult.data || []

    const status =
      statusResult.error
        ? null
        : statusResult.data

    const levelKey =
      String(
        status?.level_key ||
        "miembro"
      )

    const currentLevel =
      levels.find(
        (level: any) =>
          String(level.key) === levelKey
      ) || null

    const areaInterestRows =
      areaInterestsResult.error
        ? []
        : areaInterestsResult.data || []

    const areaIds =
      Array.from(
        new Set(
          areaInterestRows
            .map((row: any) =>
              row.area_id
                ? String(row.area_id)
                : ""
            )
            .filter(Boolean)
        )
      )

    const areasById =
      new Map<string, any>()

    if (areaIds.length > 0) {
      const { data: areasData, error: areasError } =
        await supabase
          .from("community_interest_areas")
          .select("id,key,label,description,display_order")
          .in(
            "id",
            areaIds
          )

      if (areasError) {
        console.warn(
          "COMMUNITY MEMBER AREAS LOOKUP WARNING:",
          areasError
        )
      }

      ;(areasData || []).forEach((area: any) => {
        areasById.set(
          String(area.id),
          area
        )
      })
    }

    const specificInterestRows =
      specificInterestsResult.error
        ? []
        : specificInterestsResult.data || []

    const subnicheIds =
      Array.from(
        new Set(
          specificInterestRows
            .map((row: any) =>
              row.subniche_id
                ? String(row.subniche_id)
                : ""
            )
            .filter(Boolean)
        )
      )

    const subnichesById =
      new Map<string, any>()

    const nichesById =
      new Map<string, any>()

    if (subnicheIds.length > 0) {
      const { data: subnichesData, error: subnichesError } =
        await supabase
          .from("strategic_subniches")
          .select("id,niche_id,name,public_name")
          .in(
            "id",
            subnicheIds
          )

      if (subnichesError) {
        console.warn(
          "COMMUNITY MEMBER SUBNICHES LOOKUP WARNING:",
          subnichesError
        )
      }

      ;(subnichesData || []).forEach((subniche: any) => {
        subnichesById.set(
          String(subniche.id),
          subniche
        )
      })

      const nicheIds =
        Array.from(
          new Set(
            (subnichesData || [])
              .map((subniche: any) =>
                subniche.niche_id
                  ? String(subniche.niche_id)
                  : ""
              )
              .filter(Boolean)
          )
        )

      if (nicheIds.length > 0) {
        const { data: nichesData, error: nichesError } =
          await supabase
            .from("strategic_niches")
            .select("id,name,public_name")
            .in(
              "id",
              nicheIds
            )

        if (nichesError) {
          console.warn(
            "COMMUNITY MEMBER NICHES LOOKUP WARNING:",
            nichesError
          )
        }

        ;(nichesData || []).forEach((niche: any) => {
          nichesById.set(
            String(niche.id),
            niche
          )
        })
      }
    }

    const joinedAt =
      (subscriberResult.data as any).created_at ||
      null

    const memberProfile = {
      id:
        subscriberId,
      name:
        (subscriberResult.data as any).nombre ||
        "Miembro IMNOVA",
      joined_at:
        joinedAt,
      level: {
        key:
          levelKey,
        label:
          currentLevel?.label ||
          "Miembro",
        description:
          currentLevel?.description ||
          null,
        benefits:
          currentLevel?.benefits ||
          [],
      },
      points_total:
        Number(
          status?.points_total || 0
        ),
      is_vip:
        Boolean(status?.is_vip),
      last_activity_at:
        status?.last_activity_at ||
        status?.updated_at ||
        null,
      referral: {
        code:
          referralCode,
        total_referrals:
          referralsResult.count || 0,
      },
      interests: {
        areas:
          sortByCreatedAtDesc(
            areaInterestRows.map((row: any) => {
              const area =
                areasById.get(
                  String(row.area_id)
                )

              return {
                id:
                  String(row.area_id),
                key:
                  area?.key || null,
                label:
                  area?.label ||
                  "Area IMNOVA",
                description:
                  area?.description ||
                  null,
                source:
                  row.source || null,
                created_at:
                  row.created_at || null,
              }
            })
          ),
        specific:
          sortByCreatedAtDesc(
            specificInterestRows.map((row: any) => {
              const subniche =
                subnichesById.get(
                  String(row.subniche_id)
                )

              const niche =
                subniche?.niche_id
                  ? nichesById.get(
                      String(subniche.niche_id)
                    )
                  : null

              return {
                id:
                  String(row.subniche_id),
                label:
                  subniche?.public_name ||
                  subniche?.name ||
                  "Interes especifico",
                niche_label:
                  niche?.public_name ||
                  niche?.name ||
                  null,
                source:
                  row.source || null,
                created_at:
                  row.created_at || null,
              }
            })
          ),
        legacy:
          Array.isArray(
            (subscriberResult.data as any).nichos
          )
            ? (subscriberResult.data as any).nichos
            : [],
      },
      votes:
        votesResult.error
          ? []
          : votesResult.data || [],
      points_ledger:
        pointsResult.error
          ? []
          : pointsResult.data || [],
      rewards:
        rewardsResult.error
          ? []
          : rewardsResult.data || [],
      warnings:
        [
          ...(statusResult.error
            ? [
                "member_status_not_available",
              ]
            : []),
          ...(areaInterestsResult.error
            ? [
                "area_interests_not_available",
              ]
            : []),
          ...(specificInterestsResult.error
            ? [
                "specific_interests_not_available",
              ]
            : []),
          ...(votesResult.error
            ? [
                "votes_not_available",
              ]
            : []),
          ...(pointsResult.error
            ? [
                "points_ledger_not_available",
              ]
            : []),
          ...(rewardsResult.error
            ? [
                "rewards_not_available",
              ]
            : []),
        ],
    }

    return NextResponse.json({
      success: true,
      member:
        memberProfile,
    })
  } catch (error) {
    console.error(
      "COMMUNITY MEMBER PROFILE ERROR:",
      error
    )

    return createErrorResponse(
      "member_profile_failed",
      500
    )
  }
}
