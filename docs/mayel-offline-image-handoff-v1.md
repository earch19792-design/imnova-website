# Mayel: saved image proposals and deferred synchronization

The four-action menu now opens previously generated, authorized image proposals
from Seller OS storage even when eBay's Trading quota is unavailable. This closes
the missing handoff from the automated image generator into the existing Mayel
visual task, human review, atomic manifest and delegated execution path.

`READ → PREPARE_REVIEW → human fidelity confirmation → CONFIRM_QUEUE` uses only
staging database/storage. It never invokes eBay or another paid image generation.
The original generator experiment remains the provenance authority. Generated
assets are explicitly identified as `SELLER_OS_ASSISTANT_IMAGE_VARIANT`; they are
not mislabeled as manually uploaded ChatGPT subscription images.

If no task exists, the existing task producer can create a draft from the validated
generator's saved authorized source. Its identity is explicitly historical,
`SELLER_OS_SAVED_LISTING_VISUAL_DRAFT`. No new current-LIVE assertion or product
facts are fabricated. The subsequent official preflight remains mandatory.

The operator explicitly confirms replacing the main image and retaining the
secondary gallery. The existing atomic promotion is wrapped with a task lock and
expected-manifest comparison so concurrent reviews cannot silently overwrite each
other. Import replays reuse the durable variant asset ID. Approval replays retain
the stored manifest instead of reconstructing and resurrecting a removed image.

The existing scheduled delegated execution and safe-rebase paths consult official
Developer Analytics quota evidence before any Trading preflight. BLOCKED or
UNPROVEN leaves proposals pending without probing Trading. After OPEN, the normal
executor retains exact account/item/manifest binding, fresh official reads,
single-write claims, ambiguous-write protection and official readback. Work stays
bounded to three pending tasks and at most one listing write per execution run.
No new poller or background worker is introduced. Discovery excludes exact
completed manifests before its limit; previously completed tasks could occupy
all discovery slots and starve subsequent pending work.

This change does not certify arbitrary title/specifics/description writes or Ads.
Ads remain disabled. It also does not claim the total recurring application quota
consumption is solved: other monitor and economic acquisition callers still need
bounded attribution. No physical marketplace write is authorized for this change.

Validation covers source/account/item/hash/QA mismatch, human QA, origin admission,
legacy source compatibility, manifest compare-and-swap, completed-task starvation,
offline reload, blocked-quota preservation and mocked recovery through the
existing executor. Deployment/readback results are recorded separately after
validation; a mocked application is not a physical eBay application.

## Ayuda para Mayel

1. Entra en **Mejorar listings** y selecciona el producto.
2. Pulsa **Abrir mejoras guardadas**. Allí puedes comparar la imagen anterior con
   la propuesta, aunque eBay esté temporalmente sin consultas disponibles.
3. Pulsa **Preparar esta imagen para revisión**. Comprueba que sigue siendo el
   mismo producto y marca la confirmación sólo después de revisarlo.
4. Pulsa **Confirmar y enviar cuando eBay esté disponible**. La imagen queda
   guardada. No necesitas dejar el iPad abierto para que el sistema continúe.

**Borrador guardado** todavía no está confirmado. **Pendiente de sincronización**
significa que está confirmado pero falta verificarlo y enviarlo.
**Actualizado y verificado en eBay** aparece sólo tras la confirmación oficial de
eBay. Si la revisión detecta un conflicto, la propuesta se conserva para revisarla.
La publicidad sigue siendo una simulación: este botón no paga anuncios.
