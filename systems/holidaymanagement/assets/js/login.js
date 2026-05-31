
import { requireGuest } from '../../shared/guards.js';
import { signInWithPassword } from '../../shared/auth.js';
import { showMessage,setLoadingButton } from '../../shared/ui.js';
await requireGuest();
const form=document.getElementById('loginForm'),btn=form?.querySelector('button');
form?.addEventListener('submit',async e=>{e.preventDefault();const fd=new FormData(form);try{setLoadingButton(btn,true,'Signing in...');const {error}=await signInWithPassword(String(fd.get('email')).trim(),String(fd.get('password')));if(error)throw error;location.href='./select-company.html'}catch(err){showMessage('loginMessage',err.message||'Unable to sign in.','error')}finally{setLoadingButton(btn,false)}});
