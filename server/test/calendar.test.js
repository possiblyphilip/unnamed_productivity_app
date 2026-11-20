"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { makeHandler, hash } = require("../app");
const { pollAll } = require("../calendar");
const G = require("../google");

function memStore() {
  const m = new Map(); const k = (pk, sk) => pk + "|" + sk;
  return {
    m,
    async get(pk, sk) { return m.get(k(pk, sk)) || null; },
    async put(i) { m.set(k(i.pk, i.sk), i); },
    async del(pk, sk) { m.delete(k(pk, sk)); },
    async putMany(items) { items.forEach((i) => m.set(k(i.pk, i.sk), i)); },
    async bumpVersion(pk) { const p = m.get(k(pk, "PROFILE")); p.profile_version = (p.profile_version || 0) + 1; },
    async scanCalendars() { return [...m.values()].filter((i) => i.sk === "CAL#google"); }
  };
}
const kms = { async encrypt(p, c) { return Buffer.from(JSON.stringify([p, c])).toString("base64"); }, async decrypt(b, c) { const [p, c0] = JSON.parse(Buffer.from(b, "base64")); assert.deepEqual(c, c0); return p; } };
const secrets = async () => ({ clientId: "cid", clientSecret: "sec" });
const TOKEN = "t".repeat(43);
const NOW = Date.parse("2026-11-20T18:00:00Z"); // 10:00 in Los Angeles
const resp = (body, ok = true, status = 200) => ({ ok, status, json: async () => body });

async function setup(fetchFn) {
  const store = memStore();
  await store.put({ pk: "USER#kyra", sk: "PROFILE", name: "kyra", profile_version: 0 });
  await store.put({ pk: "DEVICE#" + hash(TOKEN), sk: "DEVICE", user: "kyra" });
  const deps = { store, kms, secrets, fetchFn, now: () => NOW, appUrl: "https://app.example/x/" };
  return { store, deps, h: makeHandler(deps) };
}
const ev = (method, path, extra) => ({ requestContext: { http: { method, path }, domainName: "fn.on.aws" }, headers: { authorization: "Bearer " + TOKEN }, ...extra });

test("start returns a Google URL with offline access and stores a state", async () => {
  const { store, h } = await setup();
  const r = await h(ev("POST", "/v1/auth/google/start"));
  const url = new URL(JSON.parse(r.body).url);
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("scope"), "https://www.googleapis.com/auth/calendar.readonly");
  assert.equal(url.searchParams.get("redirect_uri"), "https://fn.on.aws/auth/google/callback");
  assert.ok(await store.get("STATE#" + url.searchParams.get("state"), "STATE"));
});
test("callback stores an encrypted refresh token once, and rejects replays and bad state", async () => {
  const f = async () => resp({ refresh_token: "r-token", access_token: "a" });
  const { store, h } = await setup(f);
  const state = new URL(JSON.parse((await h(ev("POST", "/v1/auth/google/start"))).body).url).searchParams.get("state");
  const cb = { headers: {}, queryStringParameters: { code: "c", state } };
  const r = await h({ ...ev("GET", "/auth/google/callback"), ...cb, headers: {} });
  assert.equal(r.statusCode, 302);
  assert.equal(r.headers.location, "https://app.example/x/#cal=connected");
  const cal = await store.get("USER#kyra", "CAL#google");
  assert.equal(cal.status, "ok");
  assert.ok(!JSON.stringify(cal).includes("r-token"), "refresh token must not be stored in plain text");
  assert.equal((await h({ ...ev("GET", "/auth/google/callback"), ...cb })).statusCode, 400);
  assert.equal((await h({ ...ev("GET", "/auth/google/callback"), queryStringParameters: { code: "c", state: "nope" } })).statusCode, 400);
  assert.equal((await store.get("USER#kyra", "PROFILE")).profile_version, 1);
});
test("poll caches today and tomorrow and bumps profile_version only when today changes", async () => {
  let events = [{ id: "1", summary: "Dentist", start: { dateTime: "2026-11-20T21:00:00Z" }, end: { dateTime: "2026-11-20T22:00:00Z" } },
    { id: "2", summary: "Holiday", start: { date: "2026-11-21" }, end: { date: "2026-11-22" } },
    { id: "3", status: "cancelled", summary: "x", start: { dateTime: "2026-11-20T19:00:00Z" }, end: { dateTime: "2026-11-20T20:00:00Z" } }];
  const f = async (url) => url.includes("oauth2") ? resp({ access_token: "a" }) : resp({ items: events });
  const { store, deps } = await setup(f);
  await store.put({ pk: "USER#kyra", sk: "CAL#google", token: await kms.encrypt("r", { user: "kyra" }), status: "ok" });
  assert.deepEqual(await pollAll(deps), { "USER#kyra": "ok" });
  const today = (await store.get("USER#kyra", "CALDAY#2026-11-20")).events;
  assert.deepEqual(today.map((e) => e.title), ["Dentist"]);
  assert.equal((await store.get("USER#kyra", "CALDAY#2026-11-21")).events[0].allDay, true);
  assert.equal((await store.get("USER#kyra", "PROFILE")).profile_version, 1);
  assert.deepEqual(await pollAll(deps), { "USER#kyra": "unchanged" });
  assert.equal((await store.get("USER#kyra", "PROFILE")).profile_version, 1);
});
test("poll marks the connection needs_reconnect when Google revokes the grant, and /v1/calendar says so", async () => {
  const f = async () => resp({ error: "invalid_grant" }, false, 400);
  const { store, deps, h } = await setup(f);
  await store.put({ pk: "USER#kyra", sk: "CAL#google", token: await kms.encrypt("r", { user: "kyra" }), status: "ok" });
  assert.deepEqual(await pollAll(deps), { "USER#kyra": "needs_reconnect" });
  assert.equal(JSON.parse((await h(ev("GET", "/v1/calendar"))).body).status, "needs_reconnect");
  assert.deepEqual(await pollAll(deps), { "USER#kyra": "skipped" });
});
test("poll skips the small hours local time", async () => {
  const { store, deps } = await setup(async () => { throw new Error("should not call"); });
  await store.put({ pk: "USER#kyra", sk: "CAL#google", token: "x", status: "ok" });
  assert.deepEqual(await pollAll({ ...deps, now: () => Date.parse("2026-11-20T11:00:00Z") }), { "USER#kyra": "skipped" }); // 03:00 LA
});
test("local midnight handles daylight saving", () => {
  assert.equal(new Date(G.midnight("2026-03-08", "America/Los_Angeles")).toISOString(), "2026-03-08T08:00:00.000Z");
  assert.equal(new Date(G.midnight("2026-03-09", "America/Los_Angeles")).toISOString(), "2026-03-09T07:00:00.000Z");
});

test("disconnect removes the connection and hides cached events", async () => {
  const { store, h } = await setup();
  await store.put({ pk: "USER#kyra", sk: "CAL#google", token: "x", status: "ok" });
  await store.put({ pk: "USER#kyra", sk: "CALDAY#2026-11-20", events: [{ title: "x" }] });
  assert.equal((await h(ev("POST", "/v1/auth/google/disconnect"))).statusCode, 200);
  const r = JSON.parse((await h(ev("GET", "/v1/calendar"))).body);
  assert.equal(r.status, "none"); assert.deepEqual(r.days["2026-11-20"], []);
});
