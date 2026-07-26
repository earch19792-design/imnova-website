# Validación staging de aprovechamiento eBay y factory shadow

Fecha: 2026-07-26  
Entorno: `imnova-staging`  
Rama: `feature/centralize-ebay-mobile-center`

## Controles preservados

- Modo factory: `DRY_RUN`.
- Kill switch de publicación: activado.
- Publicación automática: desactivada.
- Escrituras eBay ejecutadas: 0.
- Mensajes WhatsApp reales enviados: 0.
- Cambios en Production: 0.

## Línea base de intervención

| Métrica | Valor |
| --- | ---: |
| Corridas heredadas con candidatos | 9 |
| Candidatos heredados | 50 |
| Tareas humanas | 195 |
| Minutos humanos estimados | 260.75 |
| Tareas humanas por candidato | 3.90 |

La auditoría de capacidades calcula 86.8% de implementación ponderada sobre
las 17 capacidades inventariadas. La línea base de campos recibidos y
aprovechados es 22 de 31, equivalente a 71.0%. La metodología y las matrices
productor-consumidor están documentadas en
`docs/ebay-communication-utilization-and-automation-audit-v1.md`.

## Migraciones validadas

### `20260726072000_add_listing_factory_shadow_observability.sql`

- Ejecutada dos veces dentro de una transacción con rollback: correcta.
- Aplicada dos veces en la misma transacción staging: idempotente.
- Historial Supabase registrado.
- Tres vistas `security_invoker`, acceso de navegador revocado y lectura
  exclusiva para `service_role`.
- Bridge shadow con advisory lock, precondiciones y postcondición de cero
  efectos.

### `20260726073000_fix_listing_factory_pgcrypto_search_path.sql`

- El primer bridge expuso que cinco funciones factory no podían resolver
  `digest()` porque `pgcrypto` reside en el esquema protegido `extensions`.
- La transacción fallida no dejó registros parciales.
- El ajuste agrega `extensions` únicamente al `search_path` de las cinco
  funciones afectadas; no modifica tablas, datos ni ACL.
- Ejecutada dos veces con rollback y aplicada dos veces: idempotente.
- Historial Supabase registrado.

## Prueba shadow de lote y replay

Corrida: `88f48603-bc28-4ee7-b9ea-44d749ef4676`

| Resultado | Primera ejecución | Replay |
| --- | ---: | ---: |
| Candidatos registrados | 9 | 9 |
| Slots activos | 5 | 5 |
| Reservas | 4 | 4 |
| Transiciones factory | 9 | 9 |
| Dossiers | 0 | 0 |
| Efectos/outbox | 0 | 0 |
| `safeShadowOnly` | true | true |

El replay no duplicó transiciones ni produjo efectos.

## Política promocional segura

- `ACTIVE_ONLY`, E1, E2, E3, ventas estimadas o cero ventas confirmadas:
  promoción bloqueada.
- Se exige E4 o E5, ventas oficiales, costos completos, gates económicos,
  stock exacto fresco y configuración versionada.
- La tasa es el menor entre 2%, máximo configurado y headroom real.
- La reserva económica canónica de 5% se conserva como colchón; no se presenta
  como tasa recomendada.
- Preparación y ejecución revalidan la versión de configuración.
- Antes de solicitar el token de Marketing se vuelven a calcular economía y
  stock. Cualquier drift exige nueva revisión humana.

## Validaciones locales

- `git diff --check`: correcto.
- `npx tsc --noEmit --incremental false`: correcto.
- `npm run audit:seller-os`: correcto.
- `npm run test:seller-os`: 161/161 pruebas correctas antes de la migración
  compensatoria; su prueba adicional también es correcta.
- `npm run build`: correcto.

## Límites pendientes por autorización independiente

- No se creó un Inventory Item u Offer real no publicado.
- No se inyectó un timeout real contra eBay.
- No se publicó ningún canario.

Esas pruebas implican efectos externos reales y requieren una autorización
independiente que identifique cuenta, marketplace, producto, SKU, precio,
cantidad, Offer ID o intención de crearlo, hash del payload y compuertas
aprobadas. Los contratos con mocks para outbox, timeout incierto,
reconciliación y cero reintentos ciegos permanecen cubiertos por la suite.
