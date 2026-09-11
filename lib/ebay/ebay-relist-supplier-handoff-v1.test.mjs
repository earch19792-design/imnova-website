import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {reconcileRelistSupplierHandoffV1 as reconcile} from './ebay-relist-supplier-handoff-v1.ts'

const sql=readFileSync(new URL('../../supabase/migrations/20260911155055_deterministic_relist_supplier_handoff_v1.sql',import.meta.url),'utf8')
function fixture(result={status:'CERTIFIED',linkageId:'lineage',productId:'product',variantId:'variant',sourceSku:'supplier'}) {
 const calls=[]
 let row={linkage_id:'lineage',decision:'APPROVE_EXACT_LINKAGE',luna_product_id:'product',luna_variant_id:'variant',luna_sku:'supplier'}
 const query=value=>{const q={};for(const method of ['abortSignal','retry','eq','select','order','limit'])q[method]=(...args)=>{calls.push([method,...args]);return q};q.maybeSingle=()=>Promise.resolve(value());q.then=(yes,no)=>Promise.resolve(value()).then(yes,no);return q}
 const db={rpc:(name,args)=>{calls.push([name,args]);return query(()=>({data:result,error:null}))},from:name=>{calls.push(['from',name]);return query(()=>({data:row,error:null}))}}
 return {calls,input:{supabase:db,accountKey:'account',itemId:'366643126310'},setRow:value=>{row=value}}
}
test('relist recovery accepts only account and new Item ID; product identity is resolved durably',async()=>{
 const f=fixture(),r=await reconcile(f.input);assert.equal(r.status,'CERTIFIED');assert.equal(r.durableReadbackMatch,true)
 assert.deepEqual(f.calls[0],['resolve_relist_supplier_handoff_v1',{p_account_key:'account',p_item_id:'366643126310',p_apply:true}])
 assert.ok(f.calls.some(c=>c[0]==='eq'&&c[1]==='account_key'&&c[2]==='account'))
 assert.ok(f.calls.some(c=>c[0]==='retry'&&c[1]===false))
})
test('restart/replay uses the current canonical decision and readback without another marketplace operation',async()=>{
 const f=fixture({status:'CERTIFIED',linkageId:'lineage',productId:'product',variantId:'variant',supplierSku:'supplier',idempotent:true})
 for(let i=0;i<2;i++){const r=await reconcile(f.input);assert.equal(r.idempotent,true);assert.equal(r.durableReadbackMatch,true)}
 assert.equal(f.calls.filter(c=>c[0]==='from').length,2)
})
test('wrong variant, wrong product, wrong supplier or revoked decision cannot pass readback',async()=>{
 for(const override of [{luna_product_id:'other'},{luna_variant_id:'other'},{luna_sku:'similar-supplier'},{decision:'REJECT'}]) {
  const f=fixture();f.setRow({linkage_id:'lineage',decision:'APPROVE_EXACT_LINKAGE',luna_product_id:'product',luna_variant_id:'variant',luna_sku:'supplier',...override})
  assert.equal((await reconcile(f.input)).reason,'RELIST_LINKAGE_READBACK_REQUIRED')
 }
})
test('ambiguous lineage is not promoted and does not start a stock or marketplace call',async()=>{
 const f=fixture({status:'REQUIRES_ATTENTION',reason:'AMBIGUOUS_PREDECESSOR',ownerActionRequired:true})
 const r=await reconcile(f.input);assert.equal(r.reason,'AMBIGUOUS_PREDECESSOR');assert.equal(f.calls.filter(c=>c[0]==='from').length,0)
})
test('transient authority failure remains recoverable without owner identity repair',async()=>{
 const f=fixture({status:'WAITING_FOR_DATA',reason:'CURRENT_OFFICIAL_IDENTITY_REQUIRED',ownerActionRequired:false})
 assert.equal((await reconcile(f.input)).ownerActionRequired,false)
})
test('SQL authority requires certified history, exact account/SKU/package and modern proven truth',()=>{
 for(const invariant of ['AMBIGUOUS_ACTIVE_SKU','AMBIGUOUS_PREDECESSOR','HISTORICAL_IDENTITY_CERTIFICATION_REQUIRED',
  'EXACT_UNIQUE_PACKAGE_LINEAGE_REQUIRED','SUPPLIER_IDENTITY_NOT_UNIQUE','CURRENT_SUPPLIER_IDENTITY_CONFLICT','PRODUCT_TRUTH_IDENTITY_MISMATCH',
  'MANUAL_LISTING_VERIFIED_ACTIVE_MONITOR_REGISTERED','p_account_key','for update','pg_advisory_xact_lock','fieldTruthV1',
  "'LUNA_PRODUCT_ID','LUNA_VARIANT_ID','SUPPLIER_SKU'","'DETERMINISTIC_EXACT_IDENTITY'"])assert.ok(sql.includes(invariant),invariant)
 assert.doesNotMatch(sql,/\b(?:ilike|similarity|levenshtein)\b/i)
 assert.doesNotMatch(sql,/update public\.ebay_manual_listing_links|update public\.seller_os_luna_linkage_decisions/i)
 assert.doesNotMatch(sql,/create table|cron\.schedule|publishOffer|ReviseFixedPriceItem/i)
})
test('CURRENT publication completion requires certified current product/variant rather than historical approval',()=>{
 assert.match(sql,/CURRENT_POST_PUBLISH_SUPPLIER_HANDOFF_REQUIRED/)
 for(const key of ['PRODUCT_ID','VARIANT_ID','SKU'])assert.ok(sql.includes(`current,snapshot,binding,${key}`))
 const executor=readFileSync(new URL('./ebay-current-publication-executor-v1.ts',import.meta.url),'utf8')
 assert.ok(executor.indexOf('supplierLinkageHandoffAttempted:true')<executor.indexOf('const registration=await deps.register'))
 assert.match(executor,/supplierLinkage:'CERTIFIED',stockGuardMonitored:true/)
})

test('unresolved first entries cannot permanently suppress later relists in bounded intake',async()=>{
 const {orderRelistHandoffCandidatesV1}=await import('./ebay-relist-supplier-handoff-v1.ts')
 const rows=['6','1','5','2','4','3'].map(itemId=>({itemId})),seen=new Set()
 for(let cycle=0;cycle<rows.length;cycle++){
  const ordered=orderRelistHandoffCandidatesV1(rows,cycle*300000)
  assert.equal(new Set(ordered.map(r=>r.itemId)).size,rows.length)
  for(const r of ordered.slice(0,2))seen.add(r.itemId)
 }
 assert.equal(seen.size,rows.length)
 assert.deepEqual(rows.map(r=>r.itemId),['6','1','5','2','4','3'])
})
