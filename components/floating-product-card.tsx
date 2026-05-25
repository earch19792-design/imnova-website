"use client"

import Image from "next/image"

import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
} from "framer-motion"

import {
  useRef,
} from "react"

type Props = {
  name: string
  status: string
  cities?: string[]
  image?: string
}

export function FloatingProductCard({
  name,
  status,
  cities,
  image,
}: Props) {

  /* =========================================
  3D INTERACTION SYSTEM
  ========================================= */

  const cardRef =
    useRef<HTMLDivElement>(null)

  const mouseX =
    useMotionValue(0)

  const mouseY =
    useMotionValue(0)

  const rotateX =
    useSpring(
      useTransform(
        mouseY,
        [-120, 120],
        [10, -10]
      ),
      {
        stiffness: 140,
        damping: 18,
      }
    )

  const rotateY =
    useSpring(
      useTransform(
        mouseX,
        [-120, 120],
        [-10, 10]
      ),
      {
        stiffness: 140,
        damping: 18,
      }
    )

  const glowX =
    useTransform(
      mouseX,
      [-120, 120],
      ["35%", "65%"]
    )

  const glowY =
    useTransform(
      mouseY,
      [-120, 120],
      ["35%", "65%"]
    )

  /* =========================================
  MOUSE TRACKING
  ========================================= */

  const handleMouseMove =
    (
      e: React.MouseEvent<HTMLDivElement>
    ) => {

      const rect =
        cardRef.current?.getBoundingClientRect()

      if (!rect) return

      const x =
        e.clientX -
        rect.left -
        rect.width / 2

      const y =
        e.clientY -
        rect.top -
        rect.height / 2

      mouseX.set(x)
      mouseY.set(y)

    }

  const handleMouseLeave =
    () => {

      mouseX.set(0)
      mouseY.set(0)

    }

  return (

    <motion.div
      ref={cardRef}
      onMouseMove={
        handleMouseMove
      }
      onMouseLeave={
        handleMouseLeave
      }
      animate={{
        y: [0, -15, 0],
        x: [0, 8, 0],
      }}
      transition={{
        duration: 6,
        repeat: Infinity,
        ease: "easeInOut",
      }}
      style={{
        rotateX,
        rotateY,
        transformStyle:
          "preserve-3d",
      }}
      className="
        group
        absolute
        relative
        flex
        flex-col
        items-center
        gap-4
        will-change-transform
      "
    >

      {/* =========================================
      REACTIVE LIGHT
      ========================================= */}

      <motion.div
        style={{
          background:
            `radial-gradient(circle at ${glowX} ${glowY},
            rgba(255,255,255,0.10),
            transparent 45%)`,
        }}
        className="
          pointer-events-none
          absolute
          inset-0
          rounded-full
          opacity-0
          blur-2xl
          transition-opacity
          duration-500
          group-hover:opacity-100
        "
      />

      {/* =========================================
      MAIN ORB
      ========================================= */}

      <div
        className="
          relative
          flex
          h-28
          w-28
          items-center
          justify-center
          rounded-full
          border
          border-white/10
          bg-white/[0.04]
          backdrop-blur-xl
          transition-all
          duration-500
          group-hover:border-white/20
          group-hover:bg-white/[0.06]
        "
        style={{
          transform:
            "translateZ(50px)",
        }}
      >

        {/* =========================================
        AMBIENT LIGHT
        ========================================= */}

        <div
          className="
            absolute
            inset-0
            rounded-full
            bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_60%)]
          "
        />

        {/* =========================================
        INNER RING
        ========================================= */}

        <motion.div
          animate={{
            rotate: 360,
          }}
          transition={{
            duration: 20,
            repeat: Infinity,
            ease: "linear",
          }}
          className="
            absolute
            inset-2
            rounded-full
            border
            border-white/[0.08]
          "
        />

        {/* =========================================
        CONTENT
        ========================================= */}

        {status === "🌎 Comercialización" ? (

          <Image
            src={image || ""}
            alt={name}
            width={72}
            height={72}
            className="
              relative
              z-10
              object-contain
              drop-shadow-[0_0_20px_rgba(255,255,255,0.15)]
            "
          />

        ) : (

          <div
            className="
              relative
              z-10
              max-w-[140px]
              px-2
              text-center
              text-[11px]
              font-bold
              uppercase
              leading-tight
              tracking-[0.18em]
              text-white
            "
          >

            {name}

          </div>

        )}

      </div>

      {/* =========================================
      PRODUCT INFO
      ========================================= */}

      <div
        className="
          text-center
        "
        style={{
          transform:
            "translateZ(40px)",
        }}
      >

        <div
          className="
            text-xs
            font-bold
            uppercase
            tracking-[0.18em]
            text-white
          "
        >

          {name}

        </div>

        <div
          className="
            mt-2
            text-[11px]
            uppercase
            tracking-[0.15em]
            text-white/45
          "
        >

          {status}

        </div>

      </div>

      {/* =========================================
      CITIES
      ========================================= */}

      {status === "🌎 Comercialización" && (

        <div
          className="
            flex
            max-w-[150px]
            flex-wrap
            justify-center
            gap-2
          "
          style={{
            transform:
              "translateZ(30px)",
          }}
        >

          {cities?.map(city => (

            <div
              key={city}
              className="
                rounded-full
                border
                border-white/10
                bg-white/[0.03]
                px-3
                py-1.5
                text-[9px]
                uppercase
                tracking-[0.18em]
                text-white/55
                backdrop-blur-md
              "
            >

              {city}

            </div>

          ))}

        </div>

      )}

    </motion.div>

  )
}