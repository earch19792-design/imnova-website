"use client"

/* 
================================================
MENÚ PRINCIPAL
SECCIÓN: INNOVACIONES
COMPONENTE: InnovationsSection
================================================
*/

import Image from "next/image"
import Link from "next/link"
import { motion } from "framer-motion"

import {
  Sparkles,
  ArrowUpRight,
} from "lucide-react"

import products from "../lib/products"

export function InnovationsSection() {
  return (
    <section
      id="innovations"
      className="
        relative
        isolate
        overflow-hidden
        bg-gradient-to-b
        from-[#020617]
        via-black
        to-black
        py-44
        md:py-52
      "
    >

      {/* =================================================
      BACKGROUND EFFECTS
      ================================================= */}

      {/* Main Glow */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(0,255,255,0.08),transparent_50%)]" />

      {/* Ambient Glow Top */}
      <div className="pointer-events-none absolute left-1/2 top-0 h-[700px] w-[700px] -translate-x-1/2 rounded-full bg-cyan-500/10 blur-[180px]" />

      {/* Ambient Glow Left */}
      <div className="pointer-events-none absolute left-0 top-1/3 h-[500px] w-[500px] rounded-full bg-cyan-400/5 blur-[140px]" />

      {/* Ambient Glow Right */}
      <div className="pointer-events-none absolute bottom-0 right-0 h-[600px] w-[600px] rounded-full bg-blue-500/5 blur-[160px]" />

      {/* Grid Overlay */}
      <div className="absolute inset-0 opacity-[0.02] bg-[linear-gradient(rgba(0,255,255,0.10)_1px,transparent_1px),linear-gradient(90deg,rgba(0,255,255,0.10)_1px,transparent_1px)] bg-[size:90px_90px]" />

      {/* Divider */}
      <div className="absolute left-0 right-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

      <div className="relative z-10 mx-auto max-w-7xl px-6">

        {/* =================================================
        HEADER
        ================================================= */}

        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9 }}
          viewport={{ once: true }}
          className="mb-28 text-center"
        >

          {/* Badge */}
          <div className="inline-flex items-center gap-3 rounded-full border border-cyan-400/20 bg-white/[0.04] px-6 py-3 backdrop-blur-2xl">

            <span className="text-cyan-300">
              ✦
            </span>

            <span className="text-xs uppercase tracking-[0.45em] text-cyan-300">

              IMNOVA ECOSYSTEM

            </span>

          </div>

          {/* Title */}
          <h2 className="mx-auto mt-10 max-w-6xl text-5xl font-black leading-[1.02] tracking-[-0.05em] text-white sm:text-6xl lg:text-7xl">

            Diseñamos el futuro{" "}

            <span className="bg-gradient-to-r from-cyan-200 via-blue-300 to-white bg-clip-text text-transparent">

              a través de innovación real.

            </span>

          </h2>

          {/* Divider */}
          <div className="mx-auto mt-10 h-[2px] w-28 rounded-full bg-white/10" />

          {/* Description */}
          <p className="mx-auto mt-10 max-w-4xl text-xl leading-9 text-zinc-300">

            Nutrición funcional, tecnología inteligente
            y productos premium desarrollados para redefinir
            la manera en que las personas viven,
            consumen y evolucionan.

          </p>

        </motion.div>

        {/* =================================================
        PRODUCT GRID
        ================================================= */}

        <div className="grid gap-10 lg:grid-cols-3">

          {products.slice(0, 3).map((product, index) => (

            <motion.article
              key={product.id}
              initial={{ opacity: 0, y: 50 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.7,
                delay: index * 0.15,
              }}
              viewport={{ once: true }}
              whileHover={{
                y: -12,
              }}
              className="
                group
                relative
                overflow-hidden
                rounded-[40px]
                border
                border-white/10
                bg-white/[0.04]
                p-7
                backdrop-blur-2xl
                transition-all
                duration-700
                hover:border-cyan-300/30
                hover:bg-white/[0.05]
                hover:shadow-[0_0_140px_rgba(34,211,238,0.10)]
              "
            >

              {/* Hover Gradient */}
              <div className="pointer-events-none absolute inset-0 opacity-0 transition duration-700 group-hover:opacity-100">

                <div className="absolute inset-0 bg-gradient-to-br from-cyan-400/10 via-transparent to-blue-500/10" />

              </div>

              {/* Glow Orb */}
              <div className="absolute right-0 top-0 h-52 w-52 rounded-full bg-cyan-400/10 blur-[120px] opacity-0 transition-opacity duration-700 group-hover:opacity-100" />

              {/* =================================================
              TOP BAR
              ================================================= */}

              <div className="relative z-10 mb-6 flex items-center justify-between">

                {/* Category */}
                <span
                  className="
                    rounded-full
                    border
                    border-cyan-400/20
                    bg-cyan-400/10
                    px-4
                    py-2
                    text-[11px]
                    uppercase
                    tracking-[0.35em]
                    text-cyan-300
                    backdrop-blur-xl
                  "
                >

                  {product.category}

                </span>

                {/* Icon */}
                <Sparkles
                  className="
                    h-5
                    w-5
                    text-cyan-300
                    transition-all
                    duration-500
                    group-hover:rotate-12
                    group-hover:scale-125
                  "
                />

              </div>

              {/* =================================================
              IMAGE CONTAINER
              ================================================= */}

              <div
                className="
                  relative
                  overflow-hidden
                  rounded-[32px]
                  border
                  border-white/10
                  bg-black/40
                  p-8
                  backdrop-blur-xl
                "
              >

                {/* Glow */}
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-cyan-400/10 via-transparent to-transparent opacity-70 transition duration-700 group-hover:scale-110" />

                {/* Background Orb */}
                <div className="absolute inset-0 flex items-center justify-center">

                  <div className="h-[240px] w-[240px] rounded-full bg-cyan-400/10 blur-[100px]" />

                </div>

                {/* Image */}
                <div className="relative flex h-[360px] items-center justify-center">

                  <Image
                    src={product.image}
                    alt={product.name}
                    width={420}
                    height={420}
                    className={`
                      relative
                      z-10
                      h-full
                      w-auto
                      object-contain
                      transition-all
                      duration-700
                      group-hover:-translate-y-3
                      group-hover:scale-110
                      ${
                        product.slug === "mash-coffee"
                          ? "scale-[1.45]"
                          : "scale-100"
                      }
                    `}
                  />

                </div>

              </div>

              {/* =================================================
              CONTENT
              ================================================= */}

              <div className="relative z-10 mt-8 flex flex-col">

                {/* Product Name */}
                <h3
                  className="
                    text-4xl
                    font-black
                    tracking-[-0.04em]
                    text-white
                    transition
                    duration-500
                    group-hover:text-cyan-200
                  "
                >

                  {product.name}

                </h3>

                {/* Description */}
                <p className="mt-5 text-lg leading-8 text-zinc-400">

                  {product.description}

                </p>

                {/* CTA */}
                <Link
                  href={`/store/${product.slug}`}
                  className="
                    mt-8
                    inline-flex
                    items-center
                    justify-center
                    gap-3
                    rounded-2xl
                    border
                    border-cyan-400/20
                    bg-cyan-400/10
                    px-6
                    py-4
                    text-sm
                    font-black
                    uppercase
                    tracking-[0.2em]
                    text-cyan-200
                    backdrop-blur-xl
                    transition-all
                    duration-500
                    hover:scale-[1.03]
                    hover:border-cyan-300/40
                    hover:bg-cyan-300/20
                    hover:shadow-[0_0_60px_rgba(34,211,238,0.18)]
                  "
                >

                  Explorar Innovación

                  <ArrowUpRight className="h-4 w-4" />

                </Link>

              </div>

              {/* Border Glow */}
              <div className="absolute inset-0 rounded-[40px] border border-cyan-400/0 transition-colors duration-700 group-hover:border-cyan-400/20" />

            </motion.article>

          ))}

        </div>

        {/* =================================================
        BOTTOM INDICATORS
        ================================================= */}

        <div className="mt-24 flex flex-wrap items-center justify-center gap-6 text-center text-xs uppercase tracking-[0.3em] text-zinc-600">

          <span>Innovación</span>
          <span>•</span>

          <span>Wellness</span>
          <span>•</span>

          <span>Tecnología Inteligente</span>
          <span>•</span>

          <span>Expansión Global</span>

        </div>

      </div>

    </section>
  )
}