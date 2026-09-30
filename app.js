let members = [], pledges = [], products = [];
let categories = ["Food", "Drinks", "Other"];

const state = {
  screen: "welcome",
  member: null,
  skin: "theta-chi",
  ownedSkins: new Set(),
  skinInventoryVerified: false,
  skinInventoryLoading: false,
  skinInventoryError: "",
  cart: new Map(),
  category: "Recents",
  productGroup: null,
  recentProductIds: [],
  recentsLoading: false,
  recentsError: "",
  lastTransaction: null,
  lastSyncResult: null,
  previewTransactionId: null,
  rosterEntry: "",
  rosterError: ""
};
let checkoutSession = 0;
let achievementRequest = 0;
let achievementData = null;
let achievementLoading = false;
let achievementError = "";
let leaderboardRequest = 0;
let cartPreviewTimer = null;
let cartPreviewRequest = 0;
let cartPreview = { signature: "", data: null, loading: false, error: "" };
let skinInventoryRequest = 0;

const SKINS = [
  { id: "theta-chi", label: "Theta Chi", mood: "The classic Projects look", symbol: "ΘΧ" },
  { id: "forest", label: "Forest", mood: "Fresh greens and deep pine", symbol: "✦", productId: "SKIN-FOREST", price: 0.50 },
  { id: "ocean", label: "Ocean", mood: "Cool water and electric blue", symbol: "◉", productId: "SKIN-OCEAN", price: 1.00 },
  { id: "sunset", label: "Sunset", mood: "Warm skies and golden hour", symbol: "☀", productId: "SKIN-SUNSET", price: 5.00 }
];
const THEMED_SCREENS = new Set([
  "confirm-member", "shop", "skin-shop", "review", "achievements", "success"
]);
const BUTTON_SOUNDS_ENABLED = true;
let tapAudioContext = null;

const app = document.querySelector("#app");
const appShell = document.querySelector(".app-shell");
const homeButton = document.querySelector("#homeButton");
const clock = document.querySelector("#clock");
const INACTIVITY_TIMEOUT_MS = 30000;
const SESSION_SCREENS = new Set([
  "pledges",
  "confirm-member",
  "shop",
  "skin-shop",
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

function skinStorageKey(member) {
  const id = member.type === "Brother"
    ? String(member.id).padStart(4, "0")
    : String(member.id);
  return `projectsSkinV1:${member.type}:${id}`;
}

function ownedSkinStorageKey(member) {
  const mode = ProjectsBackend.isLocalTestMode() ? "test" : "live";
  return skinStorageKey(member).replace("projectsSkinV1:", `projectsOwnedSkinsV1:${mode}:`);
}

function skinFromProductId(productId) {
  return SKINS.find(skin => skin.productId === productId);
}

function persistedSkin() {
  if (!state.member) return "theta-chi";
  try {
    const saved = localStorage.getItem(skinStorageKey(state.member));
    return saved === "theta-chi" || state.ownedSkins.has(saved) ? saved : "theta-chi";
  } catch (_) {
    return "theta-chi";
  }
}

function leaderboardSkin(person) {
  const fallback = SKINS[0];
  if (!["Brother", "Pledge"].includes(person?.type) || !person?.id) return fallback;
  try {
    const saved = SKINS.find(skin => skin.id === localStorage.getItem(skinStorageKey(person)));
    if (!saved) return fallback;
    if (!saved.productId) return saved;
    const owned = JSON.parse(localStorage.getItem(ownedSkinStorageKey(person)) || "[]");
    return Array.isArray(owned) && owned.includes(saved.id) ? saved : fallback;
  } catch (_) {
    return fallback;
  }
}

function persistOwnedSkins() {
  if (!state.member) return;
  try {
    localStorage.setItem(ownedSkinStorageKey(state.member), JSON.stringify([...state.ownedSkins]));
  } catch (_) {
    // The current checkout still works if local storage is unavailable.
  }
}

async function refreshSkinInventory() {
  if (!state.member || ProjectsBackend.isLocalTestMode()) return;
  const member = { ...state.member };
  const session = checkoutSession;
  const request = ++skinInventoryRequest;
  state.skinInventoryLoading = true;
  state.skinInventoryError = "";
  if (state.screen === "skin-shop") renderSkinShop();
  try {
    const itemIds = await ProjectsBackend.loadOwnedSkins(member);
    if (session !== checkoutSession || request !== skinInventoryRequest) return;
    itemIds.forEach(id => {
      const skin = skinFromProductId(id);
      if (skin) state.ownedSkins.add(skin.id);
    });
    state.skinInventoryVerified = true;
    persistOwnedSkins();
    if (state.skin === "theta-chi" && ![...state.cart.keys()].some(skinFromProductId)) {
      state.skin = persistedSkin();
      appShell.dataset.skin = state.skin;
    }
  } catch (error) {
    if (session !== checkoutSession || request !== skinInventoryRequest) return;
    state.skinInventoryError = "Could not check previous skin purchases. Try again to shop.";
    console.warn("Skin ownership refresh failed:", error);
  } finally {
    if (session === checkoutSession && request === skinInventoryRequest) {
      state.skinInventoryLoading = false;
      if (state.screen === "skin-shop") renderSkinShop();
    }
  }
}

function selectMember(member) {
  state.member = member;
  state.previewTransactionId = `TX-${window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
  state.ownedSkins = new Set();
  state.skinInventoryVerified = ProjectsBackend.isLocalTestMode();
  state.skinInventoryLoading = false;
  state.skinInventoryError = "";
  try {
    const savedOwned = JSON.parse(localStorage.getItem(ownedSkinStorageKey(member)) || "[]");
    if (Array.isArray(savedOwned)) {
      savedOwned.forEach(id => {
        if (SKINS.some(skin => skin.id === id && skin.productId)) state.ownedSkins.add(id);
      });
    }
  } catch (_) {
    // Paid skins can still be restored from the live Orders history.
  }
  state.skin = persistedSkin();
  if (!ProjectsBackend.isLocalTestMode()) void refreshSkinInventory();
}

function setSkin(skinId) {
  if (!state.member || !SKINS.some(skin => skin.id === skinId) ||
      (skinId !== "theta-chi" && !state.ownedSkins.has(skinId))) return;
  state.skin = skinId;
  appShell.dataset.skin = skinId;
  document.querySelectorAll("[data-skin-option]").forEach(button => {
    button.setAttribute("aria-pressed", String(button.dataset.skinOption === skinId));
  });
  try {
    localStorage.setItem(skinStorageKey(state.member), skinId);
  } catch (_) {
    // The choice still works for this checkout if storage is unavailable.
  }
}

function addSkinToCart(skin) {
  if (!state.member || !skin.productId || state.ownedSkins.has(skin.id) ||
      state.cart.has(skin.productId) || !state.skinInventoryVerified) return;
  state.cart.set(skin.productId, 1);
  state.skin = skin.id;
  appShell.dataset.skin = skin.id;
  queueCartPreview();
  renderSkinShop();
}

function cartItemIds() {
  return [...state.cart.keys()].map(String).sort();
}

function cartSignature() {
  return cartItemIds().join(",");
}

function updateCartPreviewSlot() {
  const slot = document.querySelector("#purchaseAchievementPreview");
  if (slot) slot.innerHTML = purchaseProgressMarkup();
}

function queueCartPreview() {
  window.clearTimeout(cartPreviewTimer);
  const signature = cartSignature();
  cartPreviewRequest += 1;
  cartPreview = {
    signature,
    data: signature && state.member ? ProjectsAchievements.peekPreview?.(state.member, cartItemIds(), state.previewTransactionId) || null : null,
    loading: Boolean(signature && state.member && !ProjectsBackend.isLocalTestMode()),
    error: ""
  };
  if (cartPreview.data) cartPreview.loading = false;
  if (cartPreview.loading) cartPreviewTimer = window.setTimeout(loadCartPreview, 140);
  updateCartPreviewSlot();
}

async function loadCartPreview() {
  if (!state.member || !cartPreview.signature || !cartPreview.loading) return;
  const member = { ...state.member };
  const signature = cartPreview.signature;
  const request = cartPreviewRequest;
  const session = checkoutSession;
  try {
    const data = await ProjectsAchievements.preview(member, signature.split(","), state.previewTransactionId);
    if (session !== checkoutSession || request !== cartPreviewRequest || cartPreview.signature !== signature) return;
    cartPreview.data = data;
  } catch (error) {
    if (session !== checkoutSession || request !== cartPreviewRequest || cartPreview.signature !== signature) return;
    cartPreview.error = "Achievement progress could not load. Your order can still be completed.";
    console.warn("Cart achievement preview failed:", error);
  } finally {
    if (session === checkoutSession && request === cartPreviewRequest && cartPreview.signature === signature) {
      cartPreview.loading = false;
      updateCartPreviewSlot();
    }
  }
}

function purchaseProgressMarkup() {
  if (ProjectsBackend.isLocalTestMode()) {
    return '<p class="purchase-progress-note">Achievement previews need the live Apps Script.</p>';
  }
  if (cartPreview.signature !== cartSignature()) {
    return '<p class="purchase-progress-note">Checking this purchase’s progress…</p>';
  }
  if (cartPreview.loading && !cartPreview.data) {
    return '<p class="purchase-progress-note">Checking this purchase’s progress…</p>';
  }
  if (cartPreview.error && !cartPreview.data) {
    return `<p class="purchase-progress-note" role="status">${escapeHtml(cartPreview.error)}</p>`;
  }
  const data = cartPreview.data;
  if (!data) return '<p class="purchase-progress-note">Checking this purchase’s progress…</p>';
  if (!data.changes.length) {
    return '<p class="purchase-progress-note">No achievement counters advance with these items yet. Your purchase still counts toward your purchase streak.</p>';
  }
  return `
    <div class="purchase-progress-heading">
      <strong>From this purchase</strong>
      <span>${Number(data.starsEarned) > 0 ? `+★ ${Number(data.starsEarned)} earned` : `${data.changes.length} ${data.changes.length === 1 ? "achievement" : "achievements"} advanced`}</span>
    </div>
    <div class="purchase-progress-list">
      ${data.changes.map(change => {
        const target = Math.max(1, Number(change.target) || 1);
        const before = Math.max(0, Number(change.before) || 0);
        const after = Math.max(0, Number(change.after) || 0);
        return `<div class="purchase-progress-item">
          <div><strong>${escapeHtml(change.name)}</strong><span>${before} → ${after} / ${target}</span></div>
          <progress max="${target}" value="${Math.min(target, after)}" aria-label="${escapeHtml(change.name)}: ${after} of ${target}"></progress>
          ${Number(change.starsEarned) > 0 ? `<small>★ ${Number(change.starsEarned)} milestone ${Number(change.starsEarned) === 1 ? "star" : "stars"} unlocked</small>` : ""}
        </div>`;
      }).join("")}
    </div>
    <p class="purchase-progress-footnote">Star totals update when this order syncs.</p>
  `;
}

function streakMarkup(value) {
  const streak = Number(value);
  return Number.isInteger(streak) && streak > 0
    ? `<span class="streak-badge" aria-label="${streak} day purchase streak">🔥 ${streak}</span>`
    : "";
}

function cartLines() {
  return [...state.cart.entries()].map(([productId, quantity]) => {
    const skin = skinFromProductId(productId);
    const product = skin
      ? { id: skin.productId, name: `${skin.label} Skin`, price: skin.price, category: "Skins" }
      : products.find((item) => item.id === productId);
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
  window.clearTimeout(cartPreviewTimer);
  cartPreviewRequest += 1;
  cartPreview = { signature: "", data: null, loading: false, error: "" };
  state.screen = "welcome";
  state.member = null;
  state.skin = "theta-chi";
  state.ownedSkins = new Set();
  state.skinInventoryVerified = false;
  state.skinInventoryLoading = false;
  state.skinInventoryError = "";
  skinInventoryRequest += 1;
  state.cart.clear();
  state.category = "Recents";
  state.productGroup = null;
  state.recentProductIds = [];
  state.recentsLoading = false;
  state.recentsError = "";
  state.lastTransaction = null;
  state.previewTransactionId = null;
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

      <button id="leaderboardButton" class="leaderboard-corner-button" type="button">★ Leaderboard</button>
      <button id="pledgesButton" class="pledges-corner-button" type="button">Pledges</button>
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
  const request = ++leaderboardRequest;
  const cached = ProjectsBackend.getCachedLeaderboard();

  state.screen = "leaderboard";
  state.leaderboard = Array.isArray(cached?.data?.entries)
    ? cached.data.entries
    : [];
  state.leaderboardLoading = state.leaderboard.length === 0;
  state.leaderboardError = "";

  render();

  try {
    const data = await ProjectsBackend.loadLeaderboard();

    if (state.screen !== "leaderboard" || request !== leaderboardRequest) return;

    state.leaderboard = Array.isArray(data?.entries)
      ? data.entries
      : [];
  } catch (error) {
    if (state.screen !== "leaderboard" || request !== leaderboardRequest) return;

    if (state.leaderboard.length === 0) {
      state.leaderboardError =
        "Could not load the leaderboard. Check the connection and try again.";
    }

    console.error("Could not load star leaderboard:", error);
  } finally {
    if (state.screen === "leaderboard" && request === leaderboardRequest) {
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
          <p class="eyebrow">Projects</p>
          <h1>Leaderboard</h1>
        </div>
        <button id="leaderboardBackButton" class="secondary-button" type="button">← Roster</button>
      </div>
      <p class="leaderboard-note">Click the star button in your checkout screen to view achievement progress. Paid skins color rows on this kiosk.</p>
      <div class="leaderboard-list" aria-live="polite">
        ${state.leaderboardLoading
          ? `<p class="leaderboard-message">Loading leaderboard…</p>`
          : state.leaderboardError
            ? `<p class="leaderboard-message" role="alert">${escapeHtml(state.leaderboardError)}</p>`
            : state.leaderboard.map((person, index) => {
                const skin = leaderboardSkin(person);
                return `
                <div class="leaderboard-row" data-member-skin="${skin.id}" title="${skin.label} skin">
                  <span class="leaderboard-rank">${index + 1}</span>
                  <span class="leaderboard-person">
                    <span class="leaderboard-name">${escapeHtml(person.name)}</span>
                    ${streakMarkup(person.streak)}
                  </span>
                  <strong class="leaderboard-stars">★ ${Number(person.stars) || 0}</strong>
                </div>
              `;
              }).join("") || `<p class="leaderboard-message">No star totals yet.</p>`}
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
      selectMember(activePledges.find((pledge) => pledge.id === button.dataset.pledgeId));
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
    selectMember(member);
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

function confirmationProgressMarkup() {
  if (ProjectsBackend.isLocalTestMode()) {
    return '<p class="confirmation-progress-status">Achievement progress is available with live data.</p>';
  }

  const cards = achievementData?.cards || [];
  const stars = achievementData ? Number(achievementData.stars) || 0 : "—";
  const status = achievementError ||
    (achievementLoading
      ? (achievementData ? "Updating progress…" : "Loading progress…")
      : !achievementData
        ? "Progress is unavailable right now. Checkout still works."
        : cards.length === 0
          ? "No active achievements available."
          : cards.every(rule => Number(rule.value) <= 0)
            ? "Your first purchase starts your progress."
            : "Keep going to reach the next milestone.");

  const preview = cards.map(rule => {
    const next = rule.levels?.find(level => !level.earned);
    const target = next?.target || rule.milestones?.[rule.milestones.length - 1] || 1;
    const value = Math.min(target, Math.max(0, Number(rule.value) || 0));
    return { rule, target, value, complete: !next };
  }).sort((left, right) =>
    Number(left.complete) - Number(right.complete) ||
    Number(right.value > 0) - Number(left.value > 0) ||
    right.value / right.target - left.value / left.target
  ).slice(0, 3);

  return `
    <div class="confirmation-progress-heading">
      <strong>Achievement progress</strong>
      <span class="confirmation-stars">★ ${stars} stars</span>
    </div>
    <p class="confirmation-progress-status" role="status">${escapeHtml(status)}</p>
    ${preview.length ? `<div class="confirmation-progress-list">
      ${preview.map(({ rule, target, value, complete }) => `
        <div class="confirmation-progress-item">
          <div><span>${escapeHtml(rule.name)}</span><strong>${complete ? "Complete" : `${value} / ${target}${rule.key === "days_since_first_return" ? " days" : ""}`}</strong></div>
          <progress max="${target}" value="${value}" aria-label="${escapeHtml(rule.name)}: ${value} of ${target}"></progress>
        </div>
      `).join("")}
    </div>` : ""}
  `;
}

function renderMemberConfirmation() {
  const member = state.member;
  const session = checkoutSession;
  achievementData = ProjectsAchievements.peek(member);
  if (ProjectsBackend.isLocalTestMode()) {
    achievementLoading = false;
    achievementError = "";
  } else {
    void refreshAchievements();
  }

  // Begin loading Recents while the customer is reading
  // the identity-confirmation screen.
  void ProjectsBackend.loadRecents(member).catch(error => {
    console.warn("Recents prefetch failed:", error);
  });

  app.innerHTML = `
    <section class="center-screen confirmation-screen">
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

        <div id="memberAchievementPreview" class="confirmation-progress">
          ${confirmationProgressMarkup()}
        </div>

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
  <span id="shopStreakSlot" class="shop-streak-slot" aria-live="polite">${streakMarkup(achievementData?.streak)}</span>
  <button id="skinShopButton" class="skin-shop-launch" type="button">Skins</button>
  <button id="achievementsButton" class="stars-button" type="button">
    Achievements <span aria-hidden="true">| ★</span> <span id="starCount">${achievementData ? achievementData.stars : "—"}</span>
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
  document.querySelector("#skinShopButton").addEventListener("click", () => goTo("skin-shop"));
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
    <div class="cart-top">
      <div class="cart-title-row">
        <h2>Your cart</h2>
        <span class="cart-count">${cartQuantity()}</span>
      </div>
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
          ${skinFromProductId(item.id) ? `
            <button class="skin-cart-remove" type="button" data-decrease="${item.id}" aria-label="Remove ${escapeHtml(item.name)} from cart">Remove</button>
          ` : `<div class="quantity-control" aria-label="Quantity for ${escapeHtml(item.name)}">
            <button type="button" data-decrease="${item.id}" aria-label="Remove one ${escapeHtml(item.name)}">−</button>
            <span>${item.quantity}</span>
            <button type="button" data-increase="${item.id}" aria-label="Add one ${escapeHtml(item.name)}">+</button>
          </div>`}
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
  const skin = skinFromProductId(productId);
  const nextQuantity = (state.cart.get(productId) || 0) + difference;
  if (nextQuantity <= 0) {
    state.cart.delete(productId);
  } else {
    state.cart.set(productId, skin ? 1 : nextQuantity);
  }
  if (skin && !state.cart.has(productId) && state.skin === skin.id && !state.ownedSkins.has(skin.id)) {
    const anotherSkin = [...state.cart.keys()].reverse().map(skinFromProductId).find(Boolean);
    state.skin = anotherSkin?.id || persistedSkin();
    appShell.dataset.skin = state.skin;
  }
  queueCartPreview();
  renderShop();
}

function renderSkinShop() {
  const availability = ProjectsBackend.isLocalTestMode() || state.skinInventoryVerified;
  app.innerHTML = `
    <section class="skin-shop-screen">
      <div class="skin-shop-heading">
        <div><p class="eyebrow">Personalize your checkout</p><h1>Skins</h1>
          <p>Choose a look for your visits, ${escapeHtml(state.member.name)}. <strong>No Refunds</strong></p></div>
        <button id="skinShopBack" class="secondary-button" type="button">← Back to shop</button>
      </div>
      <div class="skin-shop-grid" aria-label="Checkout skins">
        ${SKINS.map(skin => {
          const owned = !skin.productId || state.ownedSkins.has(skin.id);
          const inCart = Boolean(skin.productId && state.cart.has(skin.productId));
          const selected = state.skin === skin.id;
          const action = selected && owned ? "Equipped ✓"
            : owned ? `Equip · ${skin.productId ? "Owned" : "Free"}`
              : inCart ? "In cart ✓"
                : availability ? `Add to cart · ${money(skin.price)}` : "Checking purchases…";
          return `
          <button class="skin-shop-card ${selected ? "equipped" : ""}" type="button"
            data-skin-option="${skin.id}" aria-pressed="${selected}" ${!owned && !inCart && !availability ? "disabled" : ""}>
            <span class="skin-preview skin-preview-${skin.id}" aria-hidden="true"><span class="skin-preview-mark">${skin.symbol}</span><span class="skin-preview-ui"><i></i><i></i><i></i></span></span>
            <span class="skin-shop-card-copy"><strong>${skin.label}</strong><small>${skin.mood}</small><em>${skin.productId ? money(skin.price) : "Free"}</em></span>
            <span class="skin-shop-badge">${action}</span>
          </button>`;
        }).join("")}
      </div>
      <p class="skin-shop-note" role="status">${state.skinInventoryError
        ? `${escapeHtml(state.skinInventoryError)} <button id="retrySkinInventory" class="text-button" type="button">Try again</button>`
        : state.skinInventoryLoading ? "Checking previous skin purchases…"
          : ProjectsBackend.isLocalTestMode() ? "Sample checkout only. No account is charged in local test mode."
            : "Buy once, then choose your owned skin on later visits."}</p>
    </section>`;
  document.querySelector("#skinShopBack").addEventListener("click", () => goTo("shop"));
  document.querySelector("#retrySkinInventory")?.addEventListener("click", () => void refreshSkinInventory());
  document.querySelectorAll("[data-skin-option]").forEach(button => {
    button.addEventListener("click", () => {
      const skin = SKINS.find(item => item.id === button.dataset.skinOption);
      if (!skin) return;
      if (!skin.productId || state.ownedSkins.has(skin.id)) {
        setSkin(skin.id);
        renderSkinShop();
      } else if (state.cart.has(skin.productId)) {
        state.skin = skin.id;
        appShell.dataset.skin = skin.id;
        renderSkinShop();
      } else {
        addSkinToCart(skin);
      }
    });
  });
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
  window.clearTimeout(cartPreviewTimer);
  if (cartPreview.signature !== cartSignature()) queueCartPreview();
  if (cartPreview.loading) void loadCartPreview();

  const transaction = {
    transactionId: state.previewTransactionId,
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
    transaction.items.forEach(item => {
      const skin = skinFromProductId(item.id);
      if (skin) state.ownedSkins.add(skin.id);
    });
    persistOwnedSkins();
    if (state.ownedSkins.has(state.skin)) setSkin(state.skin);
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
    : "You're all good.";

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

      <div id="purchaseAchievementPreview" class="purchase-progress" aria-live="polite">
        ${purchaseProgressMarkup()}
      </div>

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
  }, 20000);
}

function render() {
  const renderers = {
    loading: renderLoading,
    "backend-error": renderBackendError,
    welcome: renderWelcome,
    pledges: renderPledges,
    "confirm-member": renderMemberConfirmation,
    shop: renderShop,
    "skin-shop": renderSkinShop,
    review: renderReview,
    achievements: renderAchievements,
    leaderboard: renderLeaderboard,
    success: renderSuccess
  };

  appShell.dataset.screen = state.screen;
  appShell.dataset.skin = state.member && THEMED_SCREENS.has(state.screen)
    ? state.skin
    : "theta-chi";

  appShell.classList.toggle(
    "compact-kiosk",
    ["shop", "skin-shop", "review", "achievements", "leaderboard"].includes(state.screen)
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

function playButtonSound(event) {
  if (!BUTTON_SOUNDS_ENABLED || !event.isTrusted ||
      !event.target.closest?.("button:not(:disabled)")) return;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  try {
    tapAudioContext ||= new AudioContextClass();
    if (tapAudioContext.state === "suspended") {
      void tapAudioContext.resume().catch(() => {});
    }
    const at = tapAudioContext.currentTime;
    const oscillator = tapAudioContext.createOscillator();
    const gain = tapAudioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(640, at);
    oscillator.frequency.exponentialRampToValueAtTime(470, at + 0.055);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.018, at + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.06);
    oscillator.connect(gain);
    gain.connect(tapAudioContext.destination);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
    oscillator.start(at);
    oscillator.stop(at + 0.065);
  } catch (_) {
    // Audio is optional and must never interrupt a button action.
  }
}

document.addEventListener("click", playButtonSound, { capture: true });

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
  if (ProjectsBackend.isLocalTestMode()) {
    loadLocalTestData();
  } else if (ProjectsBackend.isConfigured()) {
    await loadLiveData();
  } else {
    state.screen = "backend-error";
    render();
  }
}

function loadLocalTestData() {
  const sampleData = window.SNACK_DATA;
  if (!sampleData) {
    state.screen = "backend-error";
    render();
    return;
  }

  members = sampleData.members;
  pledges = sampleData.pledges;
  products = sampleData.products;
  categories = sampleData.categories || SHOP_CATEGORIES;
  state.category = "Recents";
  state.productGroup = null;
  state.screen = "welcome";
  render();
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
      const streak = document.querySelector("#shopStreakSlot");
      if (streak) streak.innerHTML = streakMarkup(achievementData?.streak);
      const preview = document.querySelector("#memberAchievementPreview");
      if (preview) preview.innerHTML = confirmationProgressMarkup();
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
  if (state.screen === "leaderboard") void openLeaderboard();
  if (state.member && event.detail.some(entry => entry.member.type === state.member.type && String(entry.member.id) === String(state.member.id))) {
    void refreshAchievements(true);
  }
});
document.addEventListener("scroll", noteUserActivity, { passive: true, capture: true });
document.addEventListener("keydown", noteUserActivity);

// Fresh Pages deployment after GitHub outage
