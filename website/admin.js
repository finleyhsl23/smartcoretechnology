import { supabase } from "./supabaseClient.js";

let products = [];
let settings = null;

const loginPanel = document.getElementById("loginPanel");
const adminDashboard = document.getElementById("adminDashboard");
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const loginNote = document.getElementById("loginNote");

function money(value) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(Number(value || 0));
}

function slugify(value) {
  return String(value || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

async function initAdmin() {
  bindAdminEvents();
  const { data } = await supabase.auth.getSession();
  if (data.session) await verifyAdmin();
}

function bindAdminEvents() {
  loginBtn.addEventListener("click", handleLogin);
  logoutBtn.addEventListener("click", handleLogout);
  document.querySelectorAll(".tab").forEach(tab => tab.addEventListener("click", () => switchTab(tab.dataset.tab)));
  document.getElementById("productForm").addEventListener("submit", saveProductFromForm);
  document.getElementById("clearProductForm").addEventListener("click", clearProductForm);
  document.getElementById("settingsForm").addEventListener("submit", saveSettingsForm);
}

async function handleLogin() {
  loginNote.textContent = "Logging in...";
  loginNote.className = "form-note";
  const email = document.getElementById("adminEmail").value.trim();
  const password = document.getElementById("adminPassword").value.trim();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    loginNote.textContent = error.message;
    loginNote.className = "form-note error";
    return;
  }
  await verifyAdmin();
}

async function verifyAdmin() {
  const { data, error } = await supabase.from("admin_users").select("id,email,role").single();
  if (error || !data) {
    await supabase.auth.signOut();
    loginNote.textContent = "This user is not set up as an admin.";
    loginNote.className = "form-note error";
    return;
  }
  showDashboard();
  await loadAllAdminData();
}

async function handleLogout() {
  await supabase.auth.signOut();
  loginPanel.classList.remove("hidden");
  adminDashboard.classList.add("hidden");
}

function showDashboard() {
  loginPanel.classList.add("hidden");
  adminDashboard.classList.remove("hidden");
}

function switchTab(tabId) {
  document.querySelectorAll(".tab").forEach(tab => tab.classList.toggle("active", tab.dataset.tab === tabId));
  document.querySelectorAll(".tab-panel").forEach(panel => panel.classList.toggle("hidden", panel.id !== tabId));
}

async function loadAllAdminData() {
  await loadProducts();
  await loadSettings();
  await loadOrders();
  await loadEnquiries();
}

async function loadProducts() {
  const { data, error } = await supabase.from("products").select("*").order("sort_order", { ascending: true }).order("created_at", { ascending: false });
  if (error) return alert("Could not load products.");
  products = data || [];
  renderAdminProducts();
}

function renderAdminProducts() {
  const list = document.getElementById("adminProductList");
  if (!products.length) { list.innerHTML = "<p>No products yet.</p>"; return; }
  list.innerHTML = products.map(product => `
    <div class="admin-product-row">
      <img src="${product.image_url || ""}" alt="${product.name}" onerror="this.style.display='none'" />
      <div>
        <strong>${product.name}</strong>
        <div>${product.category}</div>
        <div>${money(product.price)} | Stock: ${product.stock}</div>
        <div>${product.is_active ? "Active" : "Hidden"}</div>
      </div>
      <div class="admin-actions">
        <button data-edit="${product.id}">Edit</button>
        <button class="delete" data-delete="${product.id}">Delete</button>
      </div>
    </div>
  `).join("");

  document.querySelectorAll("[data-edit]").forEach(btn => btn.addEventListener("click", () => editProduct(btn.dataset.edit)));
  document.querySelectorAll("[data-delete]").forEach(btn => btn.addEventListener("click", () => deleteProduct(btn.dataset.delete)));
}

async function saveProductFromForm(event) {
  event.preventDefault();
  const id = document.getElementById("productId").value;
  const name = document.getElementById("productName").value.trim();
  const product = {
    name,
    slug: slugify(name),
    category: document.getElementById("productCategory").value.trim(),
    price: Number(document.getElementById("productPrice").value),
    stock: Number(document.getElementById("productStock").value),
    image_url: document.getElementById("productImage").value.trim(),
    description: document.getElementById("productDescription").value.trim(),
    is_active: document.getElementById("productActive").checked
  };
  const response = id ? await supabase.from("products").update(product).eq("id", id) : await supabase.from("products").insert(product);
  if (response.error) return alert(response.error.message);
  clearProductForm();
  await loadProducts();
}

function editProduct(id) {
  const product = products.find(p => p.id === id);
  if (!product) return;
  document.getElementById("productFormTitle").textContent = "Edit product";
  document.getElementById("productId").value = product.id;
  document.getElementById("productName").value = product.name;
  document.getElementById("productCategory").value = product.category;
  document.getElementById("productPrice").value = product.price;
  document.getElementById("productStock").value = product.stock;
  document.getElementById("productImage").value = product.image_url || "";
  document.getElementById("productDescription").value = product.description;
  document.getElementById("productActive").checked = product.is_active;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function deleteProduct(id) {
  if (!confirm("Delete this product?")) return;
  const { error } = await supabase.from("products").delete().eq("id", id);
  if (error) return alert(error.message);
  await loadProducts();
}

function clearProductForm() {
  document.getElementById("productFormTitle").textContent = "Add product";
  document.getElementById("productForm").reset();
  document.getElementById("productId").value = "";
  document.getElementById("productActive").checked = true;
}

async function loadOrders() {
  const { data, error } = await supabase.rpc("admin_orders");
  const list = document.getElementById("adminOrderList");
  if (error) { list.innerHTML = `<p>${error.message}</p>`; return; }
  if (!data.length) { list.innerHTML = "<p>No orders yet.</p>"; return; }

  const rendered = await Promise.all(data.map(async order => {
    const { data: items } = await supabase.rpc("admin_order_items", { order_uuid: order.id });
    return `
      <div class="admin-order-row">
        <h3>${order.order_number}</h3>
        <p><strong>Date:</strong> ${new Date(order.created_at).toLocaleString("en-GB")}</p>
        <p><strong>Status:</strong> ${order.status}</p>
        <p><strong>Customer:</strong> ${order.customer?.name || ""} | ${order.customer?.email || ""} | ${order.customer?.phone || ""}</p>
        <p><strong>Address:</strong> ${order.customer?.address || ""}</p>
        <p><strong>Postcode:</strong> ${order.customer?.postcode || ""}</p>
        <p><strong>Total:</strong> ${money(order.total)} including ${money(order.delivery_charge)} delivery</p>
        <div class="order-lines">${(items || []).map(item => `${item.quantity} × ${item.product_name} at ${money(item.unit_price)}`).join("<br>")}</div>
      </div>
    `;
  }));
  list.innerHTML = rendered.join("");
}

async function loadEnquiries() {
  const { data, error } = await supabase.rpc("admin_enquiries");
  const list = document.getElementById("adminEnquiryList");
  if (error) { list.innerHTML = `<p>${error.message}</p>`; return; }
  if (!data.length) { list.innerHTML = "<p>No enquiries yet.</p>"; return; }
  list.innerHTML = data.map(enquiry => `
    <div class="admin-order-row">
      <h3>${enquiry.type}</h3>
      <p><strong>Date:</strong> ${new Date(enquiry.created_at).toLocaleString("en-GB")}</p>
      <pre>${escapeHtml(JSON.stringify(enquiry.payload, null, 2))}</pre>
    </div>
  `).join("");
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

async function loadSettings() {
  const { data, error } = await supabase.from("site_settings").select("*").eq("id", 1).single();
  if (error) return alert("Could not load settings.");
  settings = data;
  loadSettingsForm();
}

function loadSettingsForm() {
  document.getElementById("settingBusinessName").value = settings.business_name;
  document.getElementById("settingMinimumOrder").value = settings.minimum_order;
  document.getElementById("settingEmail").value = settings.management_email;
  document.getElementById("settingRadiusMessage").value = settings.radius_message;
  document.getElementById("settingOpenDays").value = settings.delivery_days;
  document.getElementById("settingOpenTimes").value = settings.delivery_times;
  document.getElementById("settingPostcodes").value = (settings.allowed_postcode_prefixes || []).join(", ");
  document.getElementById("settingChargeDE").value = settings.delivery_charge_de;
  document.getElementById("settingChargeLE").value = settings.delivery_charge_le;
  document.getElementById("settingChargeNG").value = settings.delivery_charge_ng;
  document.getElementById("settingChargeB").value = settings.delivery_charge_b;
}

async function saveSettingsForm(event) {
  event.preventDefault();
  const update = {
    business_name: document.getElementById("settingBusinessName").value.trim(),
    minimum_order: Number(document.getElementById("settingMinimumOrder").value),
    management_email: document.getElementById("settingEmail").value.trim(),
    radius_message: document.getElementById("settingRadiusMessage").value.trim(),
    delivery_days: document.getElementById("settingOpenDays").value.trim(),
    delivery_times: document.getElementById("settingOpenTimes").value.trim(),
    allowed_postcode_prefixes: document.getElementById("settingPostcodes").value.split(",").map(v => v.trim().toUpperCase()).filter(Boolean),
    delivery_charge_de: Number(document.getElementById("settingChargeDE").value),
    delivery_charge_le: Number(document.getElementById("settingChargeLE").value),
    delivery_charge_ng: Number(document.getElementById("settingChargeNG").value),
    delivery_charge_b: Number(document.getElementById("settingChargeB").value)
  };
  const { error } = await supabase.from("site_settings").update(update).eq("id", 1);
  const note = document.getElementById("settingsNote");
  if (error) { note.textContent = error.message; note.className = "form-note error"; return; }
  note.textContent = "Settings saved.";
  note.className = "form-note success";
  await loadSettings();
}

initAdmin();
