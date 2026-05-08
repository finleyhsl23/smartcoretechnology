let products = getProducts();
let basket = JSON.parse(localStorage.getItem("tt_basket")) || [];
let checkedDelivery = null;

const productGrid = document.getElementById("productGrid");
const basketButton = document.getElementById("basketButton");
const basketDrawer = document.getElementById("basketDrawer");
const closeBasket = document.getElementById("closeBasket");
const overlay = document.getElementById("overlay");
const basketItems = document.getElementById("basketItems");
const basketCount = document.getElementById("basketCount");
const basketSubtotal = document.getElementById("basketSubtotal");
const basketDelivery = document.getElementById("basketDelivery");
const basketTotal = document.getElementById("basketTotal");
const categoryFilter = document.getElementById("categoryFilter");
const searchInput = document.getElementById("searchInput");
const checkoutBtn = document.getElementById("checkoutBtn");
const checkDeliveryBtn = document.getElementById("checkDeliveryBtn");
const checkoutPostcode = document.getElementById("checkoutPostcode");
const deliveryResult = document.getElementById("deliveryResult");
const paymentModal = document.getElementById("paymentModal");
const closePayment = document.getElementById("closePayment");
const completeTestPayment = document.getElementById("completeTestPayment");
const testPayAmount = document.getElementById("testPayAmount");

function init() {
  renderCategories();
  renderProducts();
  renderBasket();
  bindEvents();
}

function bindEvents() {
  document.getElementById("navToggle")?.addEventListener("click", () => {
    document.getElementById("siteNav").classList.toggle("open");
  });

  basketButton.addEventListener("click", openBasket);
  closeBasket.addEventListener("click", closeBasketDrawer);
  overlay.addEventListener("click", closeBasketDrawer);

  categoryFilter.addEventListener("change", renderProducts);
  searchInput.addEventListener("input", renderProducts);

  checkDeliveryBtn.addEventListener("click", checkCheckoutDelivery);
  checkoutBtn.addEventListener("click", openTestCheckout);
  closePayment.addEventListener("click", () => paymentModal.classList.remove("show"));
  completeTestPayment.addEventListener("click", completeOrder);

  document.getElementById("heroPostcodeBtn").addEventListener("click", () => {
    const result = calculateDelivery(document.getElementById("heroPostcode").value);
    const el = document.getElementById("heroPostcodeResult");
    el.textContent = result.message;
    el.className = result.ok ? "mini-result form-note success" : "mini-result form-note error";
  });

  document.getElementById("wholesaleForm").addEventListener("submit", handleWholesaleForm);
  document.getElementById("contactForm").addEventListener("submit", handleContactForm);
}

function renderCategories() {
  const categories = [...new Set(products.map(p => p.category))];
  categoryFilter.innerHTML = `<option value="all">All categories</option>` + categories.map(cat => (
    `<option value="${cat}">${cat}</option>`
  )).join("");
}

function renderProducts() {
  const search = searchInput.value.toLowerCase();
  const category = categoryFilter.value;

  const filtered = products.filter(product => {
    const matchesCategory = category === "all" || product.category === category;
    const matchesSearch = product.name.toLowerCase().includes(search) || product.description.toLowerCase().includes(search);
    return matchesCategory && matchesSearch;
  });

  productGrid.innerHTML = filtered.map(product => `
    <article class="product-card">
      <div class="product-image">
        <img src="${product.image}" alt="${product.name}" onerror="this.style.display='none'" />
      </div>
      <div class="product-content">
        <p class="eyebrow">${product.category}</p>
        <h3>${product.name}</h3>
        <p>${product.description}</p>
        <div class="product-meta">
          <div>
            <div class="price">${money(product.price)}</div>
            <div class="stock">${product.stock > 0 ? `${product.stock} in stock` : "Out of stock"}</div>
          </div>
          <button class="btn primary small" onclick="addToBasket('${product.id}')" ${product.stock <= 0 ? "disabled" : ""}>
            Add
          </button>
        </div>
      </div>
    </article>
  `).join("");
}

function addToBasket(productId) {
  const product = products.find(p => p.id === productId);
  if (!product || product.stock <= 0) return;

  const existing = basket.find(item => item.id === productId);
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
  const basketDetailed = basket.map(item => {
    const product = products.find(p => p.id === item.id);
    return product ? { ...product, quantity: item.quantity } : null;
  }).filter(Boolean);

  basketCount.textContent = basketDetailed.reduce((sum, item) => sum + item.quantity, 0);

  if (!basketDetailed.length) {
    basketItems.innerHTML = `<p>Your basket is empty.</p>`;
  } else {
    basketItems.innerHTML = basketDetailed.map(item => `
      <div class="basket-item">
        <div>
          <strong>${item.name}</strong>
          <div>${money(item.price)} each</div>
          <div class="qty-controls">
            <button onclick="changeQty('${item.id}', -1)">-</button>
            <span>${item.quantity}</span>
            <button onclick="changeQty('${item.id}', 1)">+</button>
            <button onclick="removeFromBasket('${item.id}')">Remove</button>
          </div>
        </div>
        <strong>${money(item.price * item.quantity)}</strong>
      </div>
    `).join("");
  }

  const subtotal = getSubtotal();
  const delivery = checkedDelivery?.ok ? checkedDelivery.charge : 0;
  basketSubtotal.textContent = money(subtotal);
  basketDelivery.textContent = checkedDelivery?.ok ? money(delivery) : "Check postcode";
  basketTotal.textContent = money(subtotal + delivery);
}

function changeQty(productId, amount) {
  const item = basket.find(i => i.id === productId);
  const product = products.find(p => p.id === productId);
  if (!item || !product) return;

  item.quantity += amount;
  if (item.quantity <= 0) basket = basket.filter(i => i.id !== productId);
  if (item.quantity > product.stock) item.quantity = product.stock;

  saveBasket();
  renderBasket();
}

function removeFromBasket(productId) {
  basket = basket.filter(item => item.id !== productId);
  saveBasket();
  renderBasket();
}

function getSubtotal() {
  return basket.reduce((sum, item) => {
    const product = products.find(p => p.id === item.id);
    return sum + (product ? product.price * item.quantity : 0);
  }, 0);
}

function openBasket() {
  basketDrawer.classList.add("open");
  overlay.classList.add("show");
  document.body.classList.add("drawer-open");
}

function closeBasketDrawer() {
  basketDrawer.classList.remove("open");
  overlay.classList.remove("show");
  document.body.classList.remove("drawer-open");
}

function checkCheckoutDelivery() {
  checkedDelivery = calculateDelivery(checkoutPostcode.value);
  deliveryResult.textContent = checkedDelivery.message;
  deliveryResult.className = checkedDelivery.ok ? "form-note success" : "form-note error";
  renderBasket();
}

function openTestCheckout() {
  const settings = getSettings();
  const subtotal = getSubtotal();

  if (!basket.length) {
    deliveryResult.textContent = "Your basket is empty.";
    deliveryResult.className = "form-note error";
    return;
  }

  if (subtotal < settings.minimumOrder) {
    deliveryResult.textContent = `Minimum order value is ${money(settings.minimumOrder)}.`;
    deliveryResult.className = "form-note error";
    return;
  }

  if (!checkedDelivery || !checkedDelivery.ok) {
    checkCheckoutDelivery();
    if (!checkedDelivery.ok) return;
  }

  testPayAmount.textContent = money(subtotal + checkedDelivery.charge);
  paymentModal.classList.add("show");
}

function completeOrder() {
  const orderItems = basket.map(item => {
    const product = products.find(p => p.id === item.id);
    return {
      id: item.id,
      name: product.name,
      price: product.price,
      quantity: item.quantity
    };
  });

  const subtotal = getSubtotal();
  const order = {
    id: "ORD-" + Date.now(),
    date: new Date().toLocaleString("en-GB"),
    status: "Paid - test payment",
    postcode: checkoutPostcode.value,
    subtotal,
    delivery: checkedDelivery.charge,
    total: subtotal + checkedDelivery.charge,
    items: orderItems
  };

  saveOrders([order, ...getOrders()]);

  products = products.map(product => {
    const ordered = basket.find(item => item.id === product.id);
    if (!ordered) return product;
    return { ...product, stock: Math.max(0, product.stock - ordered.quantity) };
  });
  saveProducts(products);

  basket = [];
  checkedDelivery = null;
  saveBasket();
  renderBasket();
  renderProducts();

  paymentModal.classList.remove("show");
  closeBasketDrawer();

  alert("Test payment complete. The order has been saved in the admin dashboard.");
}

function handleWholesaleForm(event) {
  event.preventDefault();
  const settings = getSettings();
  const note = document.getElementById("wholesaleNote");
  note.textContent = `Demo complete. In the live version, this enquiry will be emailed to ${settings.managementEmail}.`;
  note.className = "form-note success";
  event.target.reset();
}

function handleContactForm(event) {
  event.preventDefault();
  const settings = getSettings();
  const note = document.getElementById("contactNote");
  note.textContent = `Demo complete. In the live version, this message will be emailed to ${settings.managementEmail}.`;
  note.className = "form-note success";
  event.target.reset();
}

init();
