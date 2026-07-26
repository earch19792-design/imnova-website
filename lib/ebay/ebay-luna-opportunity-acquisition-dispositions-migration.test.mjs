import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const migration = fs.readFileSync(path.join(
  repositoryRoot,
  "supabase/migrations/20260726135000_create_ebay_luna_opportunity_acquisition_dispositions.sql",
), "utf8");
const rollback = fs.readFileSync(path.join(
  repositoryRoot,
  "supabase/rollback/20260726135000_create_ebay_luna_opportunity_acquisition_dispositions.down.sql",
), "utf8");

function executableSql(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--[^\r\n]*/g, "");
}

test("disposition ledger is account scoped, immutable and idempotent", () => {
  assert.match(migration, /account_key text not null/);
  assert.match(migration, /marketplace text not null/);
  assert.match(migration, /on delete restrict/g);
  assert.match(migration, /idempotency_key text not null unique/);
  assert.match(migration, /unique\s*\(\s*account_key,\s*marketplace,\s*opportunity_id/is);
  assert.match(migration, /before update or delete/is);
  assert.match(migration, /force row level security/i);
  assert.match(migration, /from public, anon, authenticated, service_role/i);
  assert.match(migration, /grant select, insert[\s\S]*to service_role/i);
});

test("backfill accepts only exact SKU or exact product and variant", () => {
  const executableMigration = executableSql(migration);
  assert.match(migration, /match_method in \('PRODUCT_VARIANT', 'SUPPLIER_SKU'\)/);
  assert.match(
    migration,
    /opportunity\.market_radar_product_id::text\s*=\s*identity\.market_radar_product_id/,
  );
  assert.match(
    migration,
    /trim\(opportunity\.supplier_variant_id\)\s*=\s*trim\(identity\.supplier_variant_id\)/,
  );
  assert.match(
    migration,
    /upper\(trim\(opportunity\.supplier_sku\)\)\s*=\s*upper\(trim\(identity\.(?:supplier_sku|ebay_sku)\)\)/,
  );
  assert.match(migration, /identity\.identity_status <> 'ENDED'/);
  assert.doesNotMatch(
    executableMigration,
    /\b(?:ilike|similarity|levenshtein)\b/i,
  );
  assert.doesNotMatch(migration, /opportunity\.(?:product_)?title\s*=/i);
});

test("eligible-reader anti-joins before ordering and LIMIT", () => {
  const functionStart = migration.indexOf(
    "create or replace function\n  public.read_eligible_ebay_luna_opportunities_v2",
  );
  assert.notEqual(functionStart, -1);
  const reader = migration.slice(functionStart);
  const antiJoinAt = reader.indexOf("and not exists");
  const orderAt = reader.indexOf("order by");
  const limitAt = reader.indexOf("limit p_limit");
  assert.ok(antiJoinAt > 0);
  assert.ok(orderAt > antiJoinAt);
  assert.ok(limitAt > orderAt);
  assert.match(reader, /disposition\.account_key = p_account_key/);
  assert.match(reader, /disposition\.marketplace = p_marketplace/);
  assert.match(reader, /p_offset between 0 and 1000000/);
  assert.match(reader, /limit p_limit\s*offset p_offset/);
  assert.doesNotMatch(migration, /update public\.ebay_luna_opportunity_queue/i);
});

test("migration and rollback preserve audit and perform no external effect", () => {
  const destructiveStatement =
    /\bdelete\s+from\b|\btruncate(?:\s+table)?\b|\bdrop\s+table\b/i;
  assert.doesNotMatch(migration, destructiveStatement);
  assert.doesNotMatch(rollback, destructiveStatement);
  assert.match(migration, /ebay_writes integer not null default 0/);
  assert.match(migration, /production_changed boolean not null default false/);
  assert.match(rollback, /revoke execute[\s\S]*from service_role/i);
  assert.match(rollback, /immutable account-scoped audit retained/i);
});
