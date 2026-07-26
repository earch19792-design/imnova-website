# Seller OS UX Fase 1 - rollback

1. Reasignar `imnova-ebay-mobile-preprod.vercel.app` al deployment Preview anterior.
2. Como alternativa no destructiva, establecer `SELLER_OS_UX_V2_ENABLED=false` sólo en Preview y reconstruir.
3. No revertir máquinas de estado, datos, expedientes ni migraciones: esta fase no los modifica.
4. No usar `git reset`, borrar rutas ni eliminar componentes legacy durante el incidente.
5. Crear un commit compensatorio revisado si la corrección debe permanecer en la rama.

El rollback no requiere cambios en Supabase, eBay, Meta, OpenAI ni Production.
