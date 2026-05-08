const DEFAULT_SETTINGS = {
  minimumOrder: 25,
  managementEmail: "support@smartcoretechnology.co.uk",
  openDays: "7 days a week",
  openTimes: "9am to 7pm",
  radiusMessage: "Sorry, You’re outside of our delivery radius",
  derbyPostcodes: ["DE", "LE", "NG", "B"]
};

const DEFAULT_PRODUCTS = [
  {
    id: "p1",
    name: "Greek Taverna Box",
    category: "Meal Boxes",
    price: 18.5,
    stock: 25,
    image: "https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=900&q=80",
    description: "A mixed Greek inspired box with freshly prepared favourites. Perfect for sharing."
  },
  {
    id: "p2",
    name: "Chicken Gyros Kit",
    category: "Meal Kits",
    price: 12.95,
    stock: 30,
    image: "https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?auto=format&fit=crop&w=900&q=80",
    description: "A simple gyros style kit for an easy Greek meal at home."
  },
  {
    id: "p3",
    name: "Greek Salad Bowl",
    category: "Sides",
    price: 7.5,
    stock: 18,
    image: "https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?auto=format&fit=crop&w=900&q=80",
    description: "Fresh salad bowl with Mediterranean inspired ingredients."
  },
  {
    id: "p4",
    name: "Baklava Selection",
    category: "Desserts",
    price: 9.95,
    stock: 16,
    image: "https://images.unsplash.com/photo-1519676867240-f03562e64548?auto=format&fit=crop&w=900&q=80",
    description: "Sweet dessert selection ideal for finishing a meal or sharing."
  },
  {
    id: "p5",
    name: "Family Greek Feast",
    category: "Meal Boxes",
    price: 39.95,
    stock: 10,
    image: "https://images.unsplash.com/photo-1550547660-d9450f859349?auto=format&fit=crop&w=900&q=80",
    description: "A larger family style feast box for gatherings and weekend meals."
  },
  {
    id: "p6",
    name: "Wholesale Sample Pack",
    category: "Wholesale",
    price: 25,
    stock: 8,
    image: "https://images.unsplash.com/photo-1555939594-58d7cb561ad1?auto=format&fit=crop&w=900&q=80",
    description: "A sample pack for business customers interested in regular orders."
  }
];

function money(value) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP"
  }).format(Number(value || 0));
}

function getSettings() {
  return JSON.parse(localStorage.getItem("tt_settings")) || DEFAULT_SETTINGS;
}

function saveSettings(settings) {
  localStorage.setItem("tt_settings", JSON.stringify(settings));
}

function getProducts() {
  return JSON.parse(localStorage.getItem("tt_products")) || DEFAULT_PRODUCTS;
}

function saveProducts(products) {
  localStorage.setItem("tt_products", JSON.stringify(products));
}

function getOrders() {
  return JSON.parse(localStorage.getItem("tt_orders")) || [];
}

function saveOrders(orders) {
  localStorage.setItem("tt_orders", JSON.stringify(orders));
}

function calculateDelivery(postcode) {
  const settings = getSettings();
  const cleaned = String(postcode || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!cleaned) {
    return { ok: false, message: "Please enter your postcode first.", charge: 0 };
  }

  const isAllowed = settings.derbyPostcodes.some(prefix => cleaned.startsWith(prefix));
  if (!isAllowed) {
    return { ok: false, message: settings.radiusMessage, charge: 0 };
  }

  let charge = 3;
  if (cleaned.startsWith("DE")) charge = 3;
  if (cleaned.startsWith("LE")) charge = 7;
  if (cleaned.startsWith("NG")) charge = 7;
  if (cleaned.startsWith("B")) charge = 10;

  return {
    ok: true,
    message: `Good news, we deliver to this postcode. Delivery charge: ${money(charge)}.`,
    charge
  };
}
