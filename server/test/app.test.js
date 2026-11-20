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
    async putMany(items) { items.forEach((i) => m.set(k(i.pk, i.sk), i)); }
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
