"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { makeHandler, hash } = require("../app");

function memStore() {
  const m = new Map();
  const k = (pk, sk) => pk + "|" + sk;
  return {
    m,
    async get(pk, sk) { const r = m.get(k(pk, sk)); return r ? JSON.parse(JSON.stringify(r)) : null; },
    async put(i) { m.set(k(i.pk, i.sk), JSON.parse(JSON.stringify(i))); },
    async del(pk, sk) { m.delete(k(pk, sk)); },
    async update(pk, sk, f) { m.set(k(pk, sk), Object.assign({}, m.get(k(pk, sk)), f)); },
    async bumpVersion(pk) { const p = m.get(k(pk, "PROFILE")); p.profile_version = (p.profile_version || 0) + 1; },
    async query(pk, prefix) { return [...m.values()].filter((i) => i.pk === pk && i.sk.startsWith(prefix)).map((i) => JSON.parse(JSON.stringify(i))); }
  };
}
// A stand-in for KMS that only decrypts with the same context, and whose output does not contain the plaintext.
const kms = {
  async encrypt(plain, ctx) { return Buffer.from(JSON.stringify({ c: ctx, p: Buffer.from(plain).reverse().toString("base64") })).toString("base64"); },
  async decrypt(b64, ctx) {
    const o = JSON.parse(Buffer.from(b64, "base64").toString());
    assert.deepEqual(o.c, ctx);
    return Buffer.from(o.p, "base64").reverse().toString();
  }
};
const TOKEN = "t".repeat(43), OTHER = "u".repeat(43);
async function setup() {
  const s = memStore();
  await s.put({ pk: "USER#kyra", sk: "PROFILE", name: "kyra", profile_version: 3 });
  await s.put({ pk: "USER#sam", sk: "PROFILE", name: "sam", profile_version: 0 });
  await s.put({ pk: "DEVICE#" + hash(TOKEN), sk: "DEVICE", user: "kyra" });
  await s.put({ pk: "DEVICE#" + hash(OTHER), sk: "DEVICE", user: "sam" });
  return { s, h: makeHandler({ store: s, kms, now: () => 1700000000000 }) };
}
const call = (h, method, path, body, token, query) => h({
  requestContext: { http: { method, path } }, headers: { Authorization: "Bearer " + (token || TOKEN) },
  queryStringParameters: query, body: body === undefined ? undefined : JSON.stringify(body)
});
const parse = (r) => JSON.parse(r.body);
const bank = (n, extra) => Object.assign({ id: "b" + n, keep: ["water"], options: [{ id: "p_o_01", text: "Walk", dur: 20 }, { id: "p_o_02", text: "Write", dur: null, dur_unknown: true }], recurring: [], report: {} }, extra || {});

test("a bank is stored as a version and read back", async () => {
  const { h } = await setup();
  assert.equal((await call(h, "GET", "/v1/bank")).statusCode, 404);
  const r = await call(h, "PUT", "/v1/bank", { bank: bank(1) });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(parse(r), { version: 1, options: 2, cycle_stored: false });
  const g = parse(await call(h, "GET", "/v1/bank"));
  assert.equal(g.version, 1);
  assert.equal(g.active, true);
  assert.equal(g.bank.options[1].dur, null, "an unknown duration stays unknown");
  assert.equal(parse(await call(h, "GET", "/v1/me")).bank_version, 1);
});
test("a new upload is a new version and the old one can be switched back to", async () => {
  const { s, h } = await setup();
  await call(h, "PUT", "/v1/bank", { bank: bank(1) });
  const before = (await s.get("USER#kyra", "PROFILE")).profile_version;
  await call(h, "PUT", "/v1/bank", { bank: bank(2) });
  assert.equal((await s.get("USER#kyra", "PROFILE")).profile_version, before + 1, "the phone is told to refetch");
  assert.equal(parse(await call(h, "GET", "/v1/bank")).bank.id, "b2");
  assert.equal(parse(await call(h, "GET", "/v1/bank", undefined, null, { version: "1" })).bank.id, "b1");
  assert.equal(parse(await call(h, "GET", "/v1/bank/versions")).versions.length, 2);
  assert.equal((await call(h, "POST", "/v1/bank/activate", { version: 1 })).statusCode, 200);
  assert.equal(parse(await call(h, "GET", "/v1/bank")).bank.id, "b1");
  assert.equal((await call(h, "POST", "/v1/bank/activate", { version: 9 })).statusCode, 404);
});
test("only the newest ten versions are kept", async () => {
  const { h } = await setup();
  for (let i = 1; i <= 12; i++) { await call(h, "PUT", "/v1/bank", { bank: bank(i) }); }
  const v = parse(await call(h, "GET", "/v1/bank/versions"));
  assert.equal(v.versions.length, 10);
  assert.equal(v.versions[0].version, 3);
  assert.equal(v.active, 12);
});
test("one person cannot read another's bank", async () => {
  const { h } = await setup();
  await call(h, "PUT", "/v1/bank", { bank: bank(1) });
  assert.equal((await call(h, "GET", "/v1/bank", undefined, OTHER)).statusCode, 404);
});
test("bank input is validated", async () => {
  const { h } = await setup();
  assert.equal((await call(h, "PUT", "/v1/bank", {})).statusCode, 400);
  assert.equal((await call(h, "PUT", "/v1/bank", { bank: { options: "x" } })).statusCode, 400);
  assert.equal((await call(h, "PUT", "/v1/bank", { bank: { options: [{ id: 1, text: "x" }] } })).statusCode, 400);
  assert.equal((await call(h, "PUT", "/v1/bank", { bank: bank(1, { pad: "x".repeat(400 * 1024) }) })).statusCode, 413);
});

const cycleBank = () => bank(1, { profile: { cycle: { shared: true, length_days: { min: 27, max: 29 }, bleed_days: { min: 3, max: 4 }, last_start: "2026-11-10", phases: [{ name: "slow", never_offer: ["x"] }] } } });
test("cycle dates and shape are taken out of the bank and stored encrypted", async () => {
  const { s, h } = await setup();
  const r = parse(await call(h, "PUT", "/v1/bank", { bank: cycleBank() }));
  assert.equal(r.cycle_stored, true);
  const stored = [...s.m.values()].find((i) => i.sk === "BANK#00000001").bank;
  assert.equal(stored.profile.cycle.last_start, undefined);
  assert.equal(stored.profile.cycle.length_days, undefined);
  assert.equal(stored.profile.cycle.phases[0].name, "slow", "the person's own phase rules stay in the bank");
  const row = s.m.get("USER#kyra|CYCLE");
  assert.ok(row && !JSON.stringify(row).includes("2026-11-10"), "the dates are not stored in the clear");
  const g = parse(await call(h, "GET", "/v1/cycle"));
  assert.deepEqual(g.shape, { length_days: { min: 27, max: 29 }, bleed_days: { min: 3, max: 4 }, last_start: "2026-11-10" });
});
test("someone who declined has no cycle data stored anywhere", async () => {
  const { s, h } = await setup();
  const b = bank(1, { profile: { cycle: { shared: false, last_start: "2026-11-10", phases: [{ name: "x" }] } } });
  assert.equal(parse(await call(h, "PUT", "/v1/bank", { bank: b })).cycle_stored, false);
  assert.equal(s.m.get("USER#kyra|CYCLE"), undefined);
  assert.equal(parse(await call(h, "GET", "/v1/bank")).bank.profile.cycle, undefined);
  assert.deepEqual(parse(await call(h, "GET", "/v1/cycle")), { stored: false });
});
test("a new period start can be logged without resending the shape", async () => {
  const { h } = await setup();
  await call(h, "PUT", "/v1/bank", { bank: cycleBank() });
  assert.equal((await call(h, "PUT", "/v1/cycle", { last_start: "2026-12-08" })).statusCode, 200);
  const g = parse(await call(h, "GET", "/v1/cycle"));
  assert.equal(g.shape.last_start, "2026-12-08");
  assert.deepEqual(g.shape.length_days, { min: 27, max: 29 });
  assert.equal((await call(h, "PUT", "/v1/cycle", { last_start: "last week" })).statusCode, 400);
  assert.equal((await call(h, "PUT", "/v1/cycle", { length_days: { min: 0, max: 5 } })).statusCode, 400);
});
test("deleting cycle data removes the item and the phase rules from every bank version", async () => {
  const { s, h } = await setup();
  await call(h, "PUT", "/v1/bank", { bank: cycleBank() });
  await call(h, "PUT", "/v1/bank", { bank: cycleBank() });
  assert.equal((await call(h, "POST", "/v1/cycle/delete")).statusCode, 200);
  assert.equal(s.m.get("USER#kyra|CYCLE"), undefined);
  for (const r of [...s.m.values()].filter((i) => i.sk.startsWith("BANK#"))) { assert.equal(r.bank.profile.cycle, undefined); }
  assert.deepEqual(parse(await call(h, "GET", "/v1/cycle")), { stored: false });
});
test("cycle data of one person is not readable with another's token", async () => {
  const { h } = await setup();
  await call(h, "PUT", "/v1/bank", { bank: cycleBank() });
  assert.deepEqual(parse(await call(h, "GET", "/v1/cycle", undefined, OTHER)), { stored: false });
});
