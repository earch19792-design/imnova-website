import {
  supabase,
} from "./supabase"

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

export async function signInAdmin(
  email: string,
  password: string
) {
  try {
    const {
      data,
      error,
    } =
      await withTimeout(
        supabase.auth.signInWithPassword({
          email,
          password,
        }),
        "admin_sign_in"
      )

    if (error || !data.session) {
      return {
        isAdmin: false,
        error:
          error?.message ||
          "No se pudo iniciar sesion.",
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
        isAdmin: false,
        error:
          "Este usuario no tiene permisos de administrador.",
      }
    }

    return {
      isAdmin: true,
      error: null,
    }
  } catch (error) {
    return {
      isAdmin: false,
      error:
        getAdminAuthErrorMessage(error) ||
        "No se pudo conectar con Supabase para iniciar sesion.",
    }
  }
}

export async function validateAdminSession() {
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
        isAdmin: false,
        session: null,
        error:
          error?.message || "NO_SESSION",
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
        isAdmin: false,
        session: null,
        error:
          adminError?.message ||
          "NOT_ADMIN",
      }
    }

    return {
      isAdmin: true,
      session:
        data.session,
      error: null,
    }
  } catch (error) {
    return {
      isAdmin: false,
      session: null,
      error:
        getAdminAuthErrorMessage(error) ||
        "No se pudo validar la sesion admin.",
    }
  }
}

export async function signOutAdmin() {
  await supabase.auth.signOut()
}
