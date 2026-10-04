"use client"

import { supabase } from "@/lib/supabase"

let renewalInFlight: Promise<string> | null = null

function adminApiPath(input: RequestInfo | URL) {
  if (typeof input !== "string" || !input.startsWith("/api/admin/")) {
    throw new Error("SELLER_OS_AUTHENTICATED_FETCH_PATH_REJECTED")
  }
  return input
}

async function currentAccessTokenV1() {
  const { data, error } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (error || !token) throw new Error("OWNER_ADMIN_SESSION_REQUIRED")
  return token
}

async function renewProtectedSellerOsSessionV1() {
  if (renewalInFlight) return renewalInFlight
  renewalInFlight = (async () => {
    const { data, error } = await supabase.auth.refreshSession()
    const token = data.session?.access_token
    if (error || !token) throw new Error("OWNER_ADMIN_SESSION_REFRESH_REQUIRED")
    const response = await fetch("/api/admin/session", {
      method: "POST", cache: "no-store", credentials: "same-origin",
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!response.ok) throw new Error("OWNER_ADMIN_SESSION_REFRESH_REJECTED")
    return token
  })()
  try {
    return await renewalInFlight
  } finally {
    renewalInFlight = null
  }
}

function requestWithTokenV1(input: string, init: RequestInit, token: string) {
  const headers = new Headers(init.headers)
  headers.set("Authorization", `Bearer ${token}`)
  return fetch(input, { ...init, cache: "no-store", credentials: "same-origin",
    headers })
}

export async function sellerOsAuthenticatedFetchV1(
  input: RequestInfo | URL,
  init: RequestInit = {},
) {
  const path = adminApiPath(input)
  const initialToken = await currentAccessTokenV1()
  const initialResponse = await requestWithTokenV1(path, init, initialToken)
  if (initialResponse.status !== 401) return initialResponse
  const renewedToken = await renewProtectedSellerOsSessionV1()
  return requestWithTokenV1(path, init, renewedToken)
}
