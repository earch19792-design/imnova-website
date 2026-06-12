import {
  supabase,
} from "./supabase"

export async function signInAdmin(
  email: string,
  password: string
) {
  const {
    data,
    error,
  } =
    await supabase.auth.signInWithPassword({
      email,
      password,
    })

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
    await supabase.rpc("is_admin")

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
    await supabase.auth.getSession()

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
    await supabase.rpc("is_admin")

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
