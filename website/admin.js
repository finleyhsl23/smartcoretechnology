import { supabase, db } from "./supabaseClient.js";
import { PRODUCT_IMAGE_BUCKET } from "./config.js";

let products = [];
let settings = null;
let orders = [];
let enquiries = [];
let productPendingDelete = null;

const $ = (id) => document.getElementById(id);

const money = (value) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP"
  }).format(Number(value || 0));

const slugify = (value) =>
  String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

async function initAdmin() {
  bindEvents();

  const { data } = await supabase.auth.getSession();

  if (data.session) {
    await verifyAdmin();
  }
}

function bindEvents() {
  $("loginBtn").addEventListener("click", handleLogin);
  $("logoutBtn").addEventListener("click", handleLogout);

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => switchTab(tab.dataset.tab));
  });

  $("addProductForm").addEventListener("submit", addProduct);
  $("editProductForm").addEventListener("submit", saveEditedProduct);
  $("settingsForm").addEventListener("submit", saveSettings);

  $("closeEditProductModal").addEventListener("click", closeEditModal);
  $("editProductModal").addEventListener("click", (event) => {
    if (event.target.id === "editProductModal") closeEditModal();
  });

  $("cancelDeleteBtn").addEventListener("click", closeDeleteModal);
  $("confirmDeleteBtn").addEventListener("click", confirmDeleteProduct);
  $("deleteConfirmModal").addEventListener("click", (event) => {
    if (event.target.id === "deleteConfirmModal") closeDeleteModal();
  });

  $("closeContactUserModal").addEventListener("click", closeContactUserModal);
  $("contactUserModal").addEventListener("click", (event) => {
    if (event.target.id === "contactUserModal") closeContactUserModal();
  });

  $("refreshProductsBtn").addEventListener("click", loadProducts);
  $("refreshOrdersBtn").addEventListener("click", loadOrders);
  $("refreshEnquiriesBtn").addEventListener("click", loadEnquiries);

  $("orderSearchInput").addEventListener("input", renderOrders);
  $("orderStatusFilter").addEventListener("change", renderOrders);
}

async function handleLogin() {
  $("loginNote").textContent = "Logging in...";
  $("loginNote").className = "form-note";

  const email = $("adminEmail").value.trim();
  const password = $("adminPassword").value.trim();

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    $("loginNote").textContent = error.message;
    $("loginNote").className = "form-note error";
    return;
  }

  await verifyAdmin();
}

async function verifyAdmin() {
  const { data, error } = await db()
    .from("admin_users")
    .select("id,email,role")
    .single();

  if (error || !data) {
    $("loginNote").textContent = "This user is not set up as an admin.";
    $("loginNote").className = "form-note error";
    return;
  }

  $("loginPanel").classList.add("hidden");
  $("adminDashboard").classList.remove("hidden");

  await loadAll();
}

async function handleLogout() {
  await supabase.auth.signOut();

  $("loginPanel").classList.remove("hidden");
  $("adminDashboard").classList.add("hidden");
}

function switchTab(tabId) {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.tab === tabId);
  });

  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("hidden", panel.id !== tabId);
  });
}

async function loadAll() {
  await loadProducts();
  await loadSettings();
  await loadOrders();
  await loadEnquiries();
}

async function loadProducts() {
  const { data, error } = await db()
    .from("products")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    alert(error.message);
    return;
  }

  products = data || [];
  renderProducts();
}

function renderProducts() {
  if (!products.length) {
    $("adminProductList").innerHTML = "<p>No products yet.</p>";
    return;
  }

  $("adminProductList").innerHTML = products
    .map(
      (product) => `
      <div class="admin-product-row">
        <img src="${product.image_url || ""}" alt="${escapeHtml(product.name)}" onerror="this.style.display='none'" />

        <div>
          <strong>${escapeHtml(product.name)}</strong>
          <div>${escapeHtml(product.category)}</div>
          <div>${money(product.price)} | Stock: ${product.stock}</div>
          <div>${product.is_active ? "Active" : "Hidden"}</div>
        </div>

        <div class="admin-actions">
          <button type="button" data-edit="${product.id}">Edit</button>
          <button type="button" class="delete" data-delete="${product.id}">Delete</button>
        </div>
      </div>
    `
    )
    .join("");

  document.querySelectorAll("[data-edit]").forEach((button) => {
    button.addEventListener("click", () => openEditModal(button.dataset.edit));
  });

  document.querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", () => openDeleteModal(button.dataset.delete));
  });
}

async function addProduct(event) {
  event.preventDefault();

  const note = $("addProductNote");
  const submitBtn = event.submitter;
  note.textContent = "Adding product...";
  note.className = "form-note";
  if (submitBtn) submitBtn.disabled = true;

  try {
    const name = $("addProductName").value.trim();
    const imageFile = $("addProductImageFile").files[0];
    const imageUrl = imageFile ? await uploadImageIfSelected(imageFile) : "";

    const product = {
      name,
      slug: await uniqueSlug(name),
      category: $("addProductCategory").value.trim(),
      price: Number($("addProductPrice").value),
      stock: Number($("addProductStock").value),
      image_url: imageUrl,
      description: $("addProductDescription").value.trim(),
      is_active: true
    };

    const { error } = await db().from("products").insert(product);

    if (error) throw error;

    note.textContent = "Product added.";
    note.className = "form-note success";
    $("addProductForm").reset();

    await loadProducts();
  } catch (error) {
    console.error(error);
    note.textContent = error.message || "Product could not be added.";
    note.className = "form-note error";
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function saveEditedProduct(event) {
  event.preventDefault();

  const note = $("editProductNote");
  const submitBtn = event.submitter;
  note.textContent = "Saving changes...";
  note.className = "form-note";
  if (submitBtn) submitBtn.disabled = true;

  try {
    const id = $("editProductId").value;
    const name = $("editProductName").value.trim();
    const uploadedImage = $("editProductImageFile").files[0]
      ? await uploadImageIfSelected($("editProductImageFile").files[0])
      : "";

    const product = {
      name,
      slug: slugify(name),
      category: $("editProductCategory").value.trim(),
      price: Number($("editProductPrice").value),
      stock: Number($("editProductStock").value),
      image_url: uploadedImage || $("editProductImageUrl").value.trim(),
      description: $("editProductDescription").value.trim(),
      is_active: $("editProductActive").checked
    };

    const { error } = await db()
      .from("products")
      .update(product)
      .eq("id", id);

    if (error) throw error;

    note.textContent = "Product updated.";
    note.className = "form-note success";

    await loadProducts();

    setTimeout(closeEditModal, 500);
  } catch (error) {
    console.error(error);
    note.textContent = error.message || "Product could not be updated.";
    note.className = "form-note error";
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function uploadImageIfSelected() {
  const imageInput = document.getElementById("productImage");

  if (!imageInput?.files?.length) {
    return null;
  }

  const file = imageInput.files[0];

  const extension = file.name.split(".").pop().toLowerCase();

  const safeFileName =
    `${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;

  const filePath = `products/${safeFileName}`;

  const { error } = await supabase.storage
    .from(PRODUCT_IMAGE_BUCKET)
    .upload(filePath, file, {
      cacheControl: "3600",
      upsert: false
    });

  if (error) {
    console.error(error);
    throw new Error(`Image upload failed: ${error.message}`);
  }

  const { data } = supabase.storage
    .from(PRODUCT_IMAGE_BUCKET)
    .getPublicUrl(filePath);

  return data.publicUrl;
}

async function uniqueSlug(name) {
  return `${slugify(name)}-${Date.now().toString().slice(-5)}`;
}

function openEditModal(id) {
  const product = products.find((p) => p.id === id);

  if (!product) return;

  $("editProductId").value = product.id;
  $("editProductName").value = product.name;
  $("editProductCategory").value = product.category;
  $("editProductPrice").value = product.price;
  $("editProductStock").value = product.stock;
  $("editProductImageUrl").value = product.image_url || "";
  $("editProductDescription").value = product.description;
  $("editProductActive").checked = product.is_active;
  $("editProductImageFile").value = "";
  $("editProductNote").textContent = "";

  $("editProductModal").classList.add("show");
}

function closeEditModal() {
  $("editProductModal").classList.remove("show");
}

function openDeleteModal(id) {
  const product = products.find((p) => p.id === id);
  if (!product) return;

  productPendingDelete = product;
  $("deleteConfirmText").textContent = `Are you sure you want to delete "${product.name}"? This cannot be undone.`;
  $("deleteNote").textContent = "";
  $("deleteConfirmModal").classList.add("show");
}

function closeDeleteModal() {
  productPendingDelete = null;
  $("deleteConfirmModal").classList.remove("show");
}

async function confirmDeleteProduct() {
  if (!productPendingDelete) return;

  $("deleteNote").textContent = "Deleting product...";
  $("deleteNote").className = "form-note";
  $("confirmDeleteBtn").disabled = true;

  const { error } = await db()
    .from("products")
    .delete()
    .eq("id", productPendingDelete.id);

  $("confirmDeleteBtn").disabled = false;

  if (error) {
    console.error(error);
    $("deleteNote").textContent = error.message;
    $("deleteNote").className = "form-note error";
    return;
  }

  closeDeleteModal();
  await loadProducts();
}

async function loadOrders() {
  const { data, error } = await db().rpc("admin_orders");

  if (error) {
    console.error(error);
    $("adminOrderList").innerHTML = `<p>${escapeHtml(error.message)}</p>`;
    return;
  }

  orders = data || [];
  renderOrders();
}

function renderOrders() {
  const search = $("orderSearchInput").value.trim().toLowerCase();
  const status = $("orderStatusFilter").value;

  const filtered = orders.filter((order) => {
    const haystack = [
      order.order_number,
      order.status,
      order.customer?.name,
      order.customer?.email,
      order.customer?.phone,
      order.customer?.postcode,
      order.customer?.address
    ]
      .join(" ")
      .toLowerCase();

    const matchesSearch = !search || haystack.includes(search);
    const matchesStatus = status === "all" || order.status === status;

    return matchesSearch && matchesStatus;
  });

  if (!filtered.length) {
    $("adminOrderList").innerHTML = "<p>No orders found.</p>";
    return;
  }

  $("adminOrderList").innerHTML = filtered
    .map(
      (order) => `
        <div class="admin-order-row">
          <div class="admin-card-top">
            <div>
              <h3>${escapeHtml(order.order_number)}</h3>
              <p>${new Date(order.created_at).toLocaleString("en-GB")}</p>
            </div>
            <span class="status-pill">${escapeHtml(order.status)}</span>
          </div>

          <div class="detail-grid">
            <div><span>Customer</span><strong>${escapeHtml(order.customer?.name || "")}</strong></div>
            <div><span>Email</span><strong>${escapeHtml(order.customer?.email || "")}</strong></div>
            <div><span>Phone</span><strong>${escapeHtml(order.customer?.phone || "")}</strong></div>
            <div><span>Postcode</span><strong>${escapeHtml(order.customer?.postcode || "")}</strong></div>
          </div>

          <p><strong>Address:</strong> ${escapeHtml(order.customer?.address || "")}</p>
          <p><strong>Total:</strong> ${money(order.total)} including ${money(order.delivery_charge)} delivery</p>

          <button class="btn secondary small" type="button" data-load-items="${order.id}">
            Show order items
          </button>

          <div class="order-lines hidden" id="items-${order.id}"></div>
        </div>
      `
    )
    .join("");

  document.querySelectorAll("[data-load-items]").forEach((button) => {
    button.addEventListener("click", () => loadOrderItems(button.dataset.loadItems));
  });
}

async function loadOrderItems(orderId) {
  const box = $(`items-${orderId}`);

  if (!box.classList.contains("hidden")) {
    box.classList.add("hidden");
    return;
  }

  box.textContent = "Loading items...";
  box.classList.remove("hidden");

  const { data, error } = await db().rpc("admin_order_items", {
    order_uuid: orderId
  });

  if (error) {
    box.textContent = error.message;
    return;
  }

  box.innerHTML = (data || [])
    .map(
      (item) =>
        `${item.quantity} × ${escapeHtml(item.product_name)} at ${money(item.unit_price)}`
    )
    .join("<br>");
}

async function loadEnquiries() {
  const { data, error } = await db().rpc("admin_enquiries");

  if (error) {
    console.error(error);
    $("adminEnquiryList").innerHTML = `<p>${escapeHtml(error.message)}</p>`;
    return;
  }

  enquiries = data || [];

  if (!enquiries.length) {
    $("adminEnquiryList").innerHTML = "<p>No enquiries yet.</p>";
    return;
  }

  $("adminEnquiryList").innerHTML = enquiries
    .map((enquiry) => renderEnquiryCard(enquiry))
    .join("");

  document.querySelectorAll("[data-contact-enquiry]").forEach((button) => {
    button.addEventListener("click", () => openContactUserModal(button.dataset.contactEnquiry));
  });
}

function renderEnquiryCard(enquiry) {
  const p = enquiry.payload || {};
  const title = enquiry.type === "wholesale" ? "Wholesale enquiry" : "Contact message";

  return `
    <div class="enquiry-card">
      <div class="admin-card-top">
        <div>
          <p class="eyebrow">${escapeHtml(title)}</p>
          <h3>${escapeHtml(p.company || p.name || "New enquiry")}</h3>
          <p>${new Date(enquiry.created_at).toLocaleString("en-GB")}</p>
        </div>
        <span class="status-pill ${enquiry.email_sent ? "sent" : "warning"}">
          ${enquiry.email_sent ? "Email sent" : "Saved only"}
        </span>
      </div>

      <div class="detail-grid">
        ${p.company ? `<div><span>Company</span><strong>${escapeHtml(p.company)}</strong></div>` : ""}
        ${p.name ? `<div><span>Name</span><strong>${escapeHtml(p.name)}</strong></div>` : ""}
        ${p.phone ? `<div><span>Phone</span><strong>${escapeHtml(p.phone)}</strong></div>` : ""}
        ${p.email ? `<div><span>Email</span><strong>${escapeHtml(p.email)}</strong></div>` : ""}
        ${p.address ? `<div><span>Address / Area</span><strong>${escapeHtml(p.address)}</strong></div>` : ""}
      </div>

      <div class="message-box">
        <span>Message</span>
        <p>${escapeHtml(p.message || "No message provided.")}</p>
      </div>

      <div class="enquiry-actions">
        <button class="btn primary small" type="button" data-contact-enquiry="${enquiry.id}">
          Contact user
        </button>
      </div>

      ${enquiry.email_error ? `<p class="form-note error">Email error: ${escapeHtml(enquiry.email_error)}</p>` : ""}
    </div>
  `;
}

function openContactUserModal(enquiryId) {
  const enquiry = enquiries.find((item) => item.id === enquiryId);
  if (!enquiry) return;

  const p = enquiry.payload || {};
  const name = p.name || p.company || "this user";
  const email = p.email || "";
  const phone = p.phone || "";

  $("contactUserText").textContent = `How would you like to contact ${name}?`;

  $("contactEmailBtn").classList.toggle("hidden", !email);
  $("contactPhoneBtn").classList.toggle("hidden", !phone);

  $("contactEmailBtn").href = email
    ? `mailto:${email}?subject=${encodeURIComponent("The Travelling Taverna enquiry")}`
    : "#";

  $("contactPhoneBtn").href = phone ? `tel:${phone}` : "#";

  $("contactUserModal").classList.add("show");
}

function closeContactUserModal() {
  $("contactUserModal").classList.remove("show");
}

async function loadSettings() {
  const { data, error } = await db()
    .from("site_settings")
    .select("*")
    .eq("id", 1)
    .single();

  if (error) {
    console.error(error);
    alert(error.message);
    return;
  }

  settings = data;
  loadSettingsForm();
}

function loadSettingsForm() {
  $("settingBusinessName").value = settings.business_name;
  $("settingMinimumOrder").value = settings.minimum_order;
  $("settingEmail").value = settings.management_email;
  $("settingRadiusMessage").value = settings.radius_message;
  $("settingOpenDays").value = settings.delivery_days;
  $("settingOpenTimes").value = settings.delivery_times;
  $("settingPostcodes").value = (settings.allowed_postcode_prefixes || []).join(", ");
  $("settingChargeDE").value = settings.delivery_charge_de;
  $("settingChargeLE").value = settings.delivery_charge_le;
  $("settingChargeNG").value = settings.delivery_charge_ng;
  $("settingChargeB").value = settings.delivery_charge_b;
}

async function saveSettings(event) {
  event.preventDefault();

  const update = {
    business_name: $("settingBusinessName").value.trim(),
    minimum_order: Number($("settingMinimumOrder").value),
    management_email: $("settingEmail").value.trim(),
    radius_message: $("settingRadiusMessage").value.trim(),
    delivery_days: $("settingOpenDays").value.trim(),
    delivery_times: $("settingOpenTimes").value.trim(),
    allowed_postcode_prefixes: $("settingPostcodes")
      .value.split(",")
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean),
    delivery_charge_de: Number($("settingChargeDE").value),
    delivery_charge_le: Number($("settingChargeLE").value),
    delivery_charge_ng: Number($("settingChargeNG").value),
    delivery_charge_b: Number($("settingChargeB").value)
  };

  const { error } = await db()
    .from("site_settings")
    .update(update)
    .eq("id", 1);

  $("settingsNote").textContent = error ? error.message : "Settings saved.";
  $("settingsNote").className = error ? "form-note error" : "form-note success";

  if (!error) {
    await loadSettings();
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

initAdmin();
