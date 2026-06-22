# PROPOSED_STATE_MACHINE â€” eBay Winner Pipeline

## Estados permitidos

- `DETECTED`: candidato identificado desde Radar.
- `ENRICHING`: se estÃ¡n normalizando/enriqueciendo datos.
- `NEEDS_DATA`: faltan datos obligatorios recuperables.
- `BLOCKED`: no puede avanzar por restricciÃ³n dura o riesgo.
- `VALIDATED`: datos, compliance y profit pasaron reglas mÃ­nimas.
- `APPROVAL_PENDING`: enviado a aprobaciÃ³n humana/WhatsApp.
- `APPROVED`: aprobado para crear draft local.
- `DRAFT_CREATED`: borrador local eBay creado; no publicado.
- `PUBLISHED`: reservado para fase futura con eBay real.
- `PAUSED`: detenido manualmente o por condiciÃ³n temporal.
- `REJECTED`: rechazado por humano o regla de negocio.

## Diagrama

```mermaid
stateDiagram-v2
  [*] --> DETECTED
  DETECTED --> ENRICHING
  ENRICHING --> NEEDS_DATA
  NEEDS_DATA --> ENRICHING
  ENRICHING --> BLOCKED
  ENRICHING --> VALIDATED
  VALIDATED --> APPROVAL_PENDING
  APPROVAL_PENDING --> APPROVED
  APPROVAL_PENDING --> REJECTED
  APPROVAL_PENDING --> PAUSED
  PAUSED --> ENRICHING
  APPROVED --> DRAFT_CREATED
  DRAFT_CREATED --> PUBLISHED
  DRAFT_CREATED --> PAUSED
  BLOCKED --> [*]
  REJECTED --> [*]
```

## Transiciones idempotentes

| TransiciÃ³n | CondiciÃ³n | Idempotency key sugerida |
|---|---|---|
| `DETECTED` | `candidate_key` no existe | `detect:{candidate_key}` |
| `DETECTED â†’ ENRICHING` | Candidato creado o actualizado | `enrich:{candidate_id}:{snapshot_id}` |
| `ENRICHING â†’ NEEDS_DATA` | `missing_fields` no vacÃ­o | `needs-data:{candidate_id}:{validation_version}` |
| `ENRICHING â†’ BLOCKED` | Compliance duro falla | `blocked:{candidate_id}:{check_version}` |
| `ENRICHING â†’ VALIDATED` | ValidaciÃ³n + compliance + profit pasan | `validated:{candidate_id}:{score_version}` |
| `VALIDATED â†’ APPROVAL_PENDING` | Mensaje WhatsApp/admin enviado | `approval-request:{candidate_id}:{message_template_version}` |
| `APPROVAL_PENDING â†’ APPROVED` | DecisiÃ³n humana approve | `decision:{candidate_id}:{message_id}:approve` |
| `APPROVAL_PENDING â†’ REJECTED` | DecisiÃ³n humana reject | `decision:{candidate_id}:{message_id}:reject` |
| `APPROVED â†’ DRAFT_CREATED` | Draft local generado | `draft:{candidate_id}:{draft_version}` |
| `DRAFT_CREATED â†’ PUBLISHED` | Fase futura eBay real | `publish:{candidate_id}:{ebay_listing_id}` |

## Reglas de protecciÃ³n

- `PUBLISHED` no debe ser alcanzable en esta fase.
- `BLOCKED` solo puede salir mediante acciÃ³n admin explÃ­cita futura; por defecto terminal.
- `REJECTED` es terminal salvo reapertura manual auditada.
- Toda transiciÃ³n debe escribir `ebay_winner_audit_log`.
- Todo cÃ¡lculo debe guardar versiÃ³n y assumptions.
- No usar `opportunity_score` como autorizaciÃ³n automÃ¡tica para publicar.
