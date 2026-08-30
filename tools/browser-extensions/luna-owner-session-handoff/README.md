# Seller OS — Luna Owner Session Handoff V1

Extensión MV3 owner-only y separada de Luna Shipping Capture. Su única función
es cifrar y transferir al Vault staging la sesión de una pestaña Luna donde la
propietaria ya está autenticada.

## Instalación owner-only

1. Descarga o actualiza el repo canónico en la workstation de la propietaria.
2. Abre `chrome://extensions` y activa **Developer mode**.
3. Pulsa **Load unpacked** y elige esta carpeta completa:
   `tools/browser-extensions/luna-owner-session-handoff`.
4. Fija **Seller OS — Luna Owner Session Handoff** en la barra de Chrome.

No instales esta extensión en la computadora de la asistente.

## Renovación

1. Abre Luna en Chrome normal y confirma que la sesión ya está autenticada.
2. Abre la pantalla protegida de Seller OS preprod y pulsa **Renovar sesión**.
3. Cuando Seller OS confirme el challenge fresco, abre el icono de esta
   extensión y pulsa **Comprobar conexión**. El permiso Luna todavía no se
   solicita en esta fase.
4. Cuando aparezca `LUNA_OWNER_EXTENSION_ADMIN_CONTEXT_CONFIRMED`, pulsa
   **Transferir sesión a Seller OS**.
5. Acepta el permiso temporal y vuelve a Seller OS para verificar
   `SESSION_READY`.

## Diagnóstico exacto del contrato de cookies

Sin crear challenge ni transferir sesión, abre una sola pestaña Luna autenticada
en `account.lunaportex.com` y la pantalla admin protegida en otra pestaña. En el
popup pulsa **Diagnosticar contrato exacto**. La extensión compara las cookies
que Chrome aplicaría a la ruta autenticada final —sin query ni fragment— con las
que aplicaría al consumer HTTP server-side `https://www.lunaportex.com/account`.
Muestra sólo conteos y clases seguras de host/path y revoca el permiso temporal
al terminar. No muestra nombres ni valores y no envía el resultado al backend.

## Frontera de seguridad

- No usa Playwright, CDP, native messaging, daemon, túnel ni automatización del
  navegador.
- No navega Luna, no automatiza login/Cloudflare y no usa `<all_urls>`.
- Reconoce la pantalla admin mediante un handshake con su content script exacto;
  no solicita permiso `tabs` ni permiso host adicional para Seller OS.
- `cookies` y los únicos dos hosts Luna están declarados como opcionales. Se
  solicitan desde el clic explícito de la propietaria y se revocan al terminar.
- La captura versionada conserva por separado las cookies aplicables al consumer
  `https://www.lunaportex.com/account` y a la ruta autenticada final en
  `account.lunaportex.com`. Cifra un jar bounded con domain/path/secure/expiry;
  nunca concatena cookies de hosts distintos en un único header.
- No declara ni usa `chrome.storage`, localStorage, sessionStorage, clipboard,
  analytics, logs o archivos.
- De esas dos consultas exactas conserva únicamente los nombres allowlisted por
  el contrato Luna existente. Los mantiene en memoria, cifra con AES-256-GCM +
  RSA-OAEP SHA-256 y limpia los buffers mutables en `finally`.
- El diagnóstico local no cambia ese selector: permite probar primero si el
  host autenticado posee identidades host-only que el consumer `www` no recibe.
- La página admin realiza el PUT same-origin del sobre cifrado. El servidor
  conserva los gates existentes de admin, boundary, nonce, TTL, replay,
  validación Luna y Vault readback.
- La extensión Luna Shipping Capture permanece separada y sin permiso de
  cookies.
