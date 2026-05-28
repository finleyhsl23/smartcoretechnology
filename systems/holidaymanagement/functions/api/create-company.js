import {cors,readJson,db,sha256,token,sendEmail,inviteEmail} from './_lib.js';
export async function onRequestOptions(){ return cors({ok:true}); }
export async function onRequestPost({request,env}){ try{
 const b=await readJson(request); if(!b.company_name||!b.owner_email) return cors({error:'Company name and owner email are required.'},400);
 const company=(await db(env,'holidaymanagement.companies',{method:'POST',body:JSON.stringify({company_name:b.company_name,display_name:b.company_name,owner_name:b.owner_name,owner_email:b.owner_email,owner_phone:b.owner_phone,max_employees:b.max_employees||25,plan_name:b.plan_name||null,notes:b.notes||null,status:'pending_onboarding',created_by_smartcore_user:b.actor_user_id||null})}))[0];
 const raw=token(); const hash=await sha256(raw); const expires=new Date(Date.now()+72*3600*1000).toISOString();
 await db(env,'holidaymanagement.onboarding_invites',{method:'POST',body:JSON.stringify({company_id:company.id,email:b.owner_email,invite_type:'owner',token_hash:hash,expires_at:expires,created_by:b.actor_user_id||null})});
 const base=env.PUBLIC_APP_URL || 'https://smartcoretechnology.co.uk/systems/holidaymanagement'; const link=`${base}?token=${raw}`;
 await sendEmail(env,{to:b.owner_email,subject:'Complete your SmartCore Holiday Management setup',html:inviteEmail({title:'Your Holiday Management portal is ready to set up',body:`SmartCore has created a Holiday Management portal for ${b.company_name}. Use the secure link below to complete your company setup.`,link})});
 return cors({ok:true,company,link});
}catch(e){ return cors({error:e.message},400); } }
