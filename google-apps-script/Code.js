const SHEETS = {
  brothers: "Brothers",
  pledges: "Pledges",
  products: "Products",
  orders: "Orders",
  skins: "Skins"
};

const ORDER_HEADERS = [
  "Transaction ID", "Timestamp", "Customer Type", "Customer ID",
  "Last Name", "First Name", "Item ID", "Item Name", "Unit Cost",
  "Quantity", "Line Total", "Order Total", "Device ID"
];

const SKIN_HEADERS = [
  "Customer Type", "Customer ID", "Name", "Theta Chi", "Forest", "Ocean", "Sunset"
];
const SKIN_COLUMN_IDS = [null, "SKIN-FOREST", "SKIN-OCEAN", "SKIN-SUNSET"];

// Virtual catalog items use the existing Orders columns and checkout queue.
// Their fixed prices are checked again when the transaction reaches Apps Script.
const SKIN_PRODUCTS = [
  { id: "SKIN-OCEAN", name: "Ocean Skin", price: 1.00, category: "Skins" },
  { id: "SKIN-FOREST", name: "Forest Skin", price: 0.50, category: "Skins" },
  { id: "SKIN-SUNSET", name: "Sunset Skin", price: 5.00, category: "Skins" }
];

function doGet(e) {
  try {
    const parameters = e && e.parameter ? e.parameter : {};
    const action = String(parameters.action || "health");

    if (action === "bootstrap") {
      return json_({ ok: true, data: getBootstrap_() });
    }

    if (action === "achievements") {
      return json_({
        ok: true,
        data: getAchievements_(
          parameters.customerType,
          parameters.customerId,
          parameters.refresh === "1"
        )
      });
    }

    if (action === "achievementPreview") {
      return json_({
        ok: true,
        data: getAchievementPreview_(
          parameters.customerType,
          parameters.customerId,
          parameters.itemIds,
          parameters.transactionId
        )
      });
    }

    if (action === "leaderboard") {
      return json_({ ok: true, data: getLeaderboard_(parameters.refresh === "1") });
    }

    if (action === "recents") {
      return json_({
        ok: true,
        data: getRecents_(
          parameters.customerType,
          parameters.customerId
        )
      });
    }

    if (action === "skinInventory") {
      return json_({
        ok: true,
        data: getSkinInventory_(parameters.customerType, parameters.customerId)
      });
    }

    return json_({
      ok: true,
      service: "Theta Chi Projects backend"
    });
  } catch (error) {
    logError_(error);
    return json_({ ok: false, error: error.message });
  }
}

function doPost(e) {
  try {
    const request = JSON.parse(e.postData.contents || "{}");
    if (request.action !== "recordTransaction") {
      throw new Error("Unknown action.");
    }
    return json_(recordTransaction_(request.transaction));
  } catch (error) {
    logError_(error);
    return json_({ ok: false, error: error.message });
  }
}

function setupProjectsBackend() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  requireSheet_(spreadsheet, SHEETS.brothers);
  requireSheet_(spreadsheet, SHEETS.pledges);
  requireSheet_(spreadsheet, SHEETS.products);

  const orders =
    spreadsheet.getSheetByName(SHEETS.orders) ||
    spreadsheet.insertSheet(SHEETS.orders);

  if (orders.getLastRow() === 0) {
    orders
      .getRange(1, 1, 1, ORDER_HEADERS.length)
      .setValues([ORDER_HEADERS]);
  }

  orders.setFrozenRows(1);
  orders.getRange("B:B").setNumberFormat("yyyy-mm-dd hh:mm:ss");
  orders.getRange("I:L").setNumberFormat("$0.00");

  syncProjectsSkins_(spreadsheet);

  return "Projects backend setup complete.";
}

function getBootstrap_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const members = readBrothers_(requireSheet_(spreadsheet, SHEETS.brothers));
  const pledges = readPledges_(requireSheet_(spreadsheet, SHEETS.pledges));
  try {
    syncProjectsSkins_(spreadsheet);
  } catch (error) {
    logError_(error);
  }

  return {
    members,
    pledges,
    products: readProducts_(
      requireSheet_(spreadsheet, SHEETS.products)
    )
  };
}

function getRecents_(customerType, customerId) {
  const type = String(customerType || "").trim();
  const suppliedId = String(customerId || "").trim();

  if (!["Brother", "Pledge"].includes(type) || !suppliedId) {
    throw new Error("Invalid customer.");
  }

  const id =
    type === "Brother" ? fourDigits_(suppliedId) : suppliedId;

  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

  const people = readBrothers_(
    requireSheet_(spreadsheet, SHEETS.brothers),
    false
  ).concat(
    readPledges_(
      requireSheet_(spreadsheet, SHEETS.pledges),
      false
    )
  );

  const customerExists = people.some(person =>
    person.type === type && person.id === id
  );

  if (!customerExists) {
    throw new Error("Customer is missing from the spreadsheet.");
  }

  const activeProducts = readProducts_(
    requireSheet_(spreadsheet, SHEETS.products),
    true
  );

  const activeProductIds = new Set(
    activeProducts.map(product => product.id)
  );

  const orders = requireSheet_(spreadsheet, SHEETS.orders);

  if (orders.getLastRow() < 2) {
    return { productIds: [] };
  }

  // Read columns B through G:
  // Timestamp, Customer Type, Customer ID, Last Name,
  // First Name, Item ID
  const rows = orders
    .getRange(2, 2, orders.getLastRow() - 1, 6)
    .getValues();

  rows.sort((left, right) => {
    const leftTime = new Date(left[0]).getTime() || 0;
    const rightTime = new Date(right[0]).getTime() || 0;
    return rightTime - leftTime;
  });

  const productIds = [];
  const seen = new Set();
  const maximumRecentProducts = 18;

  for (const row of rows) {
    const rowType = String(row[1] || "").trim();
    const rowId =
      rowType === "Brother"
        ? fourDigits_(row[2])
        : String(row[2] || "").trim();

    if (rowType !== type || rowId !== id) continue;

    const productId = fourDigits_(row[5]);

    if (
      productId &&
      activeProductIds.has(productId) &&
      !seen.has(productId)
    ) {
      seen.add(productId);
      productIds.push(productId);
    }

    if (productIds.length >= maximumRecentProducts) break;
  }

  return { productIds };
}

function getSkinInventory_(customerType, customerId) {
  const type = String(customerType || "").trim();
  const id = type === "Brother" ? fourDigits_(customerId) : String(customerId || "").trim();
  if (!["Brother", "Pledge"].includes(type) || !id) throw new Error("Invalid customer.");
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const people = readBrothers_(requireSheet_(spreadsheet, SHEETS.brothers), false)
    .concat(readPledges_(requireSheet_(spreadsheet, SHEETS.pledges), false));
  if (!people.some(person => person.type === type && person.id === id)) {
    throw new Error("Customer is missing from the spreadsheet.");
  }
  const orders = requireSheet_(spreadsheet, SHEETS.orders);
  const owned = new Set();
  const skins = skinSheet_(spreadsheet, false);
  if (skins && skins.getLastRow() > 1) {
    skins.getRange(2, 1, skins.getLastRow() - 1, SKIN_HEADERS.length)
      .getValues().forEach(row => {
        const rowType = String(row[0] || "").trim();
        const rowId = rowType === "Brother" ? fourDigits_(row[1]) : String(row[1] || "").trim();
        if (rowType === type && rowId === id) {
          SKIN_COLUMN_IDS.slice(1).forEach((itemId, index) => {
            if (Number(row[index + 4]) === 1) owned.add(itemId);
          });
        }
      });
  }
  if (orders.getLastRow() > 1) {
    // C through J: customer type and ID, item ID, and quantity.
    orders.getRange(2, 3, orders.getLastRow() - 1, 8).getValues().forEach(row => {
      const rowType = String(row[0] || "").trim();
      const rowId = rowType === "Brother" ? fourDigits_(row[1]) : String(row[1] || "").trim();
      const itemId = String(row[4] || "").trim();
      if (rowType === type && rowId === id && Number(row[7]) > 0 &&
          SKIN_PRODUCTS.some(product => product.id === itemId)) owned.add(itemId);
    });
  }
  return { customerType: type, customerId: id, itemIds: [...owned] };
}

function skinSheet_(spreadsheet, create) {
  let sheet = spreadsheet.getSheetByName(SHEETS.skins);
  if (!sheet && create) sheet = spreadsheet.insertSheet(SHEETS.skins);
  if (!sheet) return null;
  if (sheet.getLastRow() === 0 && !create) return null;
  if (sheet.getLastRow() === 0 && create) {
    sheet.getRange(1, 1, 1, SKIN_HEADERS.length).setValues([SKIN_HEADERS]);
  }
  const headers = sheet.getRange(1, 1, 1, SKIN_HEADERS.length).getValues()[0];
  if (headers.some((value, index) => String(value).trim() !== SKIN_HEADERS[index])) {
    throw new Error("Skins headers must be: " + SKIN_HEADERS.join(" | "));
  }
  return sheet;
}

function skinMemberKey_(type, id) {
  const memberType = String(type || "").trim();
  return memberType + ":" + (memberType === "Brother" ? fourDigits_(id) : String(id || "").trim());
}

// Rebuild from the current roster and paid Orders. Existing 1s also allow free
// administrative grants; a paid purchase can never be cleared by editing the tab.
function syncProjectsSkins_(spreadsheet) {
  const sheet = skinSheet_(spreadsheet, true);
  const existing = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, SKIN_HEADERS.length).getValues()
    : [];
  const unlocked = new Map();
  existing.forEach(row => {
    const key = skinMemberKey_(row[0], row[1]);
    if (!key || key === ":") return;
    unlocked.set(key, new Set(SKIN_COLUMN_IDS.slice(1).filter((id, index) => Number(row[index + 4]) === 1)));
  });

  const orders = requireSheet_(spreadsheet, SHEETS.orders);
  if (orders.getLastRow() > 1) {
    // C:J contains member type, ID, item ID, and quantity.
    orders.getRange(2, 3, orders.getLastRow() - 1, 8).getValues().forEach(row => {
      const id = String(row[4] || "").trim();
      if (!SKIN_COLUMN_IDS.includes(id) || Number(row[7]) <= 0) return;
      const key = skinMemberKey_(row[0], row[1]);
      if (!unlocked.has(key)) unlocked.set(key, new Set());
      unlocked.get(key).add(id);
    });
  }

  const brothers = readBrothers_(requireSheet_(spreadsheet, SHEETS.brothers), false)
    .sort((a, b) => Number(a.id) - Number(b.id) || a.id.localeCompare(b.id));
  const pledges = readPledges_(requireSheet_(spreadsheet, SHEETS.pledges), false)
    .sort((a, b) => a.lastName.localeCompare(b.lastName) ||
      a.firstName.localeCompare(b.firstName) || a.id.localeCompare(b.id));
  const rows = brothers.concat(pledges).map(person => {
    const owned = unlocked.get(skinMemberKey_(person.type, person.id)) || new Set();
    return [person.type, person.id, person.name, 1, ...SKIN_COLUMN_IDS.slice(1).map(id => owned.has(id) ? 1 : 0)];
  });

  const oldCount = Math.max(0, sheet.getLastRow() - 1);
  if (rows.length) sheet.getRange(2, 1, rows.length, SKIN_HEADERS.length).setValues(rows);
  if (oldCount > rows.length) {
    sheet.getRange(rows.length + 2, 1, oldCount - rows.length, SKIN_HEADERS.length).clearContent();
  }
  sheet.setFrozenRows(1);
  sheet.getRange("B:B").setNumberFormat("@");
  return { brothers: brothers.length, pledges: pledges.length, rows: rows.length };
}

function syncProjectsSkins() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const result = syncProjectsSkins_(SpreadsheetApp.getActiveSpreadsheet());
    console.log(JSON.stringify(result));
    return result;
  } finally {
    lock.releaseLock();
  }
}

function onEdit(e) {
  if (!e || !e.range || !e.source) return;
  const name = e.range.getSheet().getName();
  if (name === SHEETS.brothers || name === SHEETS.pledges) {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(1000)) return;
    try {
      syncProjectsSkins_(e.source);
    } finally {
      lock.releaseLock();
    }
  }
}

function readBrothers_(sheet, activeOnly) {
  const requireActive = activeOnly !== false;

  return rowsAsObjects_(sheet)
    .filter(row => !requireActive || isActive_(row))
    .map(row => ({
      id: fourDigits_(
        pick_(row, ["Roster #", "Roster", "Roster Number"])
      ),
      type: "Brother",
      firstName: String(pick_(row, ["First Name"]) || "").trim(),
      lastName: String(pick_(row, ["Last Name"]) || "").trim()
    }))
    .filter(person =>
      person.id && person.firstName && person.lastName
    )
    .map(finishPerson_);
}

function readPledges_(sheet, activeOnly) {
  const requireActive = activeOnly !== false;

  return rowsAsObjects_(sheet)
    .filter(row => !requireActive || isActive_(row))
    .map(row => {
      const firstName =
        String(pick_(row, ["First Name"]) || "").trim();
      const lastName =
        String(pick_(row, ["Last Name"]) || "").trim();
      const suppliedId =
        String(pick_(row, ["Pledge ID", "ID"]) || "").trim();

      return {
        id:
          suppliedId ||
          `P-${shortHash_(
            `${firstName}|${lastName}`.toLowerCase()
          )}`,
        type: "Pledge",
        firstName,
        lastName,
        status: "Active"
      };
    })
    .filter(person => person.firstName && person.lastName)
    .map(finishPerson_);
}

function readProducts_(sheet, activeOnly) {
  const requireActive = activeOnly !== false;

  return rowsAsObjects_(sheet)
    .filter(row => !requireActive || isActive_(row))
    .map(row => {
      const id = fourDigits_(pick_(row, ["Item ID", "ID"]));

      return {
        id,
        name: String(
          pick_(row, ["Item Name", "Name"]) || ""
        ).trim(),
        price: Number(
          pick_(row, ["Cost Per", "Price", "Cost"])
        ),
        category: productCategory_(
          id,
          pick_(row, ["Category"])
        ),
        group: String(
          pick_(row, [
            "Product Group",
            "Group",
            "Parent Product"
          ]) || ""
        ).trim(),
        flavor: String(
          pick_(row, ["Flavor", "Variant"]) || ""
        ).trim(),
        image: String(
          pick_(row, ["Image", "Image URL", "Image Path"]) || ""
        ).trim()
      };
    })
    .filter(product =>
      product.id &&
      product.name &&
      Number.isFinite(product.price)
    );
}

function productCategory_(id, sheetCategory) {
  const idPrefix = fourDigits_(id).slice(0, 2);

  if (idPrefix === "00") return "Food";
  if (idPrefix === "01") return "Drinks";
  if (idPrefix === "02") return "Other";

  const category =
    String(sheetCategory || "").trim().toLowerCase();

  if (
    [
      "drink",
      "drinks",
      "beverage",
      "beverages",
      "protein drink",
      "energy drink"
    ].includes(category)
  ) {
    return "Drinks";
  }

  if (
    ["other", "others", "misc", "miscellaneous"].includes(category)
  ) {
    return "Other";
  }

  return "Food";
}

function recordTransaction_(transaction) {
  validateTransactionShape_(transaction);

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const orders = spreadsheet.getSheetByName(SHEETS.orders);

    if (!orders) {
      throw new Error(
        "Run setupProjectsBackend once before accepting purchases."
      );
    }

    if (transactionExists_(orders, transaction.transactionId)) {
      achInvalidateResponseCaches_(transaction.member.type, transaction.member.id);
      try {
        syncProjectsSkins_(spreadsheet);
      } catch (error) {
        logError_(error);
      }
      return {
        ok: true,
        duplicate: true,
        transactionId: transaction.transactionId
      };
    }

    const people = readBrothers_(
      requireSheet_(spreadsheet, SHEETS.brothers),
      false
    ).concat(
      readPledges_(
        requireSheet_(spreadsheet, SHEETS.pledges),
        false
      )
    );

    const person = people.find(
      item =>
        item.id === String(transaction.member.id) &&
        item.type === transaction.member.type
    );

    if (!person) {
      throw new Error("Customer is missing from the spreadsheet.");
    }

    const allProducts = readProducts_(
      requireSheet_(spreadsheet, SHEETS.products),
      false
    ).concat(SKIN_PRODUCTS);

    const productById = Object.fromEntries(
      allProducts.map(product => [product.id, product])
    );

    const seenSkinIds = new Set();
    const cleanItems = transaction.items.map(item => {
      const product = productById[fourDigits_(item.id)];
      const quantity = Number(item.quantity);
      const purchasePrice = Number(item.price);

      if (
        !product ||
        !Number.isInteger(quantity) ||
        quantity < 1 ||
        quantity > 50 ||
        !Number.isFinite(purchasePrice) ||
        purchasePrice < 0 ||
        purchasePrice > 100
      ) {
        throw new Error(
          "A product is missing or has an invalid price or quantity."
        );
      }

      if (product.id.startsWith("SKIN-") &&
          (quantity !== 1 || purchasePrice !== product.price)) {
        throw new Error("A skin has an invalid price or quantity.");
      }
      if (product.id.startsWith("SKIN-")) {
        if (seenSkinIds.has(product.id)) throw new Error("A skin can only be purchased once per order.");
        seenSkinIds.add(product.id);
      }

      return {
        ...product,
        price: purchasePrice,
        quantity,
        lineTotal: roundMoney_(purchasePrice * quantity)
      };
    });

    if (seenSkinIds.size) {
      const inventory = getSkinInventory_(person.type, person.id);
      if (inventory.itemIds.some(id => seenSkinIds.has(id))) {
        throw new Error("This member already owns a skin in the cart.");
      }
    }

    const orderTotal = roundMoney_(
      cleanItems.reduce(
        (sum, item) => sum + item.lineTotal,
        0
      )
    );

    const timestamp = new Date();
    const rows = cleanItems.map(item => [
      transaction.transactionId,
      timestamp,
      person.type,
      person.id,
      person.lastName,
      person.firstName,
      item.id,
      item.name,
      item.price,
      item.quantity,
      item.lineTotal,
      orderTotal,
      String(transaction.deviceId || "")
    ]);

    orders
      .getRange(
        orders.getLastRow() + 1,
        1,
        rows.length,
        ORDER_HEADERS.length
      )
      .setValues(rows);

    SpreadsheetApp.flush();
    achInvalidateResponseCaches_(person.type, person.id);

    if (seenSkinIds.size) {
      try {
        syncProjectsSkins_(spreadsheet);
      } catch (error) {
        // Orders is the durable charge and ownership record. A later sync repairs
        // the display tab without reporting a successful charge as a failed sale.
        logError_(error);
      }
    }

    return {
      ok: true,
      duplicate: false,
      transactionId: transaction.transactionId,
      total: orderTotal
    };
  } finally {
    lock.releaseLock();
  }
}

function validateTransactionShape_(transaction) {
  if (!transaction || typeof transaction !== "object") {
    throw new Error("Missing transaction.");
  }

  if (
    !/^TX-[A-Za-z0-9-]{8,}$/.test(
      String(transaction.transactionId || "")
    )
  ) {
    throw new Error("Invalid transaction ID.");
  }

  if (
    !transaction.member ||
    !["Brother", "Pledge"].includes(transaction.member.type)
  ) {
    throw new Error("Invalid customer.");
  }

  if (
    !Array.isArray(transaction.items) ||
    transaction.items.length < 1 ||
    transaction.items.length > 40
  ) {
    throw new Error("Invalid items.");
  }
}

function transactionExists_(orders, transactionId) {
  if (orders.getLastRow() < 2) return false;

  return orders
    .getRange(2, 1, orders.getLastRow() - 1, 1)
    .createTextFinder(String(transactionId))
    .matchEntireCell(true)
    .findNext() !== null;
}

function rowsAsObjects_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const headers = values[0].map(value => String(value).trim());

  return values.slice(1).map(valuesRow =>
    Object.fromEntries(
      headers.map((header, index) => [
        header,
        valuesRow[index]
      ])
    )
  );
}

function isActive_(row) {
  return String(pick_(row, ["Status"]) || "")
    .trim()
    .toLowerCase() === "active";
}

function pick_(row, names) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(row, name)) {
      return row[name];
    }
  }
  return "";
}

function finishPerson_(person) {
  return {
    ...person,
    name: `${person.firstName} ${person.lastName}`,
    initials:
      `${person.firstName.charAt(0)}${person.lastName.charAt(0)}`
  };
}

function fourDigits_(value) {
  const text = String(value == null ? "" : value).trim();
  return /^\d+$/.test(text) ? text.padStart(4, "0") : text;
}

function shortHash_(text) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    text
  );

  return bytes
    .slice(0, 4)
    .map(value => (value + 256) % 256)
    .map(value => value.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

function roundMoney_(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function requireSheet_(spreadsheet, name) {
  const sheet = spreadsheet.getSheetByName(name);

  if (!sheet) {
    throw new Error(`Missing required sheet: ${name}`);
  }

  return sheet;
}

function json_(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function logError_(error) {
  console.error(error && error.stack ? error.stack : error);
}
