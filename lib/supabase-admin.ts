import {
  createClient,
} from "@supabase/supabase-js"

class ServerOnlyRealtimeTransport {
  constructor() {
    throw new Error(
      "Realtime no esta habilitado en los clientes admin server-side."
    )
  }
}

const serverOnlyRealtimeOptions = {
  realtime: {
    transport:
      ServerOnlyRealtimeTransport as unknown as typeof WebSocket,
  },
}

function getSupabaseUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || ""
}

function getSupabaseAnonKey() {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || ""
}

function getSupabaseServiceRoleKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || ""
}

export function getSupabaseAdminClient() {
  const supabaseUrl =
    getSupabaseUrl()

  const serviceRoleKey =
    getSupabaseServiceRoleKey()

  if (
    !supabaseUrl ||
    !serviceRoleKey
  ) {
    throw new Error(
      "Supabase service role no esta configurado."
    )
  }

  return createClient(
    supabaseUrl,
    serviceRoleKey,
    {
      ...serverOnlyRealtimeOptions,
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )
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
    getSupabaseUrl()

  const supabaseAnonKey =
    getSupabaseAnonKey()

  if (
    !supabaseUrl ||
    !supabaseAnonKey
  ) {
    throw new Error(
      "Supabase Auth no esta configurado para validar Admin."
    )
  }

  return createClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      ...serverOnlyRealtimeOptions,
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

function hasAdminMetadata(
  user: unknown
) {
  const metadata =
    user &&
    typeof user === "object" &&
    "app_metadata" in user &&
    user.app_metadata &&
    typeof user.app_metadata === "object"
      ? user.app_metadata as Record<string, unknown>
      : null

  return (
    metadata?.is_admin === true ||
    metadata?.role === "admin"
  )
}

export async function validateAdminApiRequest(
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
      userId: null,
    }
  }

  const serviceRoleKey =
    getSupabaseServiceRoleKey()

  if (
    serviceRoleKey &&
    token === serviceRoleKey
  ) {
    return {
      ok: true,
      status: 200,
      error: null,
      userId: null,
      authenticationMode: "service_role" as const,
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
      userId: null,
    }
  }

  if (
    hasAdminMetadata(
      userData.user
    )
  ) {
    return {
      ok: true,
      status: 200,
      error: null,
      userId: userData.user.id,
      authenticationMode: "admin_user" as const,
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
      userId: userData.user.id,
    }
  }

  return {
    ok: true,
    status: 200,
    error: null,
    userId: userData.user.id,
    authenticationMode: "admin_user" as const,
  }
}
