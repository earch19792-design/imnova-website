import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../supabase/migrations/20260726072000_add_listing_factory_shadow_observability.sql",
  import.meta.url,
);
const rollbackUrl = new URL(
  "../../supabase/rollback/20260726072000_add_listing_factory_shadow_observability.down.sql",
  import.meta.url,
);

const viewNames = [
  "ebay_listing_factory_intervention_baseline_v1",
  "ebay_listing_factory_dossier_utilization_v1",
  "ebay_listing_factory_shadow_bridge_coverage_v1",
];
const rpcName = "shadow_initialize_ebay_listing_factory_run_v1";

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertReadOnlyAcl(sql, relationName) {
  const escapedName = escapeRegExp(relationName);
  const revoke = sql.match(
    new RegExp(
      `revoke\\s+all\\s+on\\s+(?:table\\s+)?public\\.${escapedName}\\s+from\\s+([^;]+);`,
      "i",
    ),
  );

  assert.ok(revoke, `${relationName} must revoke browser access`);
  for (const role of ["public", "anon", "authenticated"]) {
    assert.match(revoke[1], new RegExp(`\\b${role}\\b`, "i"));
  }
  assert.match(
    sql,
    new RegExp(
      `grant\\s+select\\s+on\\s+(?:table\\s+)?public\\.${escapedName}\\s+to\\s+service_role\\s*;`,
      "i",
    ),
  );
}

test("shadow observability migration is read-only, guarded, and fully reversible", async () => {
  const [migration, rollback] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(rollbackUrl, "utf8"),
  ]);

  assert.match(migration, /^\s*begin\s*;/i);
  assert.match(migration, /commit\s*;\s*$/i);

  const createdViews =
    migration.match(
      /create\s+or\s+replace\s+view\s+public\.ebay_listing_factory_[a-z0-9_]+_v1\b/gi,
    ) ?? [];
  assert.equal(createdViews.length, 3);

  const securityInvokerDeclarations =
    migration.match(
      /with\s*\(\s*security_invoker\s*=\s*true\s*\)/gi,
    ) ?? [];
  assert.equal(securityInvokerDeclarations.length, 3);

  for (const viewName of viewNames) {
    assert.match(
      migration,
      new RegExp(
        `create\\s+or\\s+replace\\s+view\\s+public\\.${escapeRegExp(viewName)}\\b`,
        "i",
      ),
    );
    assertReadOnlyAcl(migration, viewName);
  }

  const rpcStart = migration.search(
    new RegExp(
      `create\\s+or\\s+replace\\s+function\\s+public\\.${rpcName}\\s*\\(`,
      "i",
    ),
  );
  assert.notEqual(rpcStart, -1);

  const migrationAfterRpcStart = migration.slice(rpcStart);
  const rpcAclOffset = migrationAfterRpcStart.search(
    new RegExp(
      `revoke\\s+all\\s+on\\s+function\\s+public\\.${rpcName}\\s*\\(`,
      "i",
    ),
  );
  assert.notEqual(rpcAclOffset, -1);
  const rpc = migrationAfterRpcStart.slice(0, rpcAclOffset);

  assert.match(
    migration,
    new RegExp(
      `function\\s+public\\.${rpcName}\\s*\\(\\s*uuid\\s*,\\s*text\\s*,\\s*uuid\\s*,\\s*timestamptz\\s*\\)\\s+from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated\\s*;`,
      "i",
    ),
  );
  assert.match(
    migration,
    new RegExp(
      `grant\\s+execute\\s+on\\s+function\\s+public\\.${rpcName}\\s*\\(\\s*uuid\\s*,\\s*text\\s*,\\s*uuid\\s*,\\s*timestamptz\\s*\\)\\s+to\\s+service_role\\s*;`,
      "i",
    ),
  );

  assert.match(rpc, /\bpg_advisory_xact_lock\s*\(/i);
  assert.match(rpc, /\bv_run\.factory_mode\b[\s\S]{0,120}'DRY_RUN'/i);
  assert.match(rpc, /\bv_run\.publication_kill_switch_engaged\b/i);
  assert.match(rpc, /\bv_run\.automatic_publication_allowed\b/i);
  assert.match(
    rpc,
    /\binitialize_ebay_listing_factory_run_v1\s*\(/i,
  );

  const effectOutboxReads =
    rpc.match(
      /\bfrom\s+public\.ebay_listing_factory_effect_outbox\b/gi,
    ) ?? [];
  assert.equal(effectOutboxReads.length, 2);
  assert.match(rpc, /LISTING_FACTORY_SHADOW_EFFECTS_MUST_BE_ZERO/i);
  assert.match(rpc, /LISTING_FACTORY_SHADOW_POSTCONDITION_FAILED/i);

  assert.doesNotMatch(
    rpc,
    /\b(?:insert\s+into|update|delete\s+from)\s+public\.ebay_listing_factory_effect_outbox\b/i,
  );
  assert.doesNotMatch(
    rpc,
    /\b(?:insert\s+into|update|delete\s+from)\s+public\.ebay_listing_factory_dossiers\b/i,
  );
  assert.doesNotMatch(
    rpc,
    /\bupdate\s+public\.ebay_same_day_pilot_(?:runs|candidates)\b/i,
  );
  assert.doesNotMatch(rpc, /\bset\s+(?:status|machine_state)\s*=/i);
  assert.doesNotMatch(
    rpc,
    /\b(?:publishOffer|createOffer|putInventoryItem|prepare_ebay_listing_factory_effect_v1|claim_ebay_listing_factory_effect_v1)\b/i,
  );

  const advisoryLockIndex = rpc.search(/\bpg_advisory_xact_lock\s*\(/i);
  const initializerIndex = rpc.search(
    /\binitialize_ebay_listing_factory_run_v1\s*\(/i,
  );
  assert.ok(advisoryLockIndex < initializerIndex);

  assert.match(rollback, /^\s*begin\s*;/i);
  assert.match(rollback, /commit\s*;\s*$/i);

  const functionDropIndex = rollback.search(
    new RegExp(
      `drop\\s+function\\s+if\\s+exists\\s+public\\.${rpcName}\\s*\\(\\s*uuid\\s*,\\s*text\\s*,\\s*uuid\\s*,\\s*timestamptz\\s*\\)`,
      "i",
    ),
  );
  assert.notEqual(functionDropIndex, -1);

  for (const viewName of viewNames) {
    const viewDropIndex = rollback.search(
      new RegExp(
        `drop\\s+view\\s+if\\s+exists\\s+public\\.${escapeRegExp(viewName)}\\b`,
        "i",
      ),
    );
    assert.notEqual(viewDropIndex, -1);
    assert.ok(functionDropIndex < viewDropIndex);
  }

  assert.doesNotMatch(
    rollback,
    /\b(?:drop\s+table|truncate|delete\s+from)\b/i,
  );
});
