import { supabase, db } from "./supabaseClient.js";
import { EMAIL_ENDPOINT } from "./config.js";

let products = [];
let settings = null;
let basket = JSON.parse(localStorage.getItem("tt_basket")) || [];
let checkedDelivery = null;

const $ = (id) => document.getElementById(id);

const money = (value) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP"
  }).format(Number(value || 0));

async function init() {
  bindEvents();
  await loadSettings();
  await loadProducts();
  renderSettings();
  renderCategories();
  renderProducts();
  renderBasket();
}

function bindEvents() {
  $("navToggle")?.addEventListener("click", () => {
    $("siteNav")?.classList.toggle("open");
  });

  $("basketButton")?.addEventListener("click", openBasket);
  $("closeBasket")?.addEventListener("click", closeBasketDrawer);
  $("overlay")?.addEventListener("click", closeBasketDrawer);

  $("categoryFilter")?.addEventListener("change", renderProducts);
  $("searchInput")?.addEventListener("input", renderProducts);

  $("checkDeliveryBtn")?.addEventListener("click", checkCheckoutDelivery);
  $("checkoutBtn")?.addEventListener("click", openTestCheckout);

  $("closePayment")?.addEventListener("click", () => {
    $("paymentModal")?.classList.remove("show");
  });

  $("completeTestPayment")?.addEventListener("click", completeOrder);

  $("heroPostcodeBtn")?.addEventListener("click", () => {
    const result = calculateDelivery($("heroPostcode")?.value || "");
    const resultEl = $("heroPostcodeResult");

    if (resultEl) {
      resultEl.textContent = result.message;
      resultEl.className = result.ok
        ? "mini-result form-note success"
        : "mini-result form-note error";
    }
  });

  $("wholesaleForm")?.addEventListener("submit", (event) =>
    handleEnquiry(event, "wholesale", "wholesaleNote")
  );

  $("contactForm")?.addEventListener("submit", (event) =>
    handleEnquiry(event, "contact", "contactNote")
  );
}

async function loadSettings() {
  const { data, error } = await db()
    .from("site_settings")
    .select("*")
    .eq("id", 1)
    .single();

  if (error) {
    console.error(error);
    throw new Error("Could not load website settings from Supabase.");
  }

  settings = data;
}

async function loadProducts() {
  const { data, error } = await db()
    .from("products")
    .select("*")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    throw new Error("Could not load products from Supabase.");
  }

  products = data || [];
}

function renderSettings() {
  document.title = settings.business_name || "The Travelling Taverna | Greek Deli";

  $("minimumOrderLabel").textContent = `Minimum order ${money(settings.minimum_order)}`;
  $("deliveryDaysLabel").textContent = settings.delivery_days;
  $("deliveryTimesLabel").textContent = settings.delivery_times;

  $("deliverySettingMinimum").textContent = `Minimum order: ${money(settings.minimum_order)}`;
  $("deliverySettingDays").textContent = `Delivery days: ${settings.delivery_days}`;
  $("deliverySettingTimes").textContent = `Delivery times: ${settings.delivery_times}`;
}

function calculateDelivery(postcode) {
  const cleaned = String(postcode || "").trim().toUpperCase().replace(/\s+/g, "");

  if (!cleaned) {
    return {
      ok: false,
      message: "Please enter your postcode first.",
      charge: 0
    };
  }

  const prefixes = settings.allowed_postcode_prefixes || [];
  const allowed = prefixes.some((prefix) =>
    cleaned.startsWith(String(prefix).toUpperCase())
  );

  if (!allowed) {
    return {
      ok: false,
      message: settings.radius_message || "Sorry, You’re outside of our delivery radius",
      charge: 0
    };
  }

  let charge = Number(settings.delivery_charge_de || 3);

  if (cleaned.startsWith("LE")) charge = Number(settings.delivery_charge_le || 7);
  if (cleaned.startsWith("NG")) charge = Number(settings.delivery_charge_ng || 7);
  if (cleaned.startsWith("B")) charge = Number(settings.delivery_charge_b || 10);

  return {
    ok: true,
    charge,
    message: `Good news, we deliver to this postcode. Delivery charge: ${money(charge)}.`
  };
}

function renderCategories() {
  const categoryFilter = $("categoryFilter");
  if (!categoryFilter) return;

  const categories = [...new Set(products.map((product) => product.category))];

  categoryFilter.innerHTML =
    `<option value="all">All categories</option>` +
    categories.map((category) => `<option value="${category}">${category}</option>`).join("");
}

function renderProducts() {
  const productGrid = $("productGrid");

  if (!productGrid) {
    return;
  }

  const searchInput = $("searchInput");
  const categoryFilter = $("categoryFilter");

  const search = searchInput
    ? searchInput.value.toLowerCase()
    : "";

  const category = categoryFilter
    ? categoryFilter.value
    : "all";

  const filtered = products.filter((product) => {
    const matchesCategory =
      category === "all" ||
      product.category === category;

    const matchesSearch =
      product.name.toLowerCase().includes(search) ||
      product.description.toLowerCase().includes(search);

    return matchesCategory && matchesSearch;
  });

  if (!filtered.length) {
    productGrid.innerHTML = "<p>No products found.</p>";
    return;
  }

  productGrid.innerHTML = filtered
    .map(
      (product) => `
      <article class="product-card">
        <a class="product-image" href="product.html?id=${product.id}">
          <img
            src="${product.image_url || ""}"
            alt="${product.name}"
            onerror="this.style.display='none'"
          />
        </a>

        <div class="product-content">
          <p class="eyebrow">${product.category}</p>

          <h3>
            <a href="product.html?id=${product.id}">
              ${product.name}
            </a>
          </h3>

          <p>${product.description}</p>

          <div class="product-meta">
            <div>
              <div class="price">
                ${money(product.price)}
              </div>

              <div class="stock">
                ${
                  product.stock > 0
                    ? `${product.stock} in stock`
                    : "Out of stock"
                }
              </div>
            </div>

            <button
              class="btn primary small"
              data-add="${product.id}"
              ${product.stock <= 0 ? "disabled" : ""}
            >
              Add
            </button>
          </div>
        </div>
      </article>
    `
    )
    .join("");

  document.querySelectorAll("[data-add]").forEach((button) => {
    button.addEventListener("click", () => {
      addToBasket(button.dataset.add);
    });
  });
}

  if (!filtered.length) {
    $("productGrid").innerHTML = "<p>No products found.</p>";
    return;
  }

  $("productGrid").innerHTML = filtered
    .map(
      (product) => `
      <article class="product-card">
        <a class="product-image" href="product.html?id=${product.id}">
          <img src="${product.image_url || ""}" alt="${product.name}" onerror="this.style.display='none'" />
        </a>

        <div class="product-content">
          <p class="eyebrow">${product.category}</p>
          <h3><a href="product.html?id=${product.id}">${product.name}</a></h3>
          <p>${product.description}</p>

          <div class="product-meta">
            <div>
              <div class="price">${money(product.price)}</div>
              <div class="stock">${product.stock > 0 ? `${product.stock} in stock` : "Out of stock"}</div>
            </div>

            <button class="btn primary small" data-add="${product.id}" ${product.stock <= 0 ? "disabled" : ""}>
              Add
            </button>
          </div>
        </div>
      </article>
    `
    )
    .join("");

  document.querySelectorAll("[data-add]").forEach((button) => {
    button.addEventListener("click", () => addToBasket(button.dataset.add));
  });
}

function addToBasket(productId) {
  const product = products.find((item) => item.id === productId);

  if (!product || product.stock <= 0) return;

  const existing = basket.find((item) => item.id === productId);

  if (existing) {
    if (existing.quantity < product.stock) existing.quantity += 1;
  } else {
    basket.push({
      id: productId,
      quantity: 1
    });
  }

  saveBasket();
  renderBasket();
  openBasket();
}

function saveBasket() {
  localStorage.setItem("tt_basket", JSON.stringify(basket));
}

function renderBasket() {
  const basketCount = $("basketCount");
  const basketItems = $("basketItems");
  const basketSubtotal = $("basketSubtotal");
  const basketDelivery = $("basketDelivery");
  const basketTotal = $("basketTotal");

  if (!basketCount || !basketItems || !basketSubtotal || !basketDelivery || !basketTotal) return;

  const basketDetailed = basket
    .map((item) => {
      const product = products.find((p) => p.id === item.id);
      return product ? { ...product, quantity: item.quantity } : null;
    })
    .filter(Boolean);

  basketCount.textContent = basketDetailed.reduce(
    (sum, item) => sum + item.quantity,
    0
  );

  if (!basketDetailed.length) {
    basketItems.innerHTML = `<p>Your basket is empty.</p>`;
  } else {
    basketItems.innerHTML = basketDetailed
      .map(
        (item) => `
        <div class="basket-item">
          <div>
            <strong>${item.name}</strong>
            <div>${money(item.price)} each</div>

            <div class="qty-controls">
              <button data-qty="${item.id}" data-amount="-1">-</button>
              <span>${item.quantity}</span>
              <button data-qty="${item.id}" data-amount="1">+</button>
              <button data-remove="${item.id}">Remove</button>
            </div>
          </div>

          <strong>${money(Number(item.price) * item.quantity)}</strong>
        </div>
      `
      )
      .join("");
  }

  document.querySelectorAll("[data-qty]").forEach((button) => {
    button.addEventListener("click", () =>
      changeQty(button.dataset.qty, Number(button.dataset.amount))
    );
  });

  document.querySelectorAll("[data-remove]").forEach((button) => {
    button.addEventListener("click", () => removeFromBasket(button.dataset.remove));
  });

  const subtotal = getSubtotal();
  const delivery = checkedDelivery?.ok ? checkedDelivery.charge : 0;

  basketSubtotal.textContent = money(subtotal);
  basketDelivery.textContent = checkedDelivery?.ok ? money(delivery) : "Check postcode";
  basketTotal.textContent = money(subtotal + delivery);
}

function changeQty(productId, amount) {
  const item = basket.find((i) => i.id === productId);
  const product = products.find((p) => p.id === productId);

  if (!item || !product) return;

  item.quantity += amount;

  if (item.quantity <= 0) {
    basket = basket.filter((i) => i.id !== productId);
  }

  if (item.quantity > product.stock) {
    item.quantity = product.stock;
  }

  saveBasket();
  renderBasket();
}

function removeFromBasket(productId) {
  basket = basket.filter((item) => item.id !== productId);
  saveBasket();
  renderBasket();
}

function getSubtotal() {
  return basket.reduce((sum, item) => {
    const product = products.find((p) => p.id === item.id);
    return sum + (product ? Number(product.price) * item.quantity : 0);
  }, 0);
}

function openBasket() {
  $("basketDrawer").classList.add("open");
  $("overlay").classList.add("show");
  document.body.classList.add("drawer-open");
}

function closeBasketDrawer() {
  $("basketDrawer").classList.remove("open");
  $("overlay").classList.remove("show");
  document.body.classList.remove("drawer-open");
}

function checkCheckoutDelivery() {
  checkedDelivery = calculateDelivery($("checkoutPostcode").value);

  $("deliveryResult").textContent = checkedDelivery.message;
  $("deliveryResult").className = checkedDelivery.ok
    ? "form-note success"
    : "form-note error";

  renderBasket();
}

function openTestCheckout() {
  const subtotal = getSubtotal();

  if (!basket.length) {
    return showDeliveryError("Your basket is empty.");
  }

  if (subtotal < Number(settings.minimum_order)) {
    return showDeliveryError(`Minimum order value is ${money(settings.minimum_order)}.`);
  }

  if (!checkedDelivery || !checkedDelivery.ok) {
    checkCheckoutDelivery();
    if (!checkedDelivery.ok) return;
  }

  if (!$("customerName").value || !$("customerEmail").value || !$("customerAddress").value) {
    return showDeliveryError("Please enter your name, email and delivery address.");
  }

  $("testPayAmount").textContent = money(subtotal + checkedDelivery.charge);
  $("paymentModal").classList.add("show");
}

function showDeliveryError(message) {
  $("deliveryResult").textContent = message;
  $("deliveryResult").className = "form-note error";
}

async function completeOrder() {
  const customer = {
    name: $("customerName").value,
    email: $("customerEmail").value,
    phone: $("customerPhone").value,
    address: $("customerAddress").value,
    postcode: $("checkoutPostcode").value
  };

  const items = basket.map((item) => ({
    product_id: item.id,
    quantity: item.quantity
  }));

  $("completeTestPayment").disabled = true;
  $("completeTestPayment").textContent = "Saving order...";

  const { data, error } = await db().rpc("create_test_order", {
    customer,
    items,
    delivery_charge: checkedDelivery.charge
  });

  $("completeTestPayment").disabled = false;
  $("completeTestPayment").textContent = "Complete test payment";

  if (error) {
    console.error(error);
    alert(error.message || "Could not save order.");
    return;
  }

  await sendEmailNotification({
    type: "order",
    subject: `New test order: ${data.order_number}`,
    payload: {
      order_number: data.order_number,
      customer,
      items,
      delivery_charge: checkedDelivery.charge,
      total: data.total
    }
  });

  basket = [];
  checkedDelivery = null;
  saveBasket();

  await loadProducts();

  renderProducts();
  renderBasket();

  $("paymentModal").classList.remove("show");
  closeBasketDrawer();

  alert(`Test payment complete. Order ${data.order_number} has been saved in Supabase.`);
}

async function handleEnquiry(event, type, noteId) {
  event.preventDefault();

  const payload = Object.fromEntries(new FormData(event.target).entries());
  const note = $(noteId);

  note.textContent = "Sending...";
  note.className = "form-note";

  const { error } = await db().rpc("create_enquiry", {
    enquiry_type: type,
    payload
  });

  if (error) {
    console.error(error);
    note.textContent = "Sorry, this could not be saved.";
    note.className = "form-note error";
    return;
  }

  const emailResult = await sendEmailNotification({
    type,
    subject: `New ${type} enquiry`,
    payload
  });

  if (!emailResult.ok) {
    note.textContent = "Saved, but the email could not be sent. Check the email endpoint.";
    note.className = "form-note error";
    return;
  }

  note.textContent = "Thank you. This has been sent.";
  note.className = "form-note success";

  event.target.reset();
}

async function sendEmailNotification({ type, subject, payload }) {
  try {
    const response = await fetch(EMAIL_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        to: settings.management_email || "support@smartcoretechnology.co.uk",
        subject,
        type,
        payload,
        html: buildEmailHtml(type, payload)
      })
    });

    if (!response.ok) {
      console.error("Email endpoint failed", await response.text());
      return { ok: false };
    }

    return { ok: true };
  } catch (error) {
    console.error("Email failed", error);
    return { ok: false };
  }
}

function buildEmailHtml(type, payload) {
  const rows = Object.entries(payload)
    .map(([key, value]) => {
      return `
        <tr>
          <td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:700;">${escapeHtml(key)}</td>
          <td style="padding:8px 12px;border:1px solid #e5e7eb;">${escapeHtml(String(value ?? ""))}</td>
        </tr>
      `;
    })
    .join("");

  return `
    <div style="font-family:Arial,sans-serif;color:#111827;">
      <h2 style="margin:0 0 12px;">The Travelling Taverna | Greek Deli</h2>
      <p style="margin:0 0 18px;">New ${escapeHtml(type)} submission received.</p>
      <table style="border-collapse:collapse;width:100%;max-width:700px;">
        ${rows}
      </table>
    </div>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

init().catch((error) => {
  console.error("REAL WEBSITE LOAD ERROR:", error);

  alert(
    "Website could not load.\n\nReal error:\n" +
    (error.message || JSON.stringify(error))
  );
});
