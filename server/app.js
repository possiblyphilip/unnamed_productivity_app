"use strict";
const crypto = require("crypto");

const MAX_BODY = 1024 * 1024;       // Function URL allows 6 MB; nothing here needs more than 1 MB
const MAX_IMPRESSIONS = 200;        // per POST /log
const MAX_IMPRESSION_BYTES = 100 * 1024; // DynamoDB items cap at 400 KB

const hash = (token) => crypto.createHash("sha256").update(token).digest("hex");
const json = (status, body) => ({ statusCode: status, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const pad = (n) => String(Math.max(0, Math.floor(n))).padStart(13, "0");

async function authenticate(store, headers) {
  const m = /^Bearer ([A-Za-z0-9_-]{20,128})$/.exec(headers.authorization || "");
  if (!m) { return null; }
  const dev = await store.get("DEVICE#" + hash(m[1]), "DEVICE");
  return dev ? dev.user : null;
}

function rand() { return crypto.randomBytes(24).toString("base64url"); }
const redirect = (url) => ({ statusCode: 302, headers: { location: url, "cache-control": "no-store" }, body: "" });

// deps: { store, kms: {encrypt, decrypt}, secrets(): {clientId, clientSecret}, fetchFn, now(), appUrl }
function makeHandler(deps) {
  const store = deps.store, G = require("./google");
  const now = deps.now || Date.now, fetchFn = deps.fetchFn || fetch;
  const callbackUri = (event) => "https://" + event.requestContext.domainName + "/auth/google/callback";

  const routes = {
    "GET /v1/me": async (user) => {
      const p = await store.get("USER#" + user, "PROFILE");
      if (!p) { return json(404, { error: "no such user" }); }
      const cal = await store.get("USER#" + user, "CAL#google");
      return json(200, {
        user: { id: user, name: p.name }, profile_version: p.profile_version || 0,
        bank_version: p.bank_version || null, calendar: cal ? cal.status : "none"
      });
    },
    "POST /v1/auth/google/start": async (user, body, event) => {
      const state = rand();
      await store.put({ pk: "STATE#" + state, sk: "STATE", user, ttl: Math.floor(now() / 1000) + 600 });
      return json(200, { url: G.authUrl(await deps.secrets(), callbackUri(event), state) });
    },
    "POST /v1/auth/google/disconnect": async (user) => {
      await store.del("USER#" + user, "CAL#google");
      await store.bumpVersion("USER#" + user);
      return json(200, { status: "none" });
    },
    "GET /v1/calendar": async (user) => {
      const { localDate } = G;
      const p = (await store.get("USER#" + user, "PROFILE")) || {};
      const tz = p.tz || "America/Los_Angeles";
      const today = localDate(now(), tz), tomorrow = G.addDays(today, 1);
      const [a, b, cal] = await Promise.all([store.get("USER#" + user, "CALDAY#" + today), store.get("USER#" + user, "CALDAY#" + tomorrow), store.get("USER#" + user, "CAL#google")]);
      return json(200, { status: cal ? cal.status : "none", last_sync: cal ? cal.last_sync || null : null, days: { [today]: cal && a ? a.events : [], [tomorrow]: cal && b ? b.events : [] } });
    },
    "POST /v1/log": async (user, body) => {
      const list = body && body.impressions;
      if (!Array.isArray(list) || list.length > MAX_IMPRESSIONS) { return json(400, { error: "impressions must be an array of at most " + MAX_IMPRESSIONS }); }
      const items = [];
      for (const r of list) {
        if (!r || typeof r.id !== "string" || r.id.length > 64 || typeof r.t0 !== "number") { return json(400, { error: "each impression needs a string id and numeric t0" }); }
        if (JSON.stringify(r).length > MAX_IMPRESSION_BYTES) { return json(413, { error: "impression " + r.id + " is too large" }); }
        // Same id and t0 give the same key, so a re-upload (or an update to a set that was still open) overwrites.
        items.push({ pk: "USER#" + user, sk: "IMP#" + pad(r.t0) + "#" + r.id, rec: r });
      }
      await store.putMany(items);
      return json(200, { stored: items.length });
    }
  };

  async function callback(event) {
    const q = event.queryStringParameters || {};
    const back = (r) => redirect(deps.appUrl + "#cal=" + r);
    if (!q.state) { return json(400, { error: "missing state" }); }
    const st = await store.get("STATE#" + q.state, "STATE");
    if (!st || st.ttl < Math.floor(now() / 1000)) { return json(400, { error: "unknown or expired state" }); }
    await store.del("STATE#" + q.state, "STATE"); // single use
    if (q.error || !q.code) { return back("denied"); }
    const t = await G.exchangeCode(fetchFn, await deps.secrets(), q.code, callbackUri(event));
    if (!t.ok || !t.body.refresh_token) { console.error("code exchange failed", t.body && t.body.error); return back("error"); }
    const pk = "USER#" + st.user;
    await store.put({ pk, sk: "CAL#google", token: await deps.kms.encrypt(t.body.refresh_token, { user: st.user }), status: "ok", connected: now() });
    await store.bumpVersion(pk);
    return back("connected");
  }

  return async function handler(event) {
    const http = event.requestContext && event.requestContext.http;
    if (!http) { return json(400, { error: "unsupported event" }); } // calendar poll and nightly events arrive in later steps
    const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    if (http.method === "GET" && http.path === "/auth/google/callback") { return callback(event); }
    const route = routes[http.method + " " + http.path.replace(/\/+$/, "")];
    if (!route) { return json(404, { error: "not found" }); }
    let user;
    try { user = await authenticate(store, headers); } catch (e) { console.error("auth failed", e.name); return json(500, { error: "server error" }); }
    if (!user) { return json(401, { error: "unauthorized" }); }
    let body = null;
    if (event.body) {
      const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
      if (raw.length > MAX_BODY) { return json(413, { error: "body too large" }); }
      try { body = JSON.parse(raw); } catch (e) { return json(400, { error: "invalid json" }); }
    }
    try { return await route(user, body, event); } catch (e) { console.error("route failed", http.method, http.path, e.name); return json(500, { error: "server error" }); }
  };
}

module.exports = { makeHandler, hash };
