import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

// No Golden terms, product IDs, credentials, network or listing package writes.
process.on('uncaughtException',error=>{console.error(error.message,error.detail??'',error.where??'',error.internalQuery?.slice(Math.max(0,Number(error.internalPosition)-180),Number(error.internalPosition)+180)??'');process.exit(1)})
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
 sourceReceiptIds:['source','snapshot'],fields:[fact('TITLE','nylon funnel'),
 fact('MATERIAL','Nylon'),fact('COLOR','Blue'),fact('QUANTITY_OR_SET_COUNT',3),
 fact('PACKAGE_CONTENTS',['3 funnels']),
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
const evidence=Array.from({length:8},(_,i)=>({...ev(i+1,'nylon funnel'),query_provenance_hashes:['query-a','query-b']}))
const queries=[{query_hash:'query-a',query_intent:'CORE_FAMILY_QUERY'},{query_hash:'query-b',query_intent:'SEMANTIC_EXPANSION_QUERY'}]
const prereq={identityMatched:true,researchComplete:true}
async function derive(t=truth,e=evidence,q=queries,p=prereq) {
 return (await db.query('select derive_product_research_keyword_intelligence_v2_1($1,$2,$3,$4) d',
 [t,e,q,p].map(JSON.stringify))).rows[0].d
}
const term=(d,t)=>d.TERMS.find(x=>x.TERM===t)
async function test(name,fn){await fn();console.log(name)}

const migrationV2Base=await readFile(new URL('../supabase/migrations/20260908101453_product_research_keyword_intelligence_v2.sql',import.meta.url),'utf8')
await db.exec(migrationV2Base)
const migrationV2=await readFile(new URL('../supabase/migrations/20260908103043_product_research_keyword_concept_boundaries_v2_1.sql',import.meta.url),'utf8')
await db.exec(migrationV2)

const good=await derive()
const promoted=d=>d.TERMS.filter(t=>t.CLASSIFICATION!=='REJECTED_TERMS')
await test('PASS_GENERIC_HEAD_NOUN_DOES_NOT_WIN_BY_COVERAGE_ALONE',async()=>{
 const d=await derive(truth,evidence.map((e,i)=>i<6?e:{...e,source_bounded_title_evidence:'funnel'}))
 assert.equal(d.PRIMARY_KEYWORD,'nylon funnel')
 assert.equal(term(d,'funnel').ITEM_COVERAGE.MATCHED,8)
 assert.equal(term(d,'nylon funnel').ITEM_COVERAGE.MATCHED,6)
 assert.ok(term(d,'funnel').GENERICITY_PENALTY>0)
})
await test('PASS_GENERIC_HEAD_NOUN_CAN_WIN_WHEN_EVIDENCE_JUSTIFIES',async()=>{
 const d=await derive(truth,evidence.map(e=>({...e,source_bounded_title_evidence:'funnel'})))
 assert.equal(d.PRIMARY_KEYWORD,'funnel')
 assert.match(term(d,'funnel').WHY_PRIMARY,/NO_DISCRIMINATIVE_CHILD/)
})
await test('PASS_MULTI_TOKEN_QUERY_CONCEPT_CAN_OUTRANK_COMPONENT_TOKEN',()=>{
 assert.equal(good.PRIMARY_KEYWORD,'nylon funnel')
 assert.ok(term(good,'nylon funnel').SCORE>term(good,'funnel').SCORE)
 assert.equal(term(good,'nylon funnel').SPECIFICITY_SCORE,20)
})
await test('PASS_LONGER_PHRASE_DOES_NOT_WIN_BY_LENGTH_ALONE',async()=>{
 const t={...truth,fields:[...truth.fields,fact('FORM_FACTOR','very long narrow')]}
 const e=evidence.map((e,i)=>({...e,source_bounded_title_evidence:i<2?'nylon very long narrow funnel':'nylon funnel'}))
 const d=await derive(t,e)
 assert.equal(d.PRIMARY_KEYWORD,'nylon funnel')
 assert.equal(term(d,'very long narrow funnel').PRIMARY_ELIGIBLE,false)
 assert.equal(term(d,'very long narrow funnel').SPECIFICITY_SCORE,term(d,'nylon funnel').SPECIFICITY_SCORE)
})
await test('PASS_COMPOSITIONAL_PARENT_CHILD_RECOGNIZED',()=>{
 const c=term(good,'nylon funnel')
 assert.equal(c.CONCEPT_TYPE,'QUALIFIED_CONCEPT')
 assert.equal(c.SEMANTIC_RELATIONSHIP.PARENT_CONCEPT,'funnel')
 assert.equal(c.SEMANTIC_RELATIONSHIP.CHILD_CONCEPT,'nylon funnel')
 assert.equal(term(good,'nylon').CONCEPT_TYPE,'ATTRIBUTE_QUALIFIER')
 assert.equal(term(good,'funnel').WHY_SECONDARY,'PARENT_HEAD_RETAINED_WITHOUT_DOUBLE_CREDIT')
})
await test('PASS_PHRASE_AND_TOKEN_DO_NOT_DOUBLE_COUNT_SAME_ITEM',()=>{
 assert.equal(good.COMPARABLE_ITEM_COUNT,8)
 assert.equal(term(good,'nylon funnel').COMPARABLE_ITEM_COUNT,8)
 assert.equal(term(good,'nylon funnel').SEMANTIC_RELATIONSHIP.INCREMENTAL_MARKET_SUPPORT.NEW_UNIQUE_ITEMS_VS_HEAD,0)
 assert.equal(good.ANCESTOR_SUPPORT_ADDED,false)
 assert.equal(good.SOLD_EVIDENCE_QUANTITY,40)
})
const aliasTruth={...truth,fields:[...truth.fields.filter(f=>f.FIELD!=='PACKAGE_CONTENTS'),fact('PACKAGE_CONTENTS',['one pourer'])]}
const aliasEvidence=evidence.map(e=>({...e,source_bounded_title_evidence:'nylon funnel pourer'}))
await test('PASS_SEMANTIC_EXPANSION_REQUIRES_MARKETPLACE_SUPPORT',async()=>{
 const yes=await derive(aliasTruth,aliasEvidence)
 assert.equal(term(yes,'pourer').CLASSIFICATION,'SEMANTIC_EXPANSIONS')
 assert.equal(term(await derive(aliasTruth),'pourer').CLASSIFICATION,'REJECTED_TERMS')
 const once=await derive(aliasTruth,[aliasEvidence[0],...evidence.slice(1)])
 assert.equal(term(once,'pourer').CLASSIFICATION,'REJECTED_TERMS')
})
for(const [name,classification] of [
 ['PASS_SEMANTIC_EXPANSION_NOT_SOURCED_FROM_ADJACENT','ADJACENT_BUT_NOT_COMPARABLE'],
 ['PASS_SEMANTIC_EXPANSION_NOT_SOURCED_FROM_FALSE_POSITIVE','FALSE_POSITIVE']]) {
 await test(name,async()=>{
  const d=await derive(aliasTruth,[...evidence,...aliasEvidence.map((e,i)=>({...e,item_id:String(200000000+i),structural_classification:classification,confirmed_sold_quantity:9999}))])
  assert.equal(term(d,'pourer').CLASSIFICATION,'REJECTED_TERMS')
  assert.equal(term(d,'pourer').SOLD_EVIDENCE_SUPPORT.CONFIRMED_QUANTITY,0)
  assert.equal(d.SOLD_EVIDENCE_QUANTITY,40)
 })
}
await test('PASS_NO_DICTIONARY_ONLY_DEMAND_PROOF',async()=>{
 const d=await derive(truth,evidence,[...queries,{query_hash:'dictionary-query',query_intent:'SEMANTIC_EXPANSION_QUERY',search_query:'nylon decanter',dictionary:{funnel:'decanter'}}])
 assert.ok(!promoted(d).some(t=>t.TERM.includes('decanter')))
 assert.equal(d.SEMANTIC_EXPANSION_RECALL_AUDIT.DICTIONARY_PROVES_DEMAND,false)
})
const dupe=await derive(truth,[...evidence,{...evidence[0],query_provenance_hashes:['query-extra']}],
 [...queries,{query_hash:'query-extra',query_intent:'SEMANTIC_EXPANSION_QUERY'}])
await test('PASS_DUPLICATE_ITEMS_ACROSS_QUERIES_DEDUPED',()=>{
 assert.equal(dupe.COMPARABLE_ITEM_COUNT,8)
 assert.equal(term(dupe,'nylon funnel').ITEM_COVERAGE.MATCHED,8)
 assert.equal(dupe.SOLD_EVIDENCE_QUANTITY,40)
})
await test('PASS_MULTI_QUERY_PROVENANCE_PRESERVED',()=>{
 assert.deepEqual(dupe.CANONICAL_ITEMS[0].QUERY_PROVENANCE,['query-a','query-b','query-extra'])
 assert.equal(term(dupe,'nylon funnel').MARKET_SUPPORT.QUERY_DIVERSITY,3)
})
await test('PASS_PRODUCT_TRUTH_COMPATIBILITY_REQUIRED',async()=>{
 const d=await derive({...truth,fields:truth.fields.filter(f=>f.FIELD!=='MATERIAL')})
 assert.ok(!promoted(d).some(t=>t.TERM.includes('nylon')))
 const wrong=await derive(truth,evidence,queries,{...prereq,identityMatched:false})
 assert.equal(wrong.KEYWORD_DECISION_READY,false)
})
await test('PASS_UNPROVEN_BRAND_MODEL_MPN_NOT_PROMOTED',async()=>{
 const d=await derive(truth,evidence.map(e=>({...e,source_bounded_title_evidence:'Acme Z991 MX203 nylon funnel'})))
 for(const x of ['acme','z991','mx203']) assert.equal(term(d,x).CLASSIFICATION,'REJECTED_TERMS')
 assert.equal(d.FIELD_PROMOTION_BLOCKERS.filter(x=>['BRAND','MODEL','MPN'].includes(x.FIELD)).length,3)
})
await test('PASS_SUPPLIER_CLAIM_REMAINS_CLAIM',async()=>{
 const d=await derive(truth,evidence.map(e=>({...e,source_bounded_title_evidence:'Indestructible nylon funnel'})))
 assert.equal(term(d,'indestructible').CLASSIFICATION,'REJECTED_TERMS')
 assert.equal(term(d,'indestructible').PRODUCT_TRUTH_SUPPORT.SUPPORTED,false)
 assert.ok(!promoted(d).some(t=>t.TERM.includes('indestructible')))
})
await test('PASS_UNPROVEN_SELLER_DIVERSITY_REMAINS_UNPROVEN',()=>assert.deepEqual(good.SELLER_DIVERSITY,{STATUS:'UNPROVEN',VALUE:null}))
await test('PASS_UNPROVEN_PRICE_REMAINS_UNPROVEN',()=>assert.deepEqual(good.PRICE_BAND,{STATUS:'UNPROVEN',VALUE:null}))
await test('PASS_IDEMPOTENT_RECOMPUTE',async()=>{
 assert.deepEqual(await derive(),good)
 const reordered=await derive(truth,[...evidence].reverse(),[...queries].reverse())
 assert.deepEqual(reordered.TERMS,good.TERMS)
 assert.equal(reordered.INPUT_FINGERPRINT,good.INPUT_FINGERPRINT)
 const same=await derive(truth,[...evidence,evidence[0]])
 assert.deepEqual(same.TERMS,good.TERMS)
 assert.equal(same.INPUT_FINGERPRINT,good.INPUT_FINGERPRINT)
})
await test('PASS_COHORT_NO_GOLDEN_SPECIAL_CASE',()=>{
 assert.doesNotMatch(migrationV2,/9266387058912|48907793826016|ITEM1046|47e287d5|strainer|stainless steel|sieve|Teo|Owner/i)
})
await test('PASS_OBSERVED_ELISION_IS_NOT_MECHANICAL_ATTRIBUTE_CONCATENATION',async()=>{
 const t={...truth,fields:truth.fields.map(f=>f.FIELD==='TITLE'?fact('TITLE','nylon tapered funnel'):f)}
 const e=evidence.map(e=>({...e,source_bounded_title_evidence:'nylon tapered funnel'}))
 const d=await derive(t,e)
 assert.equal(d.PRIMARY_KEYWORD,'nylon funnel')
 assert.equal(term(d,'nylon funnel').MARKET_SUPPORT.CONTIGUOUS_ITEM_COUNT,0)
 assert.equal(term(d,'nylon funnel').MARKET_SUPPORT.ORDERED_ELISION_ITEM_COUNT,8)
 assert.ok(term(d,'nylon funnel').SOURCE_RECEIPTS.every(r=>r.OBSERVED_CONCEPT.OBSERVED_SURFACE==='nylon tapered funnel'))
 const crossClause=await derive(t,evidence.map(e=>({...e,source_bounded_title_evidence:'nylon holder for funnel'})))
 assert.notEqual(crossClause.PRIMARY_KEYWORD,'nylon funnel')
})
await test('PASS_INDISTINGUISHABLE_SUPPORTED_CONCEPTS_FAIL_CLOSED',async()=>{
 const t={...truth,fields:[...truth.fields,fact('FORM_FACTOR','tapered')]}
 const e=evidence.map((e,i)=>({...e,source_bounded_title_evidence:i<4?'nylon funnel':'tapered funnel'}))
 const d=await derive(t,e)
 assert.equal(d.PRIMARY_KEYWORD,'UNPROVEN')
 assert.ok(d.BLOCKERS.includes('PRIMARY_CONCEPTS_NOT_DISTINGUISHABLE'))
})
await test('PASS_CONFIDENCE_ACCOUNTS_FOR_QUERY_AND_SALES_CONCENTRATION',async()=>{
 const d=await derive(truth,evidence.map((e,i)=>({...e,query_provenance_hashes:['query-a'],confirmed_sold_quantity:i===0?1000:1})))
 assert.equal(d.KEYWORD_INTELLIGENCE_CONFIDENCE,'LIMITED')
 assert.equal(d.CONFIDENCE_FACTORS.QUERY_DIVERSITY,1)
 assert.ok(d.CONFIDENCE_FACTORS.SALES_CONCENTRATION>0.9)
 assert.equal(good.KEYWORD_INTELLIGENCE_CONFIDENCE,'MODERATE')
})
await test('PASS_OBSERVED_MORPHOLOGICAL_VARIANT_NEEDS_RECURRING_FAMILY_ITEMS',async()=>{
 const t={...truth,fields:[fact('TITLE','nylon adapter'),fact('MATERIAL','nylon')]}
 const e=evidence.map(e=>({...e,source_bounded_title_evidence:'nylon adapter adapting',structural_evidence:{PRODUCT_ENTITY:{target:'adapter'}}}))
 const d=await derive(t,e)
 assert.equal(term(d,'adapting').CLASSIFICATION,'SEMANTIC_EXPANSIONS')
 assert.equal(term(d,'adapting').SEMANTIC_RELATIONSHIP.COMPOSITIONAL_RELATIONSHIP,'MORPHOLOGICAL_FAMILY_VARIANT')
})

async function insert(table,obj){await db.query(`insert into ${table} select * from jsonb_populate_record(null::${table},$1)`,[JSON.stringify(obj)])}
await test('PASS_EXISTING_AUTHORITY_HISTORY_COHORT_AND_NORMAL_TRIGGERS',async()=>{
 const originals=[]
 for(let n=1;n<=3;n++) {
  const bound={...truth,fields:[...truth.fields,fact('LUNA_PRODUCT_ID',`p${n}`),fact('LUNA_VARIANT_ID',`v${n}`)]}
  await insert('ebay_luna_opportunity_queue',{id:id(n),assessment:{productTruth:{fieldTruthV1:bound}},supplier_product_id:`p${n}`,supplier_variant_id:`v${n}`,candidate_key:`c${n}`})
  await insert('marketplace_product_research_query_plans',{id:id(n),marketplace_account_key:'test',status:'COMPLETED',research_intelligence_status:'COMMERCIALLY_SUFFICIENT',
   source_opportunity_id:id(n),source_luna_product_id:`p${n}`,subject_supplier_variant_id:`v${n}`,source_candidate_key:`c${n}`,intelligence_contract_version:'version',keyword_intelligence_history:[]})
  for(const e of evidence) await insert('seller_os_product_research_canonical_evidence_v2',{...e,plan_id:id(n),marketplace_account_key:'test'})
  for(let q=0;q<queries.length;q++) await insert('marketplace_product_research_query_tasks',{id:id(n*10+q),plan_id:id(n),marketplace_account_key:'test',query_hash:queries[q].query_hash,
   query_intent:'CORE_FAMILY_QUERY',strategy_version:'version',evidence_basis:[]})
  const old=(await db.query('select derive_product_research_keyword_intelligence_v1($1,$2,$3,$4) d',[bound,evidence,queries,prereq].map(JSON.stringify))).rows[0].d
  originals.push(old)
  await db.query('update marketplace_product_research_query_plans set keyword_intelligence_decision=$1 where id=$2',[JSON.stringify(old),id(n)])
 }
 const r=(await db.query('select recover_product_research_keyword_intelligence_v1() r')).rows[0].r
 assert.equal(r.PROCESSED_COUNT,3);assert.ok(r.RESULTS.every(x=>x.READY&&x.CHANGED))
 const rows=(await db.query('select * from marketplace_product_research_query_plans order by id')).rows
 rows.forEach((p,n)=>{
  assert.equal(p.keyword_intelligence_decision.DECISION_VERSION,'PRODUCT_RESEARCH_KEYWORD_INTELLIGENCE_V2_1')
  assert.ok(p.keyword_intelligence_history.some(h=>JSON.stringify(h)===JSON.stringify(originals[n])))
 })
 const again=(await db.query('select recover_product_research_keyword_intelligence_v1() r')).rows[0].r
 assert.ok(again.RESULTS.every(x=>!x.CHANGED))
 assert.deepEqual((await db.query('select * from marketplace_product_research_query_plans order by id')).rows,rows)
 await db.query("update marketplace_product_research_query_plans set status='ACTIVE' where id=$1",[id(1)])
 assert.equal((await db.query('select keyword_intelligence_decision from marketplace_product_research_query_plans where id=$1',[id(1)])).rows[0].keyword_intelligence_decision.KEYWORD_DECISION_READY,false)
})
await test('PASS_MORPHOLOGICAL_NORMALIZATION_CANNOT_LAUNDER_CLAIMS',async()=>{
 const t={...truth,fields:[fact('TITLE','nylon adapter'),fact('MATERIAL','nylon'),
  {...fact('FEATURES',['adapting']),SEMANTIC_CLASS:'SUPPLIER_CLAIM',EVIDENCE_STATUS:'UNPROVEN'}]}
 const e=evidence.map(e=>({...e,source_bounded_title_evidence:'nylon adapter adapting',structural_evidence:{PRODUCT_ENTITY:{target:'adapter'}}}))
 const d=await derive(t,e)
 assert.equal(term(d,'adapting').CLASSIFICATION,'REJECTED_TERMS')
 assert.equal(term(d,'adapting').PRODUCT_TRUTH_SUPPORT.SUPPORTED,false)
})
await test('PASS_HISTORICAL_DECISIONS_CANNOT_BE_REWRITTEN',async()=>{
 await assert.rejects(()=>db.query("update marketplace_product_research_query_plans set keyword_intelligence_history='[]' where id=$1",[id(1)]),/KEYWORD_HISTORY_APPEND_ONLY/)
})
await test('PASS_NO_NEW_LEDGER_AND_SERVICE_ONLY_PERMISSIONS',async()=>{
 assert.doesNotMatch(migrationV2,/create table|security definer|update public.ebay_listing_packages/i)
 for(const role of ['anon','authenticated']) assert.equal((await db.query("select has_function_privilege($1,'derive_product_research_keyword_intelligence_v2_1(jsonb,jsonb,jsonb,jsonb)','EXECUTE') allowed",[role])).rows[0].allowed,false)
})

await test('PASS_COMPARATOR_MODIFIER_OMISSION_DOES_NOT_PROMOTE_ATTRIBUTE',async()=>{
 const t={...truth,fields:truth.fields.map(f=>f.FIELD==='TITLE'?fact('TITLE','nylon tapered funnel'):f)}
 const e=evidence.map(e=>({...e,source_bounded_title_evidence:'nylon narrow tapered funnel'}))
 const d=await derive(t,e)
 assert.equal(d.PRIMARY_KEYWORD,'nylon funnel')
 assert.equal(term(d,'nylon funnel').COMPARABLE_ITEM_COUNT,8)
 assert.ok(term(d,'nylon funnel').SOURCE_RECEIPTS.every(r=>r.OBSERVED_CONCEPT.OMITTED_TOKENS_PROMOTED===false))
 assert.ok(!promoted(d).some(t=>t.TERM.includes('narrow')))
 const old=(await db.query('select derive_product_research_keyword_intelligence_v2($1,$2,$3,$4) d',[t,e,queries,prereq].map(JSON.stringify))).rows[0].d
 assert.equal(old.PRIMARY_KEYWORD,'funnel') // Historical V2 remains executable.
})
await test('PASS_OMISSION_REQUIRES_SHARED_ANCHOR_AND_REJECTS_IDENTIFIERS',async()=>{
 for(const title of ['nylon narrow funnel','nylon unknown mystery funnel','nylon Z991 tapered funnel','nylon holder for tapered funnel']) {
  const span=(await db.query('select keyword_observed_concept_span_v2_1($1,$2,$3,$4) s',[title,'nylon','funnel',['nylon','tapered','funnel']])).rows[0].s
  assert.equal(span,null)
 }
})
await test('PASS_UNIT_HEAD_FAILS_CLOSED_WITHOUT_CHANGING_CLASSIFIER',async()=>{
 const t={...truth,fields:[fact('TITLE','coating liquid 12 oz')]}
 const e=evidence.map(e=>({...e,source_bounded_title_evidence:'coating liquid 12 oz',structural_evidence:{PRODUCT_ENTITY:{target:'oz'}}}))
 const d=await derive(t,e)
 assert.equal(d.PRIMARY_KEYWORD,'UNPROVEN')
 assert.ok(d.BLOCKERS.includes('UNIT_OR_NUMERIC_TOKEN_IS_NOT_A_PRODUCT_ENTITY'))
 assert.equal(d.KEYWORD_DECISION_READY,false)
})

await db.close()
