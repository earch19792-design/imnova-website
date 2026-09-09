import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"

const migration = readFileSync(new URL("../../supabase/migrations/20260909201820_assistant_generated_image_visual_handoff_v1.sql", import.meta.url), "utf8")
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
test("automatic image admission requires durable QA, exact origin and full human review; pending discovery skips completed manifests", async () => {
  const db = new PGlite()
  try {
    const json = new Set(["transformation", "qa_result", "source_image_references", "provenance"])
    const uuids = new Set(["id", "mayel_visual_task_id", "listing_package_id", "uploaded_by", "approved_by", "opportunity_id"])
    const ints = new Set(["output_width", "output_height", "output_bytes"])
    const bools = new Set(["rights_evidence_confirmed"])
    const names = new Set([...migration.matchAll(/new\.([a-z_][a-z0-9_]*)/g)].map(m => m[1]))
    for (const name of ["declared_mime_type", "actual_mime_type", "source_image_references"]) names.add(name)
    const columns = [...names].map(name => `${name} ${json.has(name) ? "jsonb" : uuids.has(name) ? "uuid" : ints.has(name) ? "integer" : bools.has(name) ? "boolean" : "text"}`)
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create table public.ebay_listing_image_assets (${columns.join(",")});
      create table public.ebay_mayel_visual_tasks_v1 (id uuid primary key, marketplace_account_key text, ebay_item_id text, selection_authority text, selection_signal jsonb,
        assigned_operator_user_id uuid, product_truth_version text, product_truth_digest text, source_image_set_digest text,
        prompt_contract_version text, candidate_key text, opportunity_id uuid, status text, current_image_set jsonb,
        source_image_references jsonb, visual_manifest_id uuid, visual_manifest_digest text, updated_at timestamptz);
      create table public.ebay_listing_experiments_v1 (experiment_id uuid primary key, account_key text, marketplace text,
        ebay_item_id text, experiment_type text, lifecycle_status text, baseline_evidence_ref jsonb);
      create table public.ebay_mayel_visual_phase_b_executions_v1 (marketplace_account_key text, visual_task_id uuid, visual_manifest_digest text, phase text);`)
    await db.exec(migration)
    await db.exec(`create trigger approval_guard before insert or update on public.ebay_listing_image_assets
      for each row execute function public.block_non_passed_image_approval_v1();`)
    const taskId = id(1), assetId = id(2), experimentId = id(3), actor = id(4), opportunity = id(5), itemId = "366643122092"
    const digest = `sha256:${"a".repeat(64)}`, sourceUrl = "https://example.com/source.jpg"
    await db.query(`insert into public.ebay_mayel_visual_tasks_v1(id,marketplace_account_key,ebay_item_id,assigned_operator_user_id,product_truth_version,product_truth_digest,source_image_set_digest,prompt_contract_version,candidate_key,opportunity_id,status,current_image_set,source_image_references,visual_manifest_id,visual_manifest_digest,updated_at) values($1,'account',$2,$3,'TRUTH_V1',$4,$4,'MAYEL_CHATGPT_VISUAL_PROMPT_V1','candidate',$5,'MAYEL_REVIEW_PENDING',$6,$7,$8,'manifest',now())`,
      [taskId,itemId,actor,digest,opportunity,JSON.stringify([sourceUrl]),JSON.stringify([{ url: sourceUrl }]),id(6)])
    const variant = { assetId, outputSha256: "b".repeat(64), outputStoragePath: `seller-os-visual-variants/${itemId}/${experimentId}/variant-a.png`,
      status: "EXPERIMENT_READY", variantRejected: false, productTruthPreserved: true, protectedLayerRoundtripExact: true,
      sourceImageFullResolutionCertified: true, backgroundQa: { passed: true } }
    await db.query(`insert into public.ebay_listing_experiments_v1 values($1,'account','EBAY_US',$2,'HERO_VISUAL_VARIANT','DRAFT',$3)`,
      [experimentId,itemId,{ sellerOsVisualVariant: { contractVersion: "SELLER_OS_VISUAL_VARIANT_V1_2026_08_29", experimentId,
        ebayItemId: itemId, sourceImageUrl: sourceUrl, variants: [variant] } }])
    const checks = Object.fromEntries(["productIdentityPreserved","colorPreserved","shapePreserved","partCountPreserved","visibleLogosPreserved","noInventedAccessories","noUnsupportedClaims","noUnauthorizedText","roleMatchesOutput"].map(k => [k,true]))
    const asset = { id: assetId, status: "approved", mayel_visual_task_id: taskId, listing_package_id: null, source_kind: "owned_upload",
      source_type: "SELLER_OS_ASSISTANT_IMAGE_VARIANT", uploaded_by: actor, approved_by: actor, rights_basis: "owned", rights_evidence_confirmed: true,
      authorization_reference: `SELLER_OS_ASSISTANT_VARIANT:${experimentId}`, transformation_version: "SELLER_OS_ASSISTANT_OUTPUT_NORMALIZATION_V1",
      transformation: { method: "PRESERVED_FULL_FRAME", output: "1600_SQUARE_JPEG", generativeAiUsedBySellerOs: true },
      source_sha256: variant.outputSha256, output_sha256: "c".repeat(64), output_width:1600, output_height:1600, output_bytes:100,
      mayel_output_role:"DETAIL", mayel_approval_status:"APPROVED", owner_approval_status:"PENDING",
      product_truth_version:"TRUTH_V1", product_truth_digest:digest, source_image_set_digest:digest,
      prompt_contract_version:"MAYEL_CHATGPT_VISUAL_PROMPT_V1", candidate_key:"candidate", opportunity_id:opportunity, account_key:"account",
      qa_result:{automaticStatus:"PASSED",humanReview:{decision:"APPROVE",checks}}, source_image_references:[{url:sourceUrl}],
      declared_mime_type:"image/png", actual_mime_type:"image/png", provenance:{generatedOrigin:{experimentId, outputStoragePath:variant.outputStoragePath}} }
    async function insert(value) {
      const keys=Object.keys(value)
      return db.query(`insert into public.ebay_listing_image_assets (${keys.join(",")}) values (${keys.map((_,i)=>`$${i+1}`).join(",")})`,keys.map(k=>json.has(k) ? JSON.stringify(value[k]) : value[k]))
    }
    await insert(asset)
    await assert.rejects(insert({...asset, approved_by:id(7)}),/SOURCE_VISUAL_POLICY_NOT_PASSED/)
    await assert.rejects(insert({...asset, source_sha256:"d".repeat(64)}),/SOURCE_VISUAL_POLICY_NOT_PASSED/)
    await assert.rejects(insert({...asset, qa_result:{automaticStatus:"PASSED",humanReview:{decision:"APPROVE",checks:{...checks,noInventedAccessories:false}}}}),/SOURCE_VISUAL_POLICY_NOT_PASSED/)
    await db.query("update public.ebay_listing_experiments_v1 set baseline_evidence_ref=jsonb_set(baseline_evidence_ref,'{sellerOsVisualVariant,variants,0,backgroundQa,passed}','false')")
    await assert.rejects(insert(asset),/SOURCE_VISUAL_POLICY_NOT_PASSED/)
    // The previous manual source contract continues to work with the same QA.
    await insert({...asset, source_type:"CHATGPT_SUBSCRIPTION_MAYEL", authorization_reference:`MAYEL_CHATGPT_SUBSCRIPTION:${taskId}`,
      transformation_version:"MAYEL_CHATGPT_OUTPUT_NORMALIZATION_V1", transformation:{...asset.transformation,generativeAiUsedBySellerOs:false}})
    await db.exec("update public.ebay_mayel_visual_tasks_v1 set status='OWNER_PREVIEW_READY'")
    for(let n=10;n<14;n++) await db.query(`insert into public.ebay_mayel_visual_tasks_v1(id,marketplace_account_key,ebay_item_id,status,visual_manifest_id,visual_manifest_digest,updated_at)
      values($1,'account',$2,'OWNER_PREVIEW_READY',$3,'done',now()-interval '1 day')`,[id(n),String(366643122000+n),id(n+100)])
    for(let n=10;n<14;n++) await db.query(`insert into public.ebay_mayel_visual_phase_b_executions_v1 values('account',$1,'done','APPLIED_AND_OFFICIALLY_VERIFIED')`,[id(n)])
    const pending=await db.query("select id from public.seller_os_pending_mayel_visual_manifests_v1('account')")
    assert.deepEqual(pending.rows.map(r=>r.id),[taskId])
    assert.equal((await db.query("select id from public.seller_os_pending_mayel_visual_manifests_v1('other')")).rows.length,0)
    await db.exec(`create function public.promote_ebay_mayel_visual_asset_v1(text,uuid,uuid,uuid,text,text,jsonb,jsonb,text)
      returns jsonb language sql as $$ select '{"existingAtomicPromotionCalled":true}'::jsonb $$;`)
    const args=["account",actor,taskId,assetId,"path","https://example.com/asset.jpg",{}, {},"new-manifest","manifest"]
    const promotionSql="select public.seller_os_promote_assistant_image_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as result"
    assert.equal((await db.query(promotionSql,args)).rows[0].result.existingAtomicPromotionCalled,true)
    await assert.rejects(db.query(promotionSql,[...args.slice(0,9),"stale-manifest"]),/REVIEW_MANIFEST_CHANGED/)
    await db.exec("set role authenticated")
    await assert.rejects(db.query("select id from public.seller_os_pending_mayel_visual_manifests_v1('account')"),/permission denied/)
  } finally { await db.close() }
})
