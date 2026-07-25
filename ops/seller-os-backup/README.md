# Seller OS backup y recuperación local

Este toolkit crea un respaldo lógico cifrado de la base Seller OS desde
Ubuntu/WSL. No instala servicios, no contiene credenciales y no conoce una base
de Production por defecto.

La secuencia principal sigue la guía oficial de Supabase:
[Backup and Restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).

## Qué incluye

Cada ejecución genera un paquete con fecha y hora UTC:

- roles de PostgreSQL (`roles.sql`);
- schema lógico (`schema.sql`);
- datos mediante `COPY` (`data.sql`), excluyendo
  `storage.buckets_vectors` y `storage.vector_indexes`;
- schema y datos de `supabase_migrations`;
- un archivo suplementario `pg_dump --format=custom`, utilizado para validar
  el catálogo con `pg_restore --list`;
- manifiesto JSON sanitizado, checksum SHA-256 y cifrado GPG.

Los SQL de Supabase son la fuente autoritativa del restore. El custom archive
es una verificación/fallback suplementario; no sustituye el orden documentado
de restauración.

## Qué no incluye

- Los bytes de objetos de Supabase Storage. Deben respaldarse y restaurarse por
  un proceso separado usando la API de Storage.
- Cambios personalizados hechos directamente en los schemas administrados
  `auth` y `storage`. Supabase indica que deben revisarse por separado con
  `supabase db diff --linked --schema auth,storage`.
- Edge Functions, secretos, variables de entorno, OAuth, dominios o scheduler.
- La encryption root key de un proyecto. Para Vault o columnas cifradas, sigue
  el procedimiento oficial de Supabase antes de declarar una recuperación
  completa.

Si Supabase CLI o Docker no están disponibles, el respaldo falla. Nunca se
degrada silenciosamente a una copia parcial.

## Requisitos locales

- Ubuntu o Ubuntu bajo WSL2.
- Supabase CLI y Docker funcionando.
- PostgreSQL client (`psql`, `pg_dump`, `pg_restore`).
- GnuPG, `tar`, `sha256sum`, `flock`, Python 3 y `realpath`.
- Una llave pública GPG local para el destinatario configurado.
- Archivos de configuración propiedad de `root`, modo `0600` o `0400`.

No ejecutes los scripts con `bash -x`: una URL de base es un secreto.

## Configuración del backup

```bash
sudo install -d -m 0700 /etc/seller-os
sudo install -o root -g root -m 0600 \
  ops/seller-os-backup/backup.env.example \
  /etc/seller-os/backup.env
sudoedit /etc/seller-os/backup.env
```

Completa localmente:

- `SELLER_OS_BACKUP_SOURCE_DATABASE_URL`: connection string de la fuente;
- `SELLER_OS_BACKUP_SOURCE_LABEL`: etiqueta no secreta, por ejemplo una etiqueta
  de entorno;
- `SELLER_OS_BACKUP_GPG_RECIPIENT`: fingerprint o identificador de llave GPG;
- `SELLER_OS_BACKUP_DIR`: opcional; por defecto `/var/backups/seller-os`;
- `SELLER_OS_BACKUP_RETENTION_DAYS`: opcional; por defecto 30.

El directorio debe terminar exactamente en `/seller-os`, ser propiedad de root,
modo `0700`, y no atravesar symlinks. Esta restricción evita borrar o escribir
accidentalmente en una ruta amplia durante la retención.

## Ejecutar manualmente

```bash
sudo ./ops/seller-os-backup/backup.sh
```

El resultado muestra solamente el `backup_id` y la ruta cifrada. Nunca imprime
la URL, contraseña, hostname ni nombre de base. `flock` impide dos backups
simultáneos.

## Verificar sin restaurar

La verificación comprueba checksum, manifiesto, descifrado GPG, miembros exactos
del tar y catálogo del custom archive:

```bash
sudo ./ops/seller-os-backup/restore.sh verify \
  --backup-id seller-os_ENV_YYYYMMDDTHHMMSSZ
```

Los archivos descifrados viven únicamente en un directorio temporal privado y
se eliminan al salir.

## Recuperar en un proyecto nuevo

Primero crea un proyecto Supabase nuevo y configura las extensiones requeridas.
No utilices la fuente ni un proyecto que ya contenga datos de aplicación.

```bash
sudo install -o root -g root -m 0600 \
  ops/seller-os-backup/restore.env.example \
  /etc/seller-os/restore.env
sudoedit /etc/seller-os/restore.env
```

Completa una URL y etiqueta explícitas para el destino nuevo. Luego ejecuta:

```bash
sudo ./ops/seller-os-backup/restore.sh restore \
  --backup-id seller-os_ENV_YYYYMMDDTHHMMSSZ \
  --confirm "RESTORE seller-os_ENV_YYYYMMDDTHHMMSSZ TO DESTINATION_LABEL"
```

El restore se niega si:

- falta la URL o etiqueta del destino;
- etiqueta, fingerprint de conexión o fingerprint vivo coinciden con la fuente;
- el destino tiene relaciones de aplicación o historial CLI existente;
- el token escrito no coincide exactamente;
- el destino parece Production sin el reconocimiento adicional documentado en
  `restore.env.example`;
- checksum, GPG, tar o `pg_restore --list` fallan.

No se usa `pg_restore --clean`, `DROP`, reset ni reemplazo destructivo. El
restore usa una sola transacción `psql`, `ON_ERROR_STOP`, y el orden:

1. roles;
2. schema;
3. `SET session_replication_role = replica`;
4. data;
5. reactivar `session_replication_role`;
6. schema y datos de migration history.

Un proyecto Supabase nuevo ya contiene schemas administrados como `auth` y
`storage`; el preflight permite esa base administrada pero exige cero relaciones
de aplicación y cero migraciones del proyecto.

Para un destino etiquetado deliberadamente como Production, además del token
por backup se exige configurar explícitamente
`SELLER_OS_RESTORE_ALLOW_PRODUCTION=I_ACKNOWLEDGE_EMPTY_PRODUCTION_TARGET`. Esto
no omite el preflight vacío ni permite sobrescribir una base existente.

## Auditoría

Los archivos `backup-audit.log` y `restore-audit.log` contienen fecha UTC,
acción, `backup_id`, etiquetas y resultado. No contienen URLs, credenciales,
hostnames ni SQL. Tienen modo `0600`.

## Timer opcional en Ubuntu/WSL

Los templates están en `systemd/` y no se instalan automáticamente. Antes de
copiarlos, ajusta `ExecStart` a la ruta real del repositorio. Después, un
administrador puede copiarlos a `/etc/systemd/system/`, ejecutar
`systemctl daemon-reload` y habilitar el timer.

El service template usa `GNUPGHOME=/etc/seller-os/gnupg`. Importa allí solamente
la llave pública del destinatario y conserva el directorio como root. La llave
privada necesaria para `verify`/`restore` no debe copiarse al servidor del timer.

Para habilitar systemd en WSL, edita `/etc/wsl.conf`:

```ini
[boot]
systemd=true
```

Desde PowerShell, reinicia WSL:

```powershell
wsl --shutdown
```

El timer sólo corre mientras WSL está activo. Para asegurar el arranque desde
Windows, Task Scheduler puede ejecutar, con la distribución correcta:

```powershell
wsl.exe -d Ubuntu -u root --exec /usr/bin/systemctl start seller-os-backup.service
```

Comprueba manualmente el primer backup y `verify` antes de habilitar cualquier
timer. Mantén además una copia cifrada fuera del mismo disco; un respaldo local
único no es recuperación ante desastre.
