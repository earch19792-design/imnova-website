import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

// No Golden terms, product IDs, credentials, network or listing package writes.
process.on('uncaughtException',error=>{console.error(error.message,error.detail??'',error.where??'');process.exit(1)})
const db = new PGlite({ extensions: { pgcrypto } })
await db.exec(`create schema extensions; create extension pgcrypto with schema extensions;
create role anon; create role authenticated; create role service_role;
create table marketplace_product_research_query_plans(id uuid primary key,
 marketplace_account_key text,status text,research_intelligence_status text,
 terminal_research_conclusion text,source_opportunity_id uuid,source_luna_product_id text,
 subject_supplier_variant_id text,source_candidate_key text,intelligence_contract_version text);
create table ebay_luna_opportunity_queue(id uuid primary key,assessment jsonb,supplier_product_id text,
 supplier_variant_id text,candidate_key text);
create table marketplace_product_research_query_tasks(id uuid primary key,plan_id uuid,
 marketplace_account_key text,query_hash text,search_query text,query_intent text,evidence_basis jsonb,
 strategy_version text,capture_batch_id uuid,commercial_evidence_entities jsonb,quality_status text);
create table marketplace_product_research_capture_observations(id uuid primary key,
 capture_batch_id uuid,evidence_semantics_versions jsonb);
create table seller_os_product_research_canonical_evidence_v2(plan_id uuid,marketplace_account_key text,
 item_id text,source_bounded_title_evidence text,confirmed_sold_quantity numeric,
 structural_classification text,structural_compatibility jsonb,structural_evidence jsonb,
 source_observation_id uuid,source_capture_batch_id uuid,source_evidence_deduplication_key text,
 evidence_semantics_version text,query_provenance_hashes jsonb,query_intents jsonb);`)
const prior = await readFile(new URL('../supabase/migrations/20260907234441_product_research_evidence_semantics_v1.sql',import.meta.url),'utf8')
const prior2 = await readFile(new URL('../supabase/migrations/20260907235511_product_research_evidence_semantics_v2.sql',import.meta.url),'utf8')
await db.exec(prior2.slice(prior2.indexOf('create or replace function'),prior2.indexOf('$$;')+3))
for (const name of ['normalize','terms','count','sizes','entity']) {
  const start = prior.indexOf(`create or replace function public.product_research_semantic_${name}_v1(`)
  await db.exec(prior.slice(start,prior.indexOf('$$;',start)+3))
}
const baseStart=prior.indexOf('create or replace function public.derive_product_research_evidence_semantics_v1(')
await db.exec(prior.slice(baseStart,prior.indexOf('$$;',baseStart)+3))
for(const fn of ['product_research_json_text_array_v1','derive_product_research_evidence_semantics_v2']) {
 const start=prior2.indexOf(`create or replace function public.${fn}(`)
 await db.exec(prior2.slice(start,prior2.indexOf('$$;',start)+3))
}
const migration=await readFile(new URL('../supabase/migrations/20260908094555_product_research_keyword_intelligence_v1.sql',import.meta.url),'utf8')
await db.exec(migration)
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const fact=(FIELD,VALUE)=>({FIELD,VALUE,SEMANTIC_CLASS:'FACT',EVIDENCE_STATUS:'PROVEN',
 EVIDENCE_ID:`receipt:${FIELD}`,SOURCE_EVIDENCE:[{SOURCE_AUTHORITY:'SUPPLIER',VALUE}],CONTRADICTION:false})
const truth={contractVersion:'LUNA_FIELD_PRODUCT_TRUTH_V1',sourceFingerprint:'truth-receipt',
 sourceReceiptIds:['source','snapshot'],fields:[fact('TITLE','3-piece nylon funnel set'),
 fact('MATERIAL','Nylon'),fact('COLOR','Blue'),fact('QUANTITY_OR_SET_COUNT',3),
 fact('FORM_FACTOR','Round'),fact('PACKAGE_CONTENTS',['3 funnels']),
 {FIELD:'BRAND',VALUE:null,SEMANTIC_CLASS:'MISSING',EVIDENCE_STATUS:'MISSING'},
 {FIELD:'MODEL',VALUE:null,SEMANTIC_CLASS:'MISSING',EVIDENCE_STATUS:'MISSING'},
 {FIELD:'MPN',VALUE:null,SEMANTIC_CLASS:'MISSING',EVIDENCE_STATUS:'MISSING'},
 {...fact('FEATURES',['Indestructible']),SEMANTIC_CLASS:'SUPPLIER_CLAIM',EVIDENCE_STATUS:'UNPROVEN'}]}
const ev=(n,title='3-piece round nylon funnels blue',classification='CLOSE_VARIANT_COMPARABLE')=>({
 item_id:String(100000000+n),source_bounded_title_evidence:title,confirmed_sold_quantity:5,
 structural_classification:classification,structural_compatibility:{entityCompatible:true,architectureCompatible:true,useCompatible:true},
 structural_evidence:{PRODUCT_ENTITY:{target:'funnel'}},source_observation_id:id(100+n),
 source_capture_batch_id:id(200+n),source_evidence_deduplication_key:`dedup:${n}`,
 evidence_semantics_version:'PRODUCT_RESEARCH_EVIDENCE_SEMANTICS_V2_2026_09_07',
 query_provenance_hashes:['query-a'],query_intents:['CORE_FAMILY_QUERY']})
const evidence=[ev(1),ev(2),ev(3,'Round nylon funnel set of 3 blue')]
const queries=[{query_hash:'query-a',query_intent:'CORE_FAMILY_QUERY'},{query_hash:'query-b',query_intent:'SEMANTIC_EXPANSION_QUERY'}]
const prereq={identityMatched:true,researchComplete:true}
async function derive(t=truth,e=evidence,q=queries,p=prereq) {
 return (await db.query('select derive_product_research_keyword_intelligence_v1($1,$2,$3,$4) d',
 [t,e,q,p].map(JSON.stringify))).rows[0].d
}
const term=(d,t)=>d.TERMS.find(x=>x.TERM===t)
async function test(name,fn){await fn();console.log(name)}
const good=await derive()
assert.equal(good.KEYWORD_DECISION_READY,true)
assert.equal(good.TERMS.filter(t=>t.CLASSIFICATION==='PRIMARY_KEYWORD').length,1)
await test('PASS_PRIMARY_REQUIRES_MARKET_AND_PRODUCT_TRUTH_SUPPORT',async()=>{
 assert.equal((await derive(truth,[])).PRIMARY_KEYWORD,'UNPROVEN')
 assert.equal((await derive({...truth,fields:truth.fields.filter(f=>f.FIELD!=='TITLE')})).PRIMARY_KEYWORD,'UNPROVEN')
 assert.equal((await derive(truth,evidence,queries,{...prereq,identityMatched:false})).KEYWORD_DECISION_READY,false)
 assert.equal((await derive({...truth,fields:truth.fields.map(f=>({...f,SOURCE_EVIDENCE:[]}))})).KEYWORD_DECISION_READY,false)
})
for(const [name,classification] of [['PASS_ADJACENT_TERMS_NOT_POSITIVELY_WEIGHTED','ADJACENT_BUT_NOT_COMPARABLE'],['PASS_FALSE_POSITIVES_NOT_POSITIVELY_WEIGHTED','FALSE_POSITIVE']]) {
 await test(name,async()=>{
  const d=await derive(truth,[...evidence,{...ev(4,'nylon funnels drain plumbing',classification),confirmed_sold_quantity:10000}])
  assert.equal(d.COMPARABLE_ITEM_COUNT,3);assert.equal(d.SOLD_EVIDENCE_QUANTITY,15)
  assert.equal(term(d,'plumbing').CLASSIFICATION,'REJECTED_TERMS')
  assert.equal(term(d,'plumbing').MARKET_SUPPORT.TERM_FREQUENCY,0)
 })
}
const dup=await derive(truth,[...evidence,{...evidence[0],query_provenance_hashes:['query-b'],query_intents:['SEMANTIC_EXPANSION_QUERY']}])
await test('PASS_DUPLICATE_ITEM_NOT_DOUBLE_COUNTED',()=>{
 assert.equal(dup.COMPARABLE_ITEM_COUNT,3);assert.equal(dup.SOLD_EVIDENCE_QUANTITY,15)
 assert.equal(term(dup,'funnel').COMPARABLE_ITEM_COUNT,3)
})
await test('PASS_MULTI_QUERY_PROVENANCE_PRESERVED',()=>{
 assert.deepEqual(dup.CANONICAL_ITEMS[0].QUERY_PROVENANCE,['query-a','query-b'])
 assert.deepEqual(dup.CANONICAL_ITEMS[0].QUERY_INTENTS,['CORE_FAMILY_QUERY','SEMANTIC_EXPANSION_QUERY'])
})
await test('PASS_UNPROVEN_BRAND_NOT_PROMOTED',async()=>{
 const d=await derive(truth,evidence.map(e=>({...e,source_bounded_title_evidence:'Acme '+e.source_bounded_title_evidence})))
 assert.equal(term(d,'acme').CLASSIFICATION,'REJECTED_TERMS')
})
await test('PASS_SUPPLIER_CLAIM_NOT_PROMOTED_TO_FACT',async()=>{
 const d=await derive(truth,evidence.map(e=>({...e,source_bounded_title_evidence:e.source_bounded_title_evidence+' Indestructible'})))
 assert.equal(term(d,'indestructible').CLASSIFICATION,'REJECTED_TERMS')
 assert.equal(term(d,'indestructible').PRODUCT_TRUTH_SUPPORT.SUPPORTED,false)
 assert.equal(term(d,'indestructible').REASONING_BASIS,'SUPPLIER_CLAIM_NOT_SAFE_FOR_KEYWORD_PROMOTION')
})
await test('PASS_SEMANTIC_EXPANSION_REQUIRES_FAMILY_SUPPORT',async()=>{
 const t={...truth,fields:[fact('TITLE','nylon shovel'),fact('MATERIAL','Nylon'),fact('PACKAGE_CONTENTS',['one spade'])]}
 const e=[ev(1,'nylon shovel spade'),ev(2,'nylon shovel spade')].map(x=>({...x,structural_evidence:{PRODUCT_ENTITY:{target:'shovel'}}}))
 assert.equal(term(await derive(t,e),'spade').CLASSIFICATION,'SEMANTIC_EXPANSIONS')
 assert.equal(term(await derive(t,e.map(x=>({...x,structural_classification:'ADJACENT_BUT_NOT_COMPARABLE'}))),'spade').CLASSIFICATION,'REJECTED_TERMS')
 const noTruth={...t,fields:t.fields.filter(f=>f.FIELD!=='PACKAGE_CONTENTS')}
 assert.equal(term(await derive(noTruth,e),'spade').CLASSIFICATION,'REJECTED_TERMS')
})
await test('PASS_REJECTED_TERM_REASON_PERSISTED',async()=>{
 const d=await derive(truth,[...evidence,ev(4,'Brandname drain funnels','FALSE_POSITIVE')])
 for(const t of d.TERMS.filter(x=>x.CLASSIFICATION==='REJECTED_TERMS')) assert.ok(t.REASONING_BASIS)
 assert.equal(JSON.parse(JSON.stringify(d)).TERMS.find(x=>x.TERM==='drain').REASONING_BASIS,'STRUCTURALLY_INCOMPATIBLE_OR_ADJACENT_ONLY')
})
await test('PASS_UNPROVEN_SELLER_DIVERSITY_NOT_ZERO',()=>assert.deepEqual(good.SELLER_DIVERSITY,{STATUS:'UNPROVEN',VALUE:null}))
await test('PASS_UNPROVEN_PRICE_NOT_REQUIRED_FOR_KEYWORD_DECISION',()=>{
 assert.deepEqual(good.PRICE_BAND,{STATUS:'UNPROVEN',VALUE:null});assert.equal(good.KEYWORD_DECISION_READY,true)
})
await test('PASS_IDEMPOTENT_RECOMPUTE',async()=>{
 assert.deepEqual(await derive(),good)
 assert.equal((await derive(truth,[...evidence].reverse(),[...queries].reverse())).INPUT_FINGERPRINT,good.INPUT_FINGERPRINT)
 assert.equal((await derive(truth,[...evidence,evidence[0]])).INPUT_FINGERPRINT,good.INPUT_FINGERPRINT)
})
await test('PASS_CONFLICTING_ITEM_AND_MISSING_PROVENANCE_FAIL_CLOSED',async()=>{
 const d=await derive(truth,[...evidence,{...evidence[0],structural_classification:'FALSE_POSITIVE'}])
 assert.equal(d.COMPARABLE_ITEM_COUNT,2)
 assert.equal((await derive(truth,evidence,[])).KEYWORD_DECISION_READY,false)
})
async function insert(table,obj) {
 await db.query(`insert into ${table} select * from jsonb_populate_record(null::${table},$1)`,[JSON.stringify(obj)])
}
await test('PASS_EXISTING_ELIGIBLE_COHORT_RECOVERABLE',async()=>{
 for(const n of [1,2]){
  await insert('ebay_luna_opportunity_queue',{id:id(n),assessment:{productTruth:{fieldTruthV1:{...truth,fields:[...truth.fields,fact('LUNA_PRODUCT_ID',`p${n}`),fact('LUNA_VARIANT_ID',`v${n}`)]}}},supplier_product_id:`p${n}`,supplier_variant_id:`v${n}`,candidate_key:`c${n}`})
  await insert('marketplace_product_research_query_plans',{id:id(n),marketplace_account_key:'test',status:'COMPLETED',
   research_intelligence_status:'COMMERCIALLY_SUFFICIENT',terminal_research_conclusion:n===1?'EVIDENCE_SUFFICIENT':null,
   source_opportunity_id:id(n),source_luna_product_id:`p${n}`,subject_supplier_variant_id:`v${n}`,source_candidate_key:`c${n}`,intelligence_contract_version:'version'})
  for(const e of evidence) await insert('seller_os_product_research_canonical_evidence_v2',{...e,plan_id:id(n),marketplace_account_key:'test'})
  await insert('marketplace_product_research_query_tasks',{id:id(n),plan_id:id(n),marketplace_account_key:'test',query_hash:'query-a',
   query_intent:'CORE_FAMILY_QUERY',strategy_version:'version',evidence_basis:[]})
 }
 const before=(await db.query('select id,keyword_intelligence_decision from marketplace_product_research_query_plans order by id')).rows
 assert.ok(before.every(p=>p.keyword_intelligence_decision.KEYWORD_DECISION_READY)) // normal task trigger
 const r=(await db.query('select recover_product_research_keyword_intelligence_v1() r')).rows[0].r
 assert.equal(r.PROCESSED_COUNT,2);assert.ok(r.RESULTS.every(x=>!x.CHANGED))
 const page=(await db.query('select recover_product_research_keyword_intelligence_v1($1,1) r',[id(1)])).rows[0].r
 assert.equal(page.PROCESSED_COUNT,1)
 await db.query("update marketplace_product_research_query_plans set status='ACTIVE' where id=$1",[id(1)])
 assert.equal((await db.query('select keyword_intelligence_decision from marketplace_product_research_query_plans where id=$1',[id(1)])).rows[0].keyword_intelligence_decision.KEYWORD_DECISION_READY,false)
 await db.query("update ebay_luna_opportunity_queue set assessment=$1 where id=$2",[JSON.stringify({productTruth:{fieldTruthV1:{...truth,fields:[]}}}),id(2)])
 assert.equal((await db.query('select keyword_intelligence_decision from marketplace_product_research_query_plans where id=$1',[id(2)])).rows[0].keyword_intelligence_decision.KEYWORD_DECISION_READY,false)
})
await test('PASS_CURRENT_TRUTH_REVALIDATES_OLD_STRUCTURAL_CLASSIFICATION',async()=>{
 const t={...truth,fields:truth.fields.map(f=>f.FIELD==='FORM_FACTOR'?fact('FORM_FACTOR','Conical'):f)}
 const d=await derive(t,evidence)
 assert.equal(d.KEYWORD_DECISION_READY,false);assert.equal(d.COMPARABLE_ITEM_COUNT,0)
 const contradicted={...truth,fields:truth.fields.map(f=>f.FIELD==='MATERIAL'?{...f,SEMANTIC_CLASS:'CONTRADICTED'}:f)}
 assert.equal((await derive(contradicted)).KEYWORD_DECISION_READY,false)
})
await test('PASS_NO_NEW_AUTHORITY_OR_DOWNSTREAM_WRITES',async()=>{
 assert.doesNotMatch(migration,/create table|security definer|update public.ebay_listing_packages|9266387058912|ITEM1046/i)
 for(const role of ['anon','authenticated']) {
  const r=(await db.query("select has_function_privilege($1,'public.recover_product_research_keyword_intelligence_v1(uuid,integer)','EXECUTE') allowed",[role])).rows[0]
  assert.equal(r.allowed,false)
 }
})
await db.close()
