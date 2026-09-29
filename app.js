// Live Sheets data only. No products.js or sample customer dependency.
let members = [], pledges = [], products = [];
let categories = ["Food", "Drinks", "Other"];

const state = {
  screen: "welcome",
  member: null,
  cart: new Map(),
  category: "Recents",
  productGroup: null,
  recentProductIds: [],
  recentsLoading: false,
  recentsError: "",
  lastTransaction: null,
  lastSyncResult: null,
  rosterEntry: "",
  rosterError: ""
};
let checkoutSession = 0;
let achievementRequest = 0;
let achievementData = null;
let achievementLoading = false;
let achievementError = "";

const app = document.querySelector("#app");
const appShell = document.querySelector(".app-shell");
const homeButton = document.querySelector("#homeButton");
const clock = document.querySelector("#clock");
const INACTIVITY_TIMEOUT_MS = 30000;
const SESSION_SCREENS = new Set([
  "pledges",
  "confirm-member",
  "shop",
  "review",
  "achievements",
  "leaderboard"
]);

let inactivityTimer = null;

function money(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(value);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function cartLines() {
  return [...state.cart.entries()].map(([productId, quantity]) => {
    const product = products.find((item) => item.id === productId);
    return { ...product, quantity, lineTotal: product.price * quantity };
  });
}

function cartQuantity() {
  return cartLines().reduce((sum, item) => sum + item.quantity, 0);
}

function cartTotal() {
  return cartLines().reduce((sum, item) => sum + item.lineTotal, 0);
}

function goTo(screen) {
  state.screen = screen;
  render();
}

function resetCheckout() {
  checkoutSession += 1;
  achievementRequest += 1;
  achievementData = null;
  achievementLoading = false;
  achievementError = "";
  state.screen = "welcome";
  state.member = null;
  state.cart.clear();
  state.category = "Recents";
  state.productGroup = null;
  state.recentProductIds = [];
  state.recentsLoading = false;
  state.recentsError = "";
  state.lastTransaction = null;
  state.rosterEntry = "";
  state.rosterError = "";
  render();
}

function resetInactivityTimer() {
  window.clearTimeout(inactivityTimer);
  inactivityTimer = null;

  if (!SESSION_SCREENS.has(state.screen)) return;

  inactivityTimer = window.setTimeout(() => {
    if (SESSION_SCREENS.has(state.screen)) {
      resetCheckout();
    }
  }, INACTIVITY_TIMEOUT_MS);
}

function noteUserActivity() {
  if (SESSION_SCREENS.has(state.screen)) {
    resetInactivityTimer();
  }
}

function memberLabel(member) {
  return member.type === "Pledge" ? "Pledge" : `Roster ${member.id}`;
}

function renderWelcome() {
  app.innerHTML = `
    <section class="roster-screen">
      <div class="roster-card">
        <h1>Enter Roster:</h1>

        <div class="roster-display ${state.rosterError ? "error" : ""}" aria-label="Four digit roster number" aria-live="polite">
          ${[0, 1, 2, 3].map((index) => `
            <span class="roster-digit ${state.rosterEntry[index] ? "filled" : ""}">
              ${state.rosterEntry[index] || ""}
            </span>
          `).join("")}
        </div>

        <p class="roster-message ${state.rosterError ? "visible" : ""}" role="alert">
          ${state.rosterError || ""}
        </p>

        <div class="number-pad" aria-label="Roster number keypad">
          ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => `
            <button class="keypad-button" type="button" data-digit="${digit}">${digit}</button>
          `).join("")}
          <span class="keypad-spacer" aria-hidden="true"></span>
          <button class="keypad-button" type="button" data-digit="0">0</button>
          <button class="keypad-button backspace-button" type="button" data-backspace aria-label="Backspace">⌫</button>
        </div>
      </div>

      <div class="roster-shortcuts">
        <button id="pledgesButton" class="pledges-corner-button" type="button">Pledges</button>
        <button id="leaderboardButton" class="leaderboard-corner-button" type="button">★ Leaderboard</button>
      </div>
    </section>
  `;

  document.querySelectorAll("[data-digit]").forEach((button) => {
    button.addEventListener("click", () => enterRosterDigit(button.dataset.digit));
  });

  document.querySelector("[data-backspace]").addEventListener("click", backspaceRoster);
  document.querySelector("#pledgesButton").addEventListener("click", () => goTo("pledges"));
  document.querySelector("#leaderboardButton").addEventListener("click", openLeaderboard);
}

async function openLeaderboard() {
  state.screen = "leaderboard";
  state.leaderboardLoading = true;
  state.leaderboardError = "";
  render();

  try {
    const data = await ProjectsBackend.loadLeaderboard();
    if (state.screen !== "leaderboard") return;
    state.leaderboard = Array.isArray(data?.entries) ? data.entries : [];
  } catch (error) {
    if (state.screen !== "leaderboard") return;
    state.leaderboardError =
      "Could not load the leaderboard. Check the connection and try again.";
    console.error("Could not load star leaderboard:", error);
  } finally {
    if (state.screen === "leaderboard") {
      state.leaderboardLoading = false;
      renderLeaderboard();
    }
  }
}

function renderLeaderboard() {
  app.innerHTML = `
    <section class="leaderboard-screen">
      <div class="leaderboard-heading">
        <div>
          <p class="eyebrow">Projects stars</p>
          <h1>Leaderboard</h1>
        </div>
        <button id="leaderboardBackButton" class="secondary-button" type="button">← Roster</button>
      </div>
      <p class="leaderboard-note">Cosmetic stars only · No cash value</p>
      <div class="leaderboard-list" aria-live="polite">
        ${state.leaderboardLoading
          ? `<p class="leaderboard-message">Loading leaderboard…</p>`
          : state.leaderboardError
            ? `<p class="leaderboard-message" role="alert">${escapeHtml(state.leaderboardError)}</p>`
            : state.leaderboard.map((person, index) => `
                <div class="leaderboard-row">
                  <span class="leaderboard-rank">${index + 1}</span>
                  <span class="leaderboard-name">${escapeHtml(person.name)}</span>
                  <strong class="leaderboard-stars">★ ${Number(person.stars) || 0}</strong>
                </div>
              `).join("") || `<p class="leaderboard-message">No star totals yet.</p>`}
      </div>
    </section>
  `;

  document.querySelector("#leaderboardBackButton")
    .addEventListener("click", () => goTo("welcome"));
}

function renderLoading() {
  app.innerHTML = `
    <section class="center-screen">
      <div class="loading-ring" aria-hidden="true"></div>
      <p class="eyebrow">Connecting</p>
      <h1>Loading Projects</h1>
      <p class="lead">Checking the current roster, pledges, and products.</p>
    </section>
  `;
}

function renderBackendError() {
  app.innerHTML = `
    <section class="center-screen">
      <div class="member-card">
        <p class="eyebrow">Connection required</p>
        <h1>Projects could not load.</h1>
        <p class="lead">Check Wi-Fi and try again. Checkout stays locked so sample or outdated information cannot be charged.</p>
        <button id="retryBackendButton" class="primary-button" type="button">Try again</button>
      </div>
    </section>
  `;
  document.querySelector("#retryBackendButton").addEventListener("click", loadLiveData);
}

function renderPledges() {
  const activePledges = pledges
    .filter((pledge) => pledge.status === "Active")
    .map((pledge) => ({
      ...pledge,
      name: `${pledge.firstName} ${pledge.lastName}`,
      initials: `${pledge.firstName[0]}${pledge.lastName[0]}`
    }))
    .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName));

  app.innerHTML = `
    <section class="pledge-screen">
      <div class="pledge-heading">
        <div>
          <p class="eyebrow">No roster number</p>
          <h1>Select Pledge</h1>
        </div>
        <button id="backToRosterButton" class="secondary-button" type="button">Back to roster</button>
      </div>

      <div class="pledge-grid" aria-label="Active pledges">
        ${activePledges.length ? activePledges.map((pledge) => `
          <button class="pledge-name-button" type="button" data-pledge-id="${escapeHtml(pledge.id)}">
            <span>${escapeHtml(pledge.firstName)}</span>
            <strong>${escapeHtml(pledge.lastName)}</strong>
          </button>
        `).join("") : `<p class="empty-pledges">No active pledges found.</p>`}
      </div>
    </section>
  `;

  document.querySelector("#backToRosterButton").addEventListener("click", () => goTo("welcome"));
  document.querySelectorAll("[data-pledge-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.member = activePledges.find((pledge) => pledge.id === button.dataset.pledgeId);
      goTo("confirm-member");
    });
  });
}

function enterRosterDigit(digit) {
  if (state.screen !== "welcome" || state.rosterEntry.length >= 4) return;

  state.rosterError = "";
  state.rosterEntry += digit;

  if (state.rosterEntry.length < 4) {
    renderWelcome();
    return;
  }

  const member = members.find((item) => item.id === state.rosterEntry);

  if (member) {
    state.member = member;
    window.setTimeout(() => goTo("confirm-member"), 120);
    renderWelcome();
    return;
  }

  state.rosterError = "Roster not found";
  renderWelcome();
  window.setTimeout(() => {
    if (state.screen === "welcome" && state.rosterError) {
      state.rosterEntry = "";
      state.rosterError = "";
      renderWelcome();
    }
  }, 1000);
}

function backspaceRoster() {
  if (state.screen !== "welcome") return;
  state.rosterError = "";
  state.rosterEntry = state.rosterEntry.slice(0, -1);
  renderWelcome();
}

function renderMemberConfirmation() {
  const member = state.member;
  const session = checkoutSession;
  achievementData = ProjectsAchievements.peek(member);
  void refreshAchievements();

  // Begin loading Recents while the customer is reading
  // the identity-confirmation screen.
  void ProjectsBackend.loadRecents(member).catch(error => {
    console.warn("Recents prefetch failed:", error);
  });

  app.innerHTML = `
    <section class="center-screen">
      <div class="member-card">
        <div class="member-avatar">
          ${escapeHtml(member.initials)}
        </div>

        <p class="eyebrow">
          ${escapeHtml(member.type)} found
        </p>

        <h1>${escapeHtml(member.name)}</h1>

        <p class="member-meta">
          ${escapeHtml(memberLabel(member))}
        </p>

        <div class="button-row">
          <button
            id="wrongMemberButton"
            class="secondary-button"
            type="button"
          >
            Not me
          </button>

          <button
            id="correctMemberButton"
            class="primary-button"
            type="button"
          >
            Yes, continue
          </button>
        </div>
      </div>
    </section>
  `;

  document
    .querySelector("#wrongMemberButton")
    .addEventListener("click", resetCheckout);

  document
    .querySelector("#correctMemberButton")
    .addEventListener("click", () => {
      const cached =
        ProjectsBackend.getCachedRecents(member);

      state.category = "Recents";
      state.productGroup = null;
      state.recentProductIds =
        cached.productIds || [];
      state.recentsLoading =
        state.recentProductIds.length === 0;
      state.recentsError = "";

      // Open the store immediately using cached data.
      goTo("shop");

      const memberIsStillActive = () =>
        checkoutSession === session &&
        state.member &&
        state.member.type === member.type &&
        String(state.member.id) === String(member.id);

      // Complete or reuse the refresh that began above.
      ProjectsBackend.loadRecents(member)
        .then(recentData => {
          if (!memberIsStillActive()) return;

          state.recentProductIds =
            Array.isArray(recentData?.productIds)
              ? recentData.productIds
              : [];
        })
        .catch(error => {
          if (!memberIsStillActive()) return;

          console.error(
            "Could not refresh recent purchases:",
            error
          );

          if (state.recentProductIds.length === 0) {
            state.recentsError =
              "Could not load recent purchases.";
          }
        })
        .finally(() => {
          if (!memberIsStillActive()) return;

          state.recentsLoading = false;

          if (
            state.screen === "shop" &&
            state.category === "Recents"
          ) {
            renderShop();
          }
        });
    });
}

const SHOP_CATEGORIES = ["Recents", "Food", "Drinks", "Other"];
const AUTO_GROUPS = [
  "Alani Nu",
  "Powerade",
  "Premier Protein",
  "Monster",
  "Red Bull",
  "Celsius",
  "Liquid IV",
  "Gatorade",
  "Sparkling Ice"
];

function normalizeCategory(value, productId = "") {
  const idPrefix = String(productId).trim().padStart(4, "0").slice(0, 2);
  if (idPrefix === "00") return "Food";
  if (idPrefix === "01") return "Drinks";
  if (idPrefix === "02") return "Other";

  const category = String(value || "").trim().toLowerCase();
  if (["drink", "drinks", "beverage", "beverages", "protein drink", "energy drink"].includes(category)) return "Drinks";
  if (["other", "others", "misc", "miscellaneous"].includes(category)) return "Other";
  return "Food";
}

function firstAvailableCategory() {
  return SHOP_CATEGORIES.find(category => products.some(product => normalizeCategory(product.category, product.id) === category)) || "Food";
}

function inferredGroup(product) {
  const explicit = String(product.group || "").trim();
  if (explicit) return explicit;
  return AUTO_GROUPS.find(group => {
    const name = String(product.name || "").toLowerCase();
    const prefix = group.toLowerCase();
    return name === prefix || name.startsWith(`${prefix} `) || name.startsWith(`${prefix} -`) || name.startsWith(`${prefix}:`);
  }) || "";
}

function flavorLabel(product, group) {
  const explicit = String(product.flavor || "").trim();
  if (explicit) return explicit;

  const escapedGroup = group.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const remainder = String(product.name || "")
    .replace(new RegExp(`^${escapedGroup}`, "i"), "")
    .replace(/^[\s:|/\-,–—]+/, "")
    .trim();
  return remainder || product.name;
}

function productTiles(category) {
  if (category === "Recents") {
    return state.recentProductIds
      .map(productId =>
        products.find(
          product =>
            String(product.id) === String(productId)
        )
      )
      .filter(Boolean)
      .map(product => ({
        type: "product",
        product
      }));
  }

  const categoryProducts = products.filter(
    product =>
      normalizeCategory(
        product.category,
        product.id
      ) === category
  );

  const grouped = new Map();
  const tiles = [];

  categoryProducts.forEach(product => {
    const group = inferredGroup(product);

    if (!group) {
      tiles.push({
        type: "product",
        product
      });
      return;
    }

    if (!grouped.has(group)) {
      const tile = {
        type: "group",
        group,
        products: []
      };

      grouped.set(group, tile);
      tiles.push(tile);
    }

    grouped.get(group).products.push(product);
  });

  // Products with only one flavor remain normal buttons.
  return tiles.map(tile =>
    tile.type === "group" &&
    tile.products.length === 1
      ? {
          type: "product",
          product: tile.products[0]
        }
      : tile
  );
}

function emptyProductsMessage() {
  if (state.category === "Recents") {
    if (state.recentsLoading) {
      return "Loading recent purchases…";
    }

    if (state.recentsError) {
      return state.recentsError;
    }

    return "No recent purchases yet.";
  }

  return `No active ${state.category.toLowerCase()} items.`;
}

function priceRange(groupProducts) {
  const prices = groupProducts.map(product => Number(product.price));
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  return low === high ? money(low) : `${money(low)}–${money(high)}`;
}

function renderShop() {
  const tiles = productTiles(state.category);
  const selectedGroup = state.productGroup
    ? tiles.find(tile => tile.type === "group" && tile.group === state.productGroup)
    : null;

  app.innerHTML = `
    <section class="checkout-layout">
      <div class="catalog-panel ${selectedGroup ? "variant-open" : ""}">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Choose your items</p>
            <h1>Projects</h1>
          </div>
          <div class="shop-session-controls">
  <span class="member-pill">${escapeHtml(state.member.name)}</span>
  <button id="achievementsButton" class="stars-button" type="button" aria-label="View your achievements">
    ★ <span id="starCount">${achievementData ? achievementData.stars : "—"}</span>
  </button>

  <button
    id="startOverButton"
    class="start-over-button"
    type="button"
  >
    ← Roster
  </button>
</div>
        </div>

        <nav class="category-tabs" aria-label="Product categories">
          ${SHOP_CATEGORIES.map((category) => `
            <button
              class="category-button ${category === state.category ? "active" : ""}"
              type="button"
              data-category="${escapeHtml(category)}"
            >${escapeHtml(category)}</button>
          `).join("")}
        </nav>

        ${selectedGroup ? `
          <div class="variant-heading">
            <button class="variant-back-button" type="button" data-back-to-category>← ${escapeHtml(state.category)}</button>
            <div>
              <p class="eyebrow">Choose a flavor</p>
              <h2>${escapeHtml(selectedGroup.group)}</h2>
            </div>
          </div>
          <div class="product-grid variant-grid">
            ${selectedGroup.products.map(product => productCardMarkup(product, flavorLabel(product, selectedGroup.group))).join("")}
          </div>
        ` : `
          <div class="product-grid">
            ${tiles.length ? tiles.map(tile => tile.type === "group"
              ? groupCardMarkup(tile)
              : productCardMarkup(tile.product)
            ).join("") : `<p class="empty-products">${escapeHtml(emptyProductsMessage())}</p>`}
          </div>
        `}
      </div>

      <aside class="cart-panel" aria-label="Current cart">
        ${cartMarkup()}
      </aside>
    </section>
  `;

  document.querySelectorAll("[data-category]").forEach((button) => {
    button.addEventListener("click", () => {
      state.category = button.dataset.category;
      state.productGroup = null;
      renderShop();
    });
  });
  document
  .querySelector("#startOverButton")
  .addEventListener("click", resetCheckout);
  document.querySelector("#achievementsButton").addEventListener("click", () => {
    goTo("achievements");
    void refreshAchievements();
  });
  document.querySelector("[data-back-to-category]")?.addEventListener("click", () => {
    state.productGroup = null;
    renderShop();
  });

  document.querySelectorAll("[data-product-group]").forEach((button) => {
    button.addEventListener("click", () => {
      state.productGroup = button.dataset.productGroup;
      renderShop();
    });
  });

  document.querySelectorAll("[data-product-id]").forEach((button) => {
    button.addEventListener("click", () => {
      changeQuantity(button.dataset.productId, 1);
    });
  });

  bindProductImageFallbacks();

  bindCartEvents();
}

function productCardMarkup(product, label = product.name) {
  return `
    <button class="product-card" type="button" data-product-id="${escapeHtml(product.id)}">
      ${productImageMarkup(product, label)}
      <span class="product-name">${escapeHtml(label)}</span>
      <span class="product-bottom">
        <span class="product-price">${money(product.price)}</span>
        <span class="add-circle" aria-hidden="true">+</span>
      </span>
    </button>
  `;
}

function groupCardMarkup(tile) {
  const imageProduct = tile.products.find(product => String(product.image || "").trim()) || tile.products[0];
  return `
    <button class="product-card group-card" type="button" data-product-group="${escapeHtml(tile.group)}">
      ${productImageMarkup(imageProduct, tile.group)}
      <span class="product-name">${escapeHtml(tile.group)}</span>
      <span class="group-prompt">Choose flavor</span>
      <span class="product-bottom">
        <span class="product-price">${priceRange(tile.products)}</span>
        <span class="add-circle branch-circle" aria-hidden="true">›</span>
      </span>
    </button>
  `;
}

function productImageMarkup(product, label) {
  const source = String(product.image || "images/product-placeholder.svg").trim() || "images/product-placeholder.svg";
  return `
    <span class="product-image-frame" aria-hidden="true">
      <img class="product-image" src="${escapeHtml(source)}" alt="" loading="lazy" data-image-label="${escapeHtml(label)}">
    </span>
  `;
}

function bindProductImageFallbacks() {
  document.querySelectorAll(".product-image").forEach((image) => {
    image.addEventListener("error", () => {
      if (!image.src.endsWith("/images/product-placeholder.svg")) {
        image.src = "images/product-placeholder.svg";
      }
    }, { once: true });
  });
}

function cartMarkup() {
  const lines = cartLines();

  return `
    <div class="cart-title-row">
      <h2>Your cart</h2>
      <span class="cart-count">${cartQuantity()}</span>
    </div>

    <div class="cart-items">
      ${lines.length === 0 ? `
        <div class="empty-cart">
          <span aria-hidden="true">🛒</span>
          <strong>Your cart is empty</strong>
          <small>Tap an item to add it.</small>
        </div>
      ` : lines.map((item) => `
        <div class="cart-item">
          <div>
            <strong>${escapeHtml(item.name)}</strong>
            <small>${money(item.lineTotal)}</small>
          </div>
          <div class="quantity-control" aria-label="Quantity for ${escapeHtml(item.name)}">
            <button type="button" data-decrease="${item.id}" aria-label="Remove one ${escapeHtml(item.name)}">−</button>
            <span>${item.quantity}</span>
            <button type="button" data-increase="${item.id}" aria-label="Add one ${escapeHtml(item.name)}">+</button>
          </div>
        </div>
      `).join("")}
    </div>

    <div>
      <div class="cart-total-row">
        <span>Total</span>
        <span>${money(cartTotal())}</span>
      </div>
      <button id="reviewButton" class="primary-button wide-button" type="button" ${lines.length === 0 ? "disabled" : ""}>
        Place order
      </button>
    </div>
  `;
}

function bindCartEvents() {
  document.querySelectorAll("[data-decrease]").forEach((button) => {
    button.addEventListener("click", () => changeQuantity(button.dataset.decrease, -1));
  });

  document.querySelectorAll("[data-increase]").forEach((button) => {
    button.addEventListener("click", () => changeQuantity(button.dataset.increase, 1));
  });

  document.querySelector("#reviewButton")?.addEventListener("click", () => goTo("review"));
}

function changeQuantity(productId, difference) {
  const nextQuantity = (state.cart.get(productId) || 0) + difference;
  if (nextQuantity <= 0) {
    state.cart.delete(productId);
  } else {
    state.cart.set(productId, nextQuantity);
  }
  renderShop();
}

function renderReview() {
  const lines = cartLines();

  app.innerHTML = `
    <section class="center-screen review-screen">
      <div class="review-card">
        <p class="eyebrow">Final check</p>
        <h2>Review your purchase</h2>
        <p class="lead">Make sure the member and items below are correct.</p>

        <div class="review-member">
          <span>Charge to</span>
          <strong>${escapeHtml(state.member.name)} · ${escapeHtml(memberLabel(state.member))}</strong>
        </div>

        <div class="review-lines">
          ${lines.map((item) => `
            <div class="review-line">
              <strong>${escapeHtml(item.name)}</strong>
              <span>× ${item.quantity}</span>
              <strong>${money(item.lineTotal)}</strong>
            </div>
          `).join("")}
        </div>

        <div class="review-total">
          <span>Total</span>
          <span>${money(cartTotal())}</span>
        </div>

        <div class="button-row">
          <button id="backToCartButton" class="secondary-button" type="button">Back to cart</button>
          <button id="completeButton" class="primary-button" type="button">Confirm order</button>
        </div>
      </div>
    </section>
  `;

  document.querySelector("#backToCartButton").addEventListener("click", () => goTo("shop"));
  document.querySelector("#completeButton").addEventListener("click", completePurchase);
}

async function completePurchase() {
  const button = document.querySelector("#completeButton");
  if (!button || button.disabled) return;
  button.disabled = true;
  button.textContent = "Recording…";

  const transaction = {
    transactionId: `TX-${window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`,
    timestamp: new Date().toISOString(),
    member: { ...state.member },
    items: cartLines().map(({ id, name, price, quantity, lineTotal }) => ({
      id,
      name,
      price,
      quantity,
      lineTotal
    })),
    total: cartTotal(),
    source: "projects-kiosk"
  };

  const session = checkoutSession;
  try {
    const result = await ProjectsBackend.saveTransaction(transaction);
    if (checkoutSession !== session) return;
    state.lastTransaction = transaction;
    state.lastSyncResult = result;
    goTo("success");
  } catch (error) {
    if (checkoutSession !== session) return;
    console.error("Could not save this order locally:", error);
    button.disabled = false;
    button.textContent = "Confirm order";
    const warning = document.createElement("p");
    warning.className = "checkout-save-error";
    warning.setAttribute("role", "alert");
    warning.textContent = "Order could not be saved on this tablet. Please contact Augie before taking items.";
    document.querySelector(".checkout-save-error")?.remove();
    document.querySelector(".review-card").append(warning);
  }
}

function renderSuccess() {
  const transaction = state.lastTransaction;
  const syncResult = state.lastSyncResult || {};

  const localOnly = Boolean(syncResult.localOnly);
  const background = Boolean(syncResult.background);
  const synced = Boolean(syncResult.synced);

  const eyebrow = synced
    ? "Purchase recorded"
    : localOnly
      ? "Local test saved"
      : "Purchase accepted";

  const title = localOnly
    ? "Interface test complete."
    : "You're all set.";

  const message = synced
    ? "Your purchase is in the Projects spreadsheet."
    : localOnly
      ? "No spreadsheet is connected. This test purchase remains only in this browser."
      : background
        ? "Your purchase is safely saved and is syncing automatically."
        : "Your purchase is safely stored and will upload automatically.";

  const quantity = cartQuantity();

  app.innerHTML = `
    <section class="center-screen">
      <div class="success-icon" aria-hidden="true">✓</div>
      <p class="eyebrow">${eyebrow}</p>
      <h1>${title}</h1>
      <p class="lead">${message}</p>

      <p class="success-receipt">
        ${money(transaction.total)} ·
        ${quantity} item${quantity === 1 ? "" : "s"}
      </p>

      <button
        id="doneButton"
        class="primary-button"
        type="button"
      >
        Done
      </button>
    </section>
  `;

  document
    .querySelector("#doneButton")
    .addEventListener("click", resetCheckout);

  window.setTimeout(() => {
    if (state.screen === "success" && state.lastTransaction?.transactionId === transaction.transactionId) {
      resetCheckout();
    }
  }, 8000);
}

function render() {
  const renderers = {
    loading: renderLoading,
    "backend-error": renderBackendError,
    welcome: renderWelcome,
    pledges: renderPledges,
    "confirm-member": renderMemberConfirmation,
    shop: renderShop,
    review: renderReview,
    achievements: renderAchievements,
    success: renderSuccess
    leaderboard: renderLeaderboard,
  };

  appShell.dataset.screen = state.screen;

  appShell.classList.toggle(
    "compact-kiosk",
    ["shop", "review", "achievements", "leaderboard"].includes(state.screen)
  );

  renderers[state.screen]();
  resetInactivityTimer();
}


function updateClock() {
  clock.textContent = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date());
}

homeButton.addEventListener("click", () => {
  if (state.screen === "welcome" || window.confirm("Cancel this checkout and return to the start?")) {
    resetCheckout();
  }
});

document.addEventListener("keydown", (event) => {
  if (state.screen !== "welcome") return;

  if (/^\d$/.test(event.key)) {
    enterRosterDigit(event.key);
  } else if (event.key === "Backspace" || event.key === "Delete") {
    backspaceRoster();
  }
});

document.addEventListener(
  "pointerdown",
  noteUserActivity,
  { passive: true }
);

document.addEventListener(
  "touchstart",
  noteUserActivity,
  { passive: true }
);

async function initializeApp() {
  updateClock();
  window.setInterval(updateClock, 30000);
  if (ProjectsBackend.isConfigured()) {
    await loadLiveData();
  } else {
    state.screen = "backend-error";
    render();
  }
}

async function loadLiveData() {
  state.screen = "loading";
  render();
  try {
    if (!ProjectsBackend.isConfigured()) throw new Error("Set the deployed Apps Script URL in config.js.");
    const liveData = await ProjectsBackend.loadBootstrap();
    members = liveData.members;
    pledges = liveData.pledges;
    products = liveData.products;
    categories = SHOP_CATEGORIES;
    state.category = "Recents";
    state.productGroup = null;
    state.screen = "welcome";
    render();
    ProjectsBackend.syncPending();
  } catch (error) {
    console.error("Could not load live Projects data:", error);
    state.screen = "backend-error";
    render();
  }
}

window.addEventListener("online", () => ProjectsBackend.syncPending());
window.setInterval(() => ProjectsBackend.syncPending(), 30000);
initializeApp();

// Background responses update only the same active checkout session.
async function refreshAchievements(force = false) {
  if (!state.member) return;
  const member = { ...state.member };
  const session = checkoutSession;
  const request = ++achievementRequest;
  achievementLoading = true;
  achievementError = "";
  try {
    const data = await ProjectsAchievements.load(member, { force });
    if (session !== checkoutSession || request !== achievementRequest) return;
    achievementData = data;
  } catch (error) {
    if (session !== checkoutSession || request !== achievementRequest) return;
    achievementError = achievementData ? "Showing saved progress. Refresh when online." : "Stars could not load. Checkout still works.";
    console.warn("Achievement refresh failed:", error);
  } finally {
    if (session === checkoutSession && request === achievementRequest) {
      achievementLoading = false;
      const count = document.querySelector("#starCount");
      if (count) count.textContent = achievementData ? achievementData.stars : "—";
      if (state.screen === "achievements") {
        const scroll = document.querySelector(".achievement-grid")?.scrollTop || 0;
        renderAchievements();
        document.querySelector(".achievement-grid").scrollTop = scroll;
      }
    }
  }
}

function renderAchievements() {
  const cards = achievementData?.cards || [];
  app.innerHTML = `
    <section class="achievements-screen">
      <div class="achievement-heading">
        <div><p class="eyebrow">${escapeHtml(state.member.name)}</p><h1>Your achievements</h1></div>
        <strong class="achievement-total">★ ${achievementData ? achievementData.stars : "—"}</strong>
        <button id="backFromAchievements" class="secondary-button" type="button">← Shop</button>
      </div>
      <div class="achievement-status">
        <span>${escapeHtml(achievementError || (achievementLoading ? "Updating stars…" : "One gold star per level."))}
        ${achievementData?.ignoredRows ? " Some order rows need Augie's attention." : ""}</span>
        <button id="refreshAchievements" class="text-button" type="button" ${achievementLoading ? "disabled" : ""}>Refresh</button>
      </div>
      <div class="achievement-grid" tabindex="0" aria-label="Achievement progress">
        ${cards.length ? cards.map(achievementCardMarkup).join("") : `<p class="achievement-empty">${achievementLoading ? "Loading your progress…" : "No achievements loaded yet. Try Refresh."}</p>`}
      </div>
    </section>`;
  document.querySelector("#backFromAchievements").addEventListener("click", () => goTo("shop"));
  document.querySelector("#refreshAchievements").addEventListener("click", () => {
    void refreshAchievements(true);
    renderAchievements();
  });
}

function achievementCardMarkup(rule) {
  const next = rule.levels.find(level => !level.earned);
  const target = next?.target || rule.milestones[rule.milestones.length - 1];
  const value = next ? Math.min(target, Math.max(0, Number(rule.value) || 0)) : target;
  const earnedLevels = rule.levels.filter(level => level.earned).length;
  const unit = rule.key === "days_since_first_return" ? " days" : "";
  return `<article class="achievement-card ${next ? "" : "achievement-complete"}">
    <div class="achievement-card-title"><h2>${escapeHtml(rule.name)}</h2><span aria-label="${rule.earnedStars} stars">★ ${rule.earnedStars}</span></div>
    <p>${escapeHtml(rule.description)}</p>
    <progress max="${target}" value="${value}" aria-label="${escapeHtml(rule.name)}: ${value} of ${target}${unit}"></progress>
    <div class="achievement-progress-label"><strong>${value}/${target}${unit}</strong><span>${next ? `Level ${earnedLevels}/${rule.levels.length}` : "Complete ✓"}</span></div>
    <div class="achievement-levels" aria-label="Milestones">${rule.levels.map(level => `<span class="${level.earned ? "earned" : ""}">${level.earned ? "★" : "☆"} ${level.target}</span>`).join("")}</div>
  </article>`;
}

window.addEventListener("projects:orders-synced", event => {
  if (state.member && event.detail.some(entry => entry.member.type === state.member.type && String(entry.member.id) === String(state.member.id))) {
    void refreshAchievements(true);
  }
});
document.addEventListener("scroll", noteUserActivity, { passive: true, capture: true });
document.addEventListener("keydown", noteUserActivity);

// Fresh Pages deployment after GitHub outage
