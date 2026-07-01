# Market Radar Seller Flow Closure - 2026-06-30

## Objetivo

Documentar el cierre funcional reciente de Market Radar como flujo profesional para vendedor eBay. El modulo queda orientado a descubrir oportunidades frescas, proteger productos ya trabajados, recuperar productos bloqueados cuando cambian las condiciones comerciales y mantener todo el flujo en modo seguro/read-only hasta aprobacion humana.

## Estado final del flujo

```text
Luna Portex sync
  -> Market Radar events/scores
  -> Oportunidades encontradas
      -> solo productos frescos sin evaluacion previa
  -> Centro de Venta eBay
      -> productos revisados, listados, vinculados, bloqueados o monitoreados
  -> eBay Pipeline
      -> reanalisis seguro, Price Intelligence, stock, margen, riesgo y estrategia
  -> listing package / draft / publicacion
      -> solo despues de validaciones y aprobacion humana
```

## Cambios recientes cerrados

### 1. Centro de Venta eBay

El Centro de Venta eBay ahora representa productos ya tocados por el flujo de venta:

- productos revisados;
- productos listados o vinculados;
- candidatos existentes en eBay Pipeline;
- productos bloqueados que requieren recheck;
- productos con cambios de stock, precio o margen.

La UI muestra los productos detras de cada conteo y permite saltar al ranking/producto correspondiente. Esto evita que el vendedor vea solo numeros sin saber cuales SKUs requieren accion.

Colas principales:

- `Proteger existentes`
- `Riesgo de stock`
- `Cambios precio/margen`
- `Bloqueados o por revisar`
- `Todo monitoreado`

### 2. Oportunidades encontradas

La seccion `Oportunidades encontradas` quedo enfocada en descubrimiento fresco.

Regla final:

- incluye productos con accion `Revisar oportunidad`;
- excluye productos que ya tienen `candidate_id` o `candidate_state`;
- evita repetir productos ya evaluados;
- muestra senales comerciales claras.

Senales visibles:

- `Producto nuevo`
- `Precio/descuento`
- `Volvio a stock`
- `Coleccion activa`

Las oportunidades ya conocidas con cambios relevantes pasan al Centro de Venta eBay para monitoreo y reanalisis.

### 3. Separacion entre descubrimiento y riesgo

Los riesgos ya no contaminan el escaner de oportunidades frescas.

Riesgos como estos se trabajan fuera de `Oportunidades encontradas`:

- stock agotado;
- stock ambiguo;
- stock bajo;
- margen deteriorado;
- precio no rentable;
- no listar;
- compliance;
- bloqueos operativos;
- productos ya listados o ya revisados.

### 4. Riesgo de stock

La cola `Riesgo de stock` fue ampliada para un vendedor eBay real.

Ahora incluye productos monitoreados/evaluados con:

- stock agotado;
- stock sin cantidad confiable;
- disponibilidad ambigua;
- cantidad confirmada baja `<= 3`.

Esto evita perder productos ya trabajados que podrian generar cancelaciones, overselling o decisiones de pack incorrectas.

### 5. Variantes y matching de candidatos

Las alertas del Advisor ahora resuelven candidatos por:

```text
product_id + supplier_variant_id
```

antes de usar fallback por producto.

Impacto:

- una variante revisada no oculta otra variante fresca;
- una oportunidad real no desaparece solo porque el producto padre ya tenia un candidato;
- el flujo trabaja mejor con productos multi-variante.

### 6. Productos bloqueados reactivables

Un producto `BLOCKED` ya no se trata como descartado permanentemente.

Regla final:

```text
BLOCKED = pausado hasta que cambie la condicion que lo bloqueo
```

Si Radar detecta estas senales:

- `restocked`
- `stock_increased`
- `quantity_changed`
- `price_down`
- `discount_started`

entonces el producto bloqueado vuelve a reanalisis con accion:

```text
blocked_reactivation_review
```

La UI de eBay Pipeline muestra:

```text
Ruta de reactivacion del producto bloqueado
```

Condiciones para desbloquear:

- stock confirmado por variante o suficiente para el pack recomendado;
- precio, costo, fees y envio sostienen margen minimo;
- no hay bloqueos criticos de compliance, imagenes o datos;
- la estrategia comercial soporta listing individual o paquete rentable.

Si el reproceso pasa validaciones, Pipeline puede sacar el candidato de `BLOCKED` y dejarlo continuar hacia listing package, draft y publicacion con aprobacion humana.

### 7. Limpieza visual final

Las secciones inferiores fueron limpiadas:

- `Escenarios de referencia` ahora muestra tarjetas de decision del vendedor en espanol;
- se removio copy crudo en ingles como `Pipeline state`;
- se ocultaron constantes tecnicas visibles como `CATALOG_COVERAGE_PARTIAL`;
- `Cobertura del catalogo` ahora usa etiquetas de negocio:
  - `Alcance parcial confirmado`
  - `No vender como catalogo completo`

### 8. Seguridad y copy read-only

El flujo sigue siendo seguro:

- no publica en eBay automaticamente;
- no crea drafts reales automaticamente;
- no modifica listings;
- no cambia estados sin aprobacion humana;
- las evaluaciones son dry-run/revision segura.

Ultima correccion de copy:

```text
Crear borrador -> Preparar draft
```

Motivo: aunque el boton era dry-run, `Crear borrador` podia sonar a accion real. `Preparar draft` refleja mejor que es una preparacion/revision, no una creacion real en eBay.

## Contrato operativo del vendedor

### Market Radar debe hacer

- detectar oportunidades frescas;
- detectar cambios comerciales relevantes;
- proteger productos existentes;
- recuperar bloqueados cuando cambia stock/precio/margen;
- enviar productos al Pipeline para reanalisis seguro.

### Market Radar no debe hacer

- publicar listings;
- crear drafts reales;
- asumir cobertura completa de Luna Portex;
- repetir productos ya evaluados como si fueran nuevos;
- desbloquear automaticamente sin validacion del Pipeline.

## Validaciones ejecutadas durante el cierre

Se validaron los cambios recientes con:

```bash
node --test tools/ebay-winner-pipeline-tests.mjs
./node_modules/.bin/tsc --noEmit
git diff --check
npm run build
```

Tambien se confirmo despliegue Vercel preview passed.

Preview usado durante el cierre:

```text
https://imnova-website-z1qh-git-featur-94f38f-earch19792-6888s-projects.vercel.app
```

## Referencias de implementacion

- `components/admin/market-radar-panel.tsx`
- `components/admin/ebay-winner-pipeline-panel.tsx`
- `app/api/admin/market-radar/route.ts`
- `lib/radar-advisor-events.mjs`
- `lib/market-radar-actionable-ranking.mjs`
- `lib/ebay-winner-pipeline/core.mjs`
- `tools/ebay-winner-pipeline-tests.mjs`

## Estado de cierre

Market Radar queda cerrado como flujo funcional de vendedor eBay:

- descubre oportunidades nuevas;
- protege productos existentes;
- recupera productos bloqueados cuando vuelven a tener sentido comercial;
- mantiene decisiones de riesgo separadas del descubrimiento;
- requiere Pipeline y aprobacion humana antes de avanzar a listing/draft/publicacion.
