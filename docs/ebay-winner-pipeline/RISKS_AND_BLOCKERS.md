# RISKS_AND_BLOCKERS â€” eBay Winner Pipeline

## Riesgos tÃ©cnicos detectados

| Riesgo | Evidencia | MitigaciÃ³n |
|---|---|---|
| DuplicaciÃ³n de candidatos | Radar tiene mÃºltiples variantes por producto y snapshots histÃ³ricos. | `candidate_key` Ãºnico por `source_id:product_id:supplier_variant_id`. |
| Ejecuciones repetidas | Sync manual puede reintentarse; snapshots no son idempotentes. | Pipeline debe consumir latest view y upsert, no insertar por snapshot sin clave. |
| Stock desactualizado | `inventory_quantity` puede ser null y depende de cookie Luna Portex. | Validar recencia de `last_captured_at`; bloquear si snapshot excede SLA. |
| Datos incompletos | UPC/GTIN/MPN, peso y dimensiones no estÃ¡n normalizados. | Estado `NEEDS_DATA` y checklist de enriquecimiento antes de draft. |
| CÃ¡lculos con nulos | Precio, compare_at, stock pueden ser null. | CÃ¡lculo de profit debe rechazar o usar assumptions explÃ­citas versionadas. |
| Errores silenciosos | Varios warnings van a console; no hay tabla run log. | Agregar `ebay_winner_audit_log` y opcional `pipeline_runs`. |
| Falta observabilidad | Solo `last_error` por fuente Radar. | MÃ©tricas por etapa: detectados, validados, bloqueados, drafts. |
| Credenciales expuestas | Secretos por env; logs WhatsApp deben no incluir tokens/PII. | Sanitizar payloads, no loguear headers, remover fallbacks sensibles. |
| Operaciones no idempotentes | Drafts/decisiones no existen; podrÃ­an duplicarse. | Idempotency keys Ãºnicas para decisiones y drafts. |
| Acoplamiento con Radar | Modificar sync Luna Portex romperÃ­a dashboard. | Crear mÃ³dulo nuevo que consuma vistas/tablas existentes. |
| PublicaciÃ³n accidental eBay | Futuro conector puede publicar si se mezcla con draft local. | Separar `DRAFT_CREATED` local de `PUBLISHED`; feature flag y sandbox obligatorio. |

## Bloqueadores de negocio/datos

1. Falta definiciÃ³n de margen mÃ­nimo, profit mÃ­nimo y precio objetivo.
2. Falta polÃ­tica de shipping/devoluciones/pagos para drafts.
3. Falta lista de marcas/categorÃ­as bloqueadas.
4. Falta estrategia para UPC/GTIN/MPN cuando proveedor no lo expone.
5. Falta decisiÃ³n sobre marketplace eBay inicial y moneda.
6. Falta confirmar si Luna Portex permite uso de datos para listings eBay.
7. Falta flujo humano de aprobaciÃ³n: responsables, SLA y formato de decisiÃ³n.

## Bloqueadores tÃ©cnicos antes de producciÃ³n

- Conector eBay no debe implementarse sin OAuth sandbox y scopes revisados.
- Webhook WhatsApp para decisiones requiere verificaciÃ³n Meta y endpoint seguro.
- Supabase RLS debe cubrir nuevas tablas antes de cualquier UI admin.
- Se necesita rollback probado de migraciones nuevas.
- Se necesita polÃ­tica explÃ­cita de no almacenar tokens eBay en tablas pÃºblicas.

## SeÃ±ales de alerta para detener el pipeline

- `last_captured_at` supera el SLA definido para stock fresco.
- `price` es `null`, `0` o menor que el costo mÃ­nimo permitido.
- `inventory_quantity` es `null` y la polÃ­tica del negocio exige cantidad confirmada.
- Marca/categorÃ­a aparece en lista bloqueada o con riesgo VERO alto.
- Falta identificador requerido por categorÃ­a eBay y no existe excepciÃ³n aprobada.
- WhatsApp devuelve error o no se obtiene `message_id` para trazabilidad.
- Se detecta intento de transiciÃ³n directa a `PUBLISHED` antes de habilitar sandbox/conector real.

## Decisiones humanas mÃ­nimas antes de implementar

1. Confirmar si el pipeline corre manualmente desde admin, por cron externo o ambos.
2. Definir SLA de frescura de stock: por ejemplo 15, 30 o 60 minutos.
3. Definir margen mÃ­nimo y profit mÃ­nimo por categorÃ­a.
4. Aprobar lista inicial de marcas/categorÃ­as bloqueadas.
5. Definir aprobadores WhatsApp y polÃ­tica si no responden.
6. Confirmar si los borradores locales pueden usar imÃ¡genes del proveedor o requieren assets propios.
