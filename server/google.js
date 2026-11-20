"use strict";
// Google OAuth (authorization-code flow, offline) and Calendar reads. fetch and the clock are
// injected so tests run without a network.
const SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

function authUrl(cfg, redirectUri, state) {
  const q = new URLSearchParams({
    client_id: cfg.clientId, redirect_uri: redirectUri, response_type: "code", scope: SCOPE,
    access_type: "offline", prompt: "consent", include_granted_scopes: "true", state
  });
  return "https://accounts.google.com/o/oauth2/v2/auth?" + q;
}
async function tokenCall(fetchFn, cfg, params) {
  const r = await fetchFn("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, ...params })
  });
  const body = await r.json().catch(() => ({}));
  return { ok: r.ok, body };
}
const exchangeCode = (f, cfg, code, redirectUri) => tokenCall(f, cfg, { grant_type: "authorization_code", code, redirect_uri: redirectUri });
const refresh = (f, cfg, refreshToken) => tokenCall(f, cfg, { grant_type: "refresh_token", refresh_token: refreshToken });

// Local calendar date (YYYY-MM-DD) of an instant in a time zone, and that zone's local midnight as an instant.
function localDate(ms, tz) { return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(ms); }
function localHour(ms, tz) { return Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hour12: false }).format(ms)) % 24; }
function offsetMs(ms, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(ms).map((x) => [x.type, x.value]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}
function midnight(dateStr, tz) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  return guess - offsetMs(guess - offsetMs(guess, tz), tz);
}
function addDays(dateStr, n) { const [y, m, d] = dateStr.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); }

// Events from the primary calendar for [today, today + 2 days) local, as small plain records.
async function fetchEvents(fetchFn, accessToken, tz, now) {
  const today = localDate(now, tz);
  const q = new URLSearchParams({
    timeMin: new Date(midnight(today, tz)).toISOString(), timeMax: new Date(midnight(addDays(today, 2), tz)).toISOString(),
    singleEvents: "true", orderBy: "startTime", maxResults: "100", timeZone: tz,
    fields: "items(id,status,summary,location,start,end)"
  });
  const r = await fetchFn("https://www.googleapis.com/calendar/v3/calendars/primary/events?" + q, { headers: { authorization: "Bearer " + accessToken } });
  if (!r.ok) { const e = new Error("calendar " + r.status); e.status = r.status; throw e; }
  const items = (await r.json()).items || [];
  return items.filter((e) => e.status !== "cancelled").map((e) => {
    const allDay = !!(e.start && e.start.date);
    return {
      id: e.id, title: e.summary || "", location: e.location || "", allDay,
      start: allDay ? e.start.date : e.start.dateTime, end: allDay ? e.end.date : e.end.dateTime
    };
  });
}
module.exports = { authUrl, exchangeCode, refresh, fetchEvents, localDate, localHour, midnight, addDays };
