# IMPLEMENTATION_PLAN_5_DAYS — Plan reversible e idempotente

## Día 1 — Schema y contratos

- Crear migración nueva solo con tablas `ebay_winner_*` y `ebay_listing_drafts`.
- Agregar constraints de estado, índices, RLS admin-only y audit log.
- Definir tipos TypeScript en módulo nuevo `lib/ebay-winner-pipeline/types.ts`.
- Crear normalizador de input desde `market_radar_latest_products`.
- Tests/checks: lint y validación SQL local si Supabase CLI está disponible.

Entregable: schema listo, sin tocar Radar productivo.

## Día 2 — Motor de candidatos y enriquecimiento local

- Crear servicio `detectCandidatesFromRadar` que lea `market_radar_latest_products`.
- Crear `candidate_key` estable por fuente/producto/variante.
- Upsert idempotente en `ebay_winner_candidates`.
- Calcular `needs_data` inicial: GTIN/MPN, peso, dimensiones, categoría, policy.
- Registrar audit log por transición.

Entregable: candidatos `DETECTED`/`ENRICHING`/`NEEDS_DATA` sin conector externo.

## Día 3 — Profit, compliance y Winner Score

- Implementar cálculo de profit con assumptions configurables.
- Implementar compliance checklist inicial basado en datos internos/listas manuales.
- Calcular `winner_score` versionado y guardar breakdown.
- Estados: `VALIDATED` o `BLOCKED` según reglas.
- Manejar nulos con defaults explícitos y razones de bloqueo/datos faltantes.

Entregable: candidatos priorizados y auditables.

## Día 4 — Decisiones WhatsApp y panel admin

- Diseñar template WhatsApp de aprobación sin publicar en eBay.
- Agregar endpoint admin para enviar solicitud de aprobación y registrar `APPROVAL_PENDING`.
- Agregar endpoint/webhook futuro para capturar decisión; si no se habilita webhook, permitir decisión manual en admin.
- Crear panel admin básico de candidatos, filtros por estado y detalle de datos faltantes.

Entregable: humano puede aprobar/rechazar/pausar de forma auditable.

## Día 5 — Draft local eBay y hardening

- Generar `ebay_listing_drafts` locales para candidatos `APPROVED`.
- No llamar API eBay ni crear publicaciones reales.
- Agregar pruebas de idempotencia: rerun no duplica candidatos/decisiones/drafts.
- Agregar run logs/errores estructurados.
- Documentar runbook, rollback y checklist para fase sandbox eBay.

Entregable: pipeline completo hasta `DRAFT_CREATED` local, reversible y sin deploy automático.

## Criterios de aceptación

- Ninguna tabla/ruta/job existente eliminada o renombrada.
- Ninguna publicación real eBay.
- Reejecutar detección no duplica candidatos.
- Reejecutar aprobación/draft con mismo idempotency key no duplica registros.
- Todo cambio de estado tiene audit log.
- Datos faltantes no rompen cálculos; generan `NEEDS_DATA` o `BLOCKED` con razón.
