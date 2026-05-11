import { supabase, db } from "./supabaseClient.js";

let products = [];
let settings = null;

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

  $("productForm").addEventListener("submit", saveProduct);
  $("clearProductForm").addEventListener("click", clearProductForm);
  $("settingsForm").addEventListener("submit", saveSettings);
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
    await supabase.auth.signOut();

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
    `
    )
    .join("");

  document.querySelectorAll("[data-edit]").forEach((button) => {
    button.addEventListener("click", () => editProduct(button.dataset.edit));
  });

  document.querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", () => deleteProduct(button.dataset.delete));
  });
}

async function saveProduct(event) {
  event.preventDefault();

  const id = $("productId").value;
  const name = $("productName").value.trim();

  const product = {
    name,
    slug: slugify(name),
    category: $("productCategory").value.trim(),
    price: Number($("productPrice").value),
    stock: Number($("productStock").value),
    image_url: $("productImage").value.trim(),
    description: $("productDescription").value.trim(),
    is_active: $("productActive").checked
  };

  const response = id
    ? await db().from("products").update(product).eq("id", id)
    : await db().from("products").insert(product);

  if (response.error) {
    console.error(response.error);
    alert(response.error.message);
    return;
  }

  clearProductForm();
  await loadProducts();
}

function editProduct(id) {
  const product = products.find((p) => p.id === id);

  if (!product) return;

  $("productFormTitle").textContent = "Edit product";
  $("productId").value = product.id;
  $("productName").value = product.name;
  $("productCategory").value = product.category;
  $("productPrice").value = product.price;
  $("productStock").value = product.stock;
  $("productImage").value = product.image_url || "";
  $("productDescription").value = product.description;
  $("productActive").checked = product.is_active;

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}

async function deleteProduct(id) {
  if (!confirm("Delete this product?")) return;

  const { error } = await db()
    .from("products")
    .delete()
    .eq("id", id);

  if (error) {
    console.error(error);
    alert(error.message);
    return;
  }

  await loadProducts();
}

function clearProductForm() {
  $("productFormTitle").textContent = "Add product";
  $("productForm").reset();
  $("productId").value = "";
  $("productActive").checked = true;
}

async function loadOrders() {
  const { data, error } = await db().rpc("admin_orders");

  if (error) {
    console.error(error);
    $("adminOrderList").innerHTML = `<p>${error.message}</p>`;
    return;
  }

  if (!data.length) {
    $("adminOrderList").innerHTML = "<p>No orders yet.</p>";
    return;
  }

  const rendered = await Promise.all(
    data.map(async (order) => {
      const { data: items } = await db().rpc("admin_order_items", {
        order_uuid: order.id
      });

      return `
        <div class="admin-order-row">
          <h3>${order.order_number}</h3>
          <p><strong>Date:</strong> ${new Date(order.created_at).toLocaleString("en-GB")}</p>
          <p><strong>Status:</strong> ${order.status}</p>
          <p><strong>Customer:</strong> ${order.customer?.name || ""} | ${order.customer?.email || ""} | ${order.customer?.phone || ""}</p>
          <p><strong>Address:</strong> ${order.customer?.address || ""}</p>
          <p><strong>Postcode:</strong> ${order.customer?.postcode || ""}</p>
          <p><strong>Total:</strong> ${money(order.total)} including ${money(order.delivery_charge)} delivery</p>

          <div class="order-lines">
            ${(items || [])
              .map(
                (item) =>
                  `${item.quantity} × ${item.product_name} at ${money(item.unit_price)}`
              )
              .join("<br>")}
          </div>
        </div>
      `;
    })
  );

  $("adminOrderList").innerHTML = rendered.join("");
}

async function loadEnquiries() {
  const { data, error } = await db().rpc("admin_enquiries");

  if (error) {
    console.error(error);
    $("adminEnquiryList").innerHTML = `<p>${error.message}</p>`;
    return;
  }

  if (!data.length) {
    $("adminEnquiryList").innerHTML = "<p>No enquiries yet.</p>";
    return;
  }

  $("adminEnquiryList").innerHTML = data
    .map(
      (enquiry) => `
      <div class="admin-order-row">
        <h3>${enquiry.type}</h3>
        <p><strong>Date:</strong> ${new Date(enquiry.created_at).toLocaleString("en-GB")}</p>
        <pre>${escapeHtml(JSON.stringify(enquiry.payload, null, 2))}</pre>
      </div>
    `
    )
    .join("");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
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

initAdmin();
