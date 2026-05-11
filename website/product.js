import { db } from "./supabaseClient.js";

const money = (value) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP"
  }).format(Number(value || 0));

const detail = document.getElementById("productDetail");
const id = new URLSearchParams(window.location.search).get("id");

async function loadProduct() {
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

  detail.innerHTML = `
    <div class="product-detail-image">
      <img src="${product.image_url || ""}" alt="${product.name}" onerror="this.style.display='none'" />
    </div>

    <div class="product-detail-content">
      <p class="eyebrow">${product.category}</p>
      <h1>${product.name}</h1>
      <p class="product-detail-description">${product.description}</p>
      <div class="price large">${money(product.price)}</div>
      <p class="stock">${product.stock > 0 ? `${product.stock} in stock` : "Out of stock"}</p>

      <button class="btn primary" id="addToBasket" ${product.stock <= 0 ? "disabled" : ""}>
        Add to basket
      </button>

      <a class="btn secondary" href="shop.html">Back to shop</a>
    </div>
  `;

  document.getElementById("addToBasket")?.addEventListener("click", () => {
    const basket = JSON.parse(localStorage.getItem("tt_basket")) || [];
    const existing = basket.find((item) => item.id === product.id);

    if (existing) {
      existing.quantity += 1;
    } else {
      basket.push({
        id: product.id,
        quantity: 1
      });
    }

    localStorage.setItem("tt_basket", JSON.stringify(basket));

    alert("Added to basket. Go back to the shop to checkout.");
  });
}

loadProduct();
