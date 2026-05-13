import { supabase, db } from "./supabaseClient.js";

let products = [];
let settings = null;
let orders = [];
let enquiries = [];
let banners = [];
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
  $("loginBtn")?.addEventListener("click", handleLogin);
  $("logoutBtn")?.addEventListener("click", handleLogout);

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => switchTab(tab.dataset.tab));
  });

  $("addProductForm")?.addEventListener("submit", addProduct);
  $("editProductForm")?.addEventListener("submit", saveEditedProduct);
  $("settingsForm")?.addEventListener("submit", saveSettings);
  $("bannerForm")?.addEventListener("submit", saveBanner);
  $("settingPostcodes")?.addEventListener("input", renderPostcodePriceFields);

  $("closeEditProductModal")?.addEventListener("click", closeEditModal);
  $("editProductModal")?.addEventListener("click", (event) => {
    if (event.target.id === "editProductModal") closeEditModal();
  });

  $("cancelDeleteBtn")?.addEventListener("click", closeDeleteModal);
  $("confirmDeleteBtn")?.addEventListener("click", confirmDeleteProduct);
  $("deleteConfirmModal")?.addEventListener("click", (event) => {
    if (event.target.id === "deleteConfirmModal") closeDeleteModal();
  });

  $("closeContactUserModal")?.addEventListener("click", closeContactUserModal);
  $("contactUserModal")?.addEventListener("click", (event) => {
    if (event.target.id === "contactUserModal") closeContactUserModal();
  });

  $("refreshProductsBtn")?.addEventListener("click", loadProducts);
  $("refreshOrdersBtn")?.addEventListener("click", loadOrders);
  $("refreshEnquiriesBtn")?.addEventListener("click", loadEnquiries);
  $("refreshBannersBtn")?.addEventListener("click", loadBanners);

  $("orderSearchInput")?.addEventListener("input", renderOrders);
  $("orderStatusFilter")?.addEventListener("change", renderOrders);
}

async function handleLogin() {
  $("loginNote").textContent = "Logging in...";
  $("loginNote").className = "form-note";

  const email = $("adminEmail").value.trim();
  const password = $("adminPassword").value.trim();

  const { error } = await supabase.auth.signInWithPassword({ email, password });

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
  await loadBanners();
  await loadSettings();
  await loadOrders();
  await loadEnquiries();
}

async function loadProducts() {
  const { data, error } = await db()
    .from("products")
    .select("*")
    .order("is_active", { ascending: false })
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
  const list = $("adminProductList");
  if (!list) return;

  if (!products.length) {
    list.innerHTML = "<p>No products yet.</p>";
    return;
  }

  list.innerHTML = products
    .map(
      (product) => `
      <div class="admin-product-row ${product.is_active ? "" : "inactive-product"}">
        <img src="${product.image_url || ""}" alt="${escapeHtml(product.name)}" onerror="this.style.display='none'" />

        <div>
          <strong>${escapeHtml(product.name)}</strong>
          <div>${escapeHtml(product.category)}</div>
          <div>${money(product.price)} | Stock: ${product.stock}</div>
          <div>
            <span class="${product.is_active ? "status-pill sent" : "status-pill warning"}">
              ${product.is_active ? "Active on website" : "Not active"}
            </span>
            ${product.product_badge ? `<span class="status-pill">${escapeHtml(product.product_badge)}</span>` : ""}
          </div>
        </div>

        <div class="admin-actions">
          <a class="btn secondary small" href="product.html?id=${product.id}" target="_blank" rel="noopener">Preview</a>
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

  if (note) {
    note.textContent = "Adding product...";
    note.className = "form-note";
  }

  if (submitBtn) submitBtn.disabled = true;

  try {
    const name = $("addProductName").value.trim();
    const uploadedImageUrl = await uploadImageIfSelected($("addProductImageFile")?.files?.[0]);

    const product = {
      name,
      slug: await uniqueSlug(name),
      category: $("addProductCategory").value.trim(),
      price: Number($("addProductPrice").value),
      stock: Number($("addProductStock").value),
      description: $("addProductDescription").value.trim(),
      image_url: uploadedImageUrl || "",
      product_badge: $("addProductBadge")?.value.trim() || "",
      product_highlight: $("addProductHighlight")?.value.trim() || "",
      ingredients: $("addProductIngredients")?.value.trim() || "",
      allergens: $("addProductAllergens")?.value.trim() || "",
      serving_suggestion: $("addProductServing")?.value.trim() || "",
      is_active: true,
      sort_order: 0
    };

    const { data, error } = await db()
      .from("products")
      .insert(product)
      .select("id")
      .single();

    if (error) throw error;

    $("addProductForm").reset();

    if (note) {
      note.innerHTML = `Product added. <a href="product.html?id=${data.id}" target="_blank" rel="noopener">Preview product page</a>`;
      note.className = "form-note success";
    }

    await loadProducts();
  } catch (error) {
    console.error(error);

    if (note) {
      note.textContent = error.message || "Product could not be added.";
      note.className = "form-note error";
    } else {
      alert(error.message || "Product could not be added.");
    }
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
    const uploadedImage = await uploadImageIfSelected($("editProductImageFile")?.files?.[0]);

    const product = {
      name,
      slug: slugify(name),
      category: $("editProductCategory").value.trim(),
      price: Number($("editProductPrice").value),
      stock: Number($("editProductStock").value),
      image_url: uploadedImage || $("editProductImageUrl").value.trim(),
      description: $("editProductDescription").value.trim(),
      product_badge: $("editProductBadge")?.value.trim() || "",
      product_highlight: $("editProductHighlight")?.value.trim() || "",
      ingredients: $("editProductIngredients")?.value.trim() || "",
      allergens: $("editProductAllergens")?.value.trim() || "",
      serving_suggestion: $("editProductServing")?.value.trim() || "",
      is_active: $("editProductActive").checked
    };

    const { error } = await db()
      .from("products")
      .update(product)
      .eq("id", id);

    if (error) throw error;

    note.innerHTML = `Product updated. <a href="product.html?id=${id}" target="_blank" rel="noopener">Preview product page</a>`;
    note.className = "form-note success";

    await loadProducts();
  } catch (error) {
    console.error(error);
    note.textContent = error.message || "Product could not be updated.";
    note.className = "form-note error";
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function uploadImageIfSelected(file) {
  if (!file) return null;

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (event) => {
      const img = new Image();

      img.onload = () => {
        const canvas = document.createElement("canvas");
        const maxWidth = 900;
        const scale = Math.min(1, maxWidth / img.width);

        canvas.width = img.width * scale;
        canvas.height = img.height * scale;

        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        const compressedDataUrl = canvas.toDataURL("image/jpeg", 0.75);
        resolve(compressedDataUrl);
      };

      img.onerror = () => reject(new Error("Image could not be processed."));
      img.src = event.target.result;
    };

    reader.onerror = () => reject(new Error("Image could not be read."));
    reader.readAsDataURL(file);
  });
}

async function uniqueSlug(name) {
  const baseSlug = slugify(name);
  const randomSuffix = Date.now().toString().slice(-5);
  return `${baseSlug}-${randomSuffix}`;
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
  $("editProductBadge").value = product.product_badge || "";
  $("editProductHighlight").value = product.product_highlight || "";
  $("editProductIngredients").value = product.ingredients || "";
  $("editProductAllergens").value = product.allergens || "";
  $("editProductServing").value = product.serving_suggestion || "";
  $("editProductActive").checked = product.is_active;
  $("editProductImageFile").value = "";
  $("editProductNote").textContent = "";
  $("editProductPreviewLink").href = `product.html?id=${product.id}`;

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

async function loadBanners() {
  const { data, error } = await db()
    .from("event_banners")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    return;
  }

  banners = data || [];
  renderBanners();
}

function renderBanners() {
  const list = $("adminBannerList");
  if (!list) return;

  if (!banners.length) {
    list.innerHTML = "<p>No banners yet.</p>";
    return;
  }

  list.innerHTML = banners
    .map(
      (banner) => `
      <div class="admin-product-row ${banner.is_active ? "" : "inactive-product"}">
        <div>
          <strong>${escapeHtml(banner.title)}</strong>
          <div>${escapeHtml(banner.subtitle || "")}</div>
          <div>
            <span class="${banner.is_active ? "status-pill sent" : "status-pill warning"}">
              ${banner.is_active ? "Active on website" : "Not active"}
            </span>
          </div>
        </div>

        <div class="admin-actions">
          <button type="button" data-edit-banner="${banner.id}">Edit</button>
          <button type="button" class="delete" data-delete-banner="${banner.id}">Delete</button>
        </div>
      </div>
    `
    )
    .join("");

  document.querySelectorAll("[data-edit-banner]").forEach((button) => {
    button.addEventListener("click", () => editBanner(button.dataset.editBanner));
  });

  document.querySelectorAll("[data-delete-banner]").forEach((button) => {
    button.addEventListener("click", () => deleteBanner(button.dataset.deleteBanner));
  });
}

function editBanner(id) {
  const banner = banners.find((item) => item.id === id);
  if (!banner) return;

  $("bannerId").value = banner.id;
  $("bannerTitle").value = banner.title || "";
  $("bannerSubtitle").value = banner.subtitle || "";
  $("bannerCtaText").value = banner.cta_text || "";
  $("bannerCtaLink").value = banner.cta_link || "shop.html";
  $("bannerImageUrl").value = banner.image_url || "";
  $("bannerActive").checked = banner.is_active;
  $("bannerNote").textContent = "";
}

async function saveBanner(event) {
  event.preventDefault();

  const id = $("bannerId").value;

  const banner = {
    title: $("bannerTitle").value.trim(),
    subtitle: $("bannerSubtitle").value.trim(),
    cta_text: $("bannerCtaText").value.trim(),
    cta_link: $("bannerCtaLink").value,
    image_url: $("bannerImageUrl").value.trim(),
    is_active: $("bannerActive").checked,
    sort_order: 0
  };

  const response = id
    ? await db().from("event_banners").update(banner).eq("id", id)
    : await db().from("event_banners").insert(banner);

  if (response.error) {
    $("bannerNote").textContent = response.error.message;
    $("bannerNote").className = "form-note error";
    return;
  }

  $("bannerNote").textContent = "Banner saved.";
  $("bannerNote").className = "form-note success";
  $("bannerForm").reset();
  $("bannerId").value = "";
  $("bannerActive").checked = true;

  await loadBanners();
}

async function deleteBanner(id) {
  if (!confirm("Delete this banner?")) return;

  const { error } = await db()
    .from("event_banners")
    .delete()
    .eq("id", id);

  if (error) {
    alert(error.message);
    return;
  }

  await loadBanners();
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
  const search = $("orderSearchInput")?.value.trim().toLowerCase() || "";
  const status = $("orderStatusFilter")?.value || "all";

  const filtered = orders.filter((order) => {
    const haystack = [
      order.order_number,
      order.status,
      order.customer?.name,
      order.customer?.email,
      order.customer?.phone,
      order.customer?.postcode,
      order.customer?.address
    ].join(" ").toLowerCase();

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
    ).join("");

  document.querySelectorAll("[data-load-items]").forEach((button) => {
    button.addEventListener("click", () => loadOrderItems(button.dataset.loadItems));
  });
}

async function loadOrderItems(orderId) {
  const box = $(`items-${orderId}`);
  if (!box) return;

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
    .map((item) => `${item.quantity} × ${escapeHtml(item.product_name)} at ${money(item.unit_price)}`)
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

  $("adminEnquiryList").innerHTML = enquiries.map((enquiry) => renderEnquiryCard(enquiry)).join("");

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
  $("contactEmailBtn").href = email ? `mailto:${email}?subject=${encodeURIComponent("The Travelling Taverna enquiry")}` : "#";
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
  $("settingBusinessName").value = settings.business_name || "";
  $("settingMinimumOrder").value = settings.minimum_order || 0;
  $("settingEmail").value = settings.management_email || "";
  $("settingRadiusMessage").value = settings.radius_message || "";
  $("settingOpenDays").value = settings.delivery_days || "";
  $("settingOpenTimes").value = settings.delivery_times || "";
  $("settingPostcodes").value = (settings.allowed_postcode_prefixes || []).join(", ");

  renderPostcodePriceFields();
}

function getPrefixListFromSettingsInput() {
  return ($("settingPostcodes")?.value || "")
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
}

function renderPostcodePriceFields() {
  const box = $("postcodePriceFields");
  if (!box) return;

  const prefixes = getPrefixListFromSettingsInput();
  const prices = settings?.delivery_charges_by_prefix || {};

  if (!prefixes.length) {
    box.innerHTML = `<p class="form-note">No postcode prefixes added yet.</p>`;
    return;
  }

  box.innerHTML = prefixes
    .map((prefix) => {
      const value = prices[prefix] ?? "";
      return `
        <label class="postcode-price-row">
          Delivery price for ${escapeHtml(prefix)}
          <input
            type="number"
            step="0.01"
            min="0"
            data-postcode-price="${escapeHtml(prefix)}"
            value="${escapeHtml(value)}"
            placeholder="e.g. 5.00"
          />
        </label>
      `;
    })
    .join("");
}

async function saveSettings(event) {
  event.preventDefault();

  const prefixes = getPrefixListFromSettingsInput();
  const prices = {};

  document.querySelectorAll("[data-postcode-price]").forEach((input) => {
    prices[input.dataset.postcodePrice] = Number(input.value || 0);
  });

  const update = {
    business_name: $("settingBusinessName").value.trim(),
    minimum_order: Number($("settingMinimumOrder").value),
    management_email: $("settingEmail").value.trim(),
    radius_message: $("settingRadiusMessage").value.trim(),
    delivery_days: $("settingOpenDays").value.trim(),
    delivery_times: $("settingOpenTimes").value.trim(),
    allowed_postcode_prefixes: prefixes,
    delivery_charges_by_prefix: prices
  };

  const { error } = await db()
    .from("site_settings")
    .update(update)
    .eq("id", 1);

  $("settingsNote").textContent = error ? error.message : "Settings saved.";
  $("settingsNote").className = error ? "form-note error" : "form-note success";

  if (!error) await loadSettings();
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
