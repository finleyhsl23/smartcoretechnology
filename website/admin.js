let products = getProducts();

const loginPanel = document.getElementById("loginPanel");
const adminDashboard = document.getElementById("adminDashboard");
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const loginNote = document.getElementById("loginNote");

function initAdmin() {
  if (localStorage.getItem("tt_admin_logged_in") === "yes") showDashboard();
  bindAdminEvents();
  renderAdminProducts();
  renderOrders();
  loadSettingsForm();
}

function bindAdminEvents() {
  loginBtn.addEventListener("click", handleLogin);
  logoutBtn.addEventListener("click", handleLogout);

  document.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => switchTab(tab.dataset.tab));
  });

  document.getElementById("productForm").addEventListener("submit", saveProductFromForm);
  document.getElementById("clearProductForm").addEventListener("click", clearProductForm);
  document.getElementById("clearOrdersBtn").addEventListener("click", clearOrders);
  document.getElementById("settingsForm").addEventListener("submit", saveSettingsForm);
}

function handleLogin() {
  const email = document.getElementById("adminEmail").value.trim();
  const password = document.getElementById("adminPassword").value.trim();

  if (email && password) {
    localStorage.setItem("tt_admin_logged_in", "yes");
    showDashboard();
  } else {
    loginNote.textContent = "Please enter an email and password.";
    loginNote.className = "form-note error";
  }
}

function handleLogout() {
  localStorage.removeItem("tt_admin_logged_in");
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

function renderAdminProducts() {
  products = getProducts();
  const list = document.getElementById("adminProductList");

  if (!products.length) {
    list.innerHTML = "<p>No products yet.</p>";
    return;
  }

  list.innerHTML = products.map(product => `
    <div class="admin-product-row">
      <img src="${product.image}" alt="${product.name}" onerror="this.style.display='none'" />
      <div>
        <strong>${product.name}</strong>
        <div>${product.category}</div>
        <div>${money(product.price)} | Stock: ${product.stock}</div>
      </div>
      <div class="admin-actions">
        <button onclick="editProduct('${product.id}')">Edit</button>
        <button class="delete" onclick="deleteProduct('${product.id}')">Delete</button>
      </div>
    </div>
  `).join("");
}

function saveProductFromForm(event) {
  event.preventDefault();

  const id = document.getElementById("productId").value || "p-" + Date.now();
  const product = {
    id,
    name: document.getElementById("productName").value.trim(),
    category: document.getElementById("productCategory").value.trim(),
    price: Number(document.getElementById("productPrice").value),
    stock: Number(document.getElementById("productStock").value),
    image: document.getElementById("productImage").value.trim() || "https://images.unsplash.com/photo-1555939594-58d7cb561ad1?auto=format&fit=crop&w=900&q=80",
    description: document.getElementById("productDescription").value.trim()
  };

  const exists = products.some(p => p.id === id);
  products = exists ? products.map(p => p.id === id ? product : p) : [product, ...products];
  saveProducts(products);
  clearProductForm();
  renderAdminProducts();
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
  document.getElementById("productImage").value = product.image;
  document.getElementById("productDescription").value = product.description;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function deleteProduct(id) {
  if (!confirm("Delete this product?")) return;
  products = products.filter(p => p.id !== id);
  saveProducts(products);
  renderAdminProducts();
}

function clearProductForm() {
  document.getElementById("productFormTitle").textContent = "Add product";
  document.getElementById("productForm").reset();
  document.getElementById("productId").value = "";
}

function renderOrders() {
  const orders = getOrders();
  const list = document.getElementById("adminOrderList");

  if (!orders.length) {
    list.innerHTML = "<p>No orders yet. Complete a test checkout on the website to create one.</p>";
    return;
  }

  list.innerHTML = orders.map(order => `
    <div class="admin-order-row">
      <h3>${order.id}</h3>
      <p><strong>Date:</strong> ${order.date}</p>
      <p><strong>Status:</strong> ${order.status}</p>
      <p><strong>Postcode:</strong> ${order.postcode}</p>
      <p><strong>Total:</strong> ${money(order.total)} including ${money(order.delivery)} delivery</p>
      <div class="order-lines">
        ${order.items.map(item => `${item.quantity} × ${item.name} at ${money(item.price)}`).join("<br>")}
      </div>
    </div>
  `).join("");
}

function clearOrders() {
  if (!confirm("Clear all test orders?")) return;
  saveOrders([]);
  renderOrders();
}

function loadSettingsForm() {
  const settings = getSettings();
  document.getElementById("settingMinimumOrder").value = settings.minimumOrder;
  document.getElementById("settingEmail").value = settings.managementEmail;
  document.getElementById("settingRadiusMessage").value = settings.radiusMessage;
  document.getElementById("settingOpenDays").value = settings.openDays;
  document.getElementById("settingOpenTimes").value = settings.openTimes;
}

function saveSettingsForm(event) {
  event.preventDefault();

  const current = getSettings();
  const next = {
    ...current,
    minimumOrder: Number(document.getElementById("settingMinimumOrder").value),
    managementEmail: document.getElementById("settingEmail").value.trim(),
    radiusMessage: document.getElementById("settingRadiusMessage").value.trim(),
    openDays: document.getElementById("settingOpenDays").value.trim(),
    openTimes: document.getElementById("settingOpenTimes").value.trim()
  };

  saveSettings(next);
  const note = document.getElementById("settingsNote");
  note.textContent = "Settings saved.";
  note.className = "form-note success";
}

initAdmin();
