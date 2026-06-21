# IMPLEMENTATION_PLAN_5_DAYS â€” Plan reversible e idempotente

## DÃ­a 1 â€” Schema y contratos

- Crear migraciÃ³n nueva solo con tablas `ebay_winner_*` y `ebay_listing_drafts`.
- Agregar constraints de estado, Ã­ndices, RLS admin-only y audit log.
- Definir tipos TypeScript en mÃ³dulo nuevo `lib/ebay-winner-pipeline/types.ts`.
- Crear normalizador de input desde `market_radar_latest_products`.
- Tests/checks: lint y validaciÃ³n SQL local si Supabase CLI estÃ¡ disponible.

Entregable: schema listo, sin tocar Radar productivo.

## DÃ­a 2 â€” Motor de candidatos y enriquecimiento local

- Crear servicio `detectCandidatesFromRadar` que lea `market_radar_latest_products`.
- Crear `candidate_key` estable por fuente/producto/variante.
- Upsert idempotente en `ebay_winner_candidates`.
- Calcular `needs_data` inicial: GTIN/MPN, peso, dimensiones, categorÃ­a, policy.
- Registrar audit log por transiciÃ³n.

Entregable: candidatos `DETECTED`/`ENRICHING`/`NEEDS_DATA` sin conector externo.

## DÃ­a 3 â€” Profit, compliance y Winner Score

- Implementar cÃ¡lculo de profit con assumptions configurables.
- Implementar compliance checklist inicial basado en datos internos/listas manuales.
- Calcular `winner_score` versionado y guardar breakdown.
- Estados: `VALIDATED` o `BLOCKED` segÃºn reglas.
- Manejar nulos con defaults explÃ­citos y razones de bloqueo/datos faltantes.

Entregable: candidatos priorizados y auditables.

## DÃ­a 4 â€” Decisiones WhatsApp y panel admin

- DiseÃ±ar template WhatsApp de aprobaciÃ³n sin publicar en eBay.
- Agregar endpoint admin para enviar solicitud de aprobaciÃ³n y registrar `APPROVAL_PENDING`.
- Agregar endpoint/webhook futuro para capturar decisiÃ³n; si no se habilita webhook, permitir decisiÃ³n manual en admin.
- Crear panel admin bÃ¡sico de candidatos, filtros por estado y detalle de datos faltantes.

Entregable: humano puede aprobar/rechazar/pausar de forma auditable.

## DÃ­a 5 â€” Draft local eBay y hardening

- Generar `ebay_listing_drafts` locales para candidatos `APPROVED`.
- No llamar API eBay ni crear publicaciones reales.
- Agregar pruebas de idempotencia: rerun no duplica candidatos/decisiones/drafts.
- Agregar run logs/errores estructurados.
- Documentar runbook, rollback y checklist para fase sandbox eBay.

Entregable: pipeline completo hasta `DRAFT_CREATED` local, reversible y sin deploy automÃ¡tico.

## Criterios de aceptaciÃ³n

- Ninguna tabla/ruta/job existente eliminada o renombrada.
- Ninguna publicaciÃ³n real eBay.
- Reejecutar detecciÃ³n no duplica candidatos.
- Reejecutar aprobaciÃ³n/draft con mismo idempotency key no duplica registros.
- Todo cambio de estado tiene audit log.
- Datos faltantes no rompen cÃ¡lculos; generan `NEEDS_DATA` o `BLOCKED` con razÃ³n.
