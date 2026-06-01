
import { supabase, leaveSchema } from './supabase.js';
export async function signInWithPassword(email,password){return supabase.auth.signInWithPassword({email,password})}
export async function signOut(){localStorage.removeItem('sc_selected_company_id');localStorage.removeItem('sc_dev_role');return supabase.auth.signOut()}
export async function getSession(){const {data,error}=await supabase.auth.getSession(); if(error)throw error; return data.session}
export async function getMemberships(){const session=await getSession(); if(!session?.user)return []; const {data,error}=await supabase.schema(leaveSchema).rpc('get_my_memberships'); if(error)throw error; return data||[]}
export async function getCurrentContext(){const session=await getSession(); if(!session?.user)return null; const memberships=await getMemberships(); if(!memberships.length)return {session,user:session.user,memberships,profile:null}; let selected=localStorage.getItem('sc_selected_company_id'); let m=memberships.find(x=>x.company_id===selected)||memberships[0]; if(m) localStorage.setItem('sc_selected_company_id',m.company_id); const dev=localStorage.getItem('sc_dev_role'); if(m?.is_smartcore_admin&&dev){m={...m,role:dev,is_admin:['owner','admin'].includes(dev)}} return {session,user:session.user,memberships,profile:m};}
