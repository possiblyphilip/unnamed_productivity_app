"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { makeHandler, hash } = require("../app");

function memStore() {
  const m = new Map();
  const k = (pk, sk) => pk + "|" + sk;
  return {
    m,
    async get(pk, sk) { return m.get(k(pk, sk)) || null; },
    async put(i) { m.set(k(i.pk, i.sk), i); },
    async del(pk, sk) { m.delete(k(pk, sk)); },
    async putMany(items) { items.forEach((i) => m.set(k(i.pk, i.sk), i)); },
    async query(pk, prefix) { return [...m.values()].filter((i) => i.pk === pk && i.sk.startsWith(prefix)); }
  };
}
const TOKEN = "t".repeat(43);
async function setup() {
  const s = memStore();
  await s.put({ pk: "USER#kyra", sk: "PROFILE", name: "kyra", profile_version: 3 });
  await s.put({ pk: "DEVICE#" + hash(TOKEN), sk: "DEVICE", user: "kyra" });
  return { s, h: makeHandler({ store: s }) };
}
const call = (h, method, path, body, token) => h({
  requestContext: { http: { method, path } },
  headers: token === null ? {} : { Authorization: "Bearer " + (token || TOKEN) },
  body: body === undefined ? undefined : JSON.stringify(body)
});

test("rejects missing, malformed and unknown tokens", async () => {
  const { h } = await setup();
  assert.equal((await call(h, "GET", "/v1/me", undefined, null)).statusCode, 401);
  assert.equal((await call(h, "GET", "/v1/me", undefined, "short")).statusCode, 401);
  assert.equal((await call(h, "GET", "/v1/me", undefined, "x".repeat(43))).statusCode, 401);
});
test("GET /v1/me", async () => {
  const { h } = await setup();
  const r = await call(h, "GET", "/v1/me");
  assert.equal(r.statusCode, 200);
  assert.deepEqual(JSON.parse(r.body), { user: { id: "kyra", name: "kyra" }, profile_version: 3, bank_version: null, calendar: "none" });
});
test("POST /v1/log stores and is idempotent", async () => {
  const { s, h } = await setup();
  const imp = { id: "abc-1", t0: 1700000000000, outcome: "open" };
  assert.equal((await call(h, "POST", "/v1/log", { impressions: [imp] })).statusCode, 200);
  await call(h, "POST", "/v1/log", { impressions: [{ ...imp, outcome: "picked" }] });
  const keys = [...s.m.keys()].filter((x) => x.includes("IMP#"));
  assert.equal(keys.length, 1);
  assert.equal(s.m.get(keys[0]).rec.outcome, "picked");
});
test("POST /v1/log validates input", async () => {
  const { h } = await setup();
  assert.equal((await call(h, "POST", "/v1/log", { impressions: "x" })).statusCode, 400);
  assert.equal((await call(h, "POST", "/v1/log", { impressions: [{ t0: 1 }] })).statusCode, 400);
  assert.equal((await call(h, "POST", "/v1/log", { impressions: [{ id: "a", t0: 1, pad: "x".repeat(200000) }] })).statusCode, 413);
});
test("unknown route and bad json", async () => {
  const { h } = await setup();
  assert.equal((await call(h, "GET", "/v1/nope")).statusCode, 404);
  const r = await h({ requestContext: { http: { method: "POST", path: "/v1/log" } }, headers: { authorization: "Bearer " + TOKEN }, body: "{" });
  assert.equal(r.statusCode, 400);
});
test("added options are stored once per use and listed", async () => {
  const { h } = await setup();
  const a = { id: "added:messaging-someone", text: "Messaging someone", from: "opt1", t: 1700000000000, slice: "weekday-morning", dow: 1, minutes: 500 };
  assert.equal((await call(h, "POST", "/v1/added", { items: [a] })).statusCode, 200);
  await call(h, "POST", "/v1/added", { items: [a] }); // retry of the same use
  await call(h, "POST", "/v1/added", { items: [{ ...a, t: a.t + 1000, text: "ignored rename" }] });
  const r = JSON.parse((await call(h, "GET", "/v1/added")).body);
  assert.deepEqual(r.items, [{ id: a.id, text: "Messaging someone", from: "opt1", uses: 2, times: [a.t, a.t + 1000], last: a.t + 1000 }]);
});
test("POST /v1/added validates input", async () => {
  const { h } = await setup();
  assert.equal((await call(h, "POST", "/v1/added", { items: [{ id: "opt1", text: "x", t: 1 }] })).statusCode, 400);
  assert.equal((await call(h, "POST", "/v1/added", { items: [{ id: "added:x", text: " ", t: 1 }] })).statusCode, 400);
  assert.equal((await call(h, "POST", "/v1/added", { items: "x" })).statusCode, 400);
});
test("every use is kept as its own row with what came before it", async () => {
  const { s, h } = await setup();
  const a = { id: "added:reading", text: "Reading", t: 1700000100000, via: "now", day: "2026-11-19", minutes: 600, prev: { option: "m_walk", label: "Walking", at: 570 }, since: 30 };
  await call(h, "POST", "/v1/added", { items: [a, a] });
  const rows = [...s.m.values()].filter((i) => i.sk.startsWith("USE#"));
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].via, rows[0].since, rows[0].prev.option], ["now", 30, "m_walk"]);
});
