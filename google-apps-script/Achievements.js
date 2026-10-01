/* Projects achievements v1. Cosmetic only. Orders and billing are never edited. */
const ACH_RULE_HEADERS = ["Rule ID", "Name", "Description", "Rule Key", "Milestones", "Stars per Level", "Active", "Rule Details"];
const ACH_AWARD_HEADERS = ["Customer Type", "Customer ID", "Rule ID", "Milestone", "Earned At", "Source Transaction ID", "Stars"];
const ACH_TIME_ZONE = "America/New_York";
const ACH_BACKFILL_CURSOR = "projectsAchievementBackfillCursorV1";
const ACH_RESPONSE_CACHE_VERSION = "projectsAchievementResponsesV1";
const ACH_EXCLUDED_IDS = new Set(["SKIN-OCEAN", "SKIN-FOREST", "SKIN-SUNSET"]);
const ACH_DEFAULTS = [
  ["REGULAR", "Projects Regular", "Place orders.", "unique_orders", "1,5,10,25,50,100,200", 1, "Yes", "Count unique eligible transactions, not line items."],
  ["FAMILIAR", "Familiar Face", "Order on different days.", "distinct_days", "3,7,15,30,60,100", 1, "Yes", "Use New York calendar days."],
  ["STAY", "Here to Stay", "Order in different weeks.", "distinct_weeks", "2,4,8,12,20,30", 1, "Yes", "Weeks start Sunday; they do not need to be consecutive."],
  ["VARIETY", "Variety Seeker", "Try different products.", "distinct_products", "3,5,10,20,30,40", 1, "Yes", "Each eligible Item ID counts once, including flavors."],
  ["ROUNDED", "Well Rounded", "Buy food and drinks together.", "mixed_orders", "1,5,10,25,50", 1, "Yes", "Food and a drink in one order, including beer."],
  ["SNACK", "Snack Explorer", "Try different foods.", "distinct_foods", "3,5,10,15,20", 1, "Yes", "Each food Item ID counts once."],
  ["DRINK", "Drink Explorer", "Try different drinks.", "distinct_drinks", "3,5,10,15,20", 1, "Yes", "Each drink Item ID counts once, including beer."],
  ["RELIABLE", "Old Reliable", "Buy a favorite on different days.", "repeat_product_days", "3,5,10,20", 1, "Yes", "Most distinct purchase days for a single eligible product."],
  ["MONTHS", "Month After Month", "Order in different months.", "distinct_months", "2,3,4,6,9", 1, "Yes", "Different calendar months; not necessarily consecutive."],
  ["VETERAN", "Projects Veteran", "Come back after your first order.", "days_since_first_return", "30,90,180", 1, "Yes", "Days between first eligible purchase and a later purchase; waiting alone does not count."],
  ["DEJAVU", "Déjà Vu", "Repeat a 3-item combo on another day.", "repeated_cart", "2", 1, "Yes", "Same complete set of at least 3 different eligible products on two days; quantities do not matter."],
  ["PLOT", "Plot Twist", "Switch up your whole combo.", "disjoint_carts", "2", 1, "Yes", "Two consecutive eligible orders on different days, each with at least 2 different items and no shared items."],
  ["CIRCLE", "Full Circle", "Buy an old favorite 30 days later.", "long_return", "1", 1, "Yes", "Buy a product at least 30 calendar days after first buying it."],
  ["MOVIE", "Movie Night", "Buy popcorn and a candy bar together.", "movie_combo", "2", 1, "Yes", "Popcorn plus any full-size candy bar, in one order."],
  ["SWEETSALTY", "Sweet & Salty", "Buy a sweet and savory snack together.", "sweet_savory_combo", "2", 1, "Yes", "A sweet snack and a savory snack in the same order."],
  ["BREAKFAST", "Breakfast Club", "Buy Pop-Tarts and a protein shake together.", "breakfast_combo", "2", 1, "Yes", "Pop-Tarts plus Fairlife or Premier Protein, in one order."],
  ["DOUBLE", "Double Agent", "Try a soda and its Zero version.", "regular_zero_pair", "2", 1, "Yes", "Coke + Coke Zero OR Sprite + Sprite Zero, across any orders."],
  ["COOKIE", "Cookie Monster", "Try all four cookie types.", "cookie_set", "4", 1, "Yes", "Oreo, Nutter Butter, Chips Ahoy, and Mini Cookies."],
  ["NOODLE", "Noodle Connoisseur", "Try both noodle options.", "noodle_pair", "2", 1, "Yes", "Cup Noodles and Shin Ramyun."],
  ["BATTERY", "Time to Recharge", "Buy a battery.", "battery_purchase", "1", 1, "Yes", "AA or AAA batteries."],
  ["HYDRATE", "Hydrate or Diedrate", "Try both Powerade and Liquid IV.", "powerade_liquid_iv", "2", 1, "Yes", "Any regular or Zero Powerade counts as one type; Liquid IV is the other."],
  ["GUM", "Mint Condition", "Buy gum.", "gum_purchase", "1", 1, "Yes", "Any Extra Gum purchase."]
];

function achSheet_(spreadsheet, name, headers, create) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet && create) sheet = spreadsheet.insertSheet(name);
  if (!sheet) throw new Error("Run setupProjectsAchievements first. Missing sheet: " + name);
  if (sheet.getLastRow() === 0 && create) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  const actual = sheet.getRange(1, 1, 1, headers.length).getValues()[0].map(String);
  if (actual.some((value, i) => value.trim() !== headers[i])) {
    throw new Error(name + " headers must be: " + headers.join(" | ") + ". Existing data was not changed.");
  }
  return sheet;
}

// Editor-only setup. Never called from the public web app.
function setupProjectsAchievements() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const rules = achSheet_(spreadsheet, "Achievements", ACH_RULE_HEADERS, true);
  const awards = achSheet_(spreadsheet, "Member Achievements", ACH_AWARD_HEADERS, true);
  if (rules.getLastRow() === 1) {
    rules.getRange("E:E").setNumberFormat("@");
    rules.getRange(2, 1, ACH_DEFAULTS.length, ACH_RULE_HEADERS.length).setValues(ACH_DEFAULTS);
  }
  rules.setFrozenRows(1);
  awards.setFrozenRows(1);
  awards.getRange("B:B").setNumberFormat("@");
  awards.getRange("E:E").setNumberFormat("yyyy-mm-dd hh:mm:ss");
  const definitions = achDefinitions_(spreadsheet);
  console.log(definitions.length + " active achievements ready. Existing rules and Orders were not overwritten.");
}

function achDefinitions_(spreadsheet) {
  const knownKeys = new Set(ACH_DEFAULTS.map(row => row[3]));
  const seen = new Set();
  return rowsAsObjects_(achSheet_(spreadsheet, "Achievements", ACH_RULE_HEADERS, false))
    .filter(row => ["yes", "true", "active", "1"].includes(String(row.Active).trim().toLowerCase()))
    .map(row => {
      const id = String(row["Rule ID"]).trim();
      const key = String(row["Rule Key"]).trim();
      const milestones = String(row.Milestones).split(",").map(value => Number(value.trim()));
      const stars = Number(row["Stars per Level"]);
      if (!id || seen.has(id) || !knownKeys.has(key) || !Number.isInteger(stars) || stars < 1 ||
          !milestones.length || milestones.some((n, i) => !Number.isInteger(n) || n < 1 || (i && n <= milestones[i - 1]))) {
        throw new Error("Check achievement " + (id || "(missing Rule ID)") + ": unknown Rule Key, duplicate ID, or invalid milestones/stars.");
      }
      seen.add(id);
      const details = String(row["Rule Details"] || "")
        .replace(/non-alcoholic drink/gi, "drink")
        .replace(/Atlanta calendar days/gi, "New York calendar days");
      return { id, key, milestones, stars, name: String(row.Name), description: String(row.Description), details };
    });
}

function achMemberKey_(type, id) {
  return String(type).trim() + ":" + (String(type).trim() === "Brother" ? fourDigits_(id) : String(id).trim());
}

function achData_(spreadsheet) {
  const sheet = requireSheet_(spreadsheet, SHEETS.orders);
  const headers = sheet.getRange(1, 1, 1, ORDER_HEADERS.length).getValues()[0];
  if (headers.some((header, i) => String(header).trim() !== ORDER_HEADERS[i])) throw new Error("Orders column layout differs from the expected 13 columns.");
  const rows = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, ORDER_HEADERS.length).getValues() : [];
  // Include inactive catalog products and historical names from Orders.
  const catalog = readProducts_(requireSheet_(spreadsheet, SHEETS.products), false).concat(SKIN_PRODUCTS);
  return { rows, catalog };
}

function achTimestamp_(value) {
  if (value instanceof Date) return value;
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) {
    try { return Utilities.parseDate(text, ACH_TIME_ZONE, "yyyy-MM-dd HH:mm:ss"); } catch (error) { return new Date(NaN); }
  }
  // Avoid interpreting ambiguous text dates using the server timezone.
  return /T.*(?:Z|[+-]\d\d:\d\d)$/.test(text) ? new Date(text) : new Date(NaN);
}

function achGroupOrders_(rows, catalog) {
  const names = new Map(catalog.map(product => [product.id, product.name]));
  const groups = new Map();
  let ignoredRows = 0;
  rows.forEach((row, index) => {
    if (row.every(value => value === "")) return;
    const type = String(row[2]).trim();
    const id = type === "Brother" ? fourDigits_(row[3]) : String(row[3] || "").trim();
    const tx = String(row[0] || "").trim();
    const date = achTimestamp_(row[1]);
    const productId = fourDigits_(row[6]);
    if (!["Brother", "Pledge"].includes(type) || !id || !tx || !productId || !Number.isFinite(date.getTime()) || !(Number(row[9]) > 0)) {
      ignoredRows += 1;
      return;
    }
    const key = achMemberKey_(type, id) + "|" + tx;
    if (!groups.has(key)) groups.set(key, { type, id, tx, date, index, items: new Map() });
    const order = groups.get(key);
    if (date < order.date) order.date = date;
    order.items.set(productId, String(row[7] || names.get(productId) || ""));
  });
  const members = new Map();
  [...groups.values()].sort((a, b) => a.date - b.date || a.index - b.index).forEach(order => {
    order.day = Utilities.formatDate(order.date, ACH_TIME_ZONE, "yyyy-MM-dd");
    order.dayNumber = Date.parse(order.day + "T00:00:00Z") / 86400000;
    order.week = order.dayNumber - new Date(order.dayNumber * 86400000).getUTCDay();
    order.eligible = [...order.items].filter(([id]) => !ACH_EXCLUDED_IDS.has(id)).map(([id]) => id).sort();
    const member = achMemberKey_(order.type, order.id);
    if (!members.has(member)) members.set(member, []);
    members.get(member).push(order);
  });
  return { members, ignoredRows };
}

// A valid purchase day counts even when every item is excluded from stars.
function achCurrentStreak_(orders, asOf) {
  const today = Utilities.formatDate(asOf || new Date(), ACH_TIME_ZONE, "yyyy-MM-dd");
  const todayNumber = Date.parse(today + "T00:00:00Z") / 86400000;
  const days = new Set((orders || []).map(order => order.dayNumber));
  let day = days.has(todayNumber) ? todayNumber : todayNumber - 1;
  let streak = 0;
  while (days.has(day)) {
    streak += 1;
    day -= 1;
  }
  return streak;
}

// Pure sequential evaluator: first qualifying order determines Earned At.
function achEvaluate_(orders, definitions) {
  const metrics = Object.fromEntries(ACH_DEFAULTS.map(row => [row[3], 0]));
  const days = new Set(), weeks = new Set(), months = new Set(), ids = new Set(), foods = new Set(), drinks = new Set();
  const productDays = new Map(), firstProductDay = new Map(), carts = new Map();
  const reached = new Set(), awards = [];
  let firstDay = null, previous = null;
  const candy = ["0005","0006","0007","0008","0009","0010","0011","0012","0013"];
  const sweet = ["0001","0004",...candy,"0018","0020","0021","0022","0023","0025","0028"];
  const savory = ["0002","0014","0015","0016","0017","0019","0024","0027","0030"];
  const powerades = ["0119","0120","0121","0129","0130","0131"];
  for (const order of orders) {
    if (!order.eligible.length) continue;
    const basket = new Set(order.eligible);
    const hasAny = choices => choices.some(id => basket.has(id));
    const historyCount = choices => choices.filter(id => ids.has(id)).length;
    if (firstDay === null) firstDay = order.dayNumber;
    days.add(order.day); weeks.add(order.week); months.add(order.day.slice(0, 7));
    let food = false, drink = false;
    for (const id of basket) {
      ids.add(id);
      if (id.startsWith("00")) { foods.add(id); food = true; }
      if (id.startsWith("01")) { drinks.add(id); drink = true; }
      if (!productDays.has(id)) productDays.set(id, new Set());
      productDays.get(id).add(order.day);
      metrics.repeat_product_days = Math.max(metrics.repeat_product_days, productDays.get(id).size);
      if (!firstProductDay.has(id)) firstProductDay.set(id, order.dayNumber);
      if (order.dayNumber - firstProductDay.get(id) >= 30) metrics.long_return = 1;
    }
    metrics.unique_orders += 1;
    metrics.distinct_days = days.size; metrics.distinct_weeks = weeks.size; metrics.distinct_months = months.size;
    metrics.distinct_products = ids.size; metrics.distinct_foods = foods.size; metrics.distinct_drinks = drinks.size;
    metrics.days_since_first_return = order.dayNumber - firstDay;
    if (food && drink) metrics.mixed_orders += 1;
    if (basket.size >= 3) {
      const signature = order.eligible.join("|");
      if (!carts.has(signature)) carts.set(signature, new Set());
      carts.get(signature).add(order.day);
      metrics.repeated_cart = Math.max(metrics.repeated_cart, Math.min(2, carts.get(signature).size));
    }
    if (basket.size >= 2) metrics.disjoint_carts = Math.max(1, metrics.disjoint_carts);
    if (previous && previous.day !== order.day && previous.eligible.length >= 2 && basket.size >= 2 &&
        !previous.eligible.some(id => basket.has(id))) metrics.disjoint_carts = 2;
    previous = order;
    // Same-order pairs: retain the best single basket, never combine separate orders.
    metrics.movie_combo = Math.max(metrics.movie_combo, Number(basket.has("0024")) + Number(hasAny(candy)));
    metrics.sweet_savory_combo = Math.max(metrics.sweet_savory_combo, Number(hasAny(sweet)) + Number(hasAny(savory)));
    metrics.breakfast_combo = Math.max(metrics.breakfast_combo, Number(basket.has("0025")) + Number(hasAny(["0111","0122","0123","0124","0125"])));
    metrics.regular_zero_pair = Math.max(historyCount(["0107","0109"]), historyCount(["0127","0132"]));
    metrics.cookie_set = historyCount(["0020","0021","0022","0023"]);
    metrics.noodle_pair = historyCount(["0016","0027"]);
    metrics.battery_purchase = Number(historyCount(["0201","0202"]) > 0);
    metrics.powerade_liquid_iv = Number(historyCount(powerades) > 0) + Number(ids.has("0112"));
    metrics.gum_purchase = Number(ids.has("0029"));
    for (const rule of definitions) {
      for (const milestone of rule.milestones) {
        const key = rule.id + ":" + milestone;
        if (metrics[rule.key] >= milestone && !reached.has(key)) {
          reached.add(key);
          awards.push([order.type, order.id, rule.id, milestone, order.date, order.tx, rule.stars]);
        }
      }
    }
  }
  return { metrics, awards };
}

function achAwardKey_(row) {
  return achMemberKey_(row[0], row[1]) + "|" + String(row[2]) + "|" + Number(row[3]);
}

function achResponseCache_() {
  try { return typeof CacheService === "undefined" ? null : CacheService.getScriptCache(); }
  catch (error) { return null; }
}

function achResponseCacheKey_(kind, type, id) {
  const day = Utilities.formatDate(new Date(), ACH_TIME_ZONE, "yyyy-MM-dd");
  return [ACH_RESPONSE_CACHE_VERSION, day, kind, type || "", id || ""].join(":");
}

function achCachedResponse_(key) {
  try {
    const value = achResponseCache_()?.get(key);
    return value ? JSON.parse(value) : null;
  } catch (error) { return null; }
}

function achStoreResponse_(key, value, seconds) {
  try { achResponseCache_()?.put(key, JSON.stringify(value), seconds); }
  catch (error) { /* A cache failure must not block checkout. */ }
}

function achInvalidateResponseCaches_(type, id) {
  try {
    const cache = achResponseCache_();
    const memberId = type === "Brother" ? fourDigits_(id) : String(id || "").trim();
    cache?.remove(achResponseCacheKey_("member", type, memberId));
    cache?.remove(achResponseCacheKey_("leaderboard"));
  } catch (error) { /* Orders remains the source of truth. */ }
}

function achLedger_(spreadsheet) {
  const sheet = achSheet_(spreadsheet, "Member Achievements", ACH_AWARD_HEADERS, false);
  return { sheet, rows: sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, ACH_AWARD_HEADERS.length).getValues() : [] };
}

function achAppendAwards_(spreadsheet, candidates) {
  if (!candidates.length) return 0;
  const lock = LockService.getScriptLock();
  // Heavy calculation is already finished before holding the checkout lock.
  if (!lock.tryLock(1000)) throw new Error("Stars are still syncing. Try again shortly.");
  try {
    const ledger = achLedger_(spreadsheet);
    const seen = new Set(ledger.rows.map(achAwardKey_));
    const fresh = candidates.filter(row => {
      const key = achAwardKey_(row);
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
    if (fresh.length) {
      ledger.sheet.getRange(ledger.sheet.getLastRow() + 1, 1, fresh.length, ACH_AWARD_HEADERS.length).setValues(fresh);
      SpreadsheetApp.flush();
    }
    return fresh.length;
  } finally { lock.releaseLock(); }
}

function getAchievements_(customerType, customerId, forceRefresh) {
  const type = String(customerType || "").trim();
  const id = type === "Brother" ? fourDigits_(customerId) : String(customerId || "").trim();
  if (!["Brother", "Pledge"].includes(type) || !id) throw new Error("Invalid customer.");
  const cacheKey = achResponseCacheKey_("member", type, id);
  if (!forceRefresh) {
    const cached = achCachedResponse_(cacheKey);
    if (cached) return cached;
  }
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const people = readBrothers_(requireSheet_(spreadsheet, SHEETS.brothers), false).concat(readPledges_(requireSheet_(spreadsheet, SHEETS.pledges), false));
  if (!people.some(person => person.type === type && person.id === id)) throw new Error("Customer is missing from the spreadsheet.");
  const rules = achDefinitions_(spreadsheet);
  const data = achData_(spreadsheet);
  const memberKey = achMemberKey_(type, id);
  const rows = data.rows.filter(row => achMemberKey_(row[2], row[3]) === memberKey);
  const grouped = achGroupOrders_(rows, data.catalog);
  const evaluated = achEvaluate_(grouped.members.get(memberKey) || [], rules);
  const existingLedger = achLedger_(spreadsheet).rows;
  const existingKeys = new Set(existingLedger.map(achAwardKey_));
  const missingAwards = evaluated.awards.filter(row => !existingKeys.has(achAwardKey_(row)));
  if (missingAwards.length) achAppendAwards_(spreadsheet, missingAwards);
  const ledger = (missingAwards.length ? achLedger_(spreadsheet).rows : existingLedger)
    .filter(row => achMemberKey_(row[0], row[1]) === memberKey);
  const awards = [...new Map(ledger.map(row => [achAwardKey_(row), row])).values()];
  const cards = rules.map(rule => {
    const earned = awards.filter(row => String(row[2]) === rule.id);
    const levels = rule.milestones.map(target => {
      const award = earned.find(row => Number(row[3]) === target);
      return { target, earned: Boolean(award), earnedAt: award ? achTimestamp_(award[4]).toISOString() : null };
    });
    return { ...rule, value: evaluated.metrics[rule.key], levels, earnedStars: earned.reduce((sum, row) => sum + Number(row[6]), 0) };
  });
  const result = {
    customerType: type, customerId: id, cards,
    // Existing stars remain earned even if a rule is later disabled.
    stars: awards.reduce((sum, row) => sum + Number(row[6]), 0),
    streak: achCurrentStreak_(grouped.members.get(memberKey)),
    availableStars: rules.reduce((sum, rule) => sum + rule.milestones.length * rule.stars, 0),
    updatedAt: new Date().toISOString(), ignoredRows: grouped.ignoredRows
  };
  achStoreResponse_(cacheKey, result, 75);
  return result;
}

// Read-only cart projection. It uses the same validator and rule evaluator as
// recorded orders, but never adds the imaginary transaction to a sheet.
function getAchievementPreview_(customerType, customerId, itemIds, transactionId) {
  const type = String(customerType || "").trim();
  const id = type === "Brother" ? fourDigits_(customerId) : String(customerId || "").trim();
  if (!["Brother", "Pledge"].includes(type) || !id) throw new Error("Invalid customer.");
  const ids = [...new Set(String(itemIds || "").split(",").map(value => value.trim()))];
  if (!ids.length || ids.length > 40 || ids.some(value => !/^\d{4}$/.test(value) && !ACH_EXCLUDED_IDS.has(value))) {
    throw new Error("Invalid cart items.");
  }
  const pendingTx = String(transactionId || "").trim();
  if (pendingTx && !/^TX-[A-Za-z0-9-]{1,100}$/.test(pendingTx)) throw new Error("Invalid transaction ID.");
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const people = readBrothers_(requireSheet_(spreadsheet, SHEETS.brothers), false)
    .concat(readPledges_(requireSheet_(spreadsheet, SHEETS.pledges), false));
  if (!people.some(person => person.type === type && person.id === id)) {
    throw new Error("Customer is missing from the spreadsheet.");
  }
  const definitions = achDefinitions_(spreadsheet);
  const data = achData_(spreadsheet);
  const catalog = new Map(data.catalog.map(product => [product.id, product]));
  if (ids.some(value => !catalog.has(value))) throw new Error("Cart contains an unknown item.");
  const memberKey = achMemberKey_(type, id);
  const rows = data.rows.filter(row => achMemberKey_(row[2], row[3]) === memberKey && String(row[0]).trim() !== pendingTx);
  const orders = achGroupOrders_(rows, data.catalog).members.get(memberKey) || [];
  const before = achEvaluate_(orders, definitions);
  const timestamp = new Date();
  const previewRows = ids.map(productId => [
    "PROJECTS-CART-PREVIEW", timestamp.toISOString(), type, id, "", "",
    productId, catalog.get(productId).name, 0, 1, 0, 0, "preview"
  ]);
  const projected = achGroupOrders_(previewRows, data.catalog).members.get(memberKey) || [];
  const after = achEvaluate_(orders.concat(projected).sort((left, right) => left.date - right.date || left.index - right.index), definitions);
  const changes = definitions.map(rule => {
    const current = before.metrics[rule.key] || 0;
    const next = after.metrics[rule.key] || 0;
    if (next <= current) return null;
    const target = rule.milestones.find(value => value > current) || rule.milestones[rule.milestones.length - 1];
    const earnedMilestones = rule.milestones.filter(value => current < value && next >= value);
    return {
      id: rule.id, name: rule.name, description: rule.description,
      before: current, after: next, target,
      earnedMilestones, starsEarned: earnedMilestones.length * rule.stars
    };
  }).filter(Boolean);
  return {
    customerType: type, customerId: id, itemIds: ids.sort(), transactionId: pendingTx, changes,
    starsEarned: changes.reduce((sum, change) => sum + change.starsEarned, 0),
    updatedAt: timestamp.toISOString()
  };
}

// Star totals for the active roster and pledge list, sorted highest first.
function getLeaderboard_(forceRefresh) {
  const cacheKey = achResponseCacheKey_("leaderboard");
  if (!forceRefresh) {
    const cached = achCachedResponse_(cacheKey);
    if (cached) return cached;
  }
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const people = readBrothers_(
    requireSheet_(spreadsheet, SHEETS.brothers)
  ).concat(
    readPledges_(requireSheet_(spreadsheet, SHEETS.pledges))
  );

  const totals = new Map();

  people.forEach(person => {
    totals.set(achMemberKey_(person.type, person.id), {
      name: person.name,
      type: person.type,
      id: person.id,
      stars: 0
    });
  });

  const ledgerRows = achLedger_(spreadsheet).rows;
  const recordedAwards = new Set(ledgerRows.map(achAwardKey_));
  ledgerRows.forEach(row => {
    const person = totals.get(achMemberKey_(row[0], row[1]));
    const stars = Number(row[6]);
    if (person && Number.isFinite(stars) && stars > 0) {
      person.stars += stars;
    }
  });

  const history = achData_(spreadsheet);
  const grouped = achGroupOrders_(history.rows, history.catalog);
  const rules = achDefinitions_(spreadsheet);
  const asOf = new Date();
  totals.forEach((person, key) => {
    const orders = grouped.members.get(key) || [];
    person.streak = achCurrentStreak_(orders, asOf);
    // Show newly earned historical levels immediately, even before the
    // award ledger's background backfill reaches this member.
    achEvaluate_(orders, rules).awards.forEach(award => {
      const awardKey = achAwardKey_(award);
      if (!recordedAwards.has(awardKey)) {
        person.stars += Number(award[6]) || 0;
      }
    });
  });

  const entries = [...totals.values()].sort((a, b) =>
    b.stars - a.stars || a.name.localeCompare(b.name)
  );

  const result = { entries, updatedAt: new Date().toISOString() };
  achStoreResponse_(cacheKey, result, 75);
  return result;
}

// Safe dry run: reports historical awards without writing any sheet.
function previewProjectsAchievements() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const rules = achDefinitions_(spreadsheet);
  const data = achData_(spreadsheet);
  const grouped = achGroupOrders_(data.rows, data.catalog);
  const existing = new Set(achLedger_(spreadsheet).rows.map(achAwardKey_));
  let newAwards = 0;
  grouped.members.forEach(orders => achEvaluate_(orders, rules).awards.forEach(row => {
    if (!existing.has(achAwardKey_(row))) newAwards += 1;
  }));
  const result = { members: grouped.members.size, newAwards, ignoredRows: grouped.ignoredRows, timeZone: ACH_TIME_ZONE };
  console.log(JSON.stringify(result));
  return result;
}

// Run repeatedly from the editor until the execution log says complete:true.
// Ten members per run keeps historical imports bounded; successful batches are resumable.
function backfillProjectsAchievements() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const rules = achDefinitions_(spreadsheet);
  const data = achData_(spreadsheet);
  const grouped = achGroupOrders_(data.rows, data.catalog);
  const properties = PropertiesService.getScriptProperties();
  const cursor = properties.getProperty(ACH_BACKFILL_CURSOR) || "";
  const keys = [...grouped.members.keys()].sort().filter(key => key > cursor);
  const batch = keys.slice(0, 10);
  const candidates = batch.flatMap(key => achEvaluate_(grouped.members.get(key), rules).awards);
  const added = achAppendAwards_(spreadsheet, candidates);
  const complete = keys.length <= batch.length;
  if (complete) properties.deleteProperty(ACH_BACKFILL_CURSOR);
  else properties.setProperty(ACH_BACKFILL_CURSOR, batch[batch.length - 1]);
  const result = { complete, membersProcessed: batch.length, membersRemaining: keys.length - batch.length, awardsAdded: added, ignoredRows: grouped.ignoredRows };
  console.log(JSON.stringify(result));
  return result;
}

// Optional background reconciliation also catches manually pasted orders.
// Install once from the editor; rerunning does not install duplicates.
function installProjectsAchievementTrigger() {
  if (!ScriptApp.getProjectTriggers().some(trigger => trigger.getHandlerFunction() === "backfillProjectsAchievements")) {
    ScriptApp.newTrigger("backfillProjectsAchievements").timeBased().everyMinutes(15).create();
  }
}
