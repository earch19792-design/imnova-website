import { NextResponse } from "next/server"
import { getSupabaseAdminClient,validateAdminApiRequest } from "@/lib/supabase-admin"
import { getEbaySellerAccountScopeConfiguration } from "@/lib/ebay/ebay-seller-account-scope"
import { executeCurrentUnpublishedPreparationV1 } from "@/lib/ebay/ebay-current-unpublished-preparation-server-v1"
import { getEbayDraftWriteEnvironmentBoundary } from "@/lib/ebay/environment-boundaries"
export const runtime="nodejs"
export const dynamic="force-dynamic"
export const maxDuration=120
export async function POST(req:Request){
 const auth=await validateAdminApiRequest(req)
 if(!auth.ok)return NextResponse.json({error:"ADMIN_REQUIRED"},{status:403})
 const boundary=getEbayDraftWriteEnvironmentBoundary()
 if(!boundary.productionDedicatedPreprodBound || !boundary.writeAllowed)
  return NextResponse.json({error:"CERTIFIED_PREPROD_ONLY"},{status:403})
 try{
  const body=await req.json(),packageId=String(body.packageId??"")
  if(!/^[a-f0-9-]{36}$/.test(packageId) || Object.keys(body).some(k=>k!=="packageId"))throw Error("EXACT_PACKAGE_ONLY")
  const accountKey=getEbaySellerAccountScopeConfiguration().accountKey
  if(!accountKey)throw Error("EXACT_ACCOUNT_REQUIRED")
  const db=getSupabaseAdminClient()
  const read=await db.from("ebay_authorized_listing_publications").select("actor_user_id")
    .eq("listing_package_id",packageId).eq("marketplace_account_key",accountKey).limit(2)
  if(read.error||read.data?.length!==1)throw Error("ONE_EXISTING_INTENT_REQUIRED")
  const actor=read.data[0].actor_user_id
  if(auth.authenticationMode!=="service_role"&&auth.userId!==actor)throw Error("OWNER_BINDING_MISMATCH")
  const result=await executeCurrentUnpublishedPreparationV1({supabase:db,accountKey,packageId,actor})
  return NextResponse.json({success:result.pass,result,publicationWrites:0},{status:result.pass?200:409})
 }catch(error){
  const message=error instanceof Error?error.message:"PREPARATION_FAILED"
  return NextResponse.json({error:/^[A-Z0-9_]+$/.test(message)?message:"PREPARATION_FAILED",publicationWrites:0},{status:409})
 }
}
