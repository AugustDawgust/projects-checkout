/* Cosmetic data only. This cache is never used to calculate or submit charges. */
window.ProjectsAchievements = (() => {
  const CACHE_KEY = "projectsAchievementCacheV3";
  const TTL = 2 * 60 * 1000;
  const dayFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
  const inFlight = new Map();
  const generations = new Map();
  const previewCache = new Map();
  const previewFlights = new Map();
  let cache = {};
  try { cache = JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; } catch (_) {}
  const key = member => `${member.type}:${member.type === "Brother" ? String(member.id).padStart(4, "0") : member.id}`;
  const previewIds = itemIds => [...new Set(itemIds.map(String))].sort();
  const previewKey = (member, itemIds, transactionId) => `${key(member)}|${transactionId}|${previewIds(itemIds).join(",")}`;
  function peekPreview(member, itemIds, transactionId) {
    if (!member || !itemIds?.length) return null;
    const entry = previewCache.get(previewKey(member, itemIds, transactionId));
    return entry && Date.now() - entry.savedAt < 5 * 60 * 1000 ? entry.data : null;
  }
  async function preview(member, itemIds, transactionId) {
    if (window.PROJECTS_CONFIG?.useLocalTestData === true) throw new Error("Achievements require the live backend.");
    const ids = previewIds(itemIds);
    if (!ids.length) return null;
    const k = previewKey(member, ids, transactionId);
    const cached = peekPreview(member, ids, transactionId);
    if (cached) return cached;
    if (previewFlights.has(k)) return previewFlights.get(k);
    const generation = generations.get(key(member)) || 0;
    const promise = (async () => {
      const url = new URL(String(window.PROJECTS_CONFIG.appsScriptUrl));
      url.searchParams.set("action", "achievementPreview");
      url.searchParams.set("customerType", member.type);
      url.searchParams.set("customerId", member.id);
      url.searchParams.set("itemIds", ids.join(","));
      url.searchParams.set("transactionId", transactionId);
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 20000);
      try {
        const response = await fetch(url, { cache: "no-store", redirect: "follow", signal: controller.signal });
        if (!response.ok) throw new Error("Cart progress could not load (" + response.status + ").");
        const result = await response.json();
        const data = result.data;
        if (!result.ok || !data || !Array.isArray(data.changes)) throw new Error(result.error || "Deploy the updated Apps Script to preview cart progress.");
        if (previewKey({ type: data.customerType, id: data.customerId }, data.itemIds || [], data.transactionId) !== k) throw new Error("Cart progress response mismatch.");
        if ((generations.get(key(member)) || 0) === generation) {
          previewCache.set(k, { savedAt: Date.now(), data });
          if (previewCache.size > 24) previewCache.delete(previewCache.keys().next().value);
        }
        return data;
      } finally {
        window.clearTimeout(timer);
      }
    })();
    previewFlights.set(k, promise);
    try { return await promise; }
    finally { if (previewFlights.get(k) === promise) previewFlights.delete(k); }
  }
  function persist() {
    const entries = Object.entries(cache).sort((a, b) => b[1].savedAt - a[1].savedAt).slice(0, 150);
    cache = Object.fromEntries(entries);
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch (_) { /* Cache is optional. */ }
  }
  function current(entry) {
    return entry && Number.isFinite(Number(entry.savedAt)) &&
      Number.isInteger(entry.data?.streak) && entry.data.streak >= 0 &&
      dayFormatter.format(new Date(entry.savedAt)) === dayFormatter.format(new Date());
  }
  function peek(member) {
    if (!member || window.PROJECTS_CONFIG?.useLocalTestData === true) return null;
    const entry = cache[key(member)];
    return current(entry) ? entry.data : null;
  }
  function invalidate(member) {
    const k = key(member);
    generations.set(k, (generations.get(k) || 0) + 1);
    if (cache[k]) cache[k].savedAt = 0;
    for (const entryKey of previewCache.keys()) {
      if (entryKey.startsWith(`${k}|`)) previewCache.delete(entryKey);
    }
    persist();
  }
  async function load(member, { force = false } = {}) {
    if (window.PROJECTS_CONFIG?.useLocalTestData === true) {
      throw new Error("Achievements require the live backend.");
    }
    const k = key(member);
    const generation = generations.get(k) || 0;
    const entry = cache[k];
    if (!force && current(entry) && Date.now() - entry.savedAt < TTL) return entry.data;
    const pending = inFlight.get(k);
    if (pending?.generation === generation) return pending.promise;
    const promise = (async () => {
      const url = new URL(String(window.PROJECTS_CONFIG.appsScriptUrl));
      url.searchParams.set("action", "achievements");
      url.searchParams.set("customerType", member.type);
      url.searchParams.set("customerId", member.id);
      if (force) url.searchParams.set("refresh", "1");
      url.searchParams.set("t", Date.now());
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 20000);
      try {
        const response = await fetch(url, { cache: "no-store", redirect: "follow", signal: controller.signal });
        if (!response.ok) throw new Error("Stars could not load (" + response.status + ").");
        const result = await response.json();
        if (!result.ok || !result.data || !Array.isArray(result.data.cards)) throw new Error(result.error || "Deploy the updated Apps Script to enable achievements.");
        if (key({ type: result.data.customerType, id: result.data.customerId }) !== k) throw new Error("Achievement customer mismatch.");
        // A checkout may have synced while this older request was running.
        if ((generations.get(k) || 0) !== generation) return load(member, { force: true });
        if (Number.isInteger(result.data.streak) && result.data.streak >= 0) {
          cache[k] = { savedAt: Date.now(), data: result.data };
          persist();
        }
        return result.data;
      } finally {
        window.clearTimeout(timer);
      }
    })();
    inFlight.set(k, { generation, promise });
    try { return await promise; }
    finally { if (inFlight.get(k)?.promise === promise) inFlight.delete(k); }
  }
  window.addEventListener("projects:orders-synced", event => {
    const seen = new Set();
    for (const entry of event.detail) {
      const k = key(entry.member);
      if (!seen.has(k)) { invalidate(entry.member); seen.add(k); }
    }
  });
  return { peek, load, invalidate, peekPreview, preview };
})();
