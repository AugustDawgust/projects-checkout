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
  return [
    transactionId, timestamp, "Brother", "1001", "Member", "Sample",
    productId, "Budweiser", 2, quantity, 2, 2, "test-device"
  ];
}

test("streak counts unique New York purchase dates, including excluded items", () => {
  const server = serverContext();
  const rows = [
    orderRow("2026-09-29T04:30:00Z", "TX-today001"),
    orderRow("2026-09-29T16:00:00Z", "TX-today002"),
    orderRow("2026-09-28T15:00:00Z", "TX-yesterday"),
    orderRow("2026-09-27T15:00:00Z", "TX-before00"),
    orderRow("2026-09-26T15:00:00Z", "TX-invalid0", "0133", 0)
  ];
  const grouped = server.achGroupOrders_(rows, [{ id: "0133", name: "Budweiser" }]);
  const orders = grouped.members.get("Brother:1001");
  assert.equal(orders.length, 4);
  assert.ok(orders.every(order => order.eligible.length === 0));
  assert.equal(server.achCurrentStreak_(orders, new Date("2026-09-29T16:00:00Z")), 3);
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
    ProjectsBackend: { isLocalTestMode: () => true },
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

test("skins persist per member and return to default after checkout", () => {
  const { context, shell, storage } = uiContext();
  vm.runInContext('selectMember({ type: "Brother", id: "1001" }); setSkin("ocean");', context);
  assert.equal(storage.get("projectsSkinV1:Brother:1001"), "ocean");
  vm.runInContext('state.screen = "shop"; render();', context);
  assert.equal(shell.dataset.skin, "ocean");
  vm.runInContext('resetCheckout();', context);
  assert.equal(shell.dataset.skin, "theta-chi");
  vm.runInContext('selectMember({ type: "Brother", id: "1001" });', context);
  assert.equal(vm.runInContext("state.skin", context), "ocean");
  vm.runInContext('selectMember({ type: "Pledge", id: "1001" });', context);
  assert.equal(vm.runInContext("state.skin", context), "theta-chi");
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
    { id: "0001", name: "Snack" }, { id: "0133", name: "Budweiser" }
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
  const excluded = server.getAchievementPreview_("Brother", "1001", "0133");
  assert.equal(excluded.changes.length, 0);
  assert.throws(() => server.getAchievementPreview_("Brother", "1001", "9999"), /unknown item/);
});

test("Skin Shop is separate from the cart and success shows only the matching preview", () => {
  const { context, app } = uiContext();
  vm.runInContext('selectMember({ type: "Brother", id: "1001", name: "Sample Member" }); state.screen = "shop"; renderShop();', context);
  assert.match(app.innerHTML, /id="skinShopButton"[^>]*>Skin Shop/);
  assert.match(app.innerHTML, /Achievements <span aria-hidden="true">\| ★<\/span>/);
  assert.ok(!app.innerHTML.includes('class="skin-picker"'));
  vm.runInContext('renderSkinShop();', context);
  assert.match(app.innerHTML, /Equip · Free/);
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
