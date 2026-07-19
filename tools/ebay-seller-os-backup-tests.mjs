import assert from "node:assert/strict"
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import test from "node:test"

const root = process.cwd()
const toolkit = path.join(root, "ops/seller-os-backup")
const read = (relative) => readFileSync(path.join(root, relative), "utf8")
const backup = read("ops/seller-os-backup/backup.sh")
const restore = read("ops/seller-os-backup/restore.sh")
const library = read("ops/seller-os-backup/lib.sh")
const readme = read("ops/seller-os-backup/README.md")

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    ...options,
  })
}

function executableShell(source) {
  return source
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n")
}

test("backup uses the documented Supabase logical set plus a custom archive supplement", () => {
  assert.match(backup, /supabase db dump --db-url[\s\S]*--role-only/)
  assert.match(backup, /supabase db dump --db-url[\s\S]*--use-copy --data-only[\s\S]*-x "storage\.buckets_vectors" -x "storage\.vector_indexes"/)
  assert.match(backup, /--schema supabase_migrations/)
  assert.match(backup, /pg_dump --format=custom --no-owner --no-privileges/)
  assert.match(backup, /pg_restore --list/)
  assert.match(backup, /tar --create --format=posix/)
  assert.match(backup, /gpg --batch --no-tty --encrypt/)
  assert.match(backup, /sha256sum/)
  assert.match(backup, /flock -n 9/)
  assert.match(backup, /date -u \+%Y%m%dT%H%M%SZ/)
  assert.match(backup, /SELLER_OS_BACKUP_RETENTION_DAYS/)
  assert.match(backup, /-mtime "\+\$retention_days" -delete/)
  assert.match(library, /sourceConnectionFingerprintSha256/)
  assert.match(library, /storageObjectBytes": False/)
  assert.match(library, /customAuthStorageSchemaChanges": False/)
})

test("root-only config parsing, strict directory validation and manifests expose no secrets", () => {
  assert.match(library, /ENV_FILE_ROOT_OWNERSHIP_REQUIRED/)
  assert.match(library, /ENV_FILE_MODE_0400_OR_0600_REQUIRED/)
  assert.match(library, /BACKUP_DIR_BASENAME_MUST_BE_SELLER_OS/)
  assert.match(library, /BACKUP_DIR_SYMLINK_COMPONENT_REJECTED/)
  assert.match(library, /BACKUP_DIR_MODE_0700_REQUIRED/)
  assert.doesNotMatch(library, /source\s+"?\$env_file|eval\s/)
  assert.match(library, /MANIFEST_SECRET_MATERIAL_REJECTED/)
  for (const file of ["backup.env.example", "restore.env.example"]) {
    const assignments = read(`ops/seller-os-backup/${file}`)
      .split("\n")
      .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line))
    assert.ok(assignments.length >= 3)
    assert.ok(assignments.every((line) => line.endsWith("=")), `${file} must contain no values`)
  }
  assert.doesNotMatch(
    [backup, restore, library, read("ops/seller-os-backup/backup.env.example"), read("ops/seller-os-backup/restore.env.example")].join("\n"),
    /postgres(?:ql)?:\/\/[^\s"']+@/,
  )
})

test("verify and restore are fail-closed, non-destructive and ordered", () => {
  assert.match(restore, /sha256sum --check --strict --status/)
  assert.match(restore, /gpg --batch --no-tty --decrypt/)
  assert.match(restore, /seller_os_validate_tar_members/)
  assert.match(restore, /pg_restore --list/)
  assert.match(restore, /DESTINATION_DATABASE_URL_REQUIRED/)
  assert.match(restore, /RESTORE_SOURCE_DESTINATION_LABEL_MATCH/)
  assert.match(restore, /RESTORE_SOURCE_DESTINATION_CONNECTION_MATCH/)
  assert.match(restore, /RESTORE_SOURCE_DESTINATION_DATABASE_MATCH/)
  assert.match(restore, /RESTORE_CONFIRMATION_TOKEN_MISMATCH/)
  assert.match(restore, /RESTORE_TARGET_APPLICATION_RELATIONS_NOT_EMPTY/)
  assert.match(restore, /RESTORE_TARGET_MIGRATION_HISTORY_NOT_EMPTY/)
  assert.match(restore, /PRODUCTION_RESTORE_SEPARATE_ACKNOWLEDGEMENT_REQUIRED/)
  assert.match(restore, /psql --single-transaction --variable=ON_ERROR_STOP=1/)
  const transaction = restore.slice(restore.indexOf("psql --single-transaction"))
  const ordered = [
    '--file "$roles_file"',
    '--file "$schema_file"',
    "SET session_replication_role = replica",
    '--file "$data_file"',
    "SET session_replication_role = origin",
    '--file "$history_schema_file"',
    '--file "$history_data_file"',
  ].map((needle) => transaction.indexOf(needle))
  assert.ok(ordered.every((index) => index >= 0))
  assert.deepEqual([...ordered].sort((a, b) => a - b), ordered)
  const executable = executableShell(restore)
  assert.doesNotMatch(executable, /pg_restore[^\n]*(?:--clean|-c\b)/)
  assert.doesNotMatch(executable, /\bDROP\s+(?:DATABASE|SCHEMA|TABLE)\b/i)
  assert.doesNotMatch(executable, /\bgit\s+clean\b|reset\s+--hard/)
})

test("documentation is explicit about WSL, storage gaps, auth/storage changes and new targets", () => {
  assert.match(readme, /wsl --shutdown/i)
  assert.match(readme, /Task Scheduler/i)
  assert.match(readme, /Storage/i)
  assert.match(readme, /auth.*storage/is)
  assert.match(readme, /proyecto Supabase nuevo/i)
  assert.match(readme, /no se instalan automáticamente/i)
  assert.match(readme, /copia cifrada fuera del mismo disco/i)
  const service = read("ops/seller-os-backup/systemd/seller-os-backup.service")
  const timer = read("ops/seller-os-backup/systemd/seller-os-backup.timer")
  assert.match(service, /Type=oneshot/)
  assert.match(service, /ProtectSystem=strict/)
  assert.match(timer, /Persistent=true/)
  assert.match(timer, /OnCalendar=.*UTC/)
})

test("connection fingerprints ignore passwords but distinguish database identities", () => {
  const invoke = (url) => run("bash", ["-c", `source "${toolkit}/lib.sh"; seller_os_connection_fingerprint "$1"`, "test", url])
  const first = invoke("postgresql://postgres.project-a:password-one@pooler.example.test:5432/postgres")
  const rotatedPassword = invoke("postgresql://postgres.project-a:password-two@pooler.example.test:5432/postgres")
  const anotherProject = invoke("postgresql://postgres.project-b:password-one@pooler.example.test:5432/postgres")
  const supabasePooler = invoke("postgresql://postgres.abcdefgh:password@aws-0-region.pooler.supabase.com:5432/postgres")
  const supabaseDirect = invoke("postgresql://postgres:password@db.abcdefgh.supabase.co:5432/postgres")
  assert.equal(first.status, 0, first.stderr)
  assert.equal(rotatedPassword.status, 0, rotatedPassword.stderr)
  assert.equal(anotherProject.status, 0, anotherProject.stderr)
  assert.equal(supabasePooler.status, 0, supabasePooler.stderr)
  assert.equal(supabaseDirect.status, 0, supabaseDirect.stderr)
  assert.equal(first.stdout.trim(), rotatedPassword.stdout.trim())
  assert.notEqual(first.stdout.trim(), anotherProject.stdout.trim())
  assert.equal(supabasePooler.stdout.trim(), supabaseDirect.stdout.trim())
  assert.match(first.stdout.trim(), /^[0-9a-f]{64}$/)
  assert.doesNotMatch(first.stdout, /password|pooler|postgres\.project/i)
})

test("the root env parser treats shell syntax as inert data", () => {
  const temp = mkdtempSync(path.join(tmpdir(), "seller-os-env-test-"))
  try {
    const marker = path.join(temp, "must-not-exist")
    const envFile = path.join(temp, "root.env")
    writeFileSync(envFile, `ALLOWED=$(touch ${marker})\n`, { mode: 0o600 })
    const command = `
      source "${toolkit}/lib.sh"
      stat() { if [[ "$2" == "%u" ]]; then printf '0\\n'; else printf '600\\n'; fi; }
      seller_os_load_root_env_file "$1" ALLOWED
      printf '%s' "$ALLOWED"
    `
    const result = run("bash", ["-c", command, "test", envFile])
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, `$(touch ${marker})`)
    assert.equal(existsSync(marker), false)
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})

function writeMockTools(directory) {
  const mock = path.join(directory, "mock-tool")
  const source = `#!/usr/bin/env bash
set -eu
tool=$(basename "$0")
printf '%s' "$tool" >> "$MOCK_LOG"
printf ' %q' "$@" >> "$MOCK_LOG"
printf '\\n' >> "$MOCK_LOG"
case "$tool" in
  stat)
    if [[ "$2" == "%u" ]]; then printf '0\\n'; exit 0; fi
    target=\${@: -1}
    if [[ "$target" == */seller-os ]]; then printf '700\\n'; else printf '600\\n'; fi
    ;;
  docker) exit 0 ;;
  supabase)
    if [[ "\${1:-}" == "--version" ]]; then printf 'mock\\n'; exit 0; fi
    output=""; previous=""
    for argument in "$@"; do
      if [[ "$previous" == "-f" ]]; then output="$argument"; fi
      previous="$argument"
    done
    [[ -n "$output" ]] || exit 2
    printf '%s\\n' '-- mocked logical SQL --' 'select 1;' > "$output"
    ;;
  psql)
    joined="$*"
    if [[ "$joined" == *"current_database()"* ]]; then
      if [[ "$joined" == *"source.example.test"* ]]; then
        printf 'source-db\\037192.0.2.10\\0375432\\n'
      else
        printf 'destination-db\\037192.0.2.20\\0375432\\n'
      fi
    elif [[ "$joined" == *"from pg_class"* || "$joined" == *"to_regclass"* ]]; then
      printf '0\\n'
    fi
    ;;
  pg_dump)
    output=""
    for argument in "$@"; do
      case "$argument" in --file=*) output=\${argument#--file=} ;; esac
    done
    [[ -n "$output" ]] || exit 2
    printf 'PGDMPmock\\n' > "$output"
    ;;
  pg_restore) exit 0 ;;
  gpg)
    joined="$*"
    [[ "$joined" == *"--list-keys"* ]] && exit 0
    output=""; previous=""; input=""
    for argument in "$@"; do
      if [[ "$previous" == "--output" ]]; then output="$argument"; fi
      previous="$argument"
      input="$argument"
    done
    [[ -n "$output" && -n "$input" ]] || exit 2
    cp -- "$input" "$output"
    ;;
  *) exit 2 ;;
esac
`
  writeFileSync(mock, source, { mode: 0o755 })
  for (const name of ["stat", "docker", "supabase", "psql", "pg_dump", "pg_restore", "gpg"]) {
    symlinkSync("mock-tool", path.join(directory, name))
  }
}

function writeMockEnvironment(directory) {
  const mock = path.join(directory, "mock-env.sh")
  const lines = [
    "mock_log_command() {",
    "  local tool=$1",
    "  shift",
    "  printf '%s' \"$tool\" >> \"$MOCK_LOG\"",
    "  printf ' %q' \"$@\" >> \"$MOCK_LOG\"",
    "  printf '\\n' >> \"$MOCK_LOG\"",
    "}",
    "stat() {",
    "  mock_log_command stat \"$@\"",
    "  if [[ \"$2\" == \"%u\" ]]; then printf '0\\n'; return 0; fi",
    "  local target=${@: -1}",
    "  if [[ \"$target\" == */seller-os ]]; then printf '700\\n'; else printf '600\\n'; fi",
    "}",
    "docker() { mock_log_command docker \"$@\"; return 0; }",
    "supabase() {",
    "  mock_log_command supabase \"$@\"",
    "  if [[ \"${1:-}\" == \"--version\" ]]; then printf 'mock\\n'; return 0; fi",
    "  local output= previous= argument",
    "  for argument in \"$@\"; do",
    "    if [[ \"$previous\" == \"-f\" ]]; then output=$argument; fi",
    "    previous=$argument",
    "  done",
    "  [[ -n \"$output\" ]] || return 2",
    "  printf '%s\\n' '-- mocked logical SQL --' 'select 1;' > \"$output\"",
    "}",
    "psql() {",
    "  mock_log_command psql \"$@\"",
    "  local joined=\"$*\"",
    "  if [[ \"$joined\" == *\"current_database()\"* ]]; then",
    "    if [[ \"$joined\" == *\"source.example.test\"* ]]; then",
    "      printf 'source-db\\037192.0.2.10\\0375432\\n'",
    "    else",
    "      printf 'destination-db\\037192.0.2.20\\0375432\\n'",
    "    fi",
    "  elif [[ \"$joined\" == *\"from pg_class\"* || \"$joined\" == *\"to_regclass\"* ]]; then",
    "    printf '0\\n'",
    "  fi",
    "}",
    "pg_dump() {",
    "  mock_log_command pg_dump \"$@\"",
    "  local output= argument",
    "  for argument in \"$@\"; do",
    "    case \"$argument\" in --file=*) output=${argument#--file=} ;; esac",
    "  done",
    "  [[ -n \"$output\" ]] || return 2",
    "  printf 'PGDMPmock\\n' > \"$output\"",
    "}",
    "pg_restore() { mock_log_command pg_restore \"$@\"; return 0; }",
    "gpg() {",
    "  mock_log_command gpg \"$@\"",
    "  local joined=\"$*\"",
    "  [[ \"$joined\" == *\"--list-keys\"* ]] && return 0",
    "  local output= previous= input= argument",
    "  for argument in \"$@\"; do",
    "    if [[ \"$previous\" == \"--output\" ]]; then output=$argument; fi",
    "    previous=$argument",
    "    input=$argument",
    "  done",
    "  [[ -n \"$output\" && -n \"$input\" ]] || return 2",
    "  cp -- \"$input\" \"$output\"",
    "}",
    "export -f mock_log_command stat docker supabase psql pg_dump pg_restore gpg",
    "",
  ]
  writeFileSync(mock, lines.join("\n"), { mode: 0o600 })
  return mock
}

test("mocked backup, verify and empty-target restore complete without network access", () => {
  const temp = mkdtempSync(path.join(tmpdir(), "seller-os-backup-runtime-"))
  try {
    const mockBin = path.join(temp, "bin")
    const secureTmp = path.join(temp, "tmp")
    const backupDir = path.join(temp, "backups", "seller-os")
    mkdirSync(mockBin, { recursive: true, mode: 0o700 })
    mkdirSync(secureTmp, { recursive: true, mode: 0o700 })
    writeMockTools(mockBin)
    const mockEnvironment = writeMockEnvironment(mockBin)
    const mockLog = path.join(temp, "commands.log")
    writeFileSync(mockLog, "")
    const backupEnv = path.join(temp, "backup.env")
    writeFileSync(backupEnv, [
      "SELLER_OS_BACKUP_SOURCE_DATABASE_URL=postgresql://source_user:source_password@source.example.test:5432/postgres",
      "SELLER_OS_BACKUP_SOURCE_LABEL=imnova-staging",
      "SELLER_OS_BACKUP_GPG_RECIPIENT=backup-key",
      `SELLER_OS_BACKUP_DIR=${backupDir}`,
      "SELLER_OS_BACKUP_RETENTION_DAYS=30",
      "",
    ].join("\n"), { mode: 0o600 })
    const env = {
      ...process.env,
      PATH: `${mockBin}:/usr/local/bin:/usr/bin:/bin`,
      BASH_ENV: mockEnvironment,
      MOCK_LOG: mockLog,
      TMPDIR: secureTmp,
    }
    const mockPreflight = run("bash", ["-c", "type stat; type supabase"], { env })
    assert.equal(mockPreflight.status, 0, mockPreflight.stderr)
    assert.match(mockPreflight.stdout, /stat is a function/)
    assert.match(mockPreflight.stdout, /supabase is a function/)
    const backupRun = run("bash", [path.join(toolkit, "backup.sh"), "--env-file", backupEnv], { env })
    assert.equal(backupRun.status, 0, backupRun.stderr)
    const backupId = backupRun.stdout.match(/Seller OS backup completed: (seller-os_[^\s]+)/)?.[1]
    assert.ok(backupId)
    const files = readdirSync(backupDir)
    assert.ok(files.includes(`${backupId}.tar.gpg`))
    assert.ok(files.includes(`${backupId}.manifest.json`))
    assert.ok(files.includes(`${backupId}.sha256`))
    const manifest = JSON.parse(readFileSync(path.join(backupDir, `${backupId}.manifest.json`), "utf8"))
    assert.equal(manifest.coverage.storageObjectBytes, false)
    assert.equal(manifest.coverage.customAuthStorageSchemaChanges, false)
    assert.doesNotMatch(JSON.stringify(manifest), /source_password|source\.example|postgresql:\/\//)

    const verifyRun = run("bash", [
      path.join(toolkit, "restore.sh"), "verify",
      "--backup-id", backupId,
      "--backup-dir", backupDir,
    ], { env })
    assert.equal(verifyRun.status, 0, verifyRun.stderr)
    assert.match(verifyRun.stdout, /backup verified/)

    const restoreEnv = path.join(temp, "restore.env")
    const destinationLabel = "imnova-restore-dr"
    writeFileSync(restoreEnv, [
      "SELLER_OS_RESTORE_DESTINATION_DATABASE_URL=postgresql://destination_user:destination_password@destination.example.test:5432/postgres",
      `SELLER_OS_RESTORE_DESTINATION_LABEL=${destinationLabel}`,
      "SELLER_OS_RESTORE_ALLOW_PRODUCTION=",
      "",
    ].join("\n"), { mode: 0o600 })
    const confirmation = `RESTORE ${backupId} TO ${destinationLabel}`
    const restoreRun = run("bash", [
      path.join(toolkit, "restore.sh"), "restore",
      "--backup-id", backupId,
      "--backup-dir", backupDir,
      "--env-file", restoreEnv,
      "--confirm", confirmation,
    ], { env })
    assert.equal(restoreRun.status, 0, restoreRun.stderr)
    assert.match(restoreRun.stdout, /restore completed/)

    const commandLog = readFileSync(mockLog, "utf8")
    assert.match(commandLog, /supabase db dump/)
    assert.match(commandLog, /pg_dump --format=custom/)
    assert.match(commandLog, /pg_restore --list/)
    const restorePsql = commandLog.split("\n").find((line) => line.startsWith("psql --single-transaction")) ?? ""
    assert.match(restorePsql, /--variable=ON_ERROR_STOP=1/)
    assert.match(restorePsql, /roles\.sql/)
    assert.match(restorePsql, /schema\.sql/)
    assert.match(restorePsql, /data\.sql/)
    assert.match(restorePsql, /history_schema\.sql/)
    assert.match(restorePsql, /history_data\.sql/)
    assert.doesNotMatch(restorePsql, /--clean|-c\b|DROP/i)
    const restoreAudit = readFileSync(path.join(backupDir, "restore-audit.log"), "utf8")
    assert.match(restoreAudit, /action=RESTORE/)
    assert.match(restoreAudit, /outcome=COMPLETED/)
    assert.doesNotMatch(restoreAudit, /password|postgresql:\/\/|example\.test/i)
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})

test("shell syntax and public help execute without touching a database", () => {
  const syntax = run("bash", ["-n",
    path.join(toolkit, "lib.sh"),
    path.join(toolkit, "backup.sh"),
    path.join(toolkit, "restore.sh"),
  ])
  assert.equal(syntax.status, 0, syntax.stderr)
  for (const invocation of [
    [path.join(toolkit, "backup.sh"), "--help"],
    [path.join(toolkit, "restore.sh"), "--help"],
  ]) {
    const result = run("bash", invocation)
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /Usage:/)
  }
})
