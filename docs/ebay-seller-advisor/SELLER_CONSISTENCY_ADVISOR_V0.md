# Seller Consistency Advisor V0

## Proposito

Seller Consistency Advisor V0 es la capa superior del sistema eBay de IMNOVA. No decide solo por margen y no intenta publicar mas productos por publicar.

Su funcion es ayudar a operar como vendedor consistente:

- Validar productos.
- Preparar listings competitivos.
- Observar el lanzamiento.
- Diagnosticar metricas.
- Optimizar con disciplina.
- Escalar solo lo validado.

Seller Consistency Advisor V0 no habilita publicacion, drafts reales, modificacion de listings, pausa, orders, pagos ni acciones reales de eBay.

## Principio Central

La meta no es una venta. La meta es un sistema repetible.

El sistema debe favorecer decisiones repetibles basadas en datos: productos validados, listings competitivos, precios competitivos con margen real, rutina diaria, revision semanal, optimizacion continua y escalamiento inteligente.

## Vendedor Ocasional Vs Vendedor Consistente

### Vendedor Ocasional

- Publica y espera.
- Cambia sin datos.
- Abandona rapido.
- Depende de un producto.
- Actua por intuicion.

### Vendedor Consistente

- Valida antes de listar.
- Revisa metricas.
- Optimiza con disciplina.
- Cambia una variable a la vez.
- Escala lo validado.
- Repite el proceso semanal.

## Arquitectura Futura Sugerida

Modulos futuros:

- `lib/seller-consistency-advisor/product-validation.mjs`
- `lib/seller-consistency-advisor/listing-readiness.mjs`
- `lib/seller-consistency-advisor/launch-observation.mjs`
- `lib/seller-consistency-advisor/metrics-diagnosis.mjs`
- `lib/seller-consistency-advisor/optimization-guardrail.mjs`
- `lib/seller-consistency-advisor/scaling-advisor.mjs`
- `lib/seller-consistency-advisor/routine-advisor.mjs`
- `lib/seller-consistency-advisor/index.mjs`

Implementacion recomendada:

- Docs primero.
- Modulo puro despues.
- UI mucho despues.
- eBay API real no requerida para V0.

## Las 7 Capas Del Advisor

### A. Product Validation Advisor

Responde:

- Hay demanda comprobada?
- Hay ventas recientes?
- Hay varios vendedores activos?
- La demanda es estable?
- La competencia es razonable?
- Podemos competir en precio y calidad?
- Existe margen real despues de costos?
- Avanza, se observa o se descarta?

Decision esperada:

- `advance_to_readiness` si hay demanda, competencia razonable y margen real.
- `observe_market` si hay senales incompletas.
- `discard_or_research_supplier` si no hay demanda, no hay margen o no se puede competir.

### B. Listing Readiness Advisor

Responde:

- Imagen principal clara?
- Titulo con keywords reales?
- Item specifics completos?
- Precio competitivo?
- Descripcion completa?
- Stock confirmado?
- Peso/dimensiones?
- Shipping confiable?
- Listo para preparar listing o falta informacion?

Decision esperada:

- `ready_for_listing_prep` si los campos criticos estan completos.
- `needs_data` si falta informacion.
- `blocked_by_risk` si hay riesgo operativo, stock bajo, shipping no confiable o margen insuficiente.

### C. Launch Observation Advisor

Reglas:

- Campana apagada al inicio.
- No tocar impulsivamente.
- Dejar correr aproximadamente 7 dias cuando aplique.
- Observar impresiones, clics, watchers, conversion, ventas y trafico.
- No optimizar sin datos suficientes.

Decision esperada:

- `observe_without_changes` cuando el listing esta en ventana inicial.
- `ready_for_diagnosis` cuando hay suficientes datos.
- `insufficient_data` cuando aun no hay base para cambiar.

### D. Metrics Diagnosis Advisor

Casos:

- Pocas impresiones: problema de visibilidad, demanda, keywords, titulo o categoria. Accion: revisar keywords, categoria y demanda real.
- Muchas impresiones y pocos clics: problema de CTR. Accion: revisar imagen principal, precio visible y titulo.
- Muchos clics y pocas ventas: problema de conversion. Accion: revisar descripcion, item specifics, precio vs competencia, politicas y confianza.

Decision esperada:

- `visibility_problem`
- `ctr_problem`
- `conversion_problem`
- `healthy_listing`
- `insufficient_data`

### E. Optimization Discipline Guardrail

Debe bloquear:

- Cambiar todo al mismo tiempo.
- Tocar listings que ya funcionan.
- Abandonar productos demasiado rapido.
- Optimizar sin datos.
- Cambiar titulo, imagen, precio y descripcion simultaneamente.

Debe recomendar:

- Una variable por vez.
- Esperar datos antes del siguiente cambio.
- Mantener historial.
- No tocar lo que funciona sin razon basada en datos.

Decision esperada:

- `allow_single_variable_test`
- `wait_for_more_data`
- `do_not_touch_working_listing`
- `blocked_multi_variable_change`

### F. Scaling Advisor

Responde:

- Producto fuerte o debil?
- Tiene ventas repetidas?
- Mejoro CTR?
- Mejoro conversion?
- Puede escalarse?
- Conviene variacion, pack o producto similar?
- O primero debe optimizarse?

Reglas:

- No escalar sin validar.
- No depender de un solo producto.
- Duplicar ganadores con criterio.
- Optimizar debiles antes de abandonarlos.
- Repetir proceso semanal.

Decision esperada:

- `ready_to_scale`
- `optimize_before_scaling`
- `keep_observing`
- `do_not_scale`

### G. Seller Routine Advisor

Diario:

- Revisar nuevos pedidos.
- Preparar envios.
- Revisar tracking.
- Responder mensajes antes de 24 horas.
- Revisar casos, disputas o devoluciones.

Semanal:

- Revisar impresiones.
- Revisar CTR.
- Revisar conversion.
- Clasificar productos fuertes vs debiles.
- Decidir mantener, optimizar, escalar o pausar.

Nota V0:

Orders, pagos, mensajes, casos y devoluciones son parte de la rutina conceptual, pero no se conectan a eBay real en V0.

## Output Conceptual

```json
{
  "seller_consistency_status": "unstable | building_system | consistent | ready_to_scale",
  "product_validation_decision": "...",
  "listing_readiness_decision": "...",
  "launch_observation_decision": "...",
  "metrics_diagnosis": "...",
  "optimization_guardrails": [],
  "scaling_decision": "...",
  "daily_actions": [],
  "weekly_actions": [],
  "next_safe_step": "...",
  "human_approval_required": true
}
```

Reglas del output:

- `human_approval_required` debe permanecer `true`.
- No debe habilitar publicacion.
- No debe crear drafts.
- No debe modificar listings.
- No debe pausar listings.
- No debe leer orders/pagos.

## Relacion Con Patches Existentes

### Stock Rotation Risk Guardrail V0

Tiene prioridad cuando hay riesgo de cancelacion por stock bajo. Si stock bajo bloquea campana, pack o publicacion, Seller Consistency Advisor debe respetar ese bloqueo aunque el producto tenga margen o demanda.

### Listing Seller Advisor Prompts V0

Usa el output de consistency para generar listing con disciplina. Readiness va primero; creatividad viene despues.

### eBay API Read-Only Gateway V0 Design

Alimentara categorias, aspects y metadata de readiness. Esa metadata ayuda al diagnostico, pero no autoriza publicar.

### eBay OAuth Token Store Design

Sera requisito antes de cualquier conexion real. Sin diseno OAuth aprobado, cualquier eBay API real debe permanecer apagada.

### Regla Principal

Seller Consistency Advisor no habilita publicacion. Solo organiza decisiones y proximos pasos seguros.

## Datos Existentes Vs Faltantes

### Existentes

- Stock.
- Margen.
- Costo.
- Shipping estimado.
- Precio.
- Opportunity score.
- Candidate state.
- Price intelligence.
- Multipack advisor.
- Imagenes cuando existan.
- Dimensiones cuando existan.

### Faltantes

- Ventas recientes por comparable.
- Vendedores activos.
- Estabilidad de demanda.
- CTR real.
- Conversion real.
- Impressions.
- Watchers.
- Traffic.
- Historial de cambios.
- Datos Seller Hub.
- Reputacion/policies reales del seller.

## Orden Futuro Recomendado

Despues de cerrar PR #20:

1. Aplicar Stock Rotation Risk Guardrail V0.
2. Aplicar Listing Seller Advisor Prompts V0.
3. Aplicar eBay API Read-Only Gateway V0 Design.
4. Aplicar eBay OAuth Token Store Design.
5. Aplicar Seller Consistency Advisor V0 docs-only.
6. Luego crear modulo puro con tests y datos manuales.
7. Despues integrar parcialmente con readiness/prompts.
8. Mas adelante conectar eBay read-only sandbox.

## Prohibiciones V0

- No eBay API real.
- No OAuth real.
- No tokens reales.
- No drafts reales.
- No publicacion.
- No modificacion de listings.
- No pausa real.
- No orders/pagos.
- No secretos.
- No UI en V0.
- No integracion con `decision-advisor` en V0 docs-only.
