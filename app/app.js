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
  tick();
  setInterval(tick, 1000);
}

function onLoginPage(){
  return location.pathname.endsWith("/app/index.html") || location.pathname === "/app/" || location.pathname === "/app";
}

async function initLogin(){
  startClock();

  const loginBtn = $("loginBtn");
  const clearBtn = $("clearBtn");
  const status = $("statusBadge");

  if (!loginBtn) {
    console.error("loginBtn not found in DOM");
    return;
  }

  clearBtn && (clearBtn.onclick = () => {
    $("email").value = "";
    $("password").value = "";
    status && (status.textContent = "idle");
  });

  loginBtn.onclick = async () => {
    try{
      status && (status.textContent = "working");

      const email = String($("email")?.value || "").trim();
      const password = String($("password")?.value || "").trim();

      if(!email || !password){
        toast("warn","Missing login","Enter email and password.");
        status && (status.textContent = "idle");
        return;
      }

      const sb = supabaseClient();
      const { error } = await sb.auth.signInWithPassword({ email, password });

      if(error){
        toast("bad","Login failed", error.message);
        status && (status.textContent = "error");
        return;
      }

      status && (status.textContent = "ok");
      window.location.href = "/app/dashboard.html";
    }catch(e){
      toast("bad","Error", e.message || String(e));
      status && (status.textContent = "error");
      console.error(e);
    }
  };

  // Auto-redirect if already logged in
  try{
    const sb = supabaseClient();
    const { data } = await sb.auth.getSession();
    if(data?.session){
      window.location.href = "/app/dashboard.html";
    }
  }catch(e){
    // If supabase config is wrong, you will see it here
    console.error(e);
  }
}

if(onLoginPage()){
  // Ensure DOM is ready before binding
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initLogin);
  } else {
    initLogin();
  }
}
