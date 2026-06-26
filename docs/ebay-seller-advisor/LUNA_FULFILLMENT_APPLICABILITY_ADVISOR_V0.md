# Luna Packaging & Fulfillment Applicability Advisor V0

## Proposito

Luna Packaging & Fulfillment Applicability Advisor V0 no calcula el costo final.

Primero clasifica si los costos de Luna aplican, no aplican o requieren confirmacion humana. El calculo de costo debe ocurrir despues, usando solo costos confirmados.

Principio:

IMNOVA no debe sumar tarifas de Luna por defecto. Primero debe clasificar el flujo operativo y confirmar si hay empaque, preparacion, almacenamiento o manipulacion adicional.

Este advisor no habilita publicacion, drafts reales, modificacion de listings, pausa, orders, pagos ni acciones reales.

## Diferencia Entre Aplicabilidad Y Calculo

### Aplicabilidad

- Decide si un costo puede aplicar.
- Marca costos no confirmados.
- Pide confirmacion humana.
- Clasifica el flujo operativo.
- Evita inflar costos que no corresponden.

### Calculo

- Debe ocurrir despues.
- Debe usar solo costos confirmados.
- No debe mezclar shipping, fulfillment, materiales, eBay fee y product cost.
- Debe mantener shipping separado del fulfillment/prep/materiales.

## Flujos Operativos

### A. `luna_portex_default`

- Producto viene de Luna Portex.
- Se vende con empaque/presentacion normal.
- No sumar material extra automaticamente.
- No sumar repacking automaticamente.
- Costos adicionales quedan como `not_confirmed`.
- Si hay duda, pedir confirmacion humana.
- `apply_luna_fulfillment_costs: false` por defecto.

Decision esperada:

- No aplicar tarifas Luna adicionales salvo confirmacion.
- Mantener shipping como costo separado.
- Marcar prep/materiales como no confirmados si no hay evidencia.

### B. `external_supplier_to_luna_warehouse`

- Producto se compra a proveedor externo.
- Se almacena fisicamente en Luna Warehouse.
- Receiving puede aplicar.
- Order prep puede aplicar.
- Materiales pueden aplicar.
- Shipping va separado.
- Debe tratarse como flujo operativo distinto.
- `apply_luna_fulfillment_costs` puede ser `true` solo con datos confirmados.

Decision esperada:

- Identificar receiving, prep y materiales como costos potenciales.
- No declarar rentabilidad final hasta confirmar costos operativos.
- Separar almacenamiento/prep de shipping.

### C. `custom_packaging_or_bundle`

- Cambia la presentacion original.
- Hay pack, bundle, multipack o preparacion especial.
- Evaluar polybag, caja, bubble wrap, etiquetas, armado y manipulacion.
- Shipping separado.
- No declarar rentable hasta confirmar empaque.
- Debe conectar con Multipack Profit Advisor antes de recomendar pack.

Decision esperada:

- Marcar empaque/materiales como necesarios o desconocidos.
- Bloquear conclusion de pack rentable si faltan costos de preparacion.
- Pedir confirmacion humana antes de escalar.

### D. `fba_prep_future`

- Amazon FBA queda separado de eBay FBM.
- No mezclar tarifas ni reglas.
- No usar para decisiones eBay V0.
- Documentar como flujo futuro.

Decision esperada:

- No aplicar a eBay FBM.
- No mezclar con costos Luna/eBay.
- Mantener como categoria futura.

### E. `unknown`

- Si no se sabe el flujo operativo, no aplicar costos Luna por defecto.
- Marcar `requires_human_confirmation: true`.
- Mantener costos como `not_confirmed`.

Decision esperada:

- No inflar costos automaticamente.
- No declarar rentabilidad final.
- Pedir datos minimos de flujo operativo.

## Output Conceptual

```json
{
  "supplier_flow": "luna_portex_default | external_supplier_to_luna_warehouse | custom_packaging_or_bundle | fba_prep_future | unknown",
  "uses_default_packaging": true,
  "custom_packaging_required": false,
  "warehouse_receiving_required": false,
  "luna_order_prep_required": "yes | no | unknown",
  "material_fee_required": "yes | no | unknown",
  "shipping_included": false,
  "shipping_required_separately": true,
  "apply_luna_fulfillment_costs": false,
  "costs_to_apply": [],
  "costs_not_confirmed": [],
  "profit_impact_notes": [],
  "packaging_risk_notes": [],
  "requires_human_confirmation": true
}
```

Reglas del output:

- `requires_human_confirmation` debe permanecer `true`.
- `shipping_required_separately` debe permanecer `true` para evitar mezclar shipping con prep/materiales.
- `apply_luna_fulfillment_costs` debe ser `false` por defecto.
- Costos dudosos deben ir en `costs_not_confirmed`, no en `costs_to_apply`.

## Preguntas Que IMNOVA Debe Hacer

- El producto viene directamente de Luna Portex?
- Se vendera con el empaque original?
- Se cambiara presentacion, se hara pack o bundle?
- El producto sera almacenado fisicamente en Luna Warehouse?
- Luna hara recepcion del inventario?
- Luna preparara cada orden?
- Se necesita polybag, caja, bubble wrap o etiqueta especial?
- Este flujo es eBay FBM o Amazon FBA?
- El shipping ya esta estimado por separado?
- Tenemos peso/dimensiones confirmados?

## Relacion Con Otros Advisors

- Stock Rotation Risk Guardrail mantiene prioridad si stock bajo crea riesgo.
- Multipack Profit Advisor no debe declarar pack viable sin confirmar empaque/materiales.
- Listing Seller Advisor Prompts puede mostrar notas como `packaging_not_confirmed`.
- Listing Visual Conversion Advisor debe reflejar el contenido real del pack si cambia la presentacion.
- Seller Consistency Advisor no debe escalar productos con flujo operativo no confirmado.
- eBay API Read-Only Gateway no es requisito para este advisor.
- OAuth Token Store no tiene relacion directa.

## Riesgos Que Debe Evitar

- Inflar costos aplicando tarifas Luna automaticamente.
- Subestimar costos cuando si hay repacking, bundle o proveedor externo.
- Mezclar eBay FBM con Amazon FBA.
- Declarar pack rentable sin confirmar empaque.
- Contar shipping dos veces.
- Tratar proveedor externo igual que Luna Portex default.
- No pedir confirmacion humana cuando el flujo es desconocido.
- Mezclar costo de producto, eBay fee, shipping, fulfillment y materiales en una sola categoria.

## Orden Futuro Recomendado

1. Documentar advisor como docs-only.
2. Crear modulo puro de clasificacion de `supplier_flow`.
3. Agregar tests con los flujos principales.
4. Integrarlo antes del profit engine como input de costos aplicables.
5. Integrarlo con Multipack Profit Advisor.
6. Mostrar notas en Listing Readiness.
7. UI solo despues.

## Prohibiciones V0

- No eBay API real.
- No OAuth real.
- No tokens.
- No drafts.
- No publicacion.
- No modificacion de listings.
- No pausa real.
- No orders/pagos.
- No secretos.
- No UI en V0.
- No integracion con `decision-advisor` en V0 docs-only.
