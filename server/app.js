"use strict";
const crypto = require("crypto");

const MAX_BODY = 1024 * 1024;       // Function URL allows 6 MB; nothing here needs more than 1 MB
const MAX_IMPRESSIONS = 200;        // per POST /log
const MAX_IMPRESSION_BYTES = 100 * 1024; // DynamoDB items cap at 400 KB

const MAX_BANK_BYTES = 350 * 1024;  // items cap at 400 KB; past this the bank moves to S3
const BANKS_KEPT = 10;              // older versions are pruned

const hash = (token) => crypto.createHash("sha256").update(token).digest("hex");
const bankSk = (v) => "BANK#" + String(v).padStart(8, "0");
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function validateBank(b) {
  if (!b || typeof b !== "object" || Array.isArray(b)) { return "bank must be an object"; }
  if (!Array.isArray(b.options) || b.options.length > 2000) { return "bank.options must be an array of at most 2000"; }
  for (const o of b.options) {
    if (!o || typeof o.id !== "string" || o.id.length > 64 || typeof o.text !== "string") { return "each option needs a string id and text"; }
  }
  if (b.keep !== undefined && !Array.isArray(b.keep)) { return "bank.keep must be an array"; }
  if (b.recurring !== undefined && !Array.isArray(b.recurring)) { return "bank.recurring must be an array"; }
  return null;
}

// The cycle shape and dates are the most precise health data in a bank. They are taken out of it and stored
// encrypted on their own (the CYCLE item). The person's own phase rules stay in the bank. A person who declined
// (profile.cycle.shared false) has no cycle data kept at all.
function splitCycle(bank) {
  const out = JSON.parse(JSON.stringify(bank));
  const p = out.profile;
  if (!p || p.cycle === undefined || p.cycle === null) { return { bank: out, shape: null }; }
  const c = p.cycle;
  if (c.shared === false) { delete p.cycle; return { bank: out, shape: null }; }
  const shape = { length_days: c.length_days || null, bleed_days: c.bleed_days || null, last_start: c.last_start || null };
  delete c.length_days; delete c.bleed_days; delete c.last_start;
  return { bank: out, shape: shape.length_days || shape.bleed_days || shape.last_start ? shape : null };
}

function validateShape(s) {
  if (!s || typeof s !== "object") { return "body must be an object"; }
  if (s.last_start != null && (typeof s.last_start !== "string" || !DATE.test(s.last_start))) { return "last_start must be YYYY-MM-DD"; }
  for (const k of ["length_days", "bleed_days"]) {
    const r = s[k];
    if (r == null) { continue; }
    if (typeof r !== "object" || [r.min, r.max].some((x) => x != null && (typeof x !== "number" || x < 1 || x > 100))) { return k + " must be { min, max } in days"; }
  }
  return null;
}
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
    // The option bank, one version per upload. The previous version is kept so it can be switched back.
    "PUT /v1/bank": async (user, body) => {
      const err = validateBank(body && body.bank);
      if (err) { return json(400, { error: err }); }
      if (JSON.stringify(body.bank).length > MAX_BANK_BYTES) { return json(413, { error: "bank is too large" }); }
      const { bank, shape } = splitCycle(body.bank);
      const shapeErr = shape && validateShape(shape);
      if (shapeErr) { return json(400, { error: "profile.cycle: " + shapeErr }); }
      const pk = "USER#" + user;
      const p = await store.get(pk, "PROFILE");
      if (!p) { return json(404, { error: "no such user" }); }
      if (shape) {
        if (!deps.kms) { return json(500, { error: "server error" }); }
        await store.put({ pk, sk: "CYCLE", data: await deps.kms.encrypt(JSON.stringify(shape), { user, item: "cycle" }), updated: now() });
      }
      const v = (p.bank_version || 0) + 1;
      await store.put({ pk, sk: bankSk(v), version: v, created: now(), bank });
      await store.update(pk, "PROFILE", { bank_version: v });
      await store.bumpVersion(pk);
      const old = (await store.query(pk, "BANK#")).map((r) => r.version).sort((a, b) => a - b);
      for (const ov of old.slice(0, Math.max(0, old.length - BANKS_KEPT))) { await store.del(pk, bankSk(ov)); }
      return json(200, { version: v, options: bank.options.length, cycle_stored: !!shape });
    },
    "GET /v1/bank": async (user, body, event) => {
      const pk = "USER#" + user;
      const p = await store.get(pk, "PROFILE");
      const want = Number((event.queryStringParameters || {}).version) || (p && p.bank_version);
      if (!want) { return json(404, { error: "no bank" }); }
      const row = await store.get(pk, bankSk(want));
      if (!row) { return json(404, { error: "no such version" }); }
      return json(200, { version: row.version, active: want === (p && p.bank_version), bank: row.bank });
    },
    "GET /v1/bank/versions": async (user) => {
      const pk = "USER#" + user;
      const p = await store.get(pk, "PROFILE");
      const rows = (await store.query(pk, "BANK#")).sort((a, b) => a.version - b.version);
      return json(200, { active: (p && p.bank_version) || null, versions: rows.map((r) => ({ version: r.version, created: r.created, options: r.bank.options.length })) });
    },
    "POST /v1/bank/activate": async (user, body) => {
      const pk = "USER#" + user, v = body && Number(body.version);
      if (!v || !(await store.get(pk, bankSk(v)))) { return json(404, { error: "no such version" }); }
      await store.update(pk, "PROFILE", { bank_version: v });
      await store.bumpVersion(pk);
      return json(200, { active: v });
    },
    // Cycle shape and dates. Encrypted with the KMS key, never logged, deletable. Without this item the server
    // cannot place a future day in the cycle and the phone sends derived phase bands only.
    "GET /v1/cycle": async (user) => {
      const row = await store.get("USER#" + user, "CYCLE");
      if (!row) { return json(200, { stored: false }); }
      return json(200, { stored: true, updated: row.updated, shape: JSON.parse(await deps.kms.decrypt(row.data, { user, item: "cycle" })) });
    },
    "PUT /v1/cycle": async (user, body) => {
      const err = validateShape(body);
      if (err) { return json(400, { error: err }); }
      const pk = "USER#" + user;
      const old = await store.get(pk, "CYCLE");
      const prev = old ? JSON.parse(await deps.kms.decrypt(old.data, { user, item: "cycle" })) : {};
      const shape = { length_days: body.length_days || prev.length_days || null, bleed_days: body.bleed_days || prev.bleed_days || null, last_start: body.last_start || prev.last_start || null };
      await store.put({ pk, sk: "CYCLE", data: await deps.kms.encrypt(JSON.stringify(shape), { user, item: "cycle" }), updated: now() });
      await store.bumpVersion(pk);
      return json(200, { stored: true });
    },
    // Removes the dates and shape, and the phase rules from every stored bank version.
    "POST /v1/cycle/delete": async (user) => {
      const pk = "USER#" + user;
      await store.del(pk, "CYCLE");
      for (const r of await store.query(pk, "BANK#")) {
        if (r.bank && r.bank.profile && r.bank.profile.cycle !== undefined) { delete r.bank.profile.cycle; await store.put(r); }
      }
      await store.bumpVersion(pk);
      return json(200, { deleted: true });
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
    // Options the person added themselves (long press on a card). One item per option, counted each time it is used,
    // so the planner can offer it as a card later. Kept apart from the impression log, which stays raw.
    "POST /v1/added": async (user, body) => {
      const list = body && body.items;
      if (!Array.isArray(list) || list.length > 50) { return json(400, { error: "items must be an array of at most 50" }); }
      for (const a of list) {
        if (!a || typeof a.id !== "string" || !/^added:[a-z0-9-]{1,40}$/.test(a.id) || typeof a.text !== "string" || !a.text.trim() || a.text.length > 1000 || typeof a.t !== "number") {
          return json(400, { error: "each item needs id (added:...), text and numeric t" });
        }
      }
      for (const a of list) {
        const old = await store.get("USER#" + user, "ADDED#" + a.id);
        const uses = old && old.uses || [];
        // The same use sent twice (a retry) is counted once.
        if (uses.indexOf(a.t) === -1) { uses.push(a.t); }
        await store.put({
          pk: "USER#" + user, sk: "ADDED#" + a.id, id: a.id, text: old ? old.text : a.text.trim(),
          from: a.from || (old && old.from) || null, slice: a.slice || null, dow: a.dow == null ? null : a.dow, minutes: a.minutes == null ? null : a.minutes,
          uses: uses.slice(-200), first: old ? old.first : a.t, last: Math.max(a.t, old ? old.last : 0)
        });
        // One row per use, in time order: when it happened, how (a card long press, or "what I am doing now"), and
        // what came just before and how many minutes earlier, so gaps between things can be learned later.
        await store.put({
          pk: "USER#" + user, sk: "USE#" + pad(a.t) + "#" + a.id,
          id: a.id, text: a.text.trim(), t: a.t, via: a.via === "now" ? "now" : "card", from: a.from || null,
          day: a.day || null, slice: a.slice || null, dow: a.dow == null ? null : a.dow, minutes: a.minutes == null ? null : a.minutes,
          prev: a.prev && typeof a.prev === "object" ? { option: a.prev.option || null, label: String(a.prev.label || "").slice(0, 200), at: a.prev.at == null ? null : a.prev.at } : null,
          since: typeof a.since === "number" ? a.since : null
        });
      }
      return json(200, { stored: list.length });
    },
    "GET /v1/added": async (user) => {
      const rows = await store.query("USER#" + user, "ADDED#");
      return json(200, { items: rows.map((r) => ({ id: r.id, text: r.text, from: r.from, uses: r.uses.length, times: r.uses, last: r.last })) });
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
