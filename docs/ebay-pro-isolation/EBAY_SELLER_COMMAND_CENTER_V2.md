# eBay Seller Command Center V2

## Objetivo

Convertir el catálogo observado de Luna Portex en una cola profesional de
oportunidades eBay que sea rápida, explicable y operable desde el teléfono.
El sistema separa descubrimiento, evidencia, preparación y publicación. Un
score nunca sustituye la confirmación de identidad, stock, economía o política.

## Límites de seguridad de preproducción

- Las consultas eBay de mercado, listings propios y Analytics son read-only.
- Los snapshots, tareas, revisiones, paquetes y alertas se guardan internamente.
- Un paquete interno o listing preview no es un draft ni un listing publicado.
- No se llama `publishOffer` ni ningún endpoint equivalente.
- La publicación real requiere una autorización independiente.

## Modelo de decisión

Cada oportunidad expone tres ejes independientes:

1. `potential_score`: atractivo comercial si la evidencia es correcta.
2. `confidence_score`: exactitud, calidad, distribución y frescura de evidencia.
3. `urgency_score`: necesidad de analizar o actuar por momentum o cambios Luna.

La cola diaria se ordena por un `seller_priority_score` canónico. El score debe
tener techo cuando identidad, stock, restricciones o evidencia estén pendientes.

## Clases de evidencia eBay

No se mezclan en un único contador:

- candidatos encontrados;
- listings activos similares fuertes;
- listings activos exactos por identificador;
- listings vendidos exactos y recientes;
- vendedores distintos con ventas o movimiento;
- delta estimado Browse observado entre snapshots;
- velocidad 7 y 30 días;
- aceleración y concentración del vendedor dominante.

`estimatedSoldQuantity` y sus deltas siguen etiquetados como estimaciones. Sólo
una fuente oficial de historial vendido se puede presentar como historial, y
siempre con ventana temporal, identidad exacta y vendedores distintos.

## Identidad

Prioridad:

1. GTIN exacto.
2. Brand + MPN exactos.
3. EPID exacto.
4. Atributos obligatorios de variante.
5. Similitud de título sólo para descubrimiento y revisión humana.

Un GTIN exacto domina un conflicto blando de vendor/brand; la contradicción se
mantiene como anomalía de datos. `vendor` de Luna no se asume automáticamente
como fabricante sin procedencia explícita.

## Demanda

Hay dos rutas válidas:

- historial vendido oficial, reciente, exacto y multi-vendedor; o
- dos o más snapshots Browse, exactos, multi-vendedor y con delta positivo.

El score considera velocidad, aceleración, amplitud de vendedores,
concentración, estabilidad, recencia y relación demanda/competencia. Un único
vendedor no prueba mercado distribuido.

## Economía

La decisión utiliza escenario conservador:

- precio P25 de comparables exactos del mismo producto/pack/condición;
- fee de categoría o fallback explícitamente etiquetado;
- costo Luna;
- shipping, empaque y handling;
- reserva de devoluciones;
- promoción configurable;
- beneficio, margen y ROI.

Peso es obligatorio cuando afecta fulfillment. Dimensiones son un gate
condicional según categoría y perfil de envío, no un bloqueo universal.

## Restricciones

El detector de restricciones se ejecuta antes del análisis costoso. Sus
resultados son hard gates o revisión explícita, no sólo una penalización de
orden. Las reglas abarcan al menos baterías/litio, aerosoles, químicos,
pesticidas, salud, claims, productos infantiles, compatibilidad, marcas y
materiales regulados.

## Scheduler por carriles

- `protection`: listings activos y paquetes listos; mayor frescura.
- `hot`: oportunidades de mayor prioridad; varias observaciones diarias.
- `baseline`: candidatos prometedores; observación diaria.
- `coverage`: catálogo restante; cursor estable y cobertura rotativa.
- `event`: nuevos productos, restocks o mejoras de costo entran de inmediato.

Las tareas se reclaman con lease transaccional y `FOR UPDATE SKIP LOCKED`.
Incluyen `due_at`, intentos, backoff, último error y dead-letter. No se pagina por
offset sobre un ranking mutable. Una falla de candidato no detiene los demás.

## Monitoreo de listings activos

Los listings propios administrados por Sell Inventory se sincronizan mediante
lecturas por SKU y se vinculan con oportunidad, producto Radar y variante Luna.
Los listings creados fuera de Inventory API pueden requerir un conector oficial
adicional; la interfaz no presenta esta fuente como cobertura universal. El monitor
evalúa:

- sin stock;
- poco stock según velocidad y lead time;
- stock desconocido o vencido;
- costo mayor y margen roto;
- mapping faltante;
- listing sin sincronizar;
- recuperación de stock o margen.

Cada riesgo tiene fingerprint idempotente, evidencia, acción recomendada y
resolución. Las alertas in-app usan un outbox idempotente. WhatsApp y email
permanecen desactivados hasta incorporar y validar un worker de entrega.
En Production, un cron read-only actualiza Inventory y ejecuta el monitor; en
Preview la misma operación se dispara manualmente desde el teléfono.

## Flujo móvil

Navegación inferior:

1. Inicio: salud de fuentes, frescura y siguiente mejor acción.
2. Oportunidades: ranking canónico, filtros y evidencia visible.
3. En curso: revisiones persistidas y continuar donde se dejó.
4. Alertas: riesgo, cambio, listing afectado y acción directa.

El cockpit mantiene el orden Luna → eBay → Economía → Listing. Cada paso se
guarda en servidor. Un cambio upstream invalida y recalcula los pasos
dependientes. La CTA fija sólo muestra la siguiente acción segura.

## Paquete de listing

El workspace se abre por `opportunity_id`, no por fixture. Carga producto Luna,
evidencia eBay, economía, categoría, aspectos, imágenes y guardas. Persiste un
paquete interno versionado. Inventory Mapping puede aportar un listing preview
como segunda opinión; su resultado nunca se trata automáticamente como verdad.

## Feedback de nuestra cuenta

Seller Analytics alimenta impresiones, vistas, CTR, transacciones y conversión
de listings propios. Después de tener volumen suficiente se ejecuta backtesting
por versión de motor y cohorte. Hasta entonces los pesos permanecen reglas
explicables y versionadas, no se presentan como machine learning.

## Criterios de aceptación

- Dos workers nunca reclaman la misma tarea.
- Los carriles críticos se atienden antes que la cobertura y sin starvation.
- La salud muestra cuántas tareas están pendientes, reintentando o en dead-letter.
- El tiempo real de cobertura se mide en preproducción antes de fijar un SLA.
- Un candidato defectuoso no detiene el lane.
- Evidencia degradada nunca se muestra como cero confirmado.
- Vendedores distintos son obligatorios para la etiqueta multi-seller.
- Velocidad y economía usan comparables exactos elegibles.
- El trabajo móvil se reanuda después de cerrar la pestaña.
- El workspace de listing conserva el producto y evidencia seleccionados.
- Una condición de riesgo produce una sola alerta abierta.
- La recuperación resuelve el riesgo anterior.
- Ninguna ruta de preproducción puede publicar en eBay.

## Configuración operativa requerida

- `CRON_SECRET`
- `EBAY_CLIENT_ID`
- `EBAY_CLIENT_SECRET`
- `EBAY_SELLER_REFRESH_TOKEN`
- acceso/scope read-only requerido para Browse, Analytics e Inventory
- credenciales Luna válidas
- variables WhatsApp sólo si la entrega de alertas está habilitada

Preview conserva controles manuales porque Vercel no ejecuta crons en Preview.
La programación automática y la entrega externa de alertas se activan únicamente
después de promover código y configuración aprobados a Production.
