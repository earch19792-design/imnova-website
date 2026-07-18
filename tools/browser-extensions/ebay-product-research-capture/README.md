# Seller OS — eBay Product Research Capture

Extensión local MV3 para el piloto Preview de Loop 2.

1. Abre `chrome://extensions` o `edge://extensions`.
2. Activa **Developer mode**.
3. Selecciona **Load unpacked** y elige esta carpeta.
4. Abre la página oficial `https://www.ebay.com/sh/research` e inicia sesión normalmente.
5. Ejecuta una búsqueda y usa **Capturar resultados para Seller OS**.

Si ya estaba instalada una versión anterior, reemplaza la carpeta extraída y pulsa
**Reload** en `chrome://extensions` o `edge://extensions`. La versión guiada actual es 1.2.2.

## Consulta guiada y patrones locales (v1.2.2)

Seller OS puede abrir Product Research con una consulta preparada en el fragmento
local de la URL. La extensión aplica la consulta automáticamente y el usuario sólo
pulsa “Capturar y continuar” cuando la tabla nueva está lista. “Aplicar y buscar” se
mantiene como fallback si eBay impide el submit automático. El fragmento no se envía
al servidor de eBay ni cambia los permisos de la extensión.

La misma captura analiza únicamente miniaturas que ya estén visibles en el viewport de Product Research. Chrome intenta leer un recorte temporal de la representación renderizada en memoria para derivar rasgos agregados (fondo, cobertura, complejidad y composición). El recorte y su buffer se eliminan inmediatamente.

La extensión no descarga imágenes, no abre versiones completas, no guarda ni lee URLs de imagen, no genera screenshots/base64/blobs y no transmite píxeles. Si Chrome bloquea la lectura por seguridad de origen, marca el análisis como no disponible y continúa la captura comercial normal.

La captura rápida usa un único snapshot de la cuadrícula visible, reutiliza geometría
y procesa primero las filas ancladas a Item IDs, incluso cuando eBay representa el
enlace mediante texto accesible o una imagen con `alt`. Después de importar, Seller OS puede
aplicar y ejecutar automáticamente la siguiente consulta agrupada después de cada captura
aceptada. La extensión espera resultados
nuevos y verifica que la consulta visible coincida antes de habilitar la siguiente captura;
nunca inicia sesión automáticamente. Si eBay recarga la página, conserva en el fragmento
local la consulta y una huella SHA-256 no reconstructiva de la tabla anterior; no guarda
Item IDs ni filas en storage y sólo reactiva la captura cuando prueba que los resultados cambiaron.

La extensión sólo se inyecta en la ruta oficial Product Research. No lee cookies,
tokens, contraseñas, datos de comprador, HTML completo ni archivos de imagen. La
tabla visible se entrega mediante `postMessage` a la URL canónica de Preview; la
extensión no hace solicitudes de red ni funciona en Production.
