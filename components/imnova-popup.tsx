"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function InnovaPopup() {
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  const [selectedNiches, setSelectedNiches] = useState<string[]>([]);

  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
 useEffect(() => {

  setMounted(true);

  const hasAccess = localStorage.getItem("innova-access");

  if (hasAccess !== "true") {
    setIsOpen(true);
  }

}, []);
  const niches = [
    {
      title: "Performance",
      subtitle: "Fitness, entrenamiento y bienestar",
      icon: "🏋️",
      glow: "from-green-400 to-emerald-500",
    },
    {
      title: "Future Tech",
      subtitle: "Tecnología, gadgets e innovación",
      icon: "⚡",
      glow: "from-cyan-400 to-blue-500",
    },
    {
      title: "Functional Drinks",
      subtitle: "Bebidas funcionales y energía",
      icon: "☕",
      glow: "from-yellow-400 to-orange-500",
    },
    {
      title: "Smart Living",
      subtitle: "Hogar inteligente y organización",
      icon: "🏠",
      glow: "from-sky-400 to-cyan-500",
    },
    {
      title: "Exclusive Deals",
      subtitle: "Ofertas especiales para miembros",
      icon: "🔥",
      glow: "from-orange-400 to-red-500",
    },
  ];

  const toggleNiche = (title: string) => {
    setSelectedNiches((prev) =>
      prev.includes(title)
        ? prev.filter((item) => item !== title)
        : [...prev, title]
    );
  };

  const handleSubmit = async () => {
    try {
      if (!fullName || !phone) {
        alert("Completa nombre y teléfono");
        return;
      }

      if (selectedNiches.length === 0) {
        alert("Selecciona al menos un nicho");
        return;
      }
      const cleanPhone = phone
  .replace(/\D/g, "")
  .trim();

setLoading(true);

const { data: existingUsers, error: checkError } = await supabase
  .from("subscribers")
  .select("id")
  .eq("telefono", cleanPhone);

console.log("PHONE:", cleanPhone);
console.log("USERS:", existingUsers);
console.log("ERROR:", checkError);

if (checkError) {
  console.error(checkError);
}

if (existingUsers && existingUsers.length > 0) {

  alert("Este número ya está registrado.");

  localStorage.setItem("innova-access", "true");

  setLoading(false);

  setTimeout(() => {
    setIsOpen(false);
  }, 1000);

  return;
}
      const { error } = await supabase
        .from("subscribers")
        .insert([
          {
  nombre: fullName,
  telefono: cleanPhone,
  email: email,
  nichos: [...selectedNiches],
}
        ]);

      if (error) {
        throw error;
      }

      setSuccess(true);
  localStorage.setItem("innova-access", "true");

setTimeout(() => {
  setIsOpen(false);
}, 2200);
      setFullName("");
      setPhone("");
      setEmail("");
      setSelectedNiches([]);

    } catch (err) {
      console.error(err);
      alert("Error guardando datos");
    } finally {
      setLoading(false);
    }
  };
if (!mounted) return null;

if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-auto bg-black/80 p-4 backdrop-blur-sm">

      <div
        className="
          relative
          w-full
          max-w-7xl
          max-h-[95vh]
          overflow-y-auto
          overflow-x-hidden
          rounded-[36px]
          border
          border-cyan-500/30
          bg-[#030712]
          shadow-[0_0_80px_rgba(59,130,246,0.35)]
        "
      >

        {/* CLOSE */}
        <button
          onClick={() => window.location.reload()}
          className="absolute right-6 top-5 z-20 text-4xl text-white/80 transition hover:text-white"
        >
          ×
        </button>

        <div className="grid min-h-[640px] lg:grid-cols-2">

          {/* LEFT SIDE */}
          <div className="relative overflow-hidden border-r border-cyan-500/20 bg-[radial-gradient(circle_at_top,#0f172a,#020617)] p-8 lg:p-12">

            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,#3b82f6_0%,transparent_70%)] opacity-20" />

            <div className="relative z-10">

              {/* LOGO */}
              <div className="mb-8 flex items-center gap-4">

                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400 to-violet-500 text-3xl font-black text-white shadow-[0_0_25px_rgba(59,130,246,0.7)]">
                  N
                </div>

                <div>
                  <h1 className="text-4xl font-black tracking-wide text-white">
                    INNOVA
                  </h1>

                  <p className="text-sm uppercase tracking-[0.25em] text-cyan-400">
                    Club
                  </p>
                </div>
              </div>

              {/* HERO */}
              <div className="max-w-xl">

                <div className="mb-4 inline-flex items-center rounded-full border border-violet-500/40 bg-violet-500/10 px-4 py-2 text-sm text-violet-300 backdrop-blur-md">
                  ✦ Acceso Exclusivo
                </div>

                <h2 className="text-4xl font-black leading-tight text-white sm:text-5xl lg:text-7xl">
                  Entrá al futuro

                  <span className="block bg-gradient-to-r from-violet-400 to-cyan-400 bg-clip-text text-transparent">
                    de las compras
                  </span>

                  inteligentes.
                </h2>

                <p className="mt-6 max-w-md text-lg leading-relaxed text-slate-300">
                  Accedé antes que todos a productos innovadores,
                  lanzamientos premium y experiencias seleccionadas
                  inteligentemente para vos.
                </p>

              </div>

              {/* PRODUCTS */}
              <div className="relative mt-14 flex flex-wrap items-end justify-center gap-6 rounded-[32px] border border-cyan-500/20 bg-black/30 p-8 backdrop-blur-xl">

                <div className="absolute inset-0 rounded-[32px] bg-[radial-gradient(circle_at_center,#3b82f6_0%,transparent_70%)] opacity-20" />

                {/* PANCAKE */}
                <img
                  src="/images/mash-nutri+-PANCAKE.png"
                  alt="Mash Pancake"
                  className="relative z-10 w-24 rounded-2xl shadow-2xl transition hover:scale-105 lg:w-32"
                />

                {/* PAN */}
                <img
                  src="/images/mash-nutri+-PAN.png"
                  alt="Mash Pan"
                  className="relative z-10 w-28 rounded-2xl shadow-2xl transition hover:scale-105 lg:w-36"
                />

                {/* COFFEE */}
                <img
                  src="/images/mash-coffee.png"
                  alt="Mash Coffee"
                  className="relative z-10 w-36 rounded-2xl shadow-2xl transition hover:scale-105 lg:w-52"
                />

              </div>

              {/* FEATURES */}
              <div className="mt-10 grid grid-cols-2 gap-4 lg:grid-cols-4">

                {[
                  "Acceso anticipado",
                  "Ofertas exclusivas",
                  "Contenido premium",
                  "IA inteligente",
                ].map((item) => (

                  <div
                    key={item}
                    className="rounded-2xl border border-cyan-500/20 bg-white/5 p-4 text-center text-sm text-slate-200 backdrop-blur-md"
                  >
                    {item}
                  </div>

                ))}

              </div>

            </div>
          </div>

          {/* RIGHT SIDE */}
          <div className="relative bg-[#050816] p-8 lg:p-12">

            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,#8b5cf6_0%,transparent_70%)] opacity-10" />

            <div className="relative z-10 mx-auto max-w-2xl">

              {/* TITLE */}
              <div className="mb-10">

                <h2 className="text-4xl font-black text-white lg:text-5xl">
                  ÚNETE A

                  <span className="bg-gradient-to-r from-violet-400 to-cyan-400 bg-clip-text text-transparent">
                    {" "}INNOVA CLUB
                  </span>

                </h2>

                <p className="mt-4 text-lg text-slate-300">
                  Completá tus datos y activá tu acceso exclusivo.
                </p>

              </div>

              {/* FORM */}
              <div className="space-y-5">

                <input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Nombre completo"
                  className="w-full rounded-2xl border border-cyan-500/20 bg-black/30 px-6 py-5 text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/40 backdrop-blur-xl"
                />

                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Teléfono / WhatsApp"
                  className="w-full rounded-2xl border border-cyan-500/20 bg-black/30 px-6 py-5 text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/40 backdrop-blur-xl"
                />

                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email"
                  className="w-full rounded-2xl border border-cyan-500/20 bg-black/30 px-6 py-5 text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/40 backdrop-blur-xl"
                />

              </div>

              {/* NICHES */}
              <div className="mt-10">

                <h3 className="mb-3 text-center text-2xl font-black tracking-wide text-white">
                  ELEGÍ LOS UNIVERSOS QUE MÁS TE INTERESAN
                </h3>

                <p className="mb-10 text-center text-sm text-slate-400">
                  Personalizaremos tu experiencia según tus intereses.
                </p>

                <div className="grid grid-cols-2 gap-5 lg:grid-cols-3">

                  {niches.map((niche) => {

                    const active = selectedNiches.includes(niche.title);

                    return (
                      <button
                        key={niche.title}
                        onClick={() => toggleNiche(niche.title)}
                        className={`
                          group
                          relative
                          overflow-hidden
                          rounded-[28px]
                          border
                          p-5
                          text-left
                          transition-all
                          duration-300
                          backdrop-blur-xl
                          hover:-translate-y-1
                          hover:shadow-[0_0_30px_rgba(34,211,238,0.18)]
                          ${
                            active
                              ? "border-cyan-400 bg-cyan-500/15 shadow-[0_0_35px_rgba(34,211,238,0.25)]"
                              : "border-cyan-500/20 bg-black/30 hover:border-cyan-400/70"
                          }
                        `}
                      >

                        {/* Glow Background */}
                        <div className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 bg-[radial-gradient(circle_at_top,#22d3ee22,transparent_70%)]" />

                        {/* Icon */}
                        <div
                          className={`
                            relative
                            z-10
                            mb-4
                            flex
                            h-12
                            w-12
                            items-center
                            justify-center
                            rounded-2xl
                            bg-gradient-to-br
                            ${niche.glow}
                            text-xl
                            shadow-xl
                          `}
                        >
                          {niche.icon}
                        </div>

                        {/* Title */}
                        <h4 className="relative z-10 text-base lg:text-lg font-bold text-white">
                          {niche.title}
                        </h4>

                        {/* Subtitle */}
                        <p className="relative z-10 mt-2 text-xs lg:text-sm leading-relaxed text-slate-400">
                          {niche.subtitle}
                        </p>

                        {/* Bottom Glow */}
                        <div
                          className={`
                            absolute
                            bottom-0
                            left-0
                            h-[2px]
                            w-full
                            bg-gradient-to-r
                            ${niche.glow}
                            opacity-60
                          `}
                        />

                      </button>
                    );
                  })}
                </div>

              </div>

              {/* AI NOTICE */}
              <div className="mt-8 rounded-2xl border border-violet-500/20 bg-violet-500/10 px-5 py-4 text-sm text-violet-200 backdrop-blur-md">
                ✦ Analizando tus intereses para personalizar tu experiencia...
              </div>

              {/* BUTTON */}
              <button
                onClick={handleSubmit}
                disabled={loading}
                className="mt-8 w-full rounded-3xl bg-gradient-to-r from-violet-600 via-fuchsia-500 to-cyan-500 px-8 py-6 text-2xl font-black tracking-wide text-white shadow-[0_0_40px_rgba(139,92,246,0.6)] transition hover:scale-[1.01] disabled:opacity-50"
              >
                {loading ? "ACTIVANDO..." : "ACTIVAR ACCESO"}
              </button>

              {/* SUCCESS */}
              {success && (
                <div className="mt-5 rounded-2xl border border-green-500/30 bg-green-500/10 p-5 text-green-300">
                  ✅ Acceso activado correctamente.
                </div>
              )}

              {/* FOOTER */}
              <div className="mt-8 flex flex-wrap items-center justify-center gap-6 text-sm text-slate-400">
                <span>✔ Acceso inmediato</span>
                <span>✔ Sin spam</span>
                <span>✔ Cancelá cuando quieras</span>
              </div>

            </div>
          </div>
        </div>
      </div>
    </div>
  );
}