"use client"

import Image from "next/image"
import { motion } from "framer-motion"

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

  return (

    <motion.div
      animate={{
        y: [0, -15, 0],
        x: [0, 8, 0],
      }}
      transition={{
        duration: 6,
        repeat: Infinity,
        ease: "easeInOut",
      }}
      className="
      absolute
      relative
      flex
        flex-col
        items-center
        gap-3
      "
    >

      <div
        className="
          relative
          flex
          h-24
          w-24
          items-center
          justify-center
          rounded-full
          border
          border-cyan-400/30
          bg-cyan-400/10
          backdrop-blur-2xl
          shadow-[0_0_40px_rgba(0,255,255,0.25)]
        "
      >

        {status === "🌎 Comercialización" ? (

          <Image
            src={image || ""}
            alt={name}
            width={70}
            height={70}
            className="
              object-contain
              drop-shadow-[0_0_20px_rgba(0,255,255,0.45)]
            "
          />

        ) : (

          <div
  className="
    max-w-[140px]
    text-center
    text-xs
    font-bold
    uppercase
    leading-tight
    tracking-[0.15em]
    text-white
  "
>
  {name}
</div>

        )}

      </div>

      <div
        className="
          text-center
        "
      >

        <div
          className="
           text-xs
          font-bold
            uppercase
            tracking-[0.15em]
            text-white
          "
        >
          {name}
        </div>

        <div
          className="
            mt-1
            text-xs
            text-cyan-300
          "
        >
          {status}
        </div>

      </div>

      {status === "🌎 Comercialización" && (

        <div
          className="
            flex
            flex-wrap
            justify-center
            gap-2
         max-w-[120px]
          "
        >

          {cities?.map(city => (

            <div
              key={city}
              className="
                rounded-full
                border
                border-cyan-400/20
                bg-cyan-400/10
                px-2
                py-1
                text-[10px]
                uppercase
                tracking-[0.15em]
                text-cyan-200
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