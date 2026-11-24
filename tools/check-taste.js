"use strict";
// Checks js/taste.js and its use in the planner (opts.learned).
//   node tools/check-taste.js            unit cases, then a 40-day simulated user with and without learning
//   node tools/check-taste.js --verbose  also prints the numbers behind each check
// The simulated user has fixed likes and dislikes, picks among the cards on screen with some noise, and sometimes
// turns down something they dislike. The log they leave is read by Taste, and the next day is planned with it.
const path = require("path");
const Taste = require(path.join(__dirname, "..", "js", "taste.js"));
const Planner = require(path.join(__dirname, "..", "js", "planner.js"));
const Learner = require(path.join(__dirname, "..", "js", "learner.js"));
const Sample = require(path.join(__dirname, "..", "js", "sample.js"));

const verbose = process.argv.indexOf("--verbose") !== -1;
const problems = [];
const bad = (m) => problems.push(m);
const say = (m) => { if (verbose) { console.log(m); } };
const DAY = 86400000, T0 = Date.UTC(2026, 9, 1, 0, 0, 0);

// ---- unit cases ----
let n = 0;
function set(t, shown, over) {
  return Object.assign({
    id: "s" + (n++), t0: t, t1: t + 5000, outcome: "picked", pick: null, slice: "weekday-morning", events: [], views: [[t, t + 5000]],
    cards: shown.map((o, i) => ({ card: o, option: o, pos: i, active: false, onScreen: true, seenAt: t }))
  }, over || {});
}
const bank = [{ id: "a", text: "a" }, { id: "b", text: "b" }, { id: "c", text: "c" }, { id: "d", text: "d" }];
const NOW = T0 + 30 * DAY;

if (Taste.build([], bank, NOW) !== null) { bad("an empty log should build nothing"); }
if (Taste.build([set(NOW, ["a", "b"], { pick: "a" })], bank, NOW) !== null) { bad("one set should be too little to build from"); }

// "a" is picked every time it appears with b, c and d. "b" is turned down. "c" is shown and ignored.
let log = [];
for (let i = 0; i < 20; i++) {
  const t = NOW - (20 - i) * 3600000;
  log.push(set(t, ["a", "b", "c", "d"], i % 2 === 0 ? { pick: "a" } : { outcome: "rejected", pick: "b", events: [{ t, type: "reject_reason", reason: "not_feeling_it" }] }));
}
let T = Taste.build(log, bank, NOW);
if (!T) { bad("twenty sets did not build"); } else {
  if (!(T.any.a < 0)) { bad("an option picked every time it was owed should move earlier (got " + T.any.a + ")"); }
  if (!(T.any.b > 0)) { bad("an option turned down half the time should move later (got " + T.any.b + ")"); }
  if (!(T.any.c > 0)) { bad("an option passed over again and again should step back (got " + T.any.c + ")"); }
  if (!(T.any.a < T.any.d)) { bad("the favourite should rank ahead of an option that was never chosen"); }
  if (T.any.a < -5.001 || T.any.b > 11.001) { bad("shifts are not bounded"); }
  if (T.seen.a !== 20) { bad("seen count wrong: " + T.seen.a); }
}

// a glance says nothing, and older sets count for less
const glances = log.map((r) => Object.assign({}, r, { outcome: "expired", pick: null, views: [[r.t0, r.t0 + 500]] }));
const gt = Taste.build(glances, bank, NOW);
if (gt && Object.keys(gt.seen).length) { bad("glances were counted as impressions"); }
const old = log.map((r) => Object.assign({}, r, { t0: r.t0 - 200 * DAY, views: [[r.t0 - 200 * DAY, r.t0 - 200 * DAY + 5000]] }));
const ot = Taste.build(old, bank, NOW);
if (ot && !(Math.abs(ot.any.a) < Math.abs(T.any.a))) { bad("sets from months ago counted as much as recent ones"); }

// the input is not changed, and the same log gives the same answer
const copy = JSON.stringify(log);
Taste.build(log, bank, NOW);
if (JSON.stringify(log) !== copy) { bad("build changed the log"); }
if (JSON.stringify(Taste.build(log, bank, NOW)) !== JSON.stringify(T)) { bad("build is not deterministic"); }

// a child starts from its parent's lift
const tree = [{ id: "cat", text: "cat", opens: "cat" }, { id: "kid", text: "kid", under: "cat" }, { id: "x", text: "x" }];
let tl = [];
for (let i = 0; i < 20; i++) { tl.push(set(NOW - i * 3600000, ["cat", "x"], { pick: "cat" })); }
const tt = Taste.build(tl, tree, NOW);
if (!(tt.lift.kid > 1)) { bad("an option with no history should start from the lift of the category it sits under (got " + tt.lift.kid + ")"); }

// cadence inputs
const c = Taste.counts([set(NOW - DAY, ["a"], { pick: "a" }), set(NOW - 2 * DAY, ["a"], { pick: "a" }), set(NOW - 9 * DAY, ["b"], { pick: "b" })], NOW);
if (c.weekCounts.a !== 2 || c.weekCounts.b) { bad("weekCounts wrong: " + JSON.stringify(c.weekCounts)); }
if (c.daysSince.a !== 1 || c.daysSince.b !== 9) { bad("daysSince wrong: " + JSON.stringify(c.daysSince)); }

// the mood of the day: a few gentle picks move every gentle option earlier, and every demanding one later, at once
const traitBank = [{ id: "g1", gentle: true }, { id: "g2", gentle: true }, { id: "h1", demanding: true, signal: { energy: 1 } }, { id: "h2", demanding: true }, { id: "n1" }];
const morning = [set(NOW - 2 * 3600000, ["g1", "h1", "n1", "h2"], { pick: "g1" }), set(NOW - 3600000, ["g1", "h1", "n1", "g2"], { pick: "g1" })];
const mt = Taste.build(morning, traitBank, NOW);
if (!mt) { bad("two picks this morning built nothing, but the mood does not wait for history"); }
else {
  if (!(mt.mood.g2 < 0)) { bad("a gentle option never offered did not move earlier after gentle picks (" + mt.mood.g2 + ")"); }
  if (!(mt.mood.h2 > 0)) { bad("a demanding option did not move later after gentle picks (" + mt.mood.h2 + ")"); }
  if (mt.mood.n1) { bad("an option with no traits moved with the mood"); }
}
if (Taste.build(morning, traitBank, NOW + 20 * 3600000)) { bad("yesterday's mood carried into tomorrow"); }
const turnedDown = [set(NOW - 600000, ["h1", "h2", "g1", "n1"], { outcome: "rejected", pick: "h1", events: [{ t: NOW, type: "reject_reason", reason: "not_feeling_it" }] })];
const rt = Taste.build(turnedDown, traitBank, NOW);
if (!rt || !(rt.mood.h2 > 0)) { bad("turning down a demanding option did not move the other demanding ones later"); }

// lenses: a pattern that is really there moves the cards, only in the lens state it was found in, and noise does not
function lensSets(statesFor, pickGentle, seed) {
  const rand = rng(seed), out = [];
  for (let i = 0; i < 160; i++) {
    const t = NOW - (160 - i) * 7200000 + (i % 7) * 60000, st = statesFor(i, rand);
    const gentle = rand() < pickGentle(st);
    const pickId = gentle ? (rand() < 0.5 ? "g1" : "g2") : (rand() < 0.5 ? "h1" : "h2");
    const L = { enabled: { sleep: true, moon: true } };
    if (st.sleep) { L.sleep = { state: st.sleep }; }
    if (st.moon) { L.moon = { group: st.moon }; }
    out.push(set(t, ["g1", "g2", "h1", "h2"], { pick: pickId, slice: "weekday-morning", lenses: L }));
  }
  return out;
}
const lensBank = traitBank.slice(0, 4);
const real = lensSets((i) => ({ sleep: i % 2 ? "short" : "ok" }), (st) => (st.sleep === "short" ? 0.9 : 0.15), 5);
const lShort = Taste.build(real, lensBank, NOW, { states: { sleep: "short" } });
const slice0 = lShort && lShort.lens["weekday-morning"];
if (!slice0) { bad("a clear sleep pattern produced no lens shift"); }
else if (!(slice0.g1 < 0 && slice0.h1 > 0)) { bad("after short nights gentle options should move earlier and demanding later (" + JSON.stringify(slice0) + ")"); }
if (lShort && Object.keys(lShort.lens).some((k) => k !== "weekday-morning")) { bad("a lens shift appeared in a slice it was not found in"); }
const lOk = Taste.build(real, lensBank, NOW, { states: { sleep: "ok" } }).lens["weekday-morning"];
if (!lOk || !(lOk.h1 < 0 && lOk.g1 > 0)) { bad("the same pattern should point the other way in the other sleep state"); }
const none = Taste.build(real, lensBank, NOW, { states: { moon: "full" } }).lens;
if (Object.keys(none).length) { bad("a lens state with no pattern moved cards"); }
if (Object.keys(Taste.build(real, lensBank, NOW).lens).length) { bad("lens shifts appeared with no lens state given"); }
let falseRuns = 0;
for (let sd = 1; sd <= 40; sd++) {
  const noise = lensSets((i, r) => ({ moon: ["new", "waxing", "full", "waning"][Math.floor(r() * 4)] }), () => 0.5, 100 + sd);
  const b = Taste.build(noise, lensBank, NOW, { states: { moon: "full" } });
  if (b && Object.keys(b.lens).length) { falseRuns++; }
}
say("lens shifts from pure noise: " + falseRuns + " of 40 runs");
if (falseRuns > 3) { bad("a lens with no effect moved cards in " + falseRuns + " of 40 runs"); }

// ---- planner use ----
const ctx = Object.assign({}, Sample.context);
const plain = Planner.plan(ctx, {}), same = Planner.plan(ctx, { learned: null });
if (JSON.stringify(plain.nodes[plain.root].cards) !== JSON.stringify(same.nodes[same.root].cards)) { bad("planning without learned changed"); }
const favour = { any: { c_errands: -8, c_move: 8 }, slices: {}, seen: {}, seenFull: 3, exploreMax: 0, jitter: 0 };
const a1 = Planner.session(Object.assign({}, ctx, { day: "2026-11-14" }), { learned: favour });
const b1 = Planner.session(Object.assign({}, ctx, { day: "2026-11-14" }), {});
const ca = a1.bundle.nodes[a1.bundle.root].cards, cb = b1.bundle.nodes[b1.bundle.root].cards;
if (ca.indexOf("c_errands") === -1 || ca.indexOf("c_errands") >= cb.indexOf("c_errands")) { bad("a negative shift did not move an option earlier (" + cb.join() + " -> " + ca.join() + ")"); }
const again = Planner.session(Object.assign({}, ctx, { day: "2026-11-14" }), { learned: favour });
if (JSON.stringify(again.bundle.nodes[again.bundle.root].cards) !== JSON.stringify(ca)) { bad("planning with learned is not deterministic for a day"); }

// ---- simulated user ----
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const LIKE = { c_move: 1.5, c_creative: 1.5, c_mindful: 1, m_walk: 2, st_hips: 1.5, m_stretch: 1.5, cr_write: 2, cr_draw: 1, mi_meditate: 1.5, rx_read: 1, cn_call: 1, c_connect: 0.5 };
const DISLIKE = { c_errands: -3, c_resp: -2.5, c_work: -1, w_mail: -2, m_strong: -2, e_post: -2, r_house: -2, e_shop: -2, rw_invoice: -1.5, c_eat: -0.5 };
const util = (id) => (LIKE[id] || 0) + (DISLIKE[id] || 0);
const isCat = (id) => !!(Planner.OPTIONS.filter((o) => o.id === id)[0] || {}).opens;
const leafOpts = Planner.OPTIONS.filter((o) => !o.opens && !o.filler && !o.kind).map((o) => o.id);

function simulate(days, learning, seed) {
  const rand = rng(seed), lg = [], shownEver = {}, perDay = [];
  for (let d = 0; d < days; d++) {
    const t0 = T0 + d * DAY, dt = new Date(t0), day = dt.toISOString().slice(0, 10), dow = dt.getUTCDay();
    const cx = Object.assign({}, Sample.context, { day });
    const taste = learning ? Taste.build(lg, Planner.OPTIONS, t0) : null;
    const sess = Planner.session(Object.assign({}, cx, learning ? Taste.counts(lg, t0) : {}), { learned: taste });
    const nodes = sess.bundle.nodes;
    let key = sess.bundle.root, inBlock = 0, shownCount = 0, dislikedShown = 0, likedShown = 0, leafPicks = 0, likedPicks = 0, clock = 7.5 * 60;
    for (let step = 0; step < 40; step++) {
      sess.ensure(key);
      const node = nodes[key];
      if (!node.cards.length) { if (!node.children.expired) { break; } key = node.children.expired; inBlock = 0; continue; }
      const shown = node.cards.slice(0, node.show);
      shown.forEach((id) => { shownEver[id] = true; shownCount++; if (DISLIKE[id]) { dislikedShown++; } if (LIKE[id]) { likedShown++; } });
      const t = t0 + clock * 60000, mins = Math.floor(clock);
      const base = { id: "i" + lg.length, t0: t, t1: t + 8000, slice: Learner.sliceOf(dow, mins), events: [], views: [[t, t + 8000]], cards: node.cards.map((id, i) => ({ card: id, option: id, pos: i, active: false, onScreen: i < node.show, seenAt: i < node.show ? t : null })) };
      // turn down something disliked, sometimes
      const worst = shown.slice().sort((x, y) => util(x) - util(y))[0];
      if (util(worst) <= -2 && rand() < 0.5) {
        lg.push(Object.assign(base, { outcome: "rejected", pick: worst, events: [{ t, type: "reject_reason", reason: "not_feeling_it" }] }));
        key = sess.reject(key, worst); clock += 0.5; continue;
      }
      let best = null, bu = -Infinity;
      shown.forEach((id) => { const u = util(id) + (rand() - 0.5) * 3; if (u > bu) { bu = u; best = id; } });
      if (bu < -1.5) { lg.push(Object.assign(base, { outcome: "expired", pick: null })); key = node.children.expired || key; inBlock = 0; clock += 60; if (!node.children.expired) { break; } continue; }
      lg.push(Object.assign(base, { outcome: "picked", pick: best }));
      key = node.children["picked:" + best];
      if (!isCat(best)) { inBlock++; leafPicks++; if (util(best) > 0) { likedPicks++; } clock += 25; }
      if (inBlock >= 3 && nodes[key] && nodes[key].children.expired !== undefined) { sess.ensure(key); if (nodes[key].children.expired) { key = nodes[key].children.expired; inBlock = 0; } }
      if (clock > 22 * 60) { break; }
    }
    perDay.push({ shownCount, dislikedShown, likedShown, leafPicks, likedPicks });
  }
  return { perDay, shownEver, log: lg };
}
function share(rows, a, b, num, den) {
  const sl = rows.slice(a, b), x = sl.reduce((s, r) => s + r[num], 0), y = sl.reduce((s, r) => s + r[den], 0);
  return y ? x / y : 0;
}

const SEEDS = [11, 22, 33];
const agg = { lsFirst: 0, lsLast: 0, lsBase: 0, likedFirst: 0, likedLast: 0, likedLastBase: 0, disFirst: 0, disLast: 0, disLastBase: 0, cov: 0, covBase: 0 };
SEEDS.forEach((seed) => {
  const L = simulate(40, true, seed), B = simulate(40, false, seed);
  agg.lsFirst += share(L.perDay, 0, 10, "likedShown", "shownCount");
  agg.lsLast += share(L.perDay, 30, 40, "likedShown", "shownCount");
  agg.lsBase += share(B.perDay, 30, 40, "likedShown", "shownCount");
  agg.likedFirst += share(L.perDay, 0, 10, "likedPicks", "leafPicks");
  agg.likedLast += share(L.perDay, 30, 40, "likedPicks", "leafPicks");
  agg.likedLastBase += share(B.perDay, 30, 40, "likedPicks", "leafPicks");
  agg.disFirst += share(L.perDay, 0, 10, "dislikedShown", "shownCount");
  agg.disLast += share(L.perDay, 30, 40, "dislikedShown", "shownCount");
  agg.disLastBase += share(B.perDay, 30, 40, "dislikedShown", "shownCount");
  agg.cov += leafOpts.filter((id) => L.shownEver[id]).length / leafOpts.length;
  agg.covBase += leafOpts.filter((id) => B.shownEver[id]).length / leafOpts.length;
});
Object.keys(agg).forEach((k) => { agg[k] /= SEEDS.length; });
say("liked share of cards on screen: first 10 days " + agg.lsFirst.toFixed(2) + ", last 10 days " + agg.lsLast.toFixed(2) + " (no learning " + agg.lsBase.toFixed(2) + ")");
say("liked share of picks:   first 10 days " + agg.likedFirst.toFixed(2) + ", last 10 days " + agg.likedLast.toFixed(2) + " (no learning " + agg.likedLastBase.toFixed(2) + ")");
say("disliked share of cards on screen: first 10 days " + agg.disFirst.toFixed(2) + ", last 10 days " + agg.disLast.toFixed(2) + " (no learning " + agg.disLastBase.toFixed(2) + ")");
say("leaf options shown at least once in 40 days: " + (agg.cov * 100).toFixed(0) + "% (no learning " + (agg.covBase * 100).toFixed(0) + "%)");

if (!(agg.lsLast >= agg.lsBase + 0.05)) { bad("learning did not put more of what the person likes on screen (" + agg.lsLast.toFixed(2) + " vs " + agg.lsBase.toFixed(2) + " without)"); }
if (!(agg.likedLast >= agg.likedLastBase)) { bad("learning did not raise the share of picks the person likes (" + agg.likedLast.toFixed(2) + " vs " + agg.likedLastBase.toFixed(2) + " without)"); }
if (!(agg.disLast <= agg.disLastBase - 0.03)) { bad("learning did not cut how often disliked options are put in front of the person (" + agg.disLast.toFixed(2) + " vs " + agg.disLastBase.toFixed(2) + " without)"); }
if (!(agg.cov >= 0.9 * agg.covBase)) { bad("learning narrowed what is ever shown (" + (agg.cov * 100).toFixed(0) + "% vs " + (agg.covBase * 100).toFixed(0) + "%): it is locking in");}

// ---- one tired day: the app should follow the person within the day, not the next one ----
function tiredDay(learning, seed) {
  const rand = rng(seed), lg = [], t0 = T0 + 3 * DAY, day = new Date(t0).toISOString().slice(0, 10), dow = new Date(t0).getUTCDay();
  const cx = Object.assign({}, Sample.context, { day });
  const byId = {}; Planner.OPTIONS.forEach((o) => { byId[o.id] = o; });
  const gentleU = (id) => (byId[id] && byId[id].gentle ? 2 : byId[id] && byId[id].demanding ? -2 : 0);
  const mk = () => Planner.session(cx, { learned: learning ? Taste.build(lg, Planner.OPTIONS, t0 + clock * 60000) : null });
  let clock = 8 * 60, sess = mk(), key = sess.bundle.root, picked = 0, shownN = 0, gentleN = 0, demandN = 0, step = 0, inBlock = 0;
  for (let i = 0; i < 40 && picked < 14; i++) {
    sess.ensure(key);
    const node = sess.bundle.nodes[key];
    if (!node.cards.length) { if (!node.children.expired) { break; } key = node.children.expired; inBlock = 0; continue; }
    const shown = node.cards.slice(0, node.show);
    if (picked >= 3) { shown.forEach((id) => { shownN++; if (byId[id].gentle) { gentleN++; } if (byId[id].demanding) { demandN++; } }); }
    const t = t0 + clock * 60000;
    let best = null, bu = -Infinity;
    shown.forEach((id) => { const u = gentleU(id) + (rand() - 0.5) * 2; if (u > bu) { bu = u; best = id; } });
    lg.push({ id: "t" + i, t0: t, t1: t + 8000, slice: Learner.sliceOf(dow, Math.floor(clock)), events: [], views: [[t, t + 8000]], outcome: "picked", pick: best, cards: node.cards.map((id, k) => ({ card: id, option: id, pos: k, onScreen: k < node.show, seenAt: t })) });
    const nextKey = node.children["picked:" + best];
    if (!byId[best].opens) { picked++; inBlock++; clock += 20; }
    sess = learning ? mk() : sess;
    key = learning ? sess.restore(nextKey) : nextKey;
    if (inBlock >= 3) { sess.ensure(key); if (sess.bundle.nodes[key].children.expired) { key = sess.bundle.nodes[key].children.expired; inBlock = 0; } }
  }
  return { gentle: shownN ? gentleN / shownN : 0, demanding: shownN ? demandN / shownN : 0 };
}
let tg = 0, tgb = 0, td = 0, tdb = 0;
SEEDS.forEach((seed) => { const a = tiredDay(true, seed), b = tiredDay(false, seed); tg += a.gentle; tgb += b.gentle; td += a.demanding; tdb += b.demanding; });
tg /= SEEDS.length; tgb /= SEEDS.length; td /= SEEDS.length; tdb /= SEEDS.length;
say("tired day, after three picks: gentle share on screen " + tg.toFixed(2) + " vs " + tgb.toFixed(2) + " without; demanding " + td.toFixed(2) + " vs " + tdb.toFixed(2));

if (!(tg >= tgb + 0.05)) { bad("a day of gentle picks did not put more gentle options on screen later the same day (" + tg.toFixed(2) + " vs " + tgb.toFixed(2) + ")"); }
if (!(td <= tdb - 0.02)) { bad("a day of gentle picks did not put fewer demanding options on screen later the same day (" + td.toFixed(2) + " vs " + tdb.toFixed(2) + ")"); }

if (problems.length) { console.log("PROBLEMS:\n- " + problems.join("\n- ")); process.exit(1); }
console.log("taste checks passed");
