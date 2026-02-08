/*
  SmartCore App Core
  Auth + routing shell
*/

const SUPABASE_URL = "https://jmgbbybpsnazkxinnpxp.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhqZHBjZmhvemhveWVxZXZudXBtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5MTk3MzYsImV4cCI6MjA4MjQ5NTczNn0.BXosJO4NmEZOe73GXSGPa3z-i_4ZzF9zBAMBIf6Mkts";

// Placeholder until Supabase JS is wired
async function login() {
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  if (!email || !password) {
    alert("Enter email and password");
    return;
  }

  // TEMP – replace with Supabase auth
  fakeAuth(email);
}

function fakeAuth(email) {
  // Example: infer company from email domain (TEMP)
  let companySlug = "smartfits";

  if (email.includes("@mmb")) companySlug = "mmb";
  if (email.includes("@smartcore")) companySlug = "smartcore";

  redirectToCompany(companySlug);
}

function redirectToCompany(company) {
  // Final app routing structure
  // /app/{company}/dashboard.html
  window.location.href = `/app/${company}/dashboard.html`;
}

/*
  FUTURE (do not remove):
  - Supabase auth
  - session persistence
  - role-based routing
*/
