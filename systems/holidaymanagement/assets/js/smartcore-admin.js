
import { requireAuth, requireAdminPageAccess, requireSmartCoreAdmin, isAdminProfile } from '../../shared/guards.js';
import { signOut } from '../../shared/auth.js';
import { showMessage, setLoadingButton, renderEmptyState, openModal, closeModal, escapeHtml } from '../../shared/ui.js';
import { formatDate, prorateAllowance } from '../../shared/dates.js';
import * as api from '../../shared/api.js';
import { supabase } from '../../shared/supabase.js';

const ctx=await requireSmartCoreAdmin();if(ctx){document.getElementById('logoutBtn').onclick=async()=>{await signOut();location.href='./login.html'};let companies=[];async function load(){companies=await api.getAllCompanies();render()}function render(){if(!companies.length)return renderEmptyState(companyList,'No companies yet.');companyList.innerHTML=companies.map(c=>`<article class="leave-card"><div class="leave-card-top"><div><p class="leave-card-title">${c.display_name||c.company_name}</p><p class="leave-card-subtitle">${c.status} • Max employees: ${c.max_employees} • Created: ${formatDate(c.created_at)}</p></div><span class="badge">${c.status}</span></div></article>`).join('')}addCompanyForm.onsubmit=async e=>{e.preventDefault();try{await api.addCompany({company_name:companyName.value,owner_full_name:ownerName.value,owner_email:ownerEmail.value,owner_phone:ownerPhone.value,max_employees:Number(maxEmployees.value||25),notes:notes.value,created_by:ctx.user.id});showMessage('addCompanyMessage','Company created and onboarding invite generated.','success');addCompanyForm.reset();await load()}catch(err){showMessage('addCompanyMessage',err.message,'error')}};await load();}
