export const runtime="nodejs"
export const maxDuration=300
import { NextResponse } from "next/server"
import { validateAdminApiRequest } from "@/lib/supabase-admin"

const AUTHORIZED_BRANCH="feature/centralize-ebay-mobile-command-center"
const STAGING_PROJECT_REF="vsfthqydfrdzulldbfbe"
const CONFIRMATION="RUN_ONE_STAGING_EXTRAORDINARY_POSITION_6_PROVIDER_CALL_8"
const FEATURE_FLAG="OPENAI_REFERENCE_GUIDED_PRODUCT_GENERATION_ENABLED"
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&
  !Array.isArray(value)?value as Record<string,unknown>:{}
const safeCode=(error:unknown)=>(error instanceof Error?error.message:"")
  .match(/[A-Z][A-Z0-9_:.-]{2,180}/)?.[0]??"EXTRAORDINARY_POSITION_6_EXECUTION_FAILED"

function assertPreviewBoundary(){
  let projectRef=""
  try{projectRef=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()??"")
    .hostname.split(".")[0]??""}catch{}
  if(process.env.VERCEL_ENV!=="preview"||
    process.env.VERCEL_GIT_COMMIT_REF!==AUTHORIZED_BRANCH||projectRef!==STAGING_PROJECT_REF)
    throw new Error("EXTRAORDINARY_POSITION_6_PREVIEW_STAGING_REQUIRED")
  if(!process.env.OPENAI_API_KEY?.trim()||process.env.OPENAI_IMAGE_MODEL?.trim()!=="gpt-image-2")
    throw new Error("EXTRAORDINARY_POSITION_6_PROVIDER_CONFIGURATION_INVALID")
  if(process.env[FEATURE_FLAG]==="true")
    throw new Error("EXTRAORDINARY_POSITION_6_FEATURE_MUST_START_DISABLED")
}

export async function POST(req:Request){
  const validation=await validateAdminApiRequest(req)
  if(!validation.ok||validation.authenticationMode!=="service_role")
    return NextResponse.json({success:false,error:validation.error??"service_role_required"},
      {status:validation.status&&validation.status!==200?validation.status:403})
  try{
    assertPreviewBoundary()
    if(record(await req.json()).confirmation!==CONFIRMATION)
      throw new Error("EXTRAORDINARY_POSITION_6_EXPLICIT_CONFIRMATION_REQUIRED")
    process.env[FEATURE_FLAG]="true"
    process.env.CANARY_EXECUTION_ENVIRONMENT="preview"
    const executed=await import("@/scripts/execute-reference-guided-extraordinary-position-6.mjs") as
      {executionResult:Record<string,unknown>}
    const response=NextResponse.json({success:true,...executed.executionResult})
    response.headers.set("Cache-Control","no-store")
    return response
  }catch(error){
    return NextResponse.json({success:false,error:safeCode(error),automaticRetryOccurred:false,
      ebayWrites:0,productionChanged:false},{status:409})
  }finally{
    process.env[FEATURE_FLAG]="false"
    process.env.CANARY_EXECUTION_ENVIRONMENT="disabled"
  }
}
