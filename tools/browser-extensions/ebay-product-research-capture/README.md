# Seller OS — eBay Product Research Capture

Extensión local MV3 para el piloto Preview de Loop 2.

1. Abre `chrome://extensions` o `edge://extensions`.
2. Activa **Developer mode**.
3. Selecciona **Load unpacked** y elige esta carpeta.
4. Abre la página oficial `https://www.ebay.com/sh/research` e inicia sesión normalmente.
5. Ejecuta una búsqueda y usa **Capturar resultados para Seller OS**.

Si ya estaba instalada una versión anterior, reemplaza la carpeta extraída y pulsa
**Reload** en `chrome://extensions` o `edge://extensions`. La versión corregida es 1.0.3.

La extensión sólo se inyecta en la ruta oficial Product Research. No lee cookies,
tokens, contraseñas, datos de comprador, HTML completo ni archivos de imagen. La
tabla visible se entrega mediante `postMessage` a la URL canónica de Preview; la
extensión no hace solicitudes de red ni funciona en Production.
