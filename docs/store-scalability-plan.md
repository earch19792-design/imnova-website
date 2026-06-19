# Plan de escalabilidad de catalogo IMNOVA Store

## Estado actual

- La Store publica debe mostrar solo productos con estado `Disponible`.
- Las paginas directas de producto deben bloquear productos que siguen como idea, validacion, desarrollo o produccion.
- La experiencia actual prioriza claridad visual, producto disponible, promocion de lanzamiento y canales de compra.
- `lib/products-service.ts` ya tiene una funcion preparada para leer productos publicos por pagina: `getPublicProductsPageWithStatesByStateNames`.
- Esa funcion todavia no esta conectada a la UI. Esto mantiene el cambio sin riesgo para carrito, filtros, busqueda o compra.

## Riesgo a futuro

La Store puede funcionar bien con pocos productos cargando todo el catalogo disponible. Con cientos o miles de productos, cargar todo y filtrar en el cliente puede volver lenta la pagina, aumentar el peso inicial y complicar busqueda, filtros y ordenamiento.

## Camino recomendado

1. Mantener la Store actual mientras el catalogo es pequeno.
2. Probar el servicio paginado en staging con `limit` de 24 o 48 productos.
3. Agregar un boton simple `Ver mas` sin cambiar filtros ni carrito.
4. Mover busqueda, categoria y ordenamiento a consultas del servidor cuando el catalogo crezca.
5. Agregar busqueda avanzada solo cuando el volumen lo justifique.

## Indices a cuidar

Cuando el catalogo crezca, conviene verificar indices para:

- `products.slug`
- `products.state_id`
- `products.created_at`
- `products.category`
- combinacion publica por estado, visibilidad y fecha
- busqueda futura por nombre, categoria, beneficio principal y descripcion

## Checklist antes de conectar paginacion

- Store sigue mostrando solo `Disponible`.
- Producto en `Idea`, `Validacion`, `Desarrollo` o `Produccion` no aparece comprable.
- URL directa de producto no disponible devuelve 404 o pantalla no disponible.
- Promocion de lanzamiento sigue visible cuando aplica.
- `Donde comprar` solo aparece en productos disponibles.
- Carrito y compra no cambian de comportamiento.
- Busqueda y filtros no duplican productos entre paginas.
- Mobile sigue claro y rapido.
- `npm run build` pasa.

## Rollback

Si una fase futura conecta paginacion y algo falla, volver temporalmente a `getPublicProductsWithStatesByStateNames(["Disponible"])` en la Store publica. La funcion paginada puede quedar disponible sin afectar la UI.
