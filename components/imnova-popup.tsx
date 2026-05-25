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
      // Validaciones
      if (!fullName || !phone) {
        alert("Completa nombre y teléfono");
        return;
      }

      if (selectedNiches.length === 0) {
        alert("Selecciona al menos un nicho");
        return;
      }

      setLoading(true);

      // Limpiar teléfono
      const cleanPhone = phone.replace(/\D/g, "").trim();

      console.log("PHONE:", cleanPhone);

      // Revisar duplicados
      const { data: existingUsers, error: checkError } = await supabase
        .from("subscribers")
        .select("id")
        .eq("telefono", cleanPhone);

      console.log("USERS:", existingUsers);
      console.log("CHECK ERROR:", checkError);

      if (checkError) {
        throw checkError;
      }

      // Si ya existe
      if (existingUsers && existingUsers.length > 0) {
        alert("Este número ya está registrado.");

        localStorage.setItem("innova-access", "true");

        setTimeout(() => {
          setIsOpen(false);
        }, 1000);

        return;
      }

      // Insertar usuario
      const { data, error } = await supabase
        .from("subscribers")
        .insert([
          {
            nombre: fullName,
            telefono: cleanPhone,
            email: email,
            nichos: selectedNiches,
          },
        ])
        .select();

      console.log("INSERT DATA:", data);
      console.log("INSERT ERROR:", error);

      if (error) {
        throw error;
      }

      // Éxito
      setSuccess(true);

      localStorage.setItem("innova-access", "true");

      setTimeout(() => {
        setIsOpen(false);
      }, 2200);

      // Limpiar form
      setFullName("");
      setPhone("");
      setEmail("");
      setSelectedNiches([]);

    } catch (err: any) {
      console.error("REAL ERROR:", err);

      alert(
        err?.message ||
        JSON.stringify(err) ||
        "Error guardando datos"
      );
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
            </div>
          </div>

          {/* RIGHT SIDE */}
          <div className="relative bg-[#050816] p-8 lg:p-12">
            <div className="relative z-10 mx-auto max-w-2xl">
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
                  className="w-full rounded-2xl border border-cyan-500/20 bg-black/30 px-6 py-5 text-white outline-none"
                />

                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Teléfono / WhatsApp"
                  className="w-full rounded-2xl border border-cyan-500/20 bg-black/30 px-6 py-5 text-white outline-none"
                />

                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email"
                  className="w-full rounded-2xl border border-cyan-500/20 bg-black/30 px-6 py-5 text-white outline-none"
                />
              </div>

              {/* NICHES */}
              <div className="mt-10 grid grid-cols-2 gap-5 lg:grid-cols-3">
                {niches.map((niche) => {
                  const active = selectedNiches.includes(niche.title);

                  return (
                    <button
                      key={niche.title}
                      onClick={() => toggleNiche(niche.title)}
                      className={`rounded-[28px] border p-5 text-left transition-all ${
                        active
                          ? "border-cyan-400 bg-cyan-500/15"
                          : "border-cyan-500/20 bg-black/30"
                      }`}
                    >
                      <div
                        className={`mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${niche.glow} text-xl`}
                      >
                        {niche.icon}
                      </div>

                      <h4 className="text-base font-bold text-white">
                        {niche.title}
                      </h4>

                      <p className="mt-2 text-sm text-slate-400">
                        {niche.subtitle}
                      </p>
                    </button>
                  );
                })}
              </div>

              {/* BUTTON */}
              <button
                onClick={handleSubmit}
                disabled={loading}
                className="mt-8 w-full rounded-3xl bg-gradient-to-r from-violet-600 via-fuchsia-500 to-cyan-500 px-8 py-6 text-2xl font-black text-white"
              >
                {loading ? "ACTIVANDO..." : "ACTIVAR ACCESO"}
              </button>

              {/* SUCCESS */}
              {success && (
                <div className="mt-5 rounded-2xl border border-green-500/30 bg-green-500/10 p-5 text-green-300">
                  ✅ Acceso activado correctamente.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}