"use client"

import { ChevronDown } from "lucide-react"

export function CategoryFilter({ categories, value, onChange }) {
  return (
    <div className="mx-auto mb-8 max-w-3xl">
      <label className="sr-only">Filtrar por categoría</label>
      <div className="relative inline-flex w-full items-center justify-between overflow-hidden rounded-3xl bg-gradient-to-r from-[#06202a] via-[#071728] to-[#020617] p-[2px] shadow-lg">
        <div className="flex w-full items-center justify-between gap-4 rounded-2xl bg-black/60 px-4 py-3">
          <div className="flex items-center gap-4">
            <div className="rounded-full bg-cyan-800/30 px-3 py-1 text-xs font-semibold text-cyan-300">Filtrar</div>
            <select
              value={value}
              onChange={(e) => onChange(e.target.value)}
              className="appearance-none bg-transparent pr-6 text-white placeholder-zinc-400 outline-none"
            >
              {categories.map((cat) => (
                <option key={cat} value={cat} className="bg-[#071018] text-white">{cat}</option>
              ))}
            </select>
          </div>
          <ChevronDown className="h-5 w-5 text-cyan-300" />
        </div>
      </div>
    </div>
  )
}

export default CategoryFilter
