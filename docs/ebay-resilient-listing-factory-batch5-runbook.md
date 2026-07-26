# IMNOVA eBay Listing Factory: runbook de lotes de cinco

## Alcance

Esta implementacion extiende Same-Day Pilot. No crea una segunda seleccion de
productos, otro motor economico ni otra ruta de publicacion. Los padres siguen
siendo `ebay_same_day_pilot_runs`, los hijos siguen siendo
`ebay_same_day_pilot_candidates` y el efecto final sigue enlazado con
`ebay_authorized_listing_publications`.

La politica inicial es obligatoriamente:

- Entorno: `imnova-staging`.
- Modo: `DRY_RUN`.
- Tamano del lote: cinco.
- Concurrencia maxima: cinco productos.
- Kill switch de publicacion: activado.
- Publicacion automatica: deshabilitada.
- Escrituras externas: deshabilitadas.

## Flujo anterior

`Market Radar -> Top 5 -> Same-Day run -> candidatos -> un lease por run ->
gates humanos -> draft/Offer controlado -> publicacion autorizada separada ->
verificacion ACTIVE -> Commercial Monitoring`

El limite Top 5 ya existia, pero el lease unico por run serializaba los hijos.
Los errores desconocidos se expresaban como bloqueo o dead letter, sin
cuarentena recuperable. La evidencia estaba repartida entre summaries,
checkpoints y handoffs.

## Flujo endurecido

`Market Radar -> Same-Day run -> cinco slots -> cinco leases por candidato ->
expediente inmutable -> gates -> checkpoint -> outbox -> ledger autorizado ->
conciliacion por lectura -> post-publicacion -> Commercial Monitoring`

Un fallo de producto libera solamente su slot. El producto original permanece
en el lote y en las metricas. Una reserva puede ocupar el slot con
`replaces_candidate_id`. Un fallo global abre un circuit breaker y pausa esa
dependencia sin generar cinco cuarentenas falsas.

## Estados y checkpoints

La cadena principal no permite saltos:

`QUEUED -> CLAIMED -> MARKET_RESEARCH -> IDENTITY_VERIFIED ->
SUPPLY_VERIFIED -> DEMAND_VALIDATED -> ECONOMICS_PASSED ->
CATEGORY_AND_COMPLIANCE_PASSED -> LISTING_INTELLIGENCE_READY ->
VISUAL_PACKAGE_READY -> FINAL_QA_PASSED -> DRAFT_READY ->
APPROVED_TO_PUBLISH -> PUBLISHING -> PUBLISHED ->
POST_PUBLISH_VERIFIED -> COMMERCIAL_MONITORING`

Los estados laterales separan dependencia, retry, evidencia, reglas de negocio,
stock, margen, cumplimiento, identidad, cuarentena, rechazo y cancelacion.
Cada transicion tiene compare-and-swap, expediente, actor, correlacion,
checkpoint e idempotency key.

## Taxonomia de errores

| Categoria | Comportamiento |
| --- | --- |
| `PRODUCT_TRANSIENT` | Backoff acotado por producto |
| `RATE_LIMIT` | Reprogramar y abrir pausa de dependencia |
| `MISSING_EVIDENCE` | Bloquear sin retry inutil |
| `BUSINESS_RULE` | `STOCK_HOLD` o `MARGIN_HOLD` |
| `COMPLIANCE_OR_IDENTITY` | Bloqueo seguro |
| `UNKNOWN_PRODUCT` | Cuarentena y liberacion del slot |
| `GLOBAL_AUTH` | Circuit breaker por cuenta/dependencia |
| `GLOBAL_PROVIDER` | Circuit breaker sin contaminar productos |
| `UNCERTAIN_EXTERNAL_OUTCOME` | Conciliar antes de cualquier retry |
| `TERMINAL` | Rechazo auditable |

## Expediente

`ebay_listing_factory_dossiers` es append-only. Una version congelada exige:

- Identidad, pack, variante y condicion exactos.
- Fuente Luna autorizada, costo, stock, frescura, medidas y derechos visuales.
- Evidencia eBay clasificada sin convertir `ACTIVE_ONLY` en ventas.
- Snapshot del motor economico canonico.
- Listing, categoria, aspectos, politicas y payload hash.
- Manifiesto inmutable `VISUAL_STRATEGY_V3` con una principal y seis secundarias.
- Trazabilidad campo por campo.

No se puede actualizar ni borrar un expediente congelado. El drift crea una
nueva version y una transicion explicita.

## Idempotencia y resultado incierto

La clave del outbox incluye cuenta, marketplace, producto, SKU, generacion,
accion, version del expediente y payload hash. La base tiene dos restricciones
unicas: la clave digest y la identidad comercial completa.

Estados:

`PREPARED -> SENT -> CONFIRMED`

Un timeout posterior al envio produce `UNKNOWN_OUTCOME`. Ese estado no es
reclamable. La conciliacion debe leer Inventory Item, Offer o listing por
cuenta/SKU y comparar el hash completo. Una coincidencia exacta produce
`RECONCILED`; una ambiguedad permanece bloqueada.

## Cuarentena y replay

La cuarentena conserva fase, checkpoint, error, fingerprint, dependencia,
intentos, hashes, impacto, accion sugerida y requisitos de reanudacion.

`REPLAY_FROM_LAST_CHECKPOINT`:

1. Exige evidencia revalidada.
2. No borra historial.
3. No repite un efecto `PUBLISH_OFFER` confirmado o reconciliado.
4. No revive un listing finalizado.
5. Devuelve el candidato a reserva; el controlador asigna un slot seguro.

## Incidentes

### Producto desconocido

1. Confirmar que los otros cuatro slots siguen avanzando.
2. Revisar el fingerprint y el mensaje sanitizado.
3. Validar expediente y ultimo checkpoint.
4. Aprobar handler solo despues de pruebas.
5. Marcar replay seguro y revalidar evidencia.

### Autenticacion eBay

1. Confirmar circuito `EBAY` abierto para la cuenta.
2. No crear cuarentenas por producto.
3. Corregir credencial fuera de logs.
4. Ejecutar lectura de identidad de cuenta.
5. Pasar a `HALF_OPEN`, realizar una prueba de lectura y cerrar.

### Timeout posterior a escritura

1. No reenviar.
2. Consultar por cuenta y SKU.
3. Comparar Offer ID, Item ID y payload hash.
4. Marcar `RECONCILED` solo con coincidencia exacta.
5. En ambiguedad mantener `UNKNOWN_OUTCOME` y escalar.

## Etapas de activacion

### Etapa 0

Ejecutar tres lotes dry-run con:

```bash
node tools/ebay-resilient-listing-factory-dry-run.mjs
```

Debe reportar `ebayWrites: 0`.

### Etapa 1

Permitir Inventory Item y Offer no publicado mediante el ledger actual. El
kill switch de `PUBLISH_OFFER` permanece activado.

### Etapa 2

Antes del primer canario real se requiere una autorizacion independiente con:
cuenta, marketplace, producto, SKU, precio, cantidad, Offer ID, payload hash y
compuertas aprobadas.

### Etapa 3

No activar hasta demostrar cero duplicados, cinco canarios correctos,
conciliacion, expedientes completos, alertas y rollback.

## Rollback

1. Activar el kill switch.
2. Detener el propietario canonico del scheduler.
3. Esperar o liberar leases vencidos; nunca hacer reset destructivo.
4. Exportar dossiers, transiciones, cuarentena y attempts.
5. Reasignar staging al deployment Preview anterior si aplica.
6. Ejecutar solo tras revision la migracion compensatoria en
   `supabase/rollback/20260726070000_create_resilient_ebay_listing_factory_batch5.down.sql`.

## Variables y configuracion

- `EBAY_RESILIENT_LISTING_FACTORY_ENABLED`
- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- Credenciales eBay existentes, nunca expuestas al panel.

Batch size, concurrencia, reintentos, economia, reservas, modo, kill switch y
autorizacion automatica viven en `ebay_listing_factory_policies`, no en flags
UTC o constantes dispersas.

No se agrega otro scheduler. `factory_scheduler_owner` inicia en
`supabase_pg_cron`; GitHub Actions queda identificado solamente como fallback
manual para evitar dos propietarios activos.
