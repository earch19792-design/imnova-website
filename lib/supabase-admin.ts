import {
  createClient,
} from "@supabase/supabase-js"
import {
  SELLER_OS_ACCESS_ROLES,
  sellerOsAccessRoleFromUser,
  type SellerOsAccessRole,
// @ts-expect-error Node's direct TypeScript audit runner requires the suffix.
} from "./seller-os-access-control.ts"

type SellerOsApiValidation =
  | Readonly<{ ok: true; status: 200; error: null; userId: null;
      authenticationMode: "service_role"; accessRole: null }>
  | Readonly<{ ok: true; status: 200; error: null; userId: string;
      authenticationMode: "seller_os_user";
      accessRole: SellerOsAccessRole }>
  | Readonly<{ ok: false; status: number; error: string;
      userId: string | null; authenticationMode: null;
      accessRole: SellerOsAccessRole | null }>

type AdminApiValidation =
  | Readonly<{ ok: true; status: 200; error: null; userId: null;
      authenticationMode: "service_role"; accessRole: null }>
  | Readonly<{ ok: true; status: 200; error: null; userId: string;
      authenticationMode: "admin_user"; accessRole: "OWNER_ADMIN" }>
  | Readonly<{ ok: false; status: number; error: string;
      userId: string | null; authenticationMode: null;
      accessRole: SellerOsAccessRole | null }>

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

export async function validateSellerOsApiRequest(
  req: Request
): Promise<SellerOsApiValidation> {
  const token =
    getBearerToken(req)

  if (!token) {
    return {
      ok: false,
      status: 401,
      error:
        "seller_os_token_required",
      userId: null,
      authenticationMode: null,
      accessRole: null,
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
      accessRole: null,
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
        "seller_os_unauthorized",
      userId: null,
      authenticationMode: null,
      accessRole: null,
    }
  }

  const metadataRole = sellerOsAccessRoleFromUser(userData.user)
  if (metadataRole) {
    return {
      ok: true,
      status: 200,
      error: null,
      userId: userData.user.id,
      authenticationMode: "seller_os_user" as const,
      accessRole: metadataRole,
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
        "seller_os_forbidden",
      userId: userData.user.id,
      authenticationMode: null,
      accessRole: null,
    }
  }

  return {
    ok: true,
    status: 200,
    error: null,
    userId: userData.user.id,
    authenticationMode: "seller_os_user" as const,
    accessRole: SELLER_OS_ACCESS_ROLES.owner,
  }
}

export async function validateAdminApiRequest(
  req: Request,
): Promise<AdminApiValidation> {
  const validation = await validateSellerOsApiRequest(req)
  if (!validation.ok) return validation
  if (validation.authenticationMode === "service_role") return {
    ...validation,
    authenticationMode: "service_role" as const,
  }
  if (validation.accessRole !== SELLER_OS_ACCESS_ROLES.owner) return {
    ok: false,
    status: 403,
    error: "admin_forbidden",
    userId: validation.userId,
    authenticationMode: null,
    accessRole: validation.accessRole,
  }
  return {
    ...validation,
    authenticationMode: "admin_user" as const,
    accessRole: SELLER_OS_ACCESS_ROLES.owner,
  }
}
