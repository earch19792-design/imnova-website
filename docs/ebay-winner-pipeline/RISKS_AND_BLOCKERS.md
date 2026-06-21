# RISKS_AND_BLOCKERS — eBay Winner Pipeline

## Riesgos técnicos detectados

| Riesgo | Evidencia | Mitigación |
|---|---|---|
| Duplicación de candidatos | Radar tiene múltiples variantes por producto y snapshots históricos. | `candidate_key` único por `source_id:product_id:supplier_variant_id`. |
| Ejecuciones repetidas | Sync manual puede reintentarse; snapshots no son idempotentes. | Pipeline debe consumir latest view y upsert, no insertar por snapshot sin clave. |
| Stock desactualizado | `inventory_quantity` puede ser null y depende de cookie Luna Portex. | Validar recencia de `last_captured_at`; bloquear si snapshot excede SLA. |
| Datos incompletos | UPC/GTIN/MPN, peso y dimensiones no están normalizados. | Estado `NEEDS_DATA` y checklist de enriquecimiento antes de draft. |
| Cálculos con nulos | Precio, compare_at, stock pueden ser null. | Cálculo de profit debe rechazar o usar assumptions explícitas versionadas. |
| Errores silenciosos | Varios warnings van a console; no hay tabla run log. | Agregar `ebay_winner_audit_log` y opcional `pipeline_runs`. |
| Falta observabilidad | Solo `last_error` por fuente Radar. | Métricas por etapa: detectados, validados, bloqueados, drafts. |
| Credenciales expuestas | Secretos por env; logs WhatsApp deben no incluir tokens/PII. | Sanitizar payloads, no loguear headers, remover fallbacks sensibles. |
| Operaciones no idempotentes | Drafts/decisiones no existen; podrían duplicarse. | Idempotency keys únicas para decisiones y drafts. |
| Acoplamiento con Radar | Modificar sync Luna Portex rompería dashboard. | Crear módulo nuevo que consuma vistas/tablas existentes. |
| Publicación accidental eBay | Futuro conector puede publicar si se mezcla con draft local. | Separar `DRAFT_CREATED` local de `PUBLISHED`; feature flag y sandbox obligatorio. |

## Bloqueadores de negocio/datos

1. Falta definición de margen mínimo, profit mínimo y precio objetivo.
2. Falta política de shipping/devoluciones/pagos para drafts.
3. Falta lista de marcas/categorías bloqueadas.
4. Falta estrategia para UPC/GTIN/MPN cuando proveedor no lo expone.
5. Falta decisión sobre marketplace eBay inicial y moneda.
6. Falta confirmar si Luna Portex permite uso de datos para listings eBay.
7. Falta flujo humano de aprobación: responsables, SLA y formato de decisión.

## Bloqueadores técnicos antes de producción

- Conector eBay no debe implementarse sin OAuth sandbox y scopes revisados.
- Webhook WhatsApp para decisiones requiere verificación Meta y endpoint seguro.
- Supabase RLS debe cubrir nuevas tablas antes de cualquier UI admin.
- Se necesita rollback probado de migraciones nuevas.
- Se necesita política explícita de no almacenar tokens eBay en tablas públicas.

## Señales de alerta para detener el pipeline

- `last_captured_at` supera el SLA definido para stock fresco.
- `price` es `null`, `0` o menor que el costo mínimo permitido.
- `inventory_quantity` es `null` y la política del negocio exige cantidad confirmada.
- Marca/categoría aparece en lista bloqueada o con riesgo VERO alto.
- Falta identificador requerido por categoría eBay y no existe excepción aprobada.
- WhatsApp devuelve error o no se obtiene `message_id` para trazabilidad.
- Se detecta intento de transición directa a `PUBLISHED` antes de habilitar sandbox/conector real.

## Decisiones humanas mínimas antes de implementar

1. Confirmar si el pipeline corre manualmente desde admin, por cron externo o ambos.
2. Definir SLA de frescura de stock: por ejemplo 15, 30 o 60 minutos.
3. Definir margen mínimo y profit mínimo por categoría.
4. Aprobar lista inicial de marcas/categorías bloqueadas.
5. Definir aprobadores WhatsApp y política si no responden.
6. Confirmar si los borradores locales pueden usar imágenes del proveedor o requieren assets propios.
