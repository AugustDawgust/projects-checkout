const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

function newYorkDate(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function serverContext() {
  const context = vm.createContext({
    Utilities: {
      formatDate(date, zone, format) {
        assert.equal(zone, "America/New_York");
        assert.equal(format, "yyyy-MM-dd");
        return newYorkDate(date);
      }
    },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({}) },
    console
  });
  for (const file of ["Code.js", "Achievements.js"]) {
    vm.runInContext(
      fs.readFileSync(path.join(root, "google-apps-script", file), "utf8"),
      context,
      { filename: file }
    );
  }
  return context;
}

function orderRow(timestamp, transactionId, productId = "0133", quantity = 1) {
  const itemName = productId === "0133" ? "Budweiser"
    : productId.startsWith("SKIN-") ? "Ocean Skin" : "Snack";
  return [
    transactionId, timestamp, "Brother", "1001", "Member", "Sample",
    productId, itemName, 2, quantity, 2, 2, "test-device"
  ];
}

test("streak counts unique New York purchase dates, including excluded items", () => {
  const server = serverContext();
  const rows = [
    orderRow("2026-09-29T04:30:00Z", "TX-today001", "SKIN-OCEAN"),
    orderRow("2026-09-29T16:00:00Z", "TX-today002", "SKIN-OCEAN"),
    orderRow("2026-09-28T15:00:00Z", "TX-yesterday", "SKIN-OCEAN"),
    orderRow("2026-09-27T15:00:00Z", "TX-before00", "SKIN-OCEAN"),
    orderRow("2026-09-26T15:00:00Z", "TX-invalid0", "SKIN-OCEAN", 0)
  ];
  const grouped = server.achGroupOrders_(rows, [{ id: "SKIN-OCEAN", name: "Ocean Skin" }]);
  const orders = grouped.members.get("Brother:1001");
  assert.equal(orders.length, 4);
  assert.ok(orders.every(order => order.eligible.length === 0));
  assert.equal(server.achCurrentStreak_(orders, new Date("2026-09-29T16:00:00Z")), 3);
});

test("beer advances drink and mixed-order achievements while skins stay cosmetic", () => {
  const server = serverContext();
  const rows = [
    orderRow("2026-09-29T16:00:00Z", "TX-beerfood", "0133"),
    orderRow("2026-09-29T16:00:00Z", "TX-beerfood", "0001"),
    orderRow("2026-09-29T17:00:00Z", "TX-skinonly", "SKIN-OCEAN")
  ];
  const orders = server.achGroupOrders_(rows, [
    { id: "0133", name: "Budweiser" }, { id: "0001", name: "Snack" },
    { id: "SKIN-OCEAN", name: "Ocean Skin" }
  ]).members.get("Brother:1001");
  const metrics = server.achEvaluate_(orders, []).metrics;
  assert.equal(metrics.distinct_drinks, 1);
  assert.equal(metrics.distinct_products, 2);
  assert.equal(metrics.mixed_orders, 1);
  assert.equal(metrics.unique_orders, 1);
  assert.equal(orders[1].eligible.length, 0);
});

test("leaderboard shows beer-earned stars before the award backfill runs", () => {
  const server = serverContext();
  server.requireSheet_ = () => ({});
  server.readBrothers_ = () => [{ type: "Brother", id: "1001", name: "Sample Member" }];
  server.readPledges_ = () => [];
  server.achDefinitions_ = () => [{
    id: "DRINK", key: "distinct_drinks", name: "Drink Explorer",
    description: "Try drinks.", milestones: [1], stars: 1
  }];
  server.achData_ = () => ({
    rows: [orderRow(new Date().toISOString(), "TX-beeronly", "0133")],
    catalog: [{ id: "0133", name: "Budweiser" }]
  });
  server.achLedger_ = () => ({ rows: [] });
  assert.equal(server.getLeaderboard_().entries[0].stars, 1);
});

test("Apps Script charges fixed skin prices through the normal Orders rows", () => {
  const server = serverContext();
  let written;
  const orders = {
    getLastRow: () => 1,
    getRange: () => ({ setValues(rows) { written = rows; } })
  };
  server.LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) };
  server.SpreadsheetApp = { getActiveSpreadsheet: () => ({ getSheetByName: () => orders }), flush() {} };
  server.requireSheet_ = () => ({});
  server.readBrothers_ = () => [{ type: "Brother", id: "1001", firstName: "Sample", lastName: "Member" }];
  server.readPledges_ = () => [];
  server.readProducts_ = () => [{ id: "0001", name: "Snack", price: 1.25 }];
  server.transactionExists_ = () => false;
  server.getSkinInventory_ = () => ({ itemIds: [] });
  server.syncProjectsSkins_ = () => ({});
  const transaction = {
    transactionId: "TX-12345678", member: { type: "Brother", id: "1001" },
    items: [
      { id: "0001", price: 1.25, quantity: 1 },
      { id: "SKIN-FOREST", price: 0.50, quantity: 1 }
    ], deviceId: "test"
  };
  const result = server.recordTransaction_(transaction);
  assert.equal(result.total, 1.75);
  assert.equal(written.length, 2);
  assert.equal(written[1][6], "SKIN-FOREST");
  assert.equal(written[1][8], 0.5);
  assert.equal(written[1][11], 1.75);
  transaction.items[1].price = 0;
  assert.throws(() => server.recordTransaction_(transaction), /invalid price or quantity/);
  transaction.items[1].price = 0.5;
  transaction.items[1].quantity = 2;
  assert.throws(() => server.recordTransaction_(transaction), /invalid price or quantity/);
  transaction.items[1].quantity = 1;
  server.getSkinInventory_ = () => ({ itemIds: ["SKIN-FOREST"] });
  assert.throws(() => server.recordTransaction_(transaction), /already owns/);
});

test("skin ownership reads only that member's purchased skin rows", () => {
  const server = serverContext();
  const orders = {
    getLastRow: () => 5,
    getRange: () => ({ getValues: () => [
      ["Brother", "1001", "Member", "Sample", "SKIN-OCEAN", "Ocean Skin", 1, 1],
      ["Brother", "2002", "Other", "Member", "SKIN-FOREST", "Forest Skin", 0.5, 1],
      ["Brother", "1001", "Member", "Sample", "SKIN-SUNSET", "Sunset Skin", 5, 0],
      ["Brother", "1001", "Member", "Sample", "0001", "Snack", 1, 1]
    ] })
  };
  server.SpreadsheetApp = { getActiveSpreadsheet: () => ({}) };
  server.requireSheet_ = (_, name) => name === "Orders" ? orders : {};
  server.skinSheet_ = () => null;
  server.readBrothers_ = () => [{ type: "Brother", id: "1001" }];
  server.readPledges_ = () => [];
  const inventory = server.getSkinInventory_("Brother", "1001");
  assert.equal(inventory.customerId, "1001");
  assert.deepEqual(Array.from(inventory.itemIds), ["SKIN-OCEAN"]);
});

test("skin ownership also recognizes a complimentary Skins tab unlock", () => {
  const server = serverContext();
  const skins = {
    getLastRow: () => 2,
    getRange: () => ({ getValues: () => [["Pledge", "P-TEST", "Sample Pledge", 1, 1, 0, 0]] })
  };
  const orders = { getLastRow: () => 1 };
  server.SpreadsheetApp = { getActiveSpreadsheet: () => ({}) };
  server.requireSheet_ = (_, name) => name === "Orders" ? orders : {};
  server.skinSheet_ = () => skins;
  server.readBrothers_ = () => [];
  server.readPledges_ = () => [{ type: "Pledge", id: "P-TEST" }];
  const inventory = server.getSkinInventory_("Pledge", "P-TEST");
  assert.deepEqual(Array.from(inventory.itemIds), ["SKIN-FOREST"]);
});

test("Skins tab follows brother roster and sorts pledges while preserving unlocks", () => {
  const server = serverContext();
  const headers = ["Customer Type", "Customer ID", "Name", "Theta Chi", "Forest", "Ocean", "Sunset"];
  const previous = [["Pledge", "P-A", "Amy Alpha", 1, 1, 0, 0]];
  let written;
  const skins = {
    getLastRow: () => 2,
    getRange: row => ({
      getValues: () => row === 1 ? [headers] : previous,
      setValues: rows => { written = rows; },
      setNumberFormat() {}, clearContent() {}
    }),
    setFrozenRows() {}
  };
  const orders = {
    getLastRow: () => 2,
    getRange: () => ({ getValues: () => [
      ["Brother", 12, "Older", "Brother", "SKIN-OCEAN", "Ocean Skin", 1, 1]
    ] })
  };
  const spreadsheet = { getSheetByName: name => name === "Skins" ? skins : orders };
  server.requireSheet_ = (_, name) => name === "Orders" ? orders : {};
  server.readBrothers_ = () => [
    { type: "Brother", id: "0012", name: "Older Brother" },
    { type: "Brother", id: "0002", name: "Younger Brother" }
  ];
  server.readPledges_ = () => [
    { type: "Pledge", id: "P-Z", name: "Zoe Zeta", firstName: "Zoe", lastName: "Zeta" },
    { type: "Pledge", id: "P-A", name: "Amy Alpha", firstName: "Amy", lastName: "Alpha" }
  ];
  const result = server.syncProjectsSkins_(spreadsheet);
  assert.equal(result.rows, 4);
  assert.deepEqual(Array.from(written, row => Array.from(row)), [
    ["Brother", "0002", "Younger Brother", 1, 0, 0, 0],
    ["Brother", "0012", "Older Brother", 1, 0, 1, 0],
    ["Pledge", "P-A", "Amy Alpha", 1, 1, 0, 0],
    ["Pledge", "P-Z", "Zoe Zeta", 1, 0, 0, 0]
  ]);
});

test("streak accepts yesterday and expires after a missing day", () => {
  const server = serverContext();
  const grouped = server.achGroupOrders_([
    orderRow("2026-09-28T15:00:00Z", "TX-yesterday"),
    orderRow("2026-09-27T15:00:00Z", "TX-before00")
  ], []);
  const orders = grouped.members.get("Brother:1001");
  assert.equal(server.achCurrentStreak_(orders, new Date("2026-09-29T16:00:00Z")), 2);
  assert.equal(server.achCurrentStreak_(orders, new Date("2026-09-30T16:00:00Z")), 0);
  assert.equal(server.achCurrentStreak_([], new Date("2026-09-29T16:00:00Z")), 0);
});

test("streak uses calendar dates through daylight saving changes", () => {
  const server = serverContext();
  const grouped = server.achGroupOrders_([
    orderRow("2026-03-09T15:00:00Z", "TX-march009"),
    orderRow("2026-03-08T15:00:00Z", "TX-march008"),
    orderRow("2026-03-07T15:00:00Z", "TX-march007")
  ], []);
  assert.equal(
    server.achCurrentStreak_(grouped.members.get("Brother:1001"), new Date("2026-03-09T16:00:00Z")),
    3
  );
});

test("achievement and leaderboard responses include the same purchase streak", () => {
  const server = serverContext();
  const rows = [
    orderRow("2026-09-29T15:00:00Z", "TX-today001"),
    orderRow("2026-09-28T15:00:00Z", "TX-yesterday")
  ];
  server.requireSheet_ = () => ({});
  server.readBrothers_ = () => [{
    type: "Brother", id: "1001", name: "Sample Member",
    firstName: "Sample", lastName: "Member"
  }];
  server.readPledges_ = () => [];
  server.achDefinitions_ = () => [];
  server.achData_ = () => ({ rows, catalog: [] });
  server.achLedger_ = () => ({ rows: [] });
  server.achAppendAwards_ = () => 0;
  const actualNow = Date;
  // The endpoint calls use the real clock, so use dates relative to today in New York.
  const today = newYorkDate(new actualNow());
  const dayNumber = Date.parse(today + "T00:00:00Z") / 86400000;
  const dateFor = offset => new Date((dayNumber + offset) * 86400000 + 18 * 3600000).toISOString();
  rows[0][1] = dateFor(0);
  rows[1][1] = dateFor(-1);
  assert.equal(server.getAchievements_("Brother", "1001").streak, 2);
  assert.equal(server.getLeaderboard_().entries[0].streak, 2);
});

function uiContext() {
  const storage = new Map();
  const app = { innerHTML: "" };
  const shell = { dataset: {}, classList: { toggle() {} } };
  const element = { addEventListener() {}, setAttribute() {}, classList: { toggle() {} } };
  const context = vm.createContext({
    document: {
      querySelector(selector) {
        return selector === "#app" ? app : selector === ".app-shell" ? shell : element;
      },
      querySelectorAll() { return []; },
      addEventListener() {}
    },
    window: {
      SNACK_DATA: { members: [], pledges: [], products: [] },
      PROJECTS_CONFIG: { useLocalTestData: true },
      setInterval() {}, setTimeout() {}, clearTimeout() {}, addEventListener() {}
    },
    localStorage: {
      getItem(key) { return storage.get(key) || null; },
      setItem(key, value) { storage.set(key, value); }
    },
    ProjectsBackend: { isLocalTestMode: () => true, loadOwnedSkins: async () => [] },
    ProjectsAchievements: { peek: () => null },
    console
  });
  vm.runInContext(fs.readFileSync(path.join(root, "app.js"), "utf8"), context, { filename: "app.js" });
  return { context, app, shell, storage };
}

test("zero streaks render no fire or number in checkout and leaderboard", () => {
  const { context, app } = uiContext();
  assert.equal(context.streakMarkup(0), "");
  assert.equal(context.streakMarkup(undefined), "");
  vm.runInContext(
    'selectMember({ type: "Brother", id: "1001", name: "Zero Member" }); state.screen = "shop"; renderShop();',
    context
  );
  assert.match(app.innerHTML, /id="shopStreakSlot"[^>]*><\/span>/);
  assert.ok(!app.innerHTML.includes("🔥"));
  vm.runInContext(
    'state.leaderboard = [{ name: "Zero Member", stars: 0, streak: 0 }]; state.leaderboardLoading = false; state.leaderboardError = ""; renderLeaderboard();',
    context
  );
  assert.ok(!app.innerHTML.includes("🔥"));
  assert.ok(app.innerHTML.includes("Zero Member"));
  vm.runInContext(
    'state.leaderboard = [{ name: "Active Member", stars: 0, streak: 3 }]; renderLeaderboard();',
    context
  );
  assert.ok(app.innerHTML.includes("🔥 3"));
});

test("Theta Chi leaderboard rows stay white while paid skins add color", () => {
  const { context, app, storage } = uiContext();
  storage.set("projectsSkinV1:Brother:1001", "forest");
  storage.set("projectsOwnedSkinsV1:test:Brother:1001", '["forest"]');
  storage.set("projectsSkinV1:Brother:1002", "theta-chi");
  vm.runInContext(`
    state.leaderboard = [
      { type: "Brother", id: "1001", name: "Forest Member", stars: 3 },
      { type: "Brother", id: "1002", name: "Classic Member", stars: 2 },
      { type: "Pledge", id: "P-OTHER", name: "Default Pledge", stars: 1 }
    ];
    state.leaderboardLoading = false;
    state.leaderboardError = "";
    renderLeaderboard();
  `, context);
  const rows = [...app.innerHTML.matchAll(/class="leaderboard-row" data-member-skin="([^"]+)"[^>]*>[\s\S]*?<span class="leaderboard-name">([^<]+)<\/span>/g)];
  assert.deepEqual(rows.map(row => [row[2], row[1]]), [
    ["Forest Member", "forest"],
    ["Classic Member", "theta-chi"],
    ["Default Pledge", "theta-chi"]
  ]);
  const css = fs.readFileSync(path.join(root, "ui-polish.css"), "utf8");
  assert.match(css, /\.leaderboard-row\[data-member-skin="theta-chi"\]\s*\{\s*background:\s*#fff;/);
  assert.match(css, /\.leaderboard-row\[data-member-skin\]:not\(\[data-member-skin="theta-chi"\]\)/);
  assert.match(css, /\.leaderboard-row\[data-member-skin="forest"\]/);
  assert.match(css, /\.leaderboard-row\[data-member-skin="ocean"\]/);
  assert.match(css, /\.leaderboard-row\[data-member-skin="sunset"\]/);
});

test("paid skins require purchase and persist per member after checkout", async () => {
  const { context, shell, storage } = uiContext();
  let savedTransaction;
  context.ProjectsBackend.saveTransaction = async transaction => {
    savedTransaction = transaction;
    return { localOnly: true };
  };
  vm.runInContext('selectMember({ type: "Brother", id: "1001", name: "Sample Member" }); setSkin("ocean");', context);
  assert.equal(vm.runInContext("state.skin", context), "theta-chi");
  vm.runInContext('addSkinToCart(SKINS.find(skin => skin.id === "ocean"));', context);
  assert.equal(vm.runInContext("cartTotal()", context), 1);
  assert.equal(vm.runInContext('state.cart.get("SKIN-OCEAN")', context), 1);
  await context.completePurchase();
  assert.equal(savedTransaction.items[0].id, "SKIN-OCEAN");
  assert.equal(savedTransaction.items[0].price, 1);
  assert.equal(savedTransaction.total, 1);
  assert.equal(storage.get("projectsSkinV1:Brother:1001"), "ocean");
  assert.match(storage.get("projectsOwnedSkinsV1:test:Brother:1001"), /ocean/);
  vm.runInContext('state.screen = "shop"; render();', context);
  assert.equal(shell.dataset.skin, "ocean");
  vm.runInContext('resetCheckout();', context);
  assert.equal(shell.dataset.skin, "theta-chi");
  vm.runInContext('selectMember({ type: "Brother", id: "1001" });', context);
  assert.equal(vm.runInContext("state.skin", context), "ocean");
  vm.runInContext('selectMember({ type: "Pledge", id: "1001" });', context);
  assert.equal(vm.runInContext("state.skin", context), "theta-chi");
  context.ProjectsBackend.isLocalTestMode = () => false;
  vm.runInContext('selectMember({ type: "Brother", id: "1001" });', context);
  assert.equal(vm.runInContext("state.skin", context), "theta-chi");
  assert.equal(vm.runInContext('state.ownedSkins.has("ocean")', context), false);
});

test("paid skins purchased on another kiosk are restored from Orders", async () => {
  const { context, app } = uiContext();
  context.ProjectsBackend.isLocalTestMode = () => false;
  context.ProjectsBackend.loadOwnedSkins = async () => ["SKIN-FOREST"];
  vm.runInContext('selectMember({ type: "Brother", id: "1001", name: "Sample Member" });', context);
  await context.refreshSkinInventory();
  assert.equal(vm.runInContext('state.ownedSkins.has("forest")', context), true);
  vm.runInContext('setSkin("forest"); renderSkinShop();', context);
  assert.match(app.innerHTML, /Equipped ✓/);
  assert.equal(vm.runInContext("state.skin", context), "forest");
});

test("confirmation preview covers progress, loading, and failure", () => {
  const { context } = uiContext();
  context.ProjectsBackend.isLocalTestMode = () => false;
  vm.runInContext(
    'achievementData = { stars: 2, cards: [{ name: "Regular", key: "unique_orders", value: 2, milestones: [5], levels: [{ target: 5, earned: false }] }] }; achievementLoading = false; achievementError = "";',
    context
  );
  const progress = context.confirmationProgressMarkup();
  assert.match(progress, /★ 2 stars/);
  assert.match(progress, /2 \/ 5/);
  assert.match(progress, /<progress max="5" value="2"/);
  vm.runInContext('achievementData = null; achievementLoading = true;', context);
  assert.match(context.confirmationProgressMarkup(), /Loading progress/);
  vm.runInContext('achievementLoading = false; achievementError = "Stars could not load.";', context);
  assert.match(context.confirmationProgressMarkup(), /Stars could not load/);
});

test("blocked audio never throws during a button click", () => {
  const { context } = uiContext();
  context.window.AudioContext = class { constructor() { throw new Error("blocked"); } };
  assert.doesNotThrow(() => context.playButtonSound({
    isTrusted: true,
    target: { closest: () => ({}) }
  }));
});

test("cart preview uses real achievement rules without writing orders or awards", () => {
  const server = serverContext();
  const rows = [orderRow("2026-09-27T15:00:00Z", "TX-prior", "0001")];
  rows[0][7] = "Snack";
  server.requireSheet_ = () => ({});
  server.readBrothers_ = () => [{ type: "Brother", id: "1001" }];
  server.readPledges_ = () => [];
  server.achDefinitions_ = () => [{
    id: "REGULAR", key: "unique_orders", name: "Projects Regular",
    description: "Place orders.", milestones: [1, 2, 5], stars: 1
  }];
  server.achData_ = () => ({ rows, catalog: [
    { id: "0001", name: "Snack" }, { id: "0133", name: "Budweiser" },
    { id: "SKIN-OCEAN", name: "Ocean Skin" }
  ] });
  server.achAppendAwards_ = () => { throw new Error("Preview must not write awards"); };
  const preview = server.getAchievementPreview_("Brother", "1001", "0001", "TX-current");
  assert.equal(preview.changes[0].before, 1);
  assert.equal(preview.changes[0].after, 2);
  assert.equal(preview.changes[0].target, 2);
  assert.equal(preview.starsEarned, 1);
  assert.equal(preview.transactionId, "TX-current");
  assert.equal(rows.length, 1);
  const syncedRow = orderRow("2026-09-29T15:00:00Z", "TX-current", "0001");
  syncedRow[7] = "Snack";
  rows.push(syncedRow);
  assert.equal(server.getAchievementPreview_("Brother", "1001", "0001", "TX-current").changes[0].before, 1);
  const excluded = server.getAchievementPreview_("Brother", "1001", "SKIN-OCEAN");
  assert.equal(excluded.changes.length, 0);
  assert.throws(() => server.getAchievementPreview_("Brother", "1001", "9999"), /unknown item/);
});

test("Skins menu is separate from the cart and success shows only the matching preview", () => {
  const { context, app } = uiContext();
  vm.runInContext('selectMember({ type: "Brother", id: "1001", name: "Sample Member" }); state.screen = "shop"; renderShop();', context);
  assert.match(app.innerHTML, /id="skinShopButton"[^>]*>Skins/);
  assert.match(app.innerHTML, /Achievements <span aria-hidden="true">\| ★<\/span>/);
  assert.ok(!app.innerHTML.includes('class="skin-picker"'));
  vm.runInContext('renderSkinShop();', context);
  assert.match(app.innerHTML, /No Refunds/);
  assert.match(app.innerHTML, /\$1\.00/);
  assert.match(app.innerHTML, /\$0\.50/);
  assert.match(app.innerHTML, /\$5\.00/);
  assert.match(app.innerHTML, /Add to cart · \$1\.00/);
  assert.match(app.innerHTML, /Equipped ✓/);
  context.ProjectsBackend.isLocalTestMode = () => false;
  vm.runInContext('state.cart.set("0001", 1); cartPreview = { signature: "0001", loading: false, error: "", data: { changes: [{ name: "Projects Regular", before: 1, after: 2, target: 5, starsEarned: 0 }], starsEarned: 0 } };', context);
  assert.match(context.purchaseProgressMarkup(), /1 → 2 \/ 5/);
  vm.runInContext('state.cart.clear();', context);
  assert.doesNotMatch(context.purchaseProgressMarkup(), /Projects Regular/);
});

test("cart projection updates when an item is removed", async () => {
  const { context } = uiContext();
  context.ProjectsBackend.isLocalTestMode = () => false;
  const requests = [];
  context.ProjectsAchievements.preview = async (_member, ids) => {
    requests.push(ids.join(","));
    return { changes: ids.map(id => ({ name: id, before: 0, after: 1, target: 2, starsEarned: 0 })), starsEarned: 0 };
  };
  vm.runInContext('selectMember({ type: "Brother", id: "1001" }); state.cart.set("0001", 1); queueCartPreview();', context);
  await context.loadCartPreview();
  assert.match(context.purchaseProgressMarkup(), /0001/);
  vm.runInContext('state.cart.set("0002", 1); queueCartPreview();', context);
  await context.loadCartPreview();
  assert.match(context.purchaseProgressMarkup(), /0002/);
  vm.runInContext('state.cart.delete("0001"); queueCartPreview();', context);
  assert.doesNotMatch(context.purchaseProgressMarkup(), /0001/);
  await context.loadCartPreview();
  assert.match(context.purchaseProgressMarkup(), /0002/);
  assert.deepEqual(requests, ["0001", "0001,0002", "0002"]);
});
