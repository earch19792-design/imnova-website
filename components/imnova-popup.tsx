"use client"

import { useEffect, useState } from "react"

import {
  motion,
  AnimatePresence,
} from "framer-motion"

import { supabase } from "@/lib/supabase"
import { useRouter } from "next/navigation"

export default function InnovaPopup() {

  const router = useRouter()

  const [fullName, setFullName] =
    useState("")

  const [password, setPassword] =
    useState("")

  const [isLogin, setIsLogin] =
    useState(false)

  const [phone, setPhone] =
    useState("")

  const [email, setEmail] =
    useState("")

  const [
    selectedNiches,
    setSelectedNiches,
  ] = useState<string[]>([])

  const [loading, setLoading] =
    useState(false)

  const [success, setSuccess] =
    useState(false)

  const [isOpen, setIsOpen] =
    useState(false)

  const [mounted, setMounted] =
    useState(false)

  /* =================================================
  INIT
  ================================================= */

  useEffect(() => {

    const checkSession =
      async () => {

        setMounted(true)

        const {
          data: { session },
        } = await supabase.auth.getSession()

        if (session) {

          setIsOpen(false)

          return

        }

        const expiration =
          localStorage.getItem(
            "innova-access-expiration"
          )

        if (!expiration) {

          setIsOpen(true)

          return

        }

        const now = Date.now()

        if (
          now > Number(expiration)
        ) {

          setIsOpen(true)

          return

        }

        setIsOpen(false)

      }

    checkSession()

  }, [])

  /* =================================================
  NICHES
  ================================================= */

  const niches = [

    {
      title:
        "Poneme Activo",

      subtitle:
        "Gym, energía y rendimiento",

      icon:
        "⚡",
    },

    {
      title:
        "Cosas del Futuro",

      subtitle:
        "Tecnología brutal e innovación",

      icon:
        "◉",
    },

    {
      title:
        "Pa' Rendír Más",

      subtitle:
        "Bebidas funcionales y enfoque",

      icon:
        "☕",
    },

    {
      title:
        "Vida Inteligente",

      subtitle:
        "Productos premium para el día a día",

      icon:
        "◆",
    },

    {
      title:
        "Poneme Más Guapo",

      subtitle:
        "Skincare, glow up y cuidado premium",

      icon:
        "✨",
    },

    {
      title:
        "Promos Tuani",

      subtitle:
        "Acceso exclusivo y descuentos",

      icon:
        "✺",
    },

  ]

  /* =================================================
  TOGGLE NICHE
  ================================================= */

  const toggleNiche = (
    title: string
  ) => {

    setSelectedNiches(
      (prev) =>

        prev.includes(title)

          ? prev.filter(
              (item) =>
                item !== title
            )

          : [...prev, title]
    )

  }

  /* =================================================
  SUBMIT
  ================================================= */

  const handleSubmit =
    async () => {

      try {

        setLoading(true)

        /* =========================================
        LOGIN
        ========================================= */

        if (isLogin) {

          if (
            !email ||
            !password
          ) {

            alert(
              "Ingresá email y contraseña"
            )

            return

          }

          const { error } =
            await supabase.auth.signInWithPassword({

              email,

              password,

            })

          if (error) {
            throw error
          }

          localStorage.setItem(
            "innova-access",
            "true"
          )

          localStorage.setItem(
            "innova-access-expiration",
            String(
              Date.now() +
              24 * 60 * 60 * 1000
            )
          )

          setSuccess(true)

          setTimeout(() => {

            setIsOpen(false)

            router.push("/")

          }, 1200)

          return

        }

        /* =========================================
        SIGNUP VALIDATION
        ========================================= */

        if (
          !fullName ||
          !phone ||
          !email ||
          !password
        ) {

          alert(
            "Completá todos los campos"
          )

          return

        }

        if (
          selectedNiches.length === 0
        ) {

          alert(
            "Seleccioná al menos un nicho"
          )

          return

        }

        /* =========================================
        SIGN UP AUTH
        ========================================= */

        const {
          data: authData,
          error: authError,
        } = await supabase.auth.signUp({

          email,

          password,

        })

        if (authError) {
          throw authError
        }

        /* =========================================
        SAVE USER DATA
        ========================================= */

        const cleanPhone =
          phone
            .replace(/\D/g, "")
            .trim()

        const {
          error,
        } = await supabase

          .from("subscribers")

          .insert([
            {
              nombre:
                fullName,

              telefono:
                cleanPhone,

              email:
                email,

              nichos:
                selectedNiches,

              auth_id:
                authData.user?.id,
            },
          ])

        if (error) {
          throw error
        }

        localStorage.setItem(
          "innova-access",
          "true"
        )

        localStorage.setItem(
          "innova-access-expiration",
          String(
            Date.now() +
            24 * 60 * 60 * 1000
          )
        )

        setSuccess(true)

        setTimeout(() => {

          setIsOpen(false)

          router.push("/")

        }, 1800)

        setFullName("")
        setPhone("")
        setEmail("")
        setPassword("")
        setSelectedNiches([])

      } catch (err: any) {

  console.log(
    "SUPABASE ERROR:",
    JSON.stringify(err, null, 2)
  )

  console.log(err)

  alert(

    err?.message ||

    err?.error_description ||

    "Error autenticando usuario"

  )

} finally {

        setLoading(false)

      }

    }

  if (!mounted) return null

  return (

    <AnimatePresence>

      {isOpen && (

        <motion.div
          initial={{
            opacity: 0,
          }}
          animate={{
            opacity: 1,
          }}
          exit={{
            opacity: 0,
          }}
          className="
            fixed
            inset-0
            z-[9999]
            flex
            items-start
            justify-center
            overflow-y-auto
            bg-black/90
            px-4
            py-10
            backdrop-blur-3xl
          "
        >

          {/* BACKGROUND */}

          <div
            className="
              pointer-events-none
              absolute
              inset-0
              overflow-hidden
            "
          >

            <motion.div
              animate={{
                scale: [1.08, 1.12, 1.08],
              }}
              transition={{
                duration: 20,
                repeat: Infinity,
                ease: "easeInOut",
              }}
              className="
                absolute
                inset-0
                bg-[url('/images/imnova-popup-3d.webp')]
                bg-cover
                bg-center
                opacity-[0.10]
              "
            />

            <div
              className="
                absolute
                inset-0
                bg-black/80
              "
            />

          </div>

          {/* CONTAINER */}

          <motion.div
            initial={{
              opacity: 0,
              scale: 0.96,
              y: 40,
            }}
            animate={{
              opacity: 1,
              scale: 1,
              y: 0,
            }}
            exit={{
              opacity: 0,
              scale: 0.98,
            }}
            transition={{
              duration: 0.8,
              ease: [0.22, 1, 0.36, 1],
            }}
            className="
              relative
              w-full
              max-w-6xl
              rounded-[40px]
              border
              border-cyan-400/10
              bg-black/60
              backdrop-blur-3xl
              shadow-[0_0_120px_rgba(34,211,238,0.08)]
            "
          >

            {/* GUEST BUTTON */}

            <button
              onClick={() => {

                localStorage.setItem(
                  "innova-access",
                  "guest"
                )

                localStorage.setItem(
                  "innova-access-expiration",
                  String(
                    Date.now() +
                    24 * 60 * 60 * 1000
                  )
                )

                setIsOpen(false)

                router.push("/")

              }}
              className="
                absolute
                right-5
                top-5
                z-20
                rounded-full
                border
                border-white/10
                bg-white/[0.04]
                px-4
                py-2
                text-xs
                uppercase
                tracking-[0.2em]
                text-white/60
                transition-all
                duration-300
                hover:border-cyan-400/30
                hover:bg-cyan-400/10
                hover:text-cyan-200
              "
            >

              Invitado

            </button>

            <div
              className="
                grid
                lg:grid-cols-2
              "
            >

              {/* LEFT */}

              <div
                className="
                  relative
                  overflow-hidden
                  border-b
                  border-white/10
                  p-8
                  lg:border-b-0
                  lg:border-r
                  lg:p-12
                "
              >

                <div
                  className="
                    relative
                    inline-flex
                    items-center
                    gap-3
                    rounded-full
                    border
                    border-cyan-400/20
                    bg-cyan-400/[0.08]
                    px-5
                    py-3
                    backdrop-blur-md
                  "
                >

                  <div
                    className="
                      h-2
                      w-2
                      rounded-full
                      bg-cyan-300
                    "
                  />

                  <span
                    className="
                      text-[10px]
                      uppercase
                      tracking-[0.35em]
                      text-cyan-100
                    "
                  >

                    IMNOVA ACCESS

                  </span>

                </div>

                <h2
                  className="
                    mt-10
                    text-4xl
                    font-bold
                    leading-[1]
                    tracking-[-0.05em]
                    text-white
                    lg:text-5xl
                  "
                >

                  Entrá al Futuro

                  <span
                    className="
                      block
                      bg-gradient-to-r
                      from-cyan-200
                      via-white
                      to-zinc-400
                      bg-clip-text
                      text-transparent
                    "
                  >

                    con IMNOVA™

                  </span>

                </h2>

                <div
                  className="
                    relative
                    mt-16
                    flex
                    items-center
                    justify-center
                    min-h-[500px]
                  "
                >

                  <motion.div
                    animate={{
                      rotate: 360,
                    }}
                    transition={{
                      duration: 80,
                      repeat: Infinity,
                      ease: "linear",
                    }}
                    className="
                      absolute
                      h-[620px]
                      w-[620px]
                      rounded-full
                      border
                      border-cyan-400/10
                    "
                  />

                  <motion.img
                    src="/images/imnova-popup-3d.webp"
                    alt="IMNOVA"
                    animate={{
                      y: [0, -20, 0],
                      rotateY: [0, 6, 0],
                      scale: [1, 1.03, 1],
                    }}
                    transition={{
                      duration: 8,
                      repeat: Infinity,
                      ease: "easeInOut",
                    }}
                    className="
                      relative
                      z-10
                      w-full
                      max-w-[620px]
                      rounded-[40px]
                      object-contain
                      mix-blend-screen
                      opacity-95
                      drop-shadow-[0_0_100px_rgba(34,211,238,0.45)]
                    "
                  />

                </div>

              </div>

              {/* RIGHT */}

              <div
                className="
                  relative
                  p-8
                  lg:p-12
                "
              >

                {/* SWITCH */}

                <div
                  className="
                    mb-6
                    flex
                    items-center
                    justify-between
                  "
                >

                  <button
                    onClick={() =>
                      setIsLogin(true)
                    }
                    className={`
                      text-sm
                      transition-all

                      ${
                        isLogin
                          ? "text-cyan-200"
                          : "text-white/40"
                      }
                    `}
                  >

                    Iniciar sesión

                  </button>

                  <button
                    onClick={() =>
                      setIsLogin(false)
                    }
                    className={`
                      text-sm
                      transition-all

                      ${
                        !isLogin
                          ? "text-cyan-200"
                          : "text-white/40"
                      }
                    `}
                  >

                    Crear acceso

                  </button>

                </div>

                <h3
                  className="
                    text-3xl
                    font-bold
                    tracking-[-0.04em]
                    text-white
                  "
                >

                  {isLogin
                    ? "Bienvenido de nuevo"
                    : "Activá tu acceso"}

                </h3>

                <div
                  className="
                    mt-4
                    rounded-2xl
                    border
                    border-cyan-400/20
                    bg-cyan-400/[0.06]
                    p-5
                    backdrop-blur-xl
                  "
                >

                  <p
                    className="
                      text-sm
                      leading-relaxed
                      text-cyan-100
                    "
                  >

                    ⚡ Accedé al ecosistema
                    IMNOVA™ y desbloqueá
                    experiencias, productos
                    y contenido exclusivo.

                  </p>

                </div>

                {/* FORM */}

                <div className="mt-6 space-y-4">

                  {!isLogin && (

                    <>
                      <input
                        value={fullName}
                        onChange={(e) =>
                          setFullName(
                            e.target.value
                          )
                        }
                        placeholder="Tu nombre"
                        className="
                          w-full
                          rounded-2xl
                          border
                          border-white/10
                          bg-white/[0.06]
                          px-6
                          py-4
                          text-white
                          outline-none
                          placeholder:text-white/45
                        "
                      />

                      <input
                        value={phone}
                        onChange={(e) =>
                          setPhone(
                            e.target.value
                          )
                        }
                        placeholder="WhatsApp"
                        className="
                          w-full
                          rounded-2xl
                          border
                          border-white/10
                          bg-white/[0.06]
                          px-6
                          py-4
                          text-white
                          outline-none
                          placeholder:text-white/45
                        "
                      />
                    </>

                  )}

                  <input
                    value={email}
                    onChange={(e) =>
                      setEmail(
                        e.target.value
                      )
                    }
                    placeholder="Correo electrónico"
                    className="
                      w-full
                      rounded-2xl
                      border
                      border-white/10
                      bg-white/[0.06]
                      px-6
                      py-4
                      text-white
                      outline-none
                      placeholder:text-white/45
                    "
                  />

                  <input
                    type="password"
                    value={password}
                    onChange={(e) =>
                      setPassword(
                        e.target.value
                      )
                    }
                    placeholder="Contraseña"
                    className="
                      w-full
                      rounded-2xl
                      border
                      border-white/10
                      bg-white/[0.06]
                      px-6
                      py-4
                      text-white
                      outline-none
                      placeholder:text-white/45
                    "
                  />

                </div>

                {/* NICHES */}

                {!isLogin && (

                  <div
                    className="
                      mt-8
                      grid
                      grid-cols-2
                      gap-4
                    "
                  >

                    {niches.map(
                      (niche) => {

                        const active =
                          selectedNiches.includes(
                            niche.title
                          )

                        return (

                          <button
                            key={niche.title}
                            type="button"
                            onClick={() =>
                              toggleNiche(
                                niche.title
                              )
                            }
                            className={`
                              rounded-[28px]
                              border
                              p-5
                              text-left
                              transition-all
                              duration-500

                              ${
                                active

                                  ? `
                                    border-cyan-400/40
                                    bg-cyan-400/[0.10]
                                  `

                                  : `
                                    border-white/10
                                    bg-white/[0.04]
                                  `
                              }
                            `}
                          >

                            <div
                              className="
                                mb-4
                                text-2xl
                              "
                            >

                              {niche.icon}

                            </div>

                            <h4
                              className="
                                text-sm
                                font-bold
                                text-white
                              "
                            >

                              {niche.title}

                            </h4>

                            <p
                              className="
                                mt-2
                                text-xs
                                text-white/60
                              "
                            >

                              {niche.subtitle}

                            </p>

                          </button>

                        )

                      }
                    )}

                  </div>

                )}

                {/* BUTTON */}

                <button
                  onClick={handleSubmit}
                  disabled={loading}
                  className="
                    mt-8
                    w-full
                    rounded-3xl
                    border
                    border-cyan-400/20
                    bg-gradient-to-r
                    from-cyan-300
                    to-white
                    px-8
                    py-5
                    text-sm
                    font-black
                    uppercase
                    tracking-[0.25em]
                    text-black
                    transition-all
                    duration-500
                    hover:scale-[1.01]
                    disabled:opacity-50
                  "
                >

                  {
                    loading
                      ? "PROCESANDO..."
                      : isLogin
                        ? "INICIAR SESIÓN"
                        : "CREAR ACCESO"
                  }

                </button>

                {/* SUCCESS */}

                {success && (

                  <motion.div
                    initial={{
                      opacity: 0,
                      y: 10,
                    }}
                    animate={{
                      opacity: 1,
                      y: 0,
                    }}
                    className="
                      mt-5
                      rounded-2xl
                      border
                      border-cyan-400/20
                      bg-cyan-400/[0.08]
                      p-5
                      text-cyan-100
                    "
                  >

                    ✓ Acceso activado correctamente.

                  </motion.div>

                )}

              </div>

            </div>

          </motion.div>

        </motion.div>

      )}

    </AnimatePresence>

  )

}