const ProjectsBackend = (() => {
  const PENDING_KEY = "projectsPendingTransactions";
  const COMPLETED_KEY = "projectsCompletedTransactions";
  const DEVICE_KEY = "projectsDeviceId";

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
    return String(window.PROJECTS_CONFIG?.appsScriptUrl || "").trim();
  }

  async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = window.setTimeout(() => controller?.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, ...(controller ? { signal: controller.signal } : {}) });
    } finally {
      window.clearTimeout(timer);
    }
  }

  function isConfigured() {
    return /^https:\/\/script\.google\.com\/macros\/s\//.test(endpoint());
  }

  function deviceId() {
    let value = localStorage.getItem(DEVICE_KEY);
    if (!value) {
      value = window.crypto?.randomUUID?.() || `device-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
    if (!pending.some((item) => item.transactionId === transaction.transactionId)) {
      pending.push(transaction);
      writeJson(PENDING_KEY, pending);
    }
  }

  function markCompleted(transaction, serverResult) {
    writeJson(PENDING_KEY, pendingTransactions().filter(
      (item) => item.transactionId !== transaction.transactionId
    ));

    const completed = completedTransactions();
    if (!completed.some((item) => item.transactionId === transaction.transactionId)) {
      completed.push({ ...transaction, serverResult });
      writeJson(COMPLETED_KEY, completed.slice(-250));
    }
  }

  async function postTransaction(transaction) {
    const response = await fetchWithTimeout(endpoint(), {
      method: "POST",
      redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "recordTransaction", transaction })
    });

    if (!response.ok) throw new Error(`Backend returned ${response.status}`);
    const result = await response.json();
    if (!result.ok) throw new Error(result.error || "The spreadsheet rejected this purchase.");
    return result;
  }

  async function saveTransaction(transaction) {
    const withDevice = { ...transaction, deviceId: deviceId() };
    enqueue(withDevice); // Persist locally before any network request.

    if (!isConfigured()) {
      return { synced: false, localOnly: true, reason: "Backend URL is not configured." };
    }

    try {
      const result = await postTransaction(withDevice);
      markCompleted(withDevice, result);
      return { synced: true, duplicate: Boolean(result.duplicate) };
    } catch (error) {
      return { synced: false, reason: error.message };
    }
  }

  async function syncPending() {
    if (!isConfigured()) return { synced: 0, remaining: pendingTransactions().length };

    let synced = 0;
    for (const transaction of pendingTransactions()) {
      try {
        const result = await postTransaction(transaction);
        markCompleted(transaction, result);
        synced += 1;
      } catch {
        // Leave failed entries in the durable queue for the next retry.
      }
    }
    return { synced, remaining: pendingTransactions().length };
  }

  async function loadBootstrap() {
    if (!isConfigured()) return null;
    const url = new URL(endpoint());
    url.searchParams.set("action", "bootstrap");
    url.searchParams.set("t", Date.now().toString());
    const response = await fetchWithTimeout(url, { redirect: "follow", cache: "no-store" });
    if (!response.ok) throw new Error(`Backend returned ${response.status}`);
    const result = await response.json();
    if (!result.ok) throw new Error(result.error || "Could not load Projects data.");
    return result.data;
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

  return {
    allLocalTransactions,
    clearLocalTransactions,
    isConfigured,
    loadBootstrap,
    pendingTransactions,
    saveTransaction,
    syncPending
  };
})();

window.ProjectsBackend = ProjectsBackend;
