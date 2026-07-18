const recoverySteps = [
  {
    title: "Encender el entorno local",
    copy: "Inicia Windows y Ubuntu/WSL. El respaldo local no puede ejecutarse mientras esa máquina esté apagada.",
  },
  {
    title: "Verificar el respaldo",
    copy: "Usa el archivo cifrado más reciente junto con su fecha, manifiesto y checksum. Si la verificación falla, no continúes.",
  },
  {
    title: "Restaurar en infraestructura nueva",
    copy: "Crea un proyecto Supabase vacío y restaura roles, esquema, migraciones, datos y archivos autorizados. Nunca sobrescribas producción directamente.",
  },
  {
    title: "Validar Seller OS",
    copy: "Comprueba acceso Admin, conteos críticos, RLS, Product Research, listings vinculados, jobs, eBay, Luna y alertas sin activar escrituras.",
  },
  {
    title: "Autorizar el cambio",
    copy: "Sólo después de una validación satisfactoria se cambian las variables del deployment y se conserva el entorno anterior para rollback.",
  },
] as const

export function SellerOsDisasterRecoveryCard() {
  return (
    <aside
      data-seller-os-disaster-recovery
      aria-labelledby="disaster-recovery-heading"
      className="mt-4 rounded-2xl border border-amber-200/25 bg-amber-200/[0.06] p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-widest text-amber-100/65">Continuidad operativa</p>
          <h3 id="disaster-recovery-heading" className="mt-1 text-lg font-black">Recuperación ante fallos</h3>
        </div>
        <span className="rounded-full border border-amber-200/25 px-3 py-2 text-[10px] font-black uppercase text-amber-50">
          Restauración con aprobación
        </span>
      </div>

      <p className="mt-3 text-sm leading-6 text-white/70">
        La copia local protege la continuidad de Seller OS, pero restaurar no significa reemplazar inmediatamente el sistema activo.
        Primero se recupera en un entorno nuevo, se valida y luego Ernesto autoriza el cambio.
      </p>

      <details data-recovery-runbook className="mt-4 rounded-2xl border border-white/10 bg-black/25 p-4">
        <summary className="cursor-pointer font-black">Ver mecanismo de recuperación</summary>
        <ol className="mt-4 space-y-3">
          {recoverySteps.map((step, index) => (
            <li key={step.title} className="flex gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-amber-200 text-sm font-black text-black">
                {index + 1}
              </span>
              <div>
                <strong className="text-sm text-white">{step.title}</strong>
                <p className="mt-1 text-xs leading-5 text-white/60">{step.copy}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-4 grid gap-2 text-xs sm:grid-cols-3">
          <div className="rounded-xl bg-black/30 p-3"><span className="text-white/45">Respaldo</span><strong className="mt-1 block">Cifrado y fechado</strong></div>
          <div className="rounded-xl bg-black/30 p-3"><span className="text-white/45">Destino</span><strong className="mt-1 block">Base nueva y vacía</strong></div>
          <div className="rounded-xl bg-black/30 p-3"><span className="text-white/45">Cambio final</span><strong className="mt-1 block">Aprobación humana</strong></div>
        </div>

        <p role="note" className="mt-4 rounded-xl border border-rose-200/20 bg-rose-200/[0.06] p-3 text-xs leading-5 text-rose-50">
          Regla crítica: no restaurar sobre producción, no guardar secretos dentro del repositorio y no cambiar dominios hasta completar la validación y disponer de rollback.
        </p>
      </details>
    </aside>
  )
}
