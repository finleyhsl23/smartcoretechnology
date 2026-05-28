import {cors,readJson,db,sha256} from './_lib.js';
export async function onRequestOptions(){ return cors({ok:true}); }
export async function onRequestPost({request,env}){ try{
 const b=await readJson(request); if(!b.user_id) throw new Error('You must be signed in to complete onboarding.'); const hash=await sha256(b.token||''); const inv=(await db(env,`holidaymanagement.onboarding_invites?token_hash=eq.${hash}&select=*`))[0]; if(!inv) throw new Error('Invite not found.'); if(inv.used_at) throw new Error('Invite already used.'); if(new Date(inv.expires_at)<new Date()) throw new Error('Invite expired.'); const p=b.payload||{};
 if(inv.invite_type==='owner'){
  await db(env,`holidaymanagement.companies?id=eq.${inv.company_id}`,{method:'PATCH',body:JSON.stringify({company_name:p.company_name,display_name:p.display_name,address_line_1:p.address_line_1,city:p.city,postcode:p.postcode,main_email:p.main_email,main_phone:p.main_phone,holiday_year_start_month:p.holiday_year_start_month||1,holiday_year_start_day:p.holiday_year_start_day||1,default_bank_holiday_region:p.default_bank_holiday_region||'england-and-wales',default_annual_leave_allowance:p.default_annual_leave_allowance||28,bank_holidays_included_in_allowance:p.bank_holidays_included_in_allowance,status:'active',onboarding_completed_at:new Date().toISOString()})});
  let emp=(await db(env,`holidaymanagement.employees?company_id=eq.${inv.company_id}&work_email=eq.${encodeURIComponent(inv.email)}&select=*`))[0];
  if(!emp){ emp=(await db(env,'holidaymanagement.employees',{method:'POST',body:JSON.stringify({company_id:inv.company_id,user_id:b.user_id,full_name:p.owner_name||inv.email,job_title:p.owner_job_title||'Owner',work_email:inv.email,personal_email:inv.email,role:'owner',is_admin:true,employment_status:'active',annual_leave_allowance:p.default_annual_leave_allowance||28,start_date:p.owner_start_date||null,no_authoriser_required:!!p.no_authoriser_required,onboarding_status:'complete',first_login_at:new Date().toISOString(),profile_updated_at:new Date().toISOString()})}))[0]; }
  else { await db(env,`holidaymanagement.employees?id=eq.${emp.id}`,{method:'PATCH',body:JSON.stringify({user_id:b.user_id,role:'owner',is_admin:true,onboarding_status:'complete',first_login_at:new Date().toISOString(),profile_updated_at:new Date().toISOString(),job_title:p.owner_job_title||emp.job_title,start_date:p.owner_start_date||emp.start_date,no_authoriser_required:!!p.no_authoriser_required})}); }
  await db(env,'holidaymanagement.company_users',{method:'POST',body:JSON.stringify({company_id:inv.company_id,user_id:b.user_id,employee_id:emp.id,role:'owner',status:'active'}),headers:{prefer:'resolution=merge-duplicates,return=representation'}}).catch(async()=>{});
 } else {
  const patch={...p,user_id:b.user_id,onboarding_status:'complete',first_login_at:new Date().toISOString(),profile_updated_at:new Date().toISOString()};
  const emp=(await db(env,`holidaymanagement.employees?id=eq.${inv.employee_id}`,{method:'PATCH',body:JSON.stringify(patch)}))[0];
  await db(env,'holidaymanagement.company_users',{method:'POST',body:JSON.stringify({company_id:inv.company_id,user_id:b.user_id,employee_id:inv.employee_id,role:emp?.role||'employee',status:'active'}),headers:{prefer:'resolution=merge-duplicates,return=representation'}}).catch(async()=>{});
 }
 await db(env,`holidaymanagement.onboarding_invites?id=eq.${inv.id}`,{method:'PATCH',body:JSON.stringify({used_at:new Date().toISOString(),status:'used'})});
 return cors({ok:true});
}catch(e){ return cors({error:e.message},400); } }
