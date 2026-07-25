"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import {
  signInAdmin,
} from "@/lib/admin-auth"
import {
  getSafeAdminReturnPath,
} from "@/lib/admin-auth-return"

export default function AdminLoginPage() {

  const router = useRouter()

  const [email, setEmail] =
    useState("")

  const [password, setPassword] =
    useState("")

  const [error, setError] =
    useState("")

  const [isLoading, setIsLoading] =
    useState(false)

  const handleLogin = async (
    e: React.FormEvent
  ) => {

    e.preventDefault()

    setError("")
    setIsLoading(true)

    try {
      const result =
        await signInAdmin(
          email.trim(),
          password
        )

      if (!result.isAdmin) {
        setError(
          result.error ||
            "Credenciales incorrectas"
        )
        return
      }

      if (!result.session?.access_token) {
        setError("No se pudo establecer la sesión administrativa segura.")
        return
      }

      const sessionResponse = await fetch("/api/admin/session", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${result.session.access_token}`,
        },
      })

      if (!sessionResponse.ok) {
        setError("No se pudo proteger la sesión administrativa.")
        return
      }

      const returnTo =
        getSafeAdminReturnPath(
          new URLSearchParams(
            window.location.search
          ).get("returnTo")
        )

      router.replace(returnTo)
    } catch (loginError) {
      console.error(
        "ADMIN LOGIN ERROR:",
        loginError
      )

      setError(
        loginError instanceof Error &&
          loginError.message
          ? loginError.message
          : "No se pudo conectar con Supabase para validar el acceso."
      )
    } finally {
      setIsLoading(false)
    }

  }

  return (

    <main
      className="
        flex
        min-h-screen
        items-center
        justify-center
        bg-black
        px-6
      "
    >

      <div
        className="
          w-full
          max-w-md
          rounded-[32px]
          border
          border-cyan-400/10
          bg-white/[0.03]
          p-8
          backdrop-blur-2xl
          shadow-[0_0_80px_rgba(0,255,255,0.08)]
        "
      >

        <div className="mb-8 text-center">

          <p
            className="
              text-xs
              uppercase
              tracking-[0.35em]
              text-cyan-300
            "
          >

            SELLER OS

          </p>

          <h1
            className="
              mt-4
              text-4xl
              font-black
              text-white
            "
          >

            ACCESO ADMINISTRATIVO

          </h1>

          <p
            className="
              mt-4
              text-zinc-400
            "
          >

            Operación profesional para marketplaces. No existe registro público.

          </p>

        </div>

        <form
          onSubmit={handleLogin}
          className="space-y-5"
        >

          <input
            type="email"
            placeholder="Email"
            required
            value={email}
            onChange={(e) =>
              setEmail(e.target.value)
            }
            className="
              w-full
              rounded-2xl
              border
              border-white/10
              bg-black/40
              px-5
              py-4
              text-white
              outline-none
            "
          />

          <input
            type="password"
            placeholder="Contraseña"
            required
            value={password}
            onChange={(e) =>
              setPassword(e.target.value)
            }
            className="
              w-full
              rounded-2xl
              border
              border-white/10
              bg-black/40
              px-5
              py-4
              text-white
              outline-none
            "
          />

          {error && (

            <p
              className="
                text-sm
                text-red-400
              "
            >

              {error}

            </p>

          )}

          <button
            type="submit"
            disabled={isLoading}
            className="
              w-full
              rounded-2xl
              bg-cyan-400
              px-5
              py-4
              font-semibold
              text-black
              transition-all
              duration-300
              hover:scale-[1.02]
              disabled:cursor-not-allowed
              disabled:opacity-60
            "
          >

            {isLoading
              ? "Validando..."
              : "Entrar al sistema"}

          </button>

        </form>

      </div>

    </main>

  )
}
