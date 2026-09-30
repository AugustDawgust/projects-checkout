const ProjectsBackend = (() => {
  const PENDING_KEY = "projectsPendingTransactions";
  const COMPLETED_KEY = "projectsCompletedTransactions";
  const DEVICE_KEY = "projectsDeviceId";
  const RECENTS_KEY = "projectsRecentProducts";
  const LEADERBOARD_CACHE_KEY = "projectsLeaderboardCacheV4";

  const RECENTS_CACHE_TIME = 5 * 60 * 1000;
  const LEADERBOARD_CACHE_TIME = 15 * 60 * 1000;
  const MAX_RECENT_PRODUCTS = 18;

  let syncInFlight = null;
  const recentsInFlight = new Map();

  function readJson(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  }

  function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function endpoint() {
    return String(
      window.PROJECTS_CONFIG?.appsScriptUrl || ""
    ).trim();
  }

  async function fetchWithTimeout(
    url,
    options = {},
    timeoutMs = 10000
  ) {
    const controller =
      typeof AbortController === "function"
        ? new AbortController()
        : null;

    const timer = window.setTimeout(
      () => controller?.abort(),
      timeoutMs
    );

    try {
      return await fetch(url, {
        ...options,
        ...(controller ? { signal: controller.signal } : {})
      });
    } finally {
      window.clearTimeout(timer);
    }
  }

  function isConfigured() {
    if (isLocalTestMode()) return false;

    return /^https:\/\/script\.google\.com\/macros\/s\//.test(
      endpoint()
    );
  }

  function isLocalTestMode() {
    return window.PROJECTS_CONFIG?.useLocalTestData === true;
  }

  function deviceId() {
    let value = localStorage.getItem(DEVICE_KEY);

    if (!value) {
      value =
        window.crypto?.randomUUID?.() ||
        `device-${Date.now()}-${Math.random()
          .toString(16)
          .slice(2)}`;

      localStorage.setItem(DEVICE_KEY, value);
    }

    return value;
  }

  function pendingTransactions() {
    return readJson(PENDING_KEY, []);
  }

  function completedTransactions() {
    return readJson(COMPLETED_KEY, []);
  }

  function enqueue(transaction) {
    const pending = pendingTransactions();

    if (
      !pending.some(
        item => item.transactionId === transaction.transactionId
      )
    ) {
      pending.push(transaction);
      writeJson(PENDING_KEY, pending);
    }
  }

  function markCompleted(transaction, serverResult) {
    writeJson(
      PENDING_KEY,
      pendingTransactions().filter(
        item =>
          item.transactionId !== transaction.transactionId
      )
    );

    const completed = completedTransactions();

    if (
      !completed.some(
        item => item.transactionId === transaction.transactionId
      )
    ) {
      completed.push({
        ...transaction,
        serverResult
      });

      writeJson(
        COMPLETED_KEY,
        completed.slice(-250)
      );
    }
  }

  function memberCacheKey(member) {
    if (!member?.type || !member?.id) return "";

    return `${String(member.type)}:${String(member.id)}`;
  }

  function normalizeProductId(value) {
    const text = String(value ?? "").trim();

    return /^\d+$/.test(text)
      ? text.padStart(4, "0")
      : text;
  }

  function recentProductsCache() {
    return readJson(RECENTS_KEY, {});
  }

  function getCachedRecents(member) {
    const key = memberCacheKey(member);

    if (!key) {
      return {
        productIds: [],
        updatedAt: 0
      };
    }

    const entry = recentProductsCache()[key];

    if (!entry || !Array.isArray(entry.productIds)) {
      return {
        productIds: [],
        updatedAt: 0
      };
    }

    return {
      productIds: entry.productIds
        .map(normalizeProductId)
        .filter(Boolean),
      updatedAt: Number(entry.updatedAt) || 0
    };
  }

  function storeRecentProducts(member, productIds) {
    const key = memberCacheKey(member);

    if (!key) return;

    const uniqueIds = [];

    productIds
      .map(normalizeProductId)
      .filter(Boolean)
      .forEach(productId => {
        if (!uniqueIds.includes(productId)) {
          uniqueIds.push(productId);
        }
      });

    const cache = recentProductsCache();

    cache[key] = {
      productIds: uniqueIds.slice(
        0,
        MAX_RECENT_PRODUCTS
      ),
      updatedAt: Date.now()
    };

    writeJson(RECENTS_KEY, cache);
  }

  function rememberRecentItems(member, items) {
    if (!member || !Array.isArray(items)) return;

    const newProductIds = items
      .map(item => normalizeProductId(item.id))
      .filter(id => id && !id.startsWith("SKIN-"));

    const existingProductIds =
      getCachedRecents(member).productIds;

    storeRecentProducts(member, [
      ...newProductIds,
      ...existingProductIds
    ]);
  }

  async function postTransaction(transaction) {
    const response = await fetchWithTimeout(endpoint(), {
      method: "POST",
      redirect: "follow",
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },
      body: JSON.stringify({
        action: "recordTransaction",
        transaction
      })
    });

    if (!response.ok) {
      throw new Error(
        `Backend returned ${response.status}`
      );
    }

    const result = await response.json();

    if (!result.ok) {
      throw new Error(
        result.error ||
        "The spreadsheet rejected this purchase."
      );
    }

    return result;
  }

  /*
   * This function deliberately returns immediately.
   *
   * The transaction has already been saved in localStorage,
   * so the success screen can appear without waiting for
   * Google Apps Script.
   */
  async function saveTransaction(transaction) {
    const withDevice = {
      ...transaction,
      deviceId: deviceId()
    };

    // Immediately update this customer's local Recents list.
    // Recents is only a convenience cache; a cache failure must not stop
    // an order already saved in the durable queue from syncing.
    try {
      rememberRecentItems(withDevice.member, withDevice.items);
    } catch (error) {
      console.warn("Could not update Recents cache:", error);
    }

    if (isLocalTestMode()) {
      // Keep test purchases in browser history without adding them to the
      // queue that is uploaded when live mode is enabled.
      markCompleted(withDevice, { localOnly: true });
      return {
        synced: false,
        queued: false,
        localOnly: true,
        reason: "Local test mode is enabled."
      };
    }

    // Save locally before doing any network work.
    enqueue(withDevice);

    if (!isConfigured()) {
      return {
        synced: false,
        queued: true,
        localOnly: true,
        reason: "Backend URL is not configured."
      };
    }

    // Begin syncing after the UI is allowed to continue.
    window.setTimeout(() => {
      void syncPending();
    }, 0);

    return {
      synced: false,
      queued: true,
      background: true,
      reason: "Order saved and syncing automatically."
    };
  }

  async function syncPending() {
    if (syncInFlight) {
      return syncInFlight;
    }

    const run = (async () => {
      if (!isConfigured()) {
        return {
          synced: 0,
          remaining: pendingTransactions().length
        };
      }

      let synced = 0;
      const syncedTransactions = [];

      for (const transaction of pendingTransactions()) {
        try {
          const result =
            await postTransaction(transaction);

          markCompleted(transaction, result);
          synced += 1;
          syncedTransactions.push(transaction);
        } catch (error) {
          console.error(
            "Projects transaction sync failed:",
            error
          );

          // Leave the transaction in the durable queue.
        }
      }

      if (syncedTransactions.length) {
        window.dispatchEvent(
          new CustomEvent("projects:orders-synced", {
            detail: syncedTransactions.map(transaction => ({
              member: transaction.member,
              transactionId: transaction.transactionId
            }))
          })
        );
      }

      return {
        synced,
        remaining: pendingTransactions().length
      };
    })();

    syncInFlight = run;

    try {
      return await run;
    } finally {
      if (syncInFlight === run) {
        syncInFlight = null;
      }
    }
  }

  async function loadBootstrap() {
    if (!isConfigured()) return null;

    const url = new URL(endpoint());

    url.searchParams.set("action", "bootstrap");
    url.searchParams.set("t", Date.now().toString());

    const response = await fetchWithTimeout(url, {
      redirect: "follow",
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(
        `Backend returned ${response.status}`
      );
    }

    const result = await response.json();

    if (!result.ok) {
      throw new Error(
        result.error ||
        "Could not load Projects data."
      );
    }

    return result.data;
  }

  function getCachedLeaderboard() {
    const cached = readJson(LEADERBOARD_CACHE_KEY, null);
    const entries = cached?.data?.entries;
    if (!Array.isArray(entries) ||
        !entries.every(person => Number.isInteger(person.streak) && person.streak >= 0) ||
        !Number.isFinite(Number(cached.savedAt))) return null;
    const day = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric", month: "2-digit", day: "2-digit"
    });
    return day.format(new Date(cached.savedAt)) === day.format(new Date())
      ? cached
      : null;
  }

  async function loadLeaderboard(options = {}) {
    if (!isConfigured()) {
      throw new Error(
        "Backend URL is not configured."
      );
    }

    const cached = getCachedLeaderboard();

    const cacheIsFresh =
      !options.force &&
      cached?.data &&
      Number(cached.savedAt) > 0 &&
      Date.now() - Number(cached.savedAt) <
        LEADERBOARD_CACHE_TIME;

    if (cacheIsFresh) {
      return cached.data;
    }

    const url = new URL(endpoint());

    url.searchParams.set("action", "leaderboard");
    url.searchParams.set("t", Date.now().toString());

    const response = await fetchWithTimeout(url, {
      redirect: "follow",
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(
        `Backend returned ${response.status}`
      );
    }

    const result = await response.json();

    if (!result.ok) {
      throw new Error(
        result.error ||
        "Could not load the leaderboard."
      );
    }

    if (Array.isArray(result.data?.entries) &&
        result.data.entries.every(person => Number.isInteger(person.streak) && person.streak >= 0)) {
      writeJson(LEADERBOARD_CACHE_KEY, {
        savedAt: Date.now(),
        data: result.data
      });
    }

    return result.data;
  }

  async function requestFreshRecents(member) {
    const url = new URL(endpoint());

    url.searchParams.set("action", "recents");
    url.searchParams.set(
      "customerType",
      String(member.type)
    );
    url.searchParams.set(
      "customerId",
      String(member.id)
    );
    url.searchParams.set("t", Date.now().toString());

    const response = await fetchWithTimeout(url, {
      redirect: "follow",
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(
        `Backend returned ${response.status}`
      );
    }

    const result = await response.json();

    if (!result.ok) {
      throw new Error(
        result.error ||
        "Could not load recent purchases."
      );
    }

    const data = result.data || {
      productIds: []
    };

    storeRecentProducts(
      member,
      Array.isArray(data.productIds)
        ? data.productIds
        : []
    );

    return {
      productIds: getCachedRecents(member).productIds
    };
  }

  async function loadRecents(
    member,
    options = {}
  ) {
    if (!member?.type || !member?.id) {
      throw new Error(
        "A customer is required to load recent purchases."
      );
    }

    const cached = getCachedRecents(member);

    if (!isConfigured()) {
      return {
        productIds: cached.productIds
      };
    }

    const cacheIsFresh =
      !options.force &&
      cached.updatedAt > 0 &&
      Date.now() - cached.updatedAt <
        RECENTS_CACHE_TIME;

    if (cacheIsFresh) {
      return {
        productIds: cached.productIds
      };
    }

    const key = memberCacheKey(member);

    // Reuse a request that already began on the
    // identity-confirmation screen.
    if (recentsInFlight.has(key)) {
      return recentsInFlight.get(key);
    }

    const request = requestFreshRecents(member)
      .catch(error => {
        // If fresh data fails, keep using the cached list.
        if (cached.productIds.length > 0) {
          console.warn(
            "Using cached recent purchases:",
            error
          );

          return {
            productIds: cached.productIds
          };
        }

        throw error;
      })
      .finally(() => {
        recentsInFlight.delete(key);
      });

    recentsInFlight.set(key, request);

    return request;
  }

  async function loadOwnedSkins(member) {
    if (!member?.type || !member?.id || !isConfigured()) {
      throw new Error("A live customer and backend are required to check skin ownership.");
    }
    const url = new URL(endpoint());
    url.searchParams.set("action", "skinInventory");
    url.searchParams.set("customerType", String(member.type));
    url.searchParams.set("customerId", String(member.id));
    url.searchParams.set("t", Date.now().toString());
    const response = await fetchWithTimeout(url, { redirect: "follow", cache: "no-store" });
    if (!response.ok) throw new Error(`Backend returned ${response.status}`);
    const result = await response.json();
    if (!result.ok || !Array.isArray(result.data?.itemIds)) {
      throw new Error(result.error || "Could not verify skin purchases. Deploy the updated Apps Script.");
    }
    if (result.data.customerType !== member.type ||
        String(result.data.customerId) !== normalizeProductId(member.id)) {
      throw new Error("Skin ownership customer mismatch.");
    }
    return result.data.itemIds;
  }

  function allLocalTransactions() {
    return {
      pending: pendingTransactions(),
      completed: completedTransactions()
    };
  }

  function clearLocalTransactions() {
    localStorage.removeItem(PENDING_KEY);
    localStorage.removeItem(COMPLETED_KEY);
  }

  // Retry when the tablet regains internet access.
  window.addEventListener("online", () => {
    void syncPending();
  });

  window.addEventListener("projects:orders-synced", () => {
    localStorage.removeItem(LEADERBOARD_CACHE_KEY);
  });

  // Retry any unsynced orders every 15 seconds.
  window.setInterval(() => {
    if (
      isConfigured() &&
      pendingTransactions().length > 0
    ) {
      void syncPending();
    }
  }, 15000);

  return {
    allLocalTransactions,
    clearLocalTransactions,
    completedTransactions,
    getCachedLeaderboard,
    getCachedRecents,
    isConfigured,
    isLocalTestMode,
    loadBootstrap,
    loadLeaderboard,
    loadOwnedSkins,
    loadRecents,
    pendingTransactions,
    rememberRecentItems,
    saveTransaction,
    syncPending
  };
})();

window.ProjectsBackend = ProjectsBackend;
