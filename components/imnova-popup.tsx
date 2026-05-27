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

  const [countryCode, setCountryCode] =
  useState("+505")

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

    status:
      "Detectando alto rendimiento...",

    icon:
      "⚡",

    image:
      "/images/imnova-fitness.webp",

    quote:
      "⚡ Energía desbloqueada.",

    glow:
      "from-cyan-400/30 to-cyan-600/10",

    energy:
      "bg-cyan-400/20",

    scene:
      "IM NOVA tomando PURA+ y comiendo pancakes Mash Nutri+ en un gym futurista.",
  },

  {
    title:
      "Cosas del Futuro",

    subtitle:
      "Tecnología brutal e innovación",

    status:
      "Conectando al ecosistema IMNOVA...",

    icon:
      "◉",

    image:
      "/images/imnova-tech.webp",

    quote:
      "◉ Bienvenido al futuro.",

    glow:
      "from-blue-500/30 to-indigo-600/10",

    energy:
      "bg-blue-500/20",

    scene:
      "IM NOVA usando hologramas, IA y gadgets futuristas.",
  },

  {
    title:
      "Pa’ Rendir Más",

    subtitle:
      "Bebidas funcionales y enfoque",

    status:
      "Modo enfoque sincronizado...",

    icon:
      "☕",

    image:
      "/images/imnova-focus.webp",

    quote:
      "☕ Modo enfoque activado.",

    glow:
      "from-orange-400/30 to-yellow-500/10",

    energy:
      "bg-orange-400/20",

    scene:
      "IM NOVA trabajando con Mash Coffee y setup productivity premium.",
  },

  {
    title:
      "Vida Inteligente",

    subtitle:
      "Productos premium para el día a día",

    status:
      "Sincronizando vida inteligente...",

    icon:
      "◆",

    image:
      "/images/imnova-lifestyle.webp",

    quote:
      "◆ Simplificá tu vida.",

    glow:
      "from-emerald-400/30 to-green-600/10",

    energy:
      "bg-emerald-400/20",

    scene:
      "IM NOVA interactuando con gadgets smart home y estilo de vida futurista.",
  },

  {
    title:
      "Poneme Más Guapo",

    subtitle:
      "Skincare, glow up y cuidado premium",

    status:
      "Glow premium activado...",

    icon:
      "✨",

    image:
      "/images/imnova-skincare.webp",

    quote:
      "✨ Glow premium activado.",

    glow:
      "from-pink-400/30 to-fuchsia-600/10",

    energy:
      "bg-pink-400/20",

    scene:
      "IM NOVA usando skincare premium con iluminación luxury glow.",
  },

  {
    title:
      "Promos Tuani",

    subtitle:
      "Acceso exclusivo y descuentos",

    status:
      "Buscando beneficios exclusivos...",

    icon:
      "✺",

    image:
      "/images/imnova-deals.webp",

    quote:
      "✺ Acceso VIP desbloqueado.",

    glow:
      "from-yellow-300/30 to-orange-500/10",

    energy:
      "bg-yellow-300/20",

    scene:
      "IM NOVA mostrando ofertas premium y acceso VIP futurista.",
  },
]
const [activeNiche, setActiveNiche] =
  useState(niches[0])

const [isSwitching, setIsSwitching] =
  useState(false)

const [displayText, setDisplayText] =
  useState("")

useEffect(() => {

  if (!isSwitching) return

  const text =
    "Sincronizando preferencias..."

  let index = 0

  setDisplayText("")

  const interval =
    setInterval(() => {

      setDisplayText(
        text.slice(0, index)
      )

      index++

      if (index > text.length) {

        clearInterval(interval)

      }

    }, 35)

  return () =>
    clearInterval(interval)

}, [isSwitching])
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
            console.log("HANDLE SUBMIT FUNCIONANDO")
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

        const cleanPhone = (
  countryCode +
  phone.replace(/\D/g, "")
).trim()
console.log({
  countryCode,
  phone,
  cleanPhone,
})

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
          <motion.div
  key={activeNiche.title}
  initial={{
    opacity: 0,
    scale: 0.7,
  }}
  animate={{
    opacity: 1,
    scale: 1,
  }}
  transition={{
    duration: 1,
  }}
  className={`
    pointer-events-none
    absolute
    left-1/2
    top-1/2
    h-[700px]
    w-[700px]
    -translate-x-1/2
    -translate-y-1/2
    rounded-full
    blur-3xl
    ${activeNiche.energy}
  `}
/>

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
  key={activeNiche.image}
  src={activeNiche.image}
  alt={activeNiche.title}

  initial={{
    opacity: 0,
    scale: 0.92,
    y: 30,
  }}

  animate={{
    opacity: 1,
    scale: [1, 1.04, 1],
    y: [0, -18, 0],
    rotateY: [0, 8, 0],
    rotateX: [0, 2, 0],
    filter: [
      "drop-shadow(0 0 40px rgba(34,211,238,0.25))",
      "drop-shadow(0 0 90px rgba(34,211,238,0.55))",
      "drop-shadow(0 0 40px rgba(34,211,238,0.25))",
    ],
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
    opacity-95
  "
/>                </div>

              </div>

              {/* RIGHT */}

              <div
                className="
                  relative
                  p-8
                  lg:p-12
                "
              >

                {/* TOP ACCESS BAR */}

                <div
                  className="
                    mb-8
                    flex
                    items-center
                    justify-between
                    gap-4
                  "
                >

                  <div>

                    <p
                      className="
                        text-sm
                        text-white/40
                      "
                    >

                      ¿Ya sos parte de IMNOVA™?

                    </p>

                    <button
                      onClick={() =>
                        setIsLogin(true)
                      }
                      className="
                        mt-1
                        text-sm
                        font-medium
                        text-cyan-200
                        transition-all
                        duration-300
                        hover:text-cyan-100
                      "
                    >

                      Iniciar sesión →

                    </button>

                  </div>

                  <button
                    onClick={async () => {

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
                      rounded-full
                      border
                      border-white/10
                      bg-white/[0.04]
                      px-5
                      py-2
                      text-[11px]
                      uppercase
                      tracking-[0.25em]
                      text-white/50
                      transition-all
                      duration-300
                      hover:border-cyan-400/30
                      hover:bg-cyan-400/[0.08]
                      hover:text-cyan-100
                    "
                  >

                    Continuar como invitado →

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

                  {
                    isLogin
                      ? "Bienvenido de nuevo"
                      : "Activá tu acceso IMNOVA™"
                  }

                </h3>

                <div
  className={`
    mt-4
    rounded-2xl
    border
    border-cyan-400/20
    bg-gradient-to-br
    ${activeNiche.glow}
    p-5
    backdrop-blur-xl
  `}
>

  <div
    className="
      text-sm
      leading-relaxed
      text-cyan-100
    "
  >

    {
      isSwitching

        ? displayText

        : activeNiche.quote
    }

  </div>

</div>
               {/* FORM */}

<div className="mt-6 space-y-4">

  {!isLogin && (

    <>

      {/* NAME */}

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

      {/* PHONE */}

      <div className="flex gap-3">

       <select
  value={countryCode}
  onChange={(e) =>
    setCountryCode(
      e.target.value
    )
  }
  className="
    rounded-2xl
    border
    border-white/10
    bg-white/[0.06]
    px-4
    text-white
    outline-none
  "
>

  {/* CENTROAMÉRICA */}

  <option value="+501">
    🇧🇿 Belize +501
  </option>

  <option value="+502">
    🇬🇹 Guatemala +502
  </option>

  <option value="+503">
    🇸🇻 El Salvador +503
  </option>

  <option value="+504">
    🇭🇳 Honduras +504
  </option>

  <option value="+505">
    🇳🇮 Nicaragua +505
  </option>

  <option value="+506">
    🇨🇷 Costa Rica +506
  </option>

  <option value="+507">
    🇵🇦 Panamá +507
  </option>

  {/* NORTEAMÉRICA */}

  <option value="+1">
    🇺🇸 Estados Unidos +1
  </option>

  <option value="+1">
    🇨🇦 Canadá +1
  </option>

</select>
        <input
          value={phone}
          onChange={(e) =>
            setPhone(
              e.target.value
            )
          }
          placeholder="Número WhatsApp"
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

    </>

  )}

  {/* EMAIL */}

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

  {/* PASSWORD */}

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
      mt-6
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
           onClick={() => {

  toggleNiche(
    niche.title
  )

  setIsSwitching(true)

  setTimeout(() => {

    setActiveNiche(niche)

    setIsSwitching(false)

  }, 700)

}}

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
                    shadow-[0_0_40px_rgba(34,211,238,0.15)]
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
  type="button"
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
        : "ACTIVAR MI ACCESO"
  }

</button>               {/* SUCCESS */}

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