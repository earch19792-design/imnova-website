# Transición local de Vercel con Supabase administrado

## Estado productivo actual

Esta configuración ejecuta la aplicación Next.js y su scheduler en Docker
local, publica Seller OS mediante Cloudflare Tunnel y mantiene el proyecto
Supabase remoto. Vercel ya no es necesario para servir Seller OS ni para sus
automatizaciones locales.

El contenedor web sólo escucha en `127.0.0.1:3100`; Cloudflare Tunnel es la
única entrada pública y presenta
`https://selleros.sunshineecommerce-llc.com`.

## Seguridad conservada

- El archivo `.env.local` se monta como secreto durante el build y no entra en
  ninguna capa de la imagen.
- El contenedor elimina la identidad heredada de Vercel y usa el límite
  explícito `selfhost`.
- El scheduler local corre con `LOCAL_SCHEDULER_DRY_RUN=false` y autentica sus
  llamadas con `CRON_SECRET`.
- Supabase continúa siendo el sistema de datos administrado.
- Las publicaciones de marketplaces permanecen fail-closed hasta una acción
  de negocio separada; migrar el hosting no habilita publicaciones.

## Preparación

1. Copiar `.env.selfhost.example` como `.env.selfhost.local`.
2. Empezar con `LOCAL_SCHEDULER_DRY_RUN=true` y cambiarlo a `false` sólo tras
   certificar dominio, túnel y rutas protegidas.
3. Crear un `CRON_SECRET` nuevo de al menos 32 caracteres antes de probar el
   perfil de automatización. No reutilizar claves de Supabase, eBay o Meta.
4. Ejecutar `npm run selfhost:preflight`.

## Construcción y prueba local

```text
npm run selfhost:build
npm run selfhost:up
npm run selfhost:status
```

La aplicación queda disponible en `http://127.0.0.1:3100`. Los registros se
consultan con `npm run selfhost:logs` y el entorno se detiene con
`npm run selfhost:down`.

## Arranque de Docker y almacenamiento en D:

Para que el servicio vuelva después de reiniciar Windows, activar **Start
Docker Desktop when you sign in** en **Docker Desktop > Settings > General**.
El contenedor ya tiene `restart: unless-stopped`, pero esa regla solo puede
actuar después de que Docker Desktop haya iniciado.

Si se desea reservar C: y usar la partición D:, abrir **Docker Desktop >
Settings > Resources > Advanced**, cambiar **Disk image location** a una
carpeta dedicada como `D:\DockerData` y usar **Apply & restart**. Dejar que
Docker Desktop haga el traslado y comprobar después que esta aplicación sigue
saludable. No mover manualmente `docker_data.vhdx` mientras Docker esté
instalado o ejecutándose.

## Automatizaciones

La sustitución de los Cron Jobs de Vercel vive en
`tools/selfhost-scheduler.mjs`. Incluye las colas operativas, la lectura
automática de Connie/Amazon cada seis horas y la recuperación pesada Quick
Pick una vez al día por la red privada de Docker.

```text
LOCAL_SCHEDULER_ONCE=true LOCAL_SCHEDULER_DRY_RUN=true node tools/selfhost-scheduler.mjs
```

El scheduler productivo debe mostrar `dryRun:false`, cinco trabajos cron y el
polling de cola activo. El relay privado de TEO apunta al dominio público de
Seller OS. El temporizador WSL de recuperación queda deshabilitado porque la
recuperación pesada ahora pertenece exclusivamente a Docker.

Los dispatchers cortos de Supabase conservan sus horarios, pero su URL cifrada
apunta a `https://selleros.sunshineecommerce-llc.com`; no deben conservar
referencias activas ni encabezados de protección de Vercel.

## Criterios antes de cancelar Vercel

- Contenedor saludable tras reinicio de Windows y Docker.
- Puerto local estable y sin conflicto con el servidor WSL existente en 3000.
- Origen HTTPS público verificado sin exponer directamente Docker ni Supabase.
- Variables del proyecto Vercel migradas sin imprimir secretos.
- Scheduler productivo con respuestas autenticadas.
- Relay privado de TEO activo y sus herramientas respondiendo por el dominio
  self-hosted.
- Recuperación pesada propiedad de Docker y temporizador WSL duplicado
  deshabilitado.
- Dispatchers de Supabase sin URL ni bypass activos de Vercel.
- eBay y Amazon SP-API certificados sin exponer credenciales.
- Connie visible y conectada; publicaciones de marketplace todavía cerradas.
- Archivo `.env.selfhost.production` ignorado por Git y preflight completo.
