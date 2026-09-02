import {
  supabase,
} from "./supabase"
import {
  SELLER_OS_ACCESS_ROLES,
  sellerOsAccessRoleFromUser,
  type SellerOsAccessRole,
} from "./seller-os-access-control"
import {
  remoteLiveOperatorUsernameFromUser,
  sellerOsPasswordLoginIdentity,
} from "./remote-live-operator-identity"

const ADMIN_AUTH_TIMEOUT_MS =
  30000

function getAdminAuthErrorMessage(
  error: unknown
) {
  const message =
    error instanceof Error
      ? error.message
      : ""

  if (message === "admin_sign_in_timeout") {
    return "Supabase Auth no respondio al login en 30 segundos. Revisa la URL publica de Supabase, la red y el request /auth/v1/token."
  }

  if (message === "admin_session_timeout") {
    return "Supabase Auth no respondio al validar la sesion en 30 segundos."
  }

  if (message === "admin_permission_check_timeout") {
    return "Supabase no respondio al validar permisos admin en 30 segundos."
  }

  return message
}

function withTimeout<T>(
  promise: PromiseLike<T>,
  label: string
): Promise<T> {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<T>((_, reject) => {
      globalThis.setTimeout(
        () => {
          reject(
            new Error(
              `${label}_timeout`
            )
          )
        },
        ADMIN_AUTH_TIMEOUT_MS
      )
    }),
  ])
}

export async function signInSellerOs(
  identifier: string,
  password: string
) {
  try {
    const loginIdentity = sellerOsPasswordLoginIdentity(identifier)
    if (!loginIdentity) return {
      authorized: false,
      role: null,
      session: null,
      error: "Escribe un email o usuario válido.",
    }
    const {
      data,
      error,
    } =
      await withTimeout(
        supabase.auth.signInWithPassword({
          email: loginIdentity.email,
          password,
        }),
        "admin_sign_in"
      )

    if (error || !data.session) {
      return {
        authorized: false,
        role: null,
        session: null,
        error:
          error?.message ||
          "No se pudo iniciar sesion.",
      }
    }

    const metadataRole = sellerOsAccessRoleFromUser(data.user)
    if (metadataRole) {
      if (metadataRole ===
          SELLER_OS_ACCESS_ROLES.remoteLiveOptimizationOperator &&
          (!loginIdentity.remoteUsername ||
            remoteLiveOperatorUsernameFromUser(data.user) !==
              loginIdentity.remoteUsername)) {
        await supabase.auth.signOut()
        return {
          authorized: false,
          role: null,
          session: null,
          error: "Usuario o contraseña incorrectos.",
        }
      }
      return {
        authorized: true,
        role: metadataRole,
        session: data.session,
        error: null,
      }
    }

    const {
      data: isAdmin,
      error: adminError,
    } =
      await withTimeout(
        supabase.rpc("is_admin"),
        "admin_permission_check"
      )

    if (adminError || isAdmin !== true) {
      await supabase.auth.signOut()

      return {
        authorized: false,
        role: null,
        session: null,
        error:
          adminError?.message ||
          "Este usuario no tiene acceso a Seller OS.",
      }
    }

    return {
      authorized: true,
      role: SELLER_OS_ACCESS_ROLES.owner,
      session: data.session,
      error: null,
    }
  } catch (error) {
    return {
      authorized: false,
      role: null,
      session: null,
      error:
        getAdminAuthErrorMessage(error) ||
        "No se pudo conectar con Supabase para iniciar sesion.",
    }
  }
}

export async function validateSellerOsSession(): Promise<{
  authorized: boolean
  role: SellerOsAccessRole | null
  session: Awaited<ReturnType<typeof supabase.auth.getSession>>["data"]["session"]
  error: string | null
}> {
  try {
    const {
      data,
      error,
    } =
      await withTimeout(
        supabase.auth.getSession(),
        "admin_session"
      )

    if (error || !data.session) {
      return {
        authorized: false,
        role: null,
        session: null,
        error:
          error?.message || "NO_SESSION",
      }
    }

    const metadataRole = sellerOsAccessRoleFromUser(data.session.user)
    if (metadataRole) {
      return {
        authorized: true,
        role: metadataRole,
        session:
          data.session,
        error: null,
      }
    }

    const {
      data: isAdmin,
      error: adminError,
    } =
      await withTimeout(
        supabase.rpc("is_admin"),
        "admin_permission_check"
      )

    if (adminError || isAdmin !== true) {
      await supabase.auth.signOut()

      return {
        authorized: false,
        role: null,
        session: null,
        error:
          adminError?.message ||
          "NOT_ADMIN",
      }
    }

    return {
      authorized: true,
      role: SELLER_OS_ACCESS_ROLES.owner,
      session:
        data.session,
      error: null,
    }
  } catch (error) {
    return {
      authorized: false,
      role: null,
      session: null,
      error:
        getAdminAuthErrorMessage(error) ||
        "No se pudo validar la sesion admin.",
    }
  }
}

export async function signInAdmin(email: string, password: string) {
  const result = await signInSellerOs(email, password)
  return {
    isAdmin: result.authorized &&
      result.role === SELLER_OS_ACCESS_ROLES.owner,
    session: result.role === SELLER_OS_ACCESS_ROLES.owner
      ? result.session : null,
    error: result.role === SELLER_OS_ACCESS_ROLES.owner
      ? result.error : result.error ?? "Este usuario no tiene permisos de administrador.",
  }
}

export async function validateAdminSession() {
  const result = await validateSellerOsSession()
  return {
    isAdmin: result.authorized &&
      result.role === SELLER_OS_ACCESS_ROLES.owner,
    session: result.role === SELLER_OS_ACCESS_ROLES.owner
      ? result.session : null,
    error: result.role === SELLER_OS_ACCESS_ROLES.owner
      ? result.error : result.error ?? "NOT_ADMIN",
  }
}

export async function signOutAdmin() {
  await supabase.auth.signOut()
}
