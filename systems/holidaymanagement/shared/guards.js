
import { getCurrentContext, getSession } from './auth.js';
import { revealApp, showPageError } from './ui.js';
import { CONFIG } from './config.js';
export function isAdminProfile(p){return p?.is_admin===true||['owner','admin'].includes(String(p?.role||'').toLowerCase())}
export function isOwner(p){return String(p?.role||'').toLowerCase()==='owner'}
export function applyRoleUi(p){const admin=isAdminProfile(p);document.querySelectorAll('.admin-only-link,[data-admin-only],#adminNavLink').forEach(el=>{el.classList.toggle('hidden',!admin);el.style.display=admin?'':'none'});document.querySelectorAll('[data-smartcore-only]').forEach(el=>{const show=p?.is_smartcore_admin===true;el.classList.toggle('hidden',!show);el.style.display=show?'':'none'});document.querySelectorAll('[data-company-name]').forEach(el=>el.textContent=p?.company_name||'Company'); return admin}
export async function requireGuest(){const s=await getSession(); if(s) location.href=`${CONFIG.appBase}/select-company.html`;}
export async function requireAuth(){try{const ctx=await getCurrentContext(); if(!ctx?.session){location.href=`${CONFIG.appBase}/login.html`;return null} if(!ctx.profile){location.href=`${CONFIG.appBase}/select-company.html`;return null} applyRoleUi(ctx.profile); setupThemeIcon(); setupDeveloperBar(ctx.profile); revealApp(); return ctx}catch(e){showPageError(e,'Access check failed');return null}}
export async function requireAdminPageAccess(){const ctx=await requireAuth(); if(!ctx)return null; if(!isAdminProfile(ctx.profile)){location.href=`${CONFIG.appBase}/dashboard.html`;return null} return ctx}
export async function requireSmartCoreAdmin(){const ctx=await requireAuth(); if(!ctx)return null; if(!ctx.profile?.is_smartcore_admin){location.href=`${CONFIG.appBase}/dashboard.html`;return null} return ctx}
function setupDeveloperBar(profile){if(!profile?.is_smartcore_admin||document.getElementById('devbar'))return; const div=document.createElement('div');div.id='devbar';div.className='devbar';div.innerHTML=`<strong>Developer mode</strong><select id="devRole"><option value="">Actual role</option><option value="owner">Owner</option><option value="admin">Admin</option><option value="employee">Employee</option></select><button class="btn btn-secondary" id="devReload">Apply</button>`;document.body.appendChild(div);document.getElementById('devRole').value=localStorage.getItem('sc_dev_role')||'';document.getElementById('devReload').onclick=()=>{const v=document.getElementById('devRole').value;if(v)localStorage.setItem('sc_dev_role',v);else localStorage.removeItem('sc_dev_role');location.reload()}}

function setupThemeIcon(){
  if(document.getElementById('themeIconBtn')) return;
  const saved=localStorage.getItem('smartcore_theme')||'dark';
  document.body.classList.toggle('light-mode', saved==='light');
  const btn=document.createElement('button');
  btn.id='themeIconBtn';
  btn.className='theme-icon-btn';
  btn.type='button';
  btn.title='Switch theme';
  btn.setAttribute('aria-label','Switch theme');
  btn.textContent=saved==='light'?'☀':'☾';
  btn.onclick=()=>{
    const light=!document.body.classList.contains('light-mode');
    document.body.classList.toggle('light-mode', light);
    localStorage.setItem('smartcore_theme', light?'light':'dark');
    btn.textContent=light?'☀':'☾';
  };
  const sidebar=document.querySelector('.sidebar');
  if(sidebar){
    const footer=sidebar.querySelector('.footer-note');
    if(footer) sidebar.insertBefore(btn, footer); else sidebar.appendChild(btn);
  } else document.body.appendChild(btn);
}
