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
  await loadHeroBanner();

  renderSettings();
  renderCategories();
  renderProducts();
  renderBasket();
}

function bindEvents() {
  $("navToggle")?.addEventListener("click", () => $("siteNav")?.classList.toggle("open"));
  $("basketButton")?.addEventListener("click", openBasket);
  $("closeBasket")?.addEventListener("click", closeBasketDrawer);
  $("overlay")?.addEventListener("click", closeBasketDrawer);
  $("categoryFilter")?.addEventListener("change", renderProducts);
  $("searchInput")?.addEventListener("input", renderProducts);
  $("checkDeliveryBtn")?.addEventListener("click", checkCheckoutDelivery);
  $("checkoutBtn")?.addEventListener("click", openTestCheckout);
  $("closePayment")?.addEventListener("click", () => $("paymentModal")?.classList.remove("show"));
  $("completeTestPayment")?.addEventListener("click", completeOrder);

  $("heroPostcodeBtn")?.addEventListener("click", () => {
    const result = calculateDelivery($("heroPostcode")?.value || "");
    const el = $("heroPostcodeResult");
    if (!el) return;
    el.textContent = result.message;
    el.className = result.ok ? "mini-result form-note success" : "mini-result form-note error";
  });

  $("wholesaleForm")?.addEventListener("submit", (event) => handleEnquiry(event, "wholesale", "wholesaleNote"));
  $("contactForm")?.addEventListener("submit", (event) => handleEnquiry(event, "contact", "contactNote"));
}

async function loadSettings() {
  const { data, error } = await db()
    .from("site_settings")
    .select("*")
    .eq("id", 1)
    .single();

  if (error) throw error;
  settings = data;
}

async function loadProducts() {
  const { data, error } = await db()
    .from("products")
    .select("*")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) throw error;
  products = data || [];
}

async function loadHeroBanner() {
  const { data, error } = await db()
    .from("event_banners")
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return;
  renderHeroBanner(data);
}

function renderHeroBanner(banner) {
  const container = $("heroBannerContainer");
  if (!container) return;

  $("heroBannerTitle").textContent = banner.title || "";
  $("heroBannerDescription").textContent = banner.subtitle || "";

  const button = $("heroBannerButton");
  button.textContent = banner.cta_text || "Learn more";
  button.href = banner.cta_link || "shop.html";

  container.classList.remove("hidden");
}

function renderSettings() {
  if (!settings) return;

  document.title = settings.business_name || "The Travelling Taverna | Greek Deli";

  setText("minimumOrderLabel", `Minimum order ${money(settings.minimum_order)}`);
  setText("deliveryDaysLabel", settings.delivery_days);
  setText("deliveryTimesLabel", settings.delivery_times);

  setText("deliverySettingMinimum", `Minimum order: ${money(settings.minimum_order)}`);
  setText("deliverySettingDays", `Delivery days: ${settings.delivery_days}`);
  setText("deliverySettingTimes", `Delivery times: ${settings.delivery_times}`);

  setText("footerMinimumOrder", `Minimum order: ${money(settings.minimum_order)}`);
  setText("footerDeliveryDays", `Delivery: ${settings.delivery_days}`);
  setText("footerDeliveryTimes", `Times: ${settings.delivery_times}`);
}

function setText(id, text) {
  const el = $(id);
  if (el) el.textContent = text;
}

function getDeliveryCharges() {
  return settings?.delivery_charges_by_prefix || {};
}

function calculateDelivery(postcode) {
  const cleaned = String(postcode || "").trim().toUpperCase().replace(/\s+/g, "");

  if (!cleaned) {
    return { ok: false, message: "Please enter your postcode first.", charge: 0 };
  }

  const prefixes = settings?.allowed_postcode_prefixes || [];
  const charges = getDeliveryCharges();

  const matchedPrefix = prefixes
    .map((prefix) => String(prefix).trim().toUpperCase())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .find((prefix) => cleaned.startsWith(prefix));

  if (!matchedPrefix) {
    return {
      ok: false,
      message: settings?.radius_message || "Sorry, You’re outside of our delivery radius",
      charge: 0
    };
  }

  const charge = Number(charges[matchedPrefix] ?? 0);

  return {
    ok: true,
    charge,
    message: `Good news, we deliver to ${matchedPrefix} postcodes. Delivery charge: ${money(charge)}.`
  };
}

function renderCategories() {
  const categoryFilter = $("categoryFilter");
  if (!categoryFilter) return;

  const categories = [...new Set(products.map((product) => product.category))];

  categoryFilter.innerHTML =
    `<option value="all">All categories</option>` +
    categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("");
}

function renderProducts() {
  const productGrid = $("productGrid");
  if (!productGrid) return;

  const search = $("searchInput")?.value?.toLowerCase() || "";
  const category = $("categoryFilter")?.value || "all";

  const filtered = products.filter((product) => {
    const matchesCategory = category === "all" || product.category === category;
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
      <article class="product-card premium-card">
        ${product.product_badge ? `<span class="product-card-badge">${escapeHtml(product.product_badge)}</span>` : ""}

        <a class="product-image" href="product.html?id=${product.id}">
          <img src="${product.image_url || ""}" alt="${escapeHtml(product.name)}" onerror="this.style.display='none'" />
        </a>

        <div class="product-content">
          <p class="eyebrow">${escapeHtml(product.category)}</p>
          <h3><a href="product.html?id=${product.id}">${escapeHtml(product.name)}</a></h3>
          <p>${escapeHtml(product.description)}</p>

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
    basket.push({ id: productId, quantity: 1 });
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

  const basketDetailed = getBasketDetailed();

  basketCount.textContent = basketDetailed.reduce((sum, item) => sum + item.quantity, 0);

  if (!basketDetailed.length) {
    basketItems.innerHTML = "<p>Your basket is empty.</p>";
  } else {
    basketItems.innerHTML = basketDetailed
      .map(
        (item) => `
        <div class="basket-item">
          <div>
            <strong>${escapeHtml(item.name)}</strong>
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

function getBasketDetailed() {
  return basket
    .map((item) => {
      const product = products.find((p) => p.id === item.id);
      return product
        ? {
            ...product,
            quantity: item.quantity,
            unit_price: Number(product.price),
            line_total: Number(product.price) * item.quantity
          }
        : null;
    })
    .filter(Boolean);
}

function changeQty(productId, amount) {
  const item = basket.find((i) => i.id === productId);
  const product = products.find((p) => p.id === productId);

  if (!item || !product) return;

  item.quantity += amount;

  if (item.quantity <= 0) basket = basket.filter((i) => i.id !== productId);
  if (item.quantity > product.stock) item.quantity = product.stock;

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
  $("basketDrawer")?.classList.add("open");
  $("overlay")?.classList.add("show");
  document.body.classList.add("drawer-open");
}

function closeBasketDrawer() {
  $("basketDrawer")?.classList.remove("open");
  $("overlay")?.classList.remove("show");
  document.body.classList.remove("drawer-open");
}

function checkCheckoutDelivery() {
  checkedDelivery = calculateDelivery($("checkoutPostcode")?.value || "");

  const result = $("deliveryResult");
  if (result) {
    result.textContent = checkedDelivery.message;
    result.className = checkedDelivery.ok ? "form-note success" : "form-note error";
  }

  renderBasket();
}

function openTestCheckout() {
  const subtotal = getSubtotal();

  if (!basket.length) return showDeliveryError("Your basket is empty.");

  if (subtotal < Number(settings.minimum_order)) {
    return showDeliveryError(`Minimum order value is ${money(settings.minimum_order)}.`);
  }

  if (!checkedDelivery || !checkedDelivery.ok) {
    checkCheckoutDelivery();
    if (!checkedDelivery.ok) return;
  }

  if (!$("customerName")?.value || !$("customerEmail")?.value || !$("customerAddress")?.value) {
    return showDeliveryError("Please enter your name, email and delivery address.");
  }

  if ($("testPayAmount")) $("testPayAmount").textContent = money(subtotal + checkedDelivery.charge);
  $("paymentModal")?.classList.add("show");
}

function showDeliveryError(message) {
  const el = $("deliveryResult");
  if (!el) return;

  el.textContent = message;
  el.className = "form-note error";
}

async function completeOrder() {
  const customer = {
    name: $("customerName")?.value || "",
    email: $("customerEmail")?.value || "",
    phone: $("customerPhone")?.value || "",
    address: $("customerAddress")?.value || "",
    postcode: $("checkoutPostcode")?.value || ""
  };

  const basketDetailed = getBasketDetailed();

  const items = basketDetailed.map((item) => ({
    product_id: item.id,
    quantity: item.quantity
  }));

  const subtotal = basketDetailed.reduce((sum, item) => sum + item.line_total, 0);
  const deliveryCharge = Number(checkedDelivery?.charge || 0);
  const calculatedTotal = subtotal + deliveryCharge;

  const btn = $("completeTestPayment");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Saving order...";
  }

  const { data, error } = await db().rpc("create_test_order", {
    customer,
    items,
    delivery_charge: deliveryCharge
  });

  if (error) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Complete test payment";
    }

    console.error(error);
    alert(error.message || "Could not save order.");
    return;
  }

  const order = {
    order_number: data?.order_number || "TEST-ORDER",
    subtotal,
    delivery_charge: deliveryCharge,
    total: Number(data?.total ?? calculatedTotal),
    customer,
    items: basketDetailed
  };

  await sendManagementOrderEmail(order);
  await sendCustomerOrderConfirmation(order);

  if (btn) {
    btn.disabled = false;
    btn.textContent = "Complete test payment";
  }

  basket = [];
  checkedDelivery = null;
  saveBasket();

  await loadProducts();

  renderProducts();
  renderBasket();

  $("paymentModal")?.classList.remove("show");
  closeBasketDrawer();

  alert(`Order ${order.order_number} has been saved. A confirmation email has been sent to the customer.`);
}

async function handleEnquiry(event, type, noteId) {
  event.preventDefault();

  const payload = Object.fromEntries(new FormData(event.target).entries());
  const note = $(noteId);

  if (note) {
    note.textContent = "Sending...";
    note.className = "form-note";
  }

  const { error } = await db().rpc("create_enquiry", {
    enquiry_type: type,
    payload
  });

  if (error) {
    console.error(error);
    if (note) {
      note.textContent = "Sorry, this could not be saved.";
      note.className = "form-note error";
    }
    return;
  }

  const emailResult = await sendEmailNotification({
    to: settings?.management_email || "support@smartcoretechnology.co.uk",
    type,
    subject: `New ${type} enquiry`,
    payload,
    html: buildGenericEmailHtml(type, payload)
  });

  if (!emailResult.ok) {
    if (note) {
      note.textContent = "Saved, but the email could not be sent. Check the email endpoint.";
      note.className = "form-note error";
    }
    return;
  }

  if (note) {
    note.textContent = "Thank you. This has been sent.";
    note.className = "form-note success";
  }

  event.target.reset();
}

async function sendManagementOrderEmail(order) {
  return sendEmailNotification({
    to: settings?.management_email || "support@smartcoretechnology.co.uk",
    type: "order",
    subject: `New order received: ${order.order_number}`,
    payload: order,
    html: buildOrderEmailHtml(order, {
      heading: "New order received",
      intro: "A new order has been placed through The Travelling Taverna Greek Deli website.",
      showCustomerThanks: false
    })
  });
}

async function sendCustomerOrderConfirmation(order) {
  if (!order.customer.email) return { ok: false };

  return sendEmailNotification({
    to: order.customer.email,
    type: "customer_order_confirmation",
    subject: `Your order confirmation: ${order.order_number}`,
    payload: order,
    html: buildOrderEmailHtml(order, {
      heading: "Thank you for your order",
      intro: "We have received your order. Here are your order details.",
      showCustomerThanks: true
    })
  });
}

async function sendEmailNotification({ to, type, subject, payload, html }) {
  try {
    const response = await fetch(EMAIL_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        to,
        subject,
        type,
        payload,
        html
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

function buildOrderEmailHtml(order, options = {}) {
  const heading = options.heading || "Order confirmation";
  const intro = options.intro || "Here are your order details.";

  const itemRows = order.items
    .map((item) => {
      const imageHtml = item.image_url
        ? `<img src="${escapeAttribute(item.image_url)}" alt="${escapeAttribute(item.name)}" style="width:72px;height:72px;object-fit:cover;border-radius:14px;display:block;" />`
        : `<div style="width:72px;height:72px;border-radius:14px;background:#eef4f8;"></div>`;

      return `
        <tr>
          <td style="padding:14px 0;border-bottom:1px solid #e6edf3;width:88px;vertical-align:top;">
            ${imageHtml}
          </td>
          <td style="padding:14px 10px;border-bottom:1px solid #e6edf3;vertical-align:top;">
            <strong style="display:block;color:#071827;font-size:15px;">${escapeHtml(item.name)}</strong>
            <span style="display:block;color:#617285;font-size:13px;margin-top:4px;">${escapeHtml(item.category || "")}</span>
            <span style="display:block;color:#617285;font-size:13px;margin-top:4px;">Quantity: ${item.quantity}</span>
          </td>
          <td style="padding:14px 10px;border-bottom:1px solid #e6edf3;text-align:right;vertical-align:top;color:#071827;font-size:14px;">
            ${money(item.unit_price)} each<br />
            <strong>${money(item.line_total)}</strong>
          </td>
        </tr>
      `;
    })
    .join("");

  return `
    <div style="margin:0;padding:0;background:#f6f1e8;font-family:Arial,Helvetica,sans-serif;color:#071827;">
      <div style="max-width:760px;margin:0 auto;padding:28px 16px;">
        <div style="background:#ffffff;border-radius:26px;overflow:hidden;box-shadow:0 18px 55px rgba(7,24,39,0.12);">
          <div style="background:#071827;padding:26px 28px;color:#ffffff;">
            <div style="font-size:13px;letter-spacing:0.14em;text-transform:uppercase;color:#7cc8ff;font-weight:700;margin-bottom:10px;">
              The Travelling Taverna | Greek Deli
            </div>
            <h1 style="margin:0;font-size:32px;line-height:1.05;color:#ffffff;">${escapeHtml(heading)}</h1>
            <p style="margin:12px 0 0;color:rgba(255,255,255,0.82);font-size:15px;line-height:1.6;">${escapeHtml(intro)}</p>
          </div>

          <div style="padding:26px 28px;">
            <div style="background:#f7fbff;border:1px solid #dceaf5;border-radius:20px;padding:18px;margin-bottom:22px;">
              <div style="font-size:13px;color:#617285;margin-bottom:4px;">Order number</div>
              <strong style="font-size:24px;color:#075a96;">${escapeHtml(order.order_number)}</strong>
            </div>

            <h2 style="font-size:20px;margin:0 0 12px;color:#071827;">Customer details</h2>

            <table style="width:100%;border-collapse:collapse;margin-bottom:26px;">
              <tr>
                <td style="padding:8px 0;color:#617285;width:145px;">Name</td>
                <td style="padding:8px 0;color:#071827;font-weight:700;">${escapeHtml(order.customer.name)}</td>
              </tr>
              <tr>
                <td style="padding:8px 0;color:#617285;">Email</td>
                <td style="padding:8px 0;color:#071827;font-weight:700;">${escapeHtml(order.customer.email)}</td>
              </tr>
              <tr>
                <td style="padding:8px 0;color:#617285;">Phone</td>
                <td style="padding:8px 0;color:#071827;font-weight:700;">${escapeHtml(order.customer.phone || "Not provided")}</td>
              </tr>
              <tr>
                <td style="padding:8px 0;color:#617285;">Postcode</td>
                <td style="padding:8px 0;color:#071827;font-weight:700;">${escapeHtml(order.customer.postcode)}</td>
              </tr>
              <tr>
                <td style="padding:8px 0;color:#617285;vertical-align:top;">Delivery address</td>
                <td style="padding:8px 0;color:#071827;font-weight:700;">${escapeHtml(order.customer.address)}</td>
              </tr>
            </table>

            <h2 style="font-size:20px;margin:0 0 12px;color:#071827;">Order items</h2>

            <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
              ${itemRows}
            </table>

            <div style="background:#fbf7ef;border-radius:20px;padding:18px;">
              <table style="width:100%;border-collapse:collapse;">
                <tr>
                  <td style="padding:7px 0;color:#617285;">Subtotal</td>
                  <td style="padding:7px 0;text-align:right;color:#071827;font-weight:700;">${money(order.subtotal)}</td>
                </tr>
                <tr>
                  <td style="padding:7px 0;color:#617285;">Delivery</td>
                  <td style="padding:7px 0;text-align:right;color:#071827;font-weight:700;">${money(order.delivery_charge)}</td>
                </tr>
                <tr>
                  <td style="padding:13px 0 0;border-top:1px solid #e0d6c6;color:#071827;font-size:18px;font-weight:900;">Total</td>
                  <td style="padding:13px 0 0;border-top:1px solid #e0d6c6;text-align:right;color:#075a96;font-size:22px;font-weight:900;">${money(order.total)}</td>
                </tr>
              </table>
            </div>

            ${
              options.showCustomerThanks
                ? `
                  <p style="margin:24px 0 0;color:#617285;line-height:1.6;">
                    Thank you for ordering from The Travelling Taverna Greek Deli. We will prepare your order and contact you if anything else is needed.
                  </p>
                `
                : ""
            }
          </div>

          <div style="background:#071827;color:#ffffff;padding:22px 28px;">
            <p style="margin:0 0 8px;color:rgba(255,255,255,0.8);font-size:13px;">
              Website and ordering system built by
              <a href="https://www.smartcoretechnology.co.uk" style="color:#ffffff;font-weight:800;text-decoration:none;">
                SmartCore Technology
              </a>
            </p>
            <p style="margin:0;color:rgba(255,255,255,0.55);font-size:12px;">
              Practical Technology. Built to Last.
            </p>
          </div>
        </div>
      </div>
    </div>
  `;
}

function buildGenericEmailHtml(type, payload) {
  const rows = Object.entries(payload)
    .map(
      ([key, value]) => `
        <tr>
          <td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:700;">${escapeHtml(key)}</td>
          <td style="padding:8px 12px;border:1px solid #e5e7eb;">${escapeHtml(String(value ?? ""))}</td>
        </tr>
      `
    )
    .join("");

  return `
    <div style="font-family:Arial,sans-serif;color:#111827;">
      <h2 style="margin:0 0 12px;">The Travelling Taverna | Greek Deli</h2>
      <p style="margin:0 0 18px;">New ${escapeHtml(type)} submission received.</p>
      <table style="border-collapse:collapse;width:100%;max-width:700px;">
        ${rows}
      </table>
      <p style="margin-top:24px;color:#6b7280;font-size:13px;">
        Website and ordering system built by
        <a href="https://www.smartcoretechnology.co.uk" style="color:#075a96;font-weight:700;">
          SmartCore Technology
        </a>.
      </p>
    </div>
  `;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

init().catch((error) => {
  console.error("REAL WEBSITE LOAD ERROR:", error);
  alert("Website could not load.\n\nReal error:\n" + (error.message || JSON.stringify(error)));
});
