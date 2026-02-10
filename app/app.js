// /app/app.js
import { supabaseClient } from "/app/shared/supabase.js";
import { toast, $ } from "/app/shared/ui.js";

function startClock(){
  const tick = () => {
    const d = new Date();
    const dd = String(d.getDate()).padStart(2,"0");
    const mm = String(d.getMonth()+1).padStart(2,"0");
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2,"0");
    const mi = String(d.getMinutes()).padStart(2,"0");
    const ss = String(d.getSeconds()).padStart(2,"0");
    const dateStr = document.getElementById("dateStr");
    const timeStr = document.getElementById("timeStr");
    if (dateStr) dateStr.textContent = `${dd}/${mm}/${yyyy}`;
    if (timeStr) timeStr.textContent = `${hh}:${mi}:${ss}`;
  };
  tick(); setInterval(tick, 1000);
}

function onLoginPage(){
  return location.pathname.endsWith("/app/index.html") || location.pathname === "/app/" || location.pathname === "/app";
}

// /app/app.js (only the login button logic needs changing)
import { supabaseClient } from "/app/shared/supabase.js";
import { toast, $ } from "/app/shared/ui.js";

async function initLogin(){
  $("clearBtn").onclick = () => {
    $("email").value = "";
    $("password").value = "";
  };

  $("loginBtn").onclick = async () => {
    try{
      $("statusBadge").textContent = "working";

      const sb = supabaseClient();

      const email = String($("email").value||"").trim();
      const password = String($("password").value||"").trim();
      if(!email || !password){
        toast("warn","Missing login","Enter email and password.");
        $("statusBadge").textContent = "idle";
        return;
      }

      const { error } = await sb.auth.signInWithPassword({ email, password });
      if(error){
        toast("bad","Login failed", error.message);
        $("statusBadge").textContent = "error";
        return;
      }

      window.location.href = "/app/dashboard.html";
    }catch(e){
      toast("bad","Error", e.message || String(e));
      $("statusBadge").textContent = "error";
    }
  };

  // If already logged in, go straight to dashboard
  try{
    const sb = supabaseClient();
    const { data } = await sb.auth.getSession();
    if(data?.session){
      window.location.href = "/app/dashboard.html";
    }
  }catch{}
}

initLogin();
