"use strict";
const G = require("./google");

const QUIET_FROM = 1, QUIET_TO = 5; // local hours when polling is skipped
const TTL_SECONDS = 3 * 24 * 3600;

function splitByDay(events, tz, today) {
  const days = { [today]: [], [G.addDays(today, 1)]: [] };
  for (const e of events) {
    const day = e.allDay ? e.start : G.localDate(Date.parse(e.start), tz);
    if (days[day]) { days[day].push(e); }
  }
  return days;
}

// Poll one user. Returns "ok", "unchanged", "skipped" or "needs_reconnect".
async function pollUser(deps, cal) {
  const { store, kms, fetchFn, now, secrets } = deps;
  const pk = cal.pk, user = pk.slice(5);
  const profile = (await store.get(pk, "PROFILE")) || {};
  const tz = profile.tz || "America/Los_Angeles";
  const h = G.localHour(now, tz);
  if (h >= QUIET_FROM && h < QUIET_TO) { return "skipped"; }
  if (cal.status === "needs_reconnect") { return "skipped"; }

  const refreshToken = await kms.decrypt(cal.token, { user });
  const t = await G.refresh(fetchFn, await secrets(), refreshToken);
  if (!t.ok) {
    if (t.body && t.body.error === "invalid_grant") { await store.put({ ...cal, status: "needs_reconnect", checked: now }); return "needs_reconnect"; }
    throw new Error("token refresh failed: " + (t.body && t.body.error));
  }
  let events;
  try { events = await G.fetchEvents(fetchFn, t.body.access_token, tz, now); }
  catch (e) { if (e.status === 401 || e.status === 403) { await store.put({ ...cal, status: "needs_reconnect", checked: now }); return "needs_reconnect"; } throw e; }

  const today = G.localDate(now, tz);
  const days = splitByDay(events, tz, today);
  let changed = false;
  for (const [date, list] of Object.entries(days)) {
    const prev = await store.get(pk, "CALDAY#" + date);
    if (!prev || JSON.stringify(prev.events) !== JSON.stringify(list)) { changed = changed || date === today; }
    await store.put({ pk, sk: "CALDAY#" + date, events: list, synced: now, ttl: Math.floor(now / 1000) + TTL_SECONDS });
  }
  await store.put({ ...cal, status: "ok", last_sync: now, checked: now });
  if (changed) { await store.bumpVersion(pk); }
  return changed ? "ok" : "unchanged";
}

async function pollAll(deps) {
  const results = {};
  const d = { ...deps, now: (deps.now || Date.now)() };
  for (const cal of await deps.store.scanCalendars()) {
    try { results[cal.pk] = await pollUser(d, cal); } catch (e) { console.error("poll failed", cal.pk, e.message); results[cal.pk] = "error"; }
  }
  return results;
}
module.exports = { pollUser, pollAll, splitByDay };
