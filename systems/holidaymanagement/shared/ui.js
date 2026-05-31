
export function showMessage(id,msg,type='info'){const el=document.getElementById(id); if(!el)return; el.textContent=msg||''; el.style.color=type==='error'?'#ff9a97':type==='success'?'#7ee4b3':'#9fb1c9'}
export function setLoadingButton(btn,on,text='Please wait...'){if(!btn)return; if(on){btn.dataset.old=btn.textContent;btn.disabled=true;btn.textContent=text}else{btn.disabled=false;btn.textContent=btn.dataset.old||btn.textContent}}
export function revealApp(){document.getElementById('appLoader')?.classList.add('hidden');document.getElementById('appLayout')?.classList.remove('hidden')}
export function renderEmptyState(el,text='Nothing to show yet.'){if(el)el.innerHTML=`<div class="empty-state">${text}</div>`}
export function showPageError(error,ctx='Page failed to load'){console.error(ctx,error);const el=document.getElementById('appLoader');if(el){el.classList.remove('hidden');el.innerHTML=`<div style="max-width:720px;text-align:center"><h2>${ctx}</h2><p>${error?.message||error||'Unknown error'}</p></div>`}}
export function escapeHtml(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
export function openModal(id){document.getElementById(id)?.classList.remove('hidden')}
export function closeModal(id){document.getElementById(id)?.classList.add('hidden')}
