import {
  supabase,
} from "./supabase"

const ADMIN_AUTH_TIMEOUT_MS =
  12000

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
}

export async function validateAdminSession() {
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
}

export async function signOutAdmin() {
  await supabase.auth.signOut()
}
