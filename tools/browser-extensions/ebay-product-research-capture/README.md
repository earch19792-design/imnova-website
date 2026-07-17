# Seller OS — eBay Product Research Capture

Extensión local MV3 para el piloto Preview de Loop 2.

1. Abre `chrome://extensions` o `edge://extensions`.
2. Activa **Developer mode**.
3. Selecciona **Load unpacked** y elige esta carpeta.
4. Abre la página oficial `https://www.ebay.com/sh/research` e inicia sesión normalmente.
5. Ejecuta una búsqueda y usa **Capturar resultados para Seller OS**.

Si ya estaba instalada una versión anterior, reemplaza la carpeta extraída y pulsa
**Reload** en `chrome://extensions` o `edge://extensions`. La versión optimizada es 1.2.0.

## Patrones visuales locales (v1.2.0)

La misma captura analiza únicamente miniaturas que ya estén visibles en el viewport de Product Research. Chrome intenta leer un recorte temporal de la representación renderizada en memoria para derivar rasgos agregados (fondo, cobertura, complejidad y composición). El recorte y su buffer se eliminan inmediatamente.

La extensión no descarga imágenes, no abre versiones completas, no guarda ni lee URLs de imagen, no genera screenshots/base64/blobs y no transmite píxeles. Si Chrome bloquea la lectura por seguridad de origen, marca el análisis como no disponible y continúa la captura comercial normal.

La captura rápida usa un único snapshot de la cuadrícula visible, reutiliza geometría
y procesa primero las filas ancladas a Item IDs, incluso cuando eBay representa el
enlace mediante texto accesible o una imagen con `alt`. Después de importar, Seller OS puede
aplicar y ejecutar la siguiente consulta agrupada con un clic. La extensión espera resultados
nuevos y verifica que la consulta visible coincida antes de habilitar la siguiente captura;
nunca inicia sesión automáticamente.

La extensión sólo se inyecta en la ruta oficial Product Research. No lee cookies,
tokens, contraseñas, datos de comprador, HTML completo ni archivos de imagen. La
tabla visible se entrega mediante `postMessage` a la URL canónica de Preview; la
extensión no hace solicitudes de red ni funciona en Production.
