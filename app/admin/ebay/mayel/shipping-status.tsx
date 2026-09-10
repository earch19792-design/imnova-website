"use client"
import { projectMayelShippingVisibilityV1, type MayelShippingSnapshotV1 } from "@/lib/seller-os/mayel-shipping-visibility-v1"
export function MayelShippingStatus({ snapshot }: { snapshot: MayelShippingSnapshotV1 | null }) {
 const state = projectMayelShippingVisibilityV1(snapshot)
 return <aside aria-label="Estado de Shipping" className="rounded-2xl border border-[#d9d1c4] bg-white p-5">
   <h2 className="font-semibold">Conexión y Shipping</h2>
   <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3" aria-live="polite">{[
     ["eBay",state.ebay],["Extensión Luna",state.extension],["Captura Shipping",state.capture],
     ["Shipping",state.shipping],["Auto-reanudación",state.autoResume],["Última observación",state.lastObservation],
   ].map(([label,value])=><div key={label}><dt className="text-[#64675f]">{label}</dt><dd className="font-semibold">{value}</dd></div>)}</dl>
   <p className="mt-3 text-sm">Estado de los listings mostrados. {state.autoResume === "ACTIVO" ? "La actualización automática está habilitada para el trabajo elegible." : "Tu trabajo sigue guardado. La actualización continuará cuando haya capacidad disponible."}</p>
   {state.economicsReevaluated && <p className="mt-2 text-sm">Economía reevaluada con el Shipping vigente.</p>}
   <details className="mt-3"><summary className="cursor-pointer text-sm">Ver detalles</summary>
     <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify({ECONOMICS_REEVALUATED:state.economicsReevaluated,rows:state.rows,authority:snapshot},null,2)}</pre>
   </details>
 </aside>
}
export function MayelListingShippingStatus({ snapshot, itemId }: { snapshot: MayelShippingSnapshotV1 | null; itemId: string }) {
 const row=projectMayelShippingVisibilityV1(snapshot).rows.find(r=>r.itemId===itemId)
 return <span className="block text-sm">{row?.fresh ? "Shipping ✅ Vigente" : "Shipping ⏳ Esperando actualización"}</span>
}
