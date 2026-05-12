import { db } from "./supabaseClient.js";

const money = (value) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP"
  }).format(Number(value || 0));

const detail = document.getElementById("productDetail");
const recommendedProducts = document.getElementById("recommendedProducts");
const id = new URLSearchParams(window.location.search).get("id");

let allProducts = [];

async function loadProductPage() {
  if (!id) {
    detail.innerHTML = "<p>No product selected.</p>";
    return;
  }

  const { data: product, error } = await db()
    .from("products")
    .select("*")
    .eq("id", id)
    .eq("is_active", true)
    .single();

  if (error || !product) {
    console.error(error);
    detail.innerHTML = "<p>This product could not be found.</p>";
    return;
  }

  document.title = `${product.name} | The Travelling Taverna Greek Deli`;

  await loadRecommendations(product);
  renderProduct(product);
  renderExtraPanels(product);
  renderRecommendations();
  updateStickyBasket();
}

async function loadRecommendations(product) {
  const { data, error } = await db()
    .from("products")
    .select("*")
    .eq("is_active", true)
    .neq("id", product.id)
    .order("sort_order", { ascending: true })
    .limit(4);

  if (error) {
    console.error(error);
    allProducts = [];
    return;
  }

  allProducts = data || [];
}

function renderProduct(product) {
  detail.innerHTML = `
    <div class="premium-product-media">
      ${product.product_badge ? `<span class="product-floating-badge">${escapeHtml(product.product_badge)}</span>` : ""}
      <img src="${product.image_url || ""}" alt="${escapeHtml(product.name)}" onerror="this.style.display='none'" />
    </div>

    <div class="premium-product-content">
      <p class="eyebrow">${escapeHtml(product.category)}</p>

      <h1>${escapeHtml(product.name)}</h1>

      <p class="product-detail-description">
        ${escapeHtml(product.description)}
      </p>

      <div class="premium-price-row">
        <div>
          <div class="price large">${money(product.price)}</div>
          <p class="stock">${product.stock > 0 ? `${product.stock} in stock` : "Out of stock"}</p>
        </div>

        <span class="fresh-pill">Fresh local delivery</span>
      </div>

      <div class="premium-product-actions">
        <button class="btn primary" id="addToBasket" ${product.stock <= 0 ? "disabled" : ""}>
          Add to basket
        </button>

        <a class="btn secondary" href="shop.html">
          Back to shop
        </a>
      </div>

      <div class="product-benefits">
        <div>
          <strong>Local delivery</strong>
          <span>Within the current delivery radius</span>
        </div>
        <div>
          <strong>Fresh products</strong>
          <span>Prepared for simple ordering</span>
        </div>
        <div>
          <strong>Business orders</strong>
          <span>Wholesale enquiries available</span>
        </div>
      </div>
    </div>
  `;

  document.getElementById("addToBasket")?.addEventListener("click", () => {
    addToBasket(product);
  });
}

function renderExtraPanels(product) {
  const highlight = document.getElementById("productHighlightText");
  const ingredients = document.getElementById("ingredientsText");
  const allergens = document.getElementById("allergensText");
  const serving = document.getElementById("servingText");

  if (highlight) highlight.textContent = product.product_highlight || "Perfect for lunch, dinner, events or sharing. Built for simple online ordering and local delivery.";
  if (ingredients) ingredients.textContent = product.ingredients || "Ingredients will be shown here when added.";
  if (allergens) allergens.textContent = product.allergens || "Please contact us if you have any allergy requirements.";
  if (serving) serving.textContent = product.serving_suggestion || "Best served fresh with your favourite sides.";
}

function renderRecommendations() {
  if (!recommendedProducts) return;

  if (!allProducts.length) {
    recommendedProducts.innerHTML = "<p>No other products available yet.</p>";
    return;
  }

  recommendedProducts.innerHTML = allProducts
    .map(
      (product) => `
      <article class="product-card recommended-card">
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
    button.addEventListener("click", () => {
      const product = allProducts.find((item) => item.id === button.dataset.add);
      if (product) addToBasket(product);
    });
  });
}

function addToBasket(product) {
  const basket = JSON.parse(localStorage.getItem("tt_basket")) || [];
  const existing = basket.find((item) => item.id === product.id);

  if (existing) existing.quantity += 1;
  else basket.push({ id: product.id, quantity: 1 });

  localStorage.setItem("tt_basket", JSON.stringify(basket));
  updateStickyBasket();
  alert("Added to basket. Go back to the shop to checkout.");
}

function updateStickyBasket() {
  const basket = JSON.parse(localStorage.getItem("tt_basket")) || [];
  const count = basket.reduce((sum, item) => sum + item.quantity, 0);

  const countEl = document.getElementById("stickyBasketCount");
  const totalEl = document.getElementById("stickyBasketTotal");
  const pill = document.getElementById("stickyBasketPill");

  if (!countEl || !totalEl || !pill) return;

  countEl.textContent = `${count} ${count === 1 ? "item" : "items"}`;
  totalEl.textContent = "View basket";
  pill.classList.toggle("show", count > 0);

  document.getElementById("stickyBasketButton")?.addEventListener("click", () => {
    window.location.href = "shop.html";
  });
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

loadProductPage();
