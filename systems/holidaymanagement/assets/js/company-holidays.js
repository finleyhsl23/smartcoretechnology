
import { requireAuth, requireAdminPageAccess, requireSmartCoreAdmin, isAdminProfile } from '../../shared/guards.js';
import { signOut } from '../../shared/auth.js';
import { showMessage, setLoadingButton, renderEmptyState, openModal, closeModal, escapeHtml } from '../../shared/ui.js';
import { formatDate, prorateAllowance } from '../../shared/dates.js';
import * as api from '../../shared/api.js';
import { supabase } from '../../shared/supabase.js';

const ctx=await requireAdminPageAccess();if(ctx){const {profile}=ctx;document.getElementById('logoutBtn').onclick=async()=>{await signOut();location.href='./login.html'};let rows=[];async function load(){rows=await api.getHolidays(profile.company_id);render()}function render(){if(!rows.length)return renderEmptyState(holidayList,'No holidays found.');holidayList.innerHTML=rows.map(h=>`<article class="leave-card"><div class="leave-card-top"><div><p class="leave-card-title">${h.name}</p><p class="leave-card-subtitle">${formatDate(h.holiday_date)} • ${h.type}</p></div>${h.type==='company'?`<button class="btn btn-danger" data-del="${h.id}">Delete</button>`:''}</div></article>`).join('')}companyHolidayForm.onsubmit=async e=>{e.preventDefault();await api.addCompanyHoliday({company_id:profile.company_id,name:holidayName.value,holiday_date:holidayDate.value,type:'company'});companyHolidayForm.reset();await load()};holidayList.onclick=async e=>{const b=e.target.closest('[data-del]');if(!b)return;if(confirm('Delete this holiday?')){await api.deleteCompanyHoliday(b.dataset.del);await load()}};await load();}
