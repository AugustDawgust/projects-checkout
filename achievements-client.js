/* Cosmetic data only. This cache is never used to calculate or submit charges. */
window.ProjectsAchievements = (() => {
  const CACHE_KEY = "projectsAchievementCacheV1";
  const TTL = 5 * 60 * 1000;
  const inFlight = new Map();
  const generations = new Map();
  let cache = {};
  try { cache = JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; } catch (_) {}
  const key = member => `${member.type}:${member.type === "Brother" ? String(member.id).padStart(4, "0") : member.id}`;
  function persist() {
    const entries = Object.entries(cache).sort((a, b) => b[1].savedAt - a[1].savedAt).slice(0, 150);
    cache = Object.fromEntries(entries);
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch (_) { /* Cache is optional. */ }
  }
  function peek(member) { return member ? cache[key(member)]?.data || null : null; }
  function invalidate(member) {
    const k = key(member);
    generations.set(k, (generations.get(k) || 0) + 1);
    if (cache[k]) cache[k].savedAt = 0;
    persist();
  }
  async function load(member, { force = false } = {}) {
    const k = key(member);
    const generation = generations.get(k) || 0;
    const entry = cache[k];
    if (!force && entry && Date.now() - entry.savedAt < TTL) return entry.data;
    const pending = inFlight.get(k);
    if (pending?.generation === generation) return pending.promise;
    const promise = (async () => {
      const url = new URL(String(window.PROJECTS_CONFIG.appsScriptUrl));
      url.searchParams.set("action", "achievements");
      url.searchParams.set("customerType", member.type);
      url.searchParams.set("customerId", member.id);
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
        cache[k] = { savedAt: Date.now(), data: result.data };
        persist();
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
  return { peek, load, invalidate };
})();
