"use strict";
// Plans the sample day with js/planner.js and checks the tree against the rules in MODEL.md.
const path = require("path");
const Model = require(path.join(__dirname, "..", "js", "model.js"));
const Planner = require(path.join(__dirname, "..", "js", "planner.js"));
const Sample = require(path.join(__dirname, "..", "js", "sample.js"));
const mins = Model.mins;

const problems = [];
function bad(msg) { problems.push(msg); }
const PRAISE = /great job|well done|good job|proud of you|amazing|you did it|nailed it|awesome/i;
const KINDS = ["routine", "variation", "wild", "checklist", "quiet", "flirty", "info"];
const OPT = {};
Planner.OPTIONS.forEach(function (o) { OPT[o.id] = o; });

function ctxWith(over) { return Object.assign({}, Sample.context, over || {}); }

function checkTree(label, bundle) {
  const nodes = bundle.nodes;
  const ids = Object.keys(nodes);
  ids.forEach(function (id) {
    const n = nodes[id];
    const where = label + " node " + id;
    if (!n.title) { bad(where + ": missing title"); }
    if (mins(n.window[1]) <= mins(n.window[0])) { bad(where + ": window ends before it starts"); }
    if (n.cards.length > 4) { bad(where + ": more than 4 cards"); }
    if (!n.cards.length && !n.quiet) { bad(where + ": no cards and no quiet text"); }
    if (!("expired" in n.children)) { bad(where + ": missing 'expired' child"); }
    if (n.reroll && !n.children.reroll) { bad(where + ": reroll on but no reroll child"); }
    if (!n.reroll && n.children.reroll) { bad(where + ": reroll child but reroll off"); }
    const real = n.cards.filter(function (x) { return !OPT[x].filler; }).length;
    const fillers = n.cards.length - real;
    if (fillers > 0 && real >= (n.type === "during_event" ? 1 : 2)) { bad(where + ": fillers crowd a screen that has " + real + " real options"); }
    let flirty = 0;
    n.cards.forEach(function (cid) {
      const c = bundle.cards[cid];
      if (!c) { bad(where + ": unknown card " + cid); return; }
      if (PRAISE.test(c.text)) { bad(where + ": praise wording: " + c.text); }
      if (KINDS.indexOf(c.tags.kind) === -1) { bad(where + ": unknown kind " + c.tags.kind); }
      if (c.tags.kind === "flirty") { flirty++; }
      const at = OPT[cid].at[n.type] || {};
      (at.needs || []).forEach(function (need) { if (n.facts.indexOf(need) === -1) { bad(where + ": " + cid + " shown without " + need); } });
      (OPT[cid].skipIf || []).forEach(function (s) { if (n.facts.indexOf(s) !== -1) { bad(where + ": " + cid + " shown despite " + s); } });
      const gives = OPT[cid].gives || [];
      if (gives.length && gives.every(function (g) { return n.facts.indexOf(g) !== -1; })) { bad(where + ": " + cid + " shown though it has nothing left to give"); }
      const child = n.children["picked:" + cid];
      if (!child || !nodes[child]) { bad(where + ": no child for pick " + cid); }
      else if (nodes[child].cards.indexOf(cid) !== -1) { bad(where + ": " + cid + " comes back after being picked"); }
    });
    if (flirty > 1) { bad(where + ": more than one flirty card"); }
    Object.keys(n.children).forEach(function (k) {
      const t = n.children[k];
      if (t !== null && !nodes[t]) { bad(where + ": child " + k + " points to missing node " + t); }
    });
  });

  const reach = {};
  (function walk(id) {
    if (!id || reach[id] || !nodes[id]) { return; }
    reach[id] = true;
    Object.keys(nodes[id].children).forEach(function (k) { walk(nodes[id].children[k]); });
  })(bundle.root);
  ids.forEach(function (id) { if (!reach[id]) { bad(label + " node " + id + " is unreachable"); } });

  let id = bundle.root, prevEnd = null, first = true;
  const seen = {};
  while (id) {
    if (seen[id]) { bad(label + ": expired chain loops at " + id); break; }
    seen[id] = true;
    const n = nodes[id];
    if (first && n.window[0] !== "07:30") { bad(label + ": the day starts at " + n.window[0]); }
    first = false;
    if (prevEnd !== null && mins(n.window[0]) !== prevEnd) { bad(label + ": gap in the do-nothing chain before " + id); }
    prevEnd = mins(n.window[1]);
    id = n.children.expired;
  }
  if (prevEnd !== mins("23:59")) { bad(label + ": the do-nothing chain ends at " + Model.hhmm(prevEnd)); }
}

// follow a list of picks starting from the screen that is current at `now` (the do-nothing path), looking
// on the "show different options" page too when a card is not on the first screen
function after(bundle, picks, now) {
  let id = Model.advance(bundle, { node: bundle.root }, mins(now)).id;
  picks.forEach(function (p) {
    const n = bundle.nodes[id];
    let next = n.children["picked:" + p];
    if (!next && n.reroll) { next = bundle.nodes[n.children.reroll].children["picked:" + p]; }
    if (!next) { bad("cannot pick " + p + " at " + id); return; }
    id = next;
  });
  const v = Model.advance(bundle, { node: id }, mins(now));
  return { title: v.node ? v.node.title : null, cards: v.cards.map(function (c) { return c.id; }), node: v.node };
}

const normal = Planner.plan(Sample.context, { energy: "normal" });
const low = Planner.plan(Sample.context, { energy: "low" });
const noEvents = Planner.plan(ctxWith({ calendar: [] }), { energy: "normal" });
const allRain = Planner.plan(ctxWith({ weather: [{ from: "00:00", to: "23:59", sky: "rain" }] }), { energy: "normal" });
checkTree("sample", normal);
checkTree("low energy", low);
checkTree("no events", noEvents);
const sleep5 = Planner.plan(Sample.context, { energy: "normal", sleep: 5 });
const sleep7 = Planner.plan(Sample.context, { energy: "normal", sleep: 7 });
const sleep9 = Planner.plan(Sample.context, { energy: "normal", sleep: 9 });
const lowSleep9 = Planner.plan(Sample.context, { energy: "low", sleep: 9 });
checkTree("all rain", allRain);
checkTree("sleep 5", sleep5);
checkTree("sleep 9", sleep9);

// the cards on a screen, plus the "show different options" page
function screen(bundle, picks, now) {
  const r = after(bundle, picks, now);
  const n = r.node;
  const more = n && n.reroll && bundle.nodes[n.children.reroll] ? bundle.nodes[n.children.reroll].cards : [];
  return { title: r.title, cards: r.cards, offered: r.cards.concat(more), node: n };
}

function expect(name, r, rule) {
  const miss = [];
  (rule.has || []).forEach(function (id) { if (r.cards.indexOf(id) === -1) { miss.push("missing " + id); } });
  (rule.lacks || []).forEach(function (id) { if (r.offered.indexOf(id) !== -1) { miss.push("should not offer " + id); } });
  (rule.any || []).forEach(function (grp) { if (!grp.some(function (id) { return r.offered.indexOf(id) !== -1; })) { miss.push("none of " + grp.join("/")); } });
  (rule.offers || []).forEach(function (id) { if (r.offered.indexOf(id) === -1) { miss.push("never offered " + id); } });
  if (rule.count && (r.cards.length < rule.count[0] || r.cards.length > rule.count[1])) { miss.push("shows " + r.cards.length + " cards, wanted " + rule.count.join("-")); }
  if (rule.first && r.cards[0] !== rule.first) { miss.push("first card is " + r.cards[0] + ", wanted " + rule.first); }
  if (rule.title && r.title !== rule.title) { miss.push("title is " + r.title + ", wanted " + rule.title); }
  if (rule.quiet && (r.cards.length || !r.node.quiet)) { miss.push("expected a quiet screen"); }
  const ok = !miss.length;
  if (!ok) { bad("test '" + name + "': " + miss.join("; ") + " (cards: " + r.cards.join(",") + ")"); }
  console.log((ok ? "ok   " : "FAIL ") + name + "  ->  " + (r.cards.join(", ") || "(quiet)"));
}

expect("08:10 first screen", screen(normal, [], "08:10"), { has: ["coffee_window", "shower"], lacks: ["perfume", "market_flowers", "write_25"], count: [2, 4] });
expect("after shower: dressing comes next, not perfume", screen(normal, ["shower"], "08:10"), { has: ["get_dressed"], lacks: ["perfume", "market_flowers"] });
expect("after shower and dressing: the market is on offer", screen(normal, ["shower", "get_dressed"], "08:10"), { offers: ["market_flowers"] });
expect("after the market walk: coffee and eggs are gone, a croissant is next", screen(normal, ["shower", "get_dressed", "market_flowers"], "08:10"), { has: ["croissant"], lacks: ["coffee_window", "eat_first", "walk_block"] });
expect("after the croissant: writing opens up", screen(normal, ["shower", "get_dressed", "market_flowers", "croissant"], "08:10"), { lacks: ["croissant", "coffee_window", "eat_first"], any: [["write_25", "putoff_ten", "two_emails", "flowers_water"]] });
(function () {
  const n = normal.nodes[normal.nodes[normal.root].children["picked:coffee_window"]];
  const r = { cards: normal.nodes[n.children.reroll].cards, node: n };
  const overlap = r.cards.filter(function (id) { return n.cards.indexOf(id) !== -1; });
  if (overlap.length) { bad("reroll repeats " + overlap.join(",")); }
  console.log((overlap.length ? "FAIL " : "ok   ") + "reroll after coffee shows different cards  ->  " + r.cards.join(", "));
})();
expect("11:40 before the appointment", screen(normal, [], "11:40"), { title: "Before 12:30", any: [["getting_ready", "bag_keys", "eat_before_out"]] });
(function () {
  const n = normal.nodes[Model.advance(normal, { node: normal.root }, mins("11:40")).id];
  const r = { title: n.title, cards: normal.nodes[n.children["picked:getting_ready"]].cards, node: normal.nodes[n.children["picked:getting_ready"]] };
  r.offered = r.cards.concat(r.node.reroll ? normal.nodes[r.node.children.reroll].cards : []);
  expect("after getting ready, leaving early is on offer", r, { offers: ["leave_early"], lacks: ["getting_ready"] });
})();
expect("12:40 during the appointment: one card, leave when it is time", screen(normal, [], "12:40"), { title: "Appointment", count: [1, 1], has: ["leave_now"] });
expect("14:10 dry afternoon offers the park", screen(normal, [], "14:10"), { title: "Afternoon", offers: ["park_walk"] });
expect("14:10 with rain all day: no park walk", screen(allRain, [], "14:10"), { lacks: ["park_walk"] });
expect("14:10 low energy starts with lying down", screen(low, [], "14:10"), { first: "lie_down_20" });
expect("20:30 night is never empty: a bedtime routine", screen(normal, [], "20:30"), { title: "Tonight", count: [2, 4], any: [["phone_charge", "wash_face"]] });
expect("no appointment: 11:40 is still morning", screen(noEvents, [], "11:40"), { title: "Morning" });
expect("evening starts with dinner", screen(normal, [], "18:00"), { any: [["chicken_bowl", "soup_bread", "new_recipe"]], title: "Evening" });

// low energy never offers a demanding option anywhere
(function () {
  const hits = [];
  Object.keys(low.nodes).forEach(function (id) { low.nodes[id].cards.forEach(function (c) { if (OPT[c].demanding) { hits.push(c); } }); });
  if (hits.length) { bad("low energy offers demanding options: " + hits.slice(0, 5).join(",")); }
  console.log((hits.length ? "FAIL " : "ok   ") + "low energy never offers a demanding option");
})();

// what each pick leads to
(function () {
  const evening = normal.nodes[Model.advance(normal, { node: normal.root }, mins("18:00")).id];
  const cooking = normal.nodes[evening.children["picked:new_recipe"]];
  expect("cooking something new leads to recipes, and only recipes", { cards: cooking.cards, offered: cooking.cards.concat(cooking.reroll ? normal.nodes[cooking.children.reroll].cards : []), node: cooking }, { lacks: ["chicken_bowl", "soup_bread", "clear_up", "evening_text"], count: [2, 4], any: [["recipe_risotto"]] });
  const recipeOnly = cooking.cards.every(function (x) { return x.indexOf("recipe_") === 0; });
  if (!recipeOnly) { bad("the screen after 'cook something new' is not all recipes: " + cooking.cards.join(",")); }
  const cooked = normal.nodes[cooking.children["picked:recipe_curry"]];
  expect("after picking a recipe, dinner is done and the evening carries on", { cards: cooked.cards, offered: cooked.cards.concat(cooked.reroll ? normal.nodes[cooked.children.reroll].cards : []), node: cooked }, { lacks: ["new_recipe", "chicken_bowl", "soup_bread", "recipe_risotto"], any: [["clear_up", "evening_text", "walk_after"]] });
})();
expect("after writing: read it back or take a break", screen(normal, ["coffee_window", "write_25"], "08:10"), { has: ["read_back"] });
expect("after the park walk: sit down for a bit", screen(normal, ["park_walk"], "14:10"), { has: ["park_sit"] });
expect("after sketching: pin it up", screen(normal, ["sketch_15"], "14:10"), { offers: ["pin_sketch"] });
expect("after a bath: get comfortable", screen(normal, ["chicken_bowl", "clear_up", "evening_text", "bath"], "18:00"), { offers: ["comfy_clothes"] });
expect("after leaving for the appointment: phone on silent", screen(normal, ["leave_now"], "12:40"), { has: ["silent_phone"] });
expect("after the phone is on silent there is still something", screen(normal, ["leave_now", "silent_phone"], "12:40"), { count: [1, 1] });
expect("after getting ready: leave early comes first", screen(normal, ["getting_ready"], "11:40"), { first: "leave_early" });

// the day never runs dry: from every part of the day, picking the first card keeps giving something
(function () {
  const sess = Planner.session(Sample.context, { energy: "normal" });
  const b = sess.bundle;
  const times = [["morning", "08:10", 8], ["before the appointment", "11:40", 4], ["the appointment", "12:40", 5], ["afternoon", "14:10", 8], ["evening", "18:00", 8], ["night", "20:30", 4]];
  times.forEach(function (t) {
    let id = Model.advance(b, { node: b.root }, mins(t[1]), sess.ensure).id, steps = 0;
    for (let i = 0; i < 40; i++) {
      const v = Model.advance(b, { node: id }, mins(t[1]), sess.ensure);
      if (!v.node || !v.cards.length) { break; }
      steps++;
      id = v.node.children["picked:" + v.cards[0].id];
    }
    const ok = steps >= t[2];
    if (!ok) { bad("the " + t[0] + " runs dry after " + steps + " picks (wanted at least " + t[2] + ")"); }
    console.log((ok ? "ok   " : "FAIL ") + "the " + t[0] + ": first card " + steps + " times in a row, still something to choose");
  });
  // the bedtime routine ends the day
  let id = Model.advance(b, { node: b.root }, mins("20:30"), sess.ensure).id;
  ["phone_charge", "wash_face", "read_bed", "lights_out"].forEach(function (p) {
    const v = Model.advance(b, { node: id }, mins("20:30"), sess.ensure);
    if (v.cards.map(function (x) { return x.id; }).indexOf(p) === -1) { bad("bedtime: " + p + " is not on offer"); return; }
    id = v.node.children["picked:" + p];
  });
  const last = Model.advance(b, { node: id }, mins("20:30"), sess.ensure);
  const ok = !last.cards.length && last.node && last.node.quiet;
  if (!ok) { bad("after lights out the evening should be done"); }
  console.log((ok ? "ok   " : "FAIL ") + "after lights out the day is done  ->  " + (last.node ? last.node.quiet : ""));
})();

// sleep: three plans, a gentler one after about 5 hours, the ordinary one at 7, more room at 9
(function () {
  const rows = [];
  function row(name, ok, detail) { if (!ok) { bad("sleep: " + name + " (" + detail + ")"); } rows.push((ok ? "ok   " : "FAIL ") + name + "  ->  " + detail); }
  const hitsDemanding = function (b) { const h = []; Object.keys(b.nodes).forEach(function (id) { b.nodes[id].cards.forEach(function (x) { if (OPT[x].demanding) { h.push(x); } }); }); return h; };
  const d5 = hitsDemanding(sleep5);
  row("5 hours: nothing demanding is offered anywhere", d5.length === 0, d5.length ? d5.slice(0, 3).join(",") : "none");
  const a5 = screen(sleep5, [], "14:10").cards;
  row("5 hours: the afternoon starts with lying down", a5[0] === "lie_down_20", a5.join(","));
  const m9 = screen(sleep9, ["coffee_window"], "08:10");
  row("9 hours: writing is on the first screen after coffee", m9.cards.indexOf("write_25") !== -1, m9.cards.join(","));
  const m7 = screen(sleep7, ["coffee_window"], "08:10");
  row("7 hours: the same morning as the default plan", JSON.stringify(m7.cards) === JSON.stringify(screen(normal, ["coffee_window"], "08:10").cards) && Object.keys(sleep7.nodes).length === Object.keys(normal.nodes).length, m7.cards.join(","));
  const same = JSON.stringify(screen(lowSleep9, [], "14:10").cards) === JSON.stringify(screen(normal, [], "14:10").cards);
  row("low energy after 9 hours of sleep is an ordinary day", same, screen(lowSleep9, [], "14:10").cards.join(","));
  const avg = function (b) { let t = 0, k = 0; Object.keys(b.nodes).forEach(function (id) { const n = b.nodes[id].cards.length; if (n) { t += n; k++; } }); return t / k; };
  row("more cards after a long night, fewer after a short one", avg(sleep9) > avg(normal) && avg(normal) > avg(sleep5), avg(sleep5).toFixed(2) + " < " + avg(normal).toFixed(2) + " < " + avg(sleep9).toFixed(2) + " cards a screen");
  rows.forEach(function (r) { console.log(r); });
})();

// after dinner there is plenty to choose from
(function () {
  const evening = normal.nodes[Model.advance(normal, { node: normal.root }, mins("18:00")).id];
  const afterDinner = normal.nodes[evening.children["picked:chicken_bowl"]];
  const seen = {};
  afterDinner.cards.forEach(function (x) { seen[x] = true; });
  if (afterDinner.reroll) { normal.nodes[afterDinner.children.reroll].cards.forEach(function (x) { seen[x] = true; }); }
  const n = Object.keys(seen).length;
  const ok = n >= 4;
  if (!ok) { bad("after dinner only " + n + " options are offered"); }
  console.log((ok ? "ok   " : "FAIL ") + "after dinner " + n + " options across the screen and its reroll  ->  " + Object.keys(seen).join(", "));
})();

// the number of cards varies, and never exceeds four
(function () {
  const dist = { 1: 0, 2: 0, 3: 0, 4: 0 };
  Object.keys(normal.nodes).forEach(function (id) { const k = normal.nodes[id].cards.length; if (k) { dist[k]++; } });
  const total = dist[1] + dist[2] + dist[3] + dist[4];
  const ok = dist[1] > 0 && dist[2] > 0 && dist[3] > 0 && dist[4] > 0 && dist[4] / total < 0.4;
  if (!ok) { bad("card counts are not varied enough: " + JSON.stringify(dist)); }
  console.log((ok ? "ok   " : "FAIL ") + "card counts vary  ->  1: " + dist[1] + ", 2: " + dist[2] + ", 3: " + dist[3] + ", 4: " + dist[4]);
})();

// flirty options turn up some days and not others: each can be found within a month, and the two
// evening ones are on offer on the sample day
(function () {
  const flirty = Planner.OPTIONS.filter(function (o) { return o.kind === "flirty"; });
  const onSample = {};
  Object.keys(normal.nodes).forEach(function (id) { normal.nodes[id].cards.forEach(function (x) { if (OPT[x].kind === "flirty") { onSample[x] = true; } }); });
  const problems2 = [];
  flirty.forEach(function (o) {
    const block = Object.keys(o.at)[0];
    let days = 0;
    for (let d = 0; d < 30; d++) {
      const day = "2026-11-" + String(13 + d > 30 ? 13 + d - 30 : 13 + d).padStart(2, "0") + (13 + d > 30 ? "x" : "");
      if (Planner.hash(day + "|" + block + "|" + o.id) % 100 < Math.round(o.chance * 100)) { days++; }
    }
    if (!days) { problems2.push(o.id + " never appears in a month"); }
  });
  ["evening_text", "good_thing"].forEach(function (id) { if (!onSample[id]) { problems2.push(id + " is not on offer on the sample day"); } });
  problems2.forEach(function (m) { bad("flirty: " + m); });
  console.log((problems2.length ? "FAIL " : "ok   ") + "flirty options turn up some days (" + Object.keys(onSample).join(", ") + " today)");
})();

// the lazy session the app uses: pick the first card every time and there is still something to choose
// deep into the morning, and progress survives a replan
(function () {
  const sess = Planner.session(Sample.context, { energy: "normal" });
  const b = sess.bundle;
  let id = b.root, steps = 0, mid = null;
  for (let i = 0; i < 20; i++) {
    const v = Model.advance(b, { node: id }, mins("08:10"), sess.ensure);
    if (!v.node || !v.cards.length) { break; }
    steps++;
    if (steps === 4) { mid = v.id; }
    id = v.node.children["picked:" + v.cards[0].id];
  }
  const ok = steps >= 8;
  if (!ok) { bad("lazy: the morning goes quiet after only " + steps + " picks"); }
  console.log((ok ? "ok   " : "FAIL ") + "picking the first card " + steps + " times in a row still leaves something to choose");

  const low = Planner.session(Sample.context, { energy: "low" });
  const restored = low.restore(mid);
  const rv = Model.advance(low.bundle, { node: restored }, mins("08:10"), low.ensure);
  const keep = restored === mid && rv.node && rv.node.facts.length >= 3;
  if (!keep) { bad("lazy: progress is lost when the plan is rebuilt"); }
  console.log((keep ? "ok   " : "FAIL ") + "a rebuilt plan keeps where you were");
})();

console.log("");
console.log(Object.keys(normal.nodes).length + " nodes, " + Object.keys(normal.cards).length + " cards (normal energy); " + Object.keys(low.nodes).length + " nodes (low energy)");
if (problems.length) {
  console.log("\n" + problems.length + " problem(s):");
  problems.slice(0, 25).forEach(function (p) { console.log(" - " + p); });
  if (problems.length > 25) { console.log(" ... and " + (problems.length - 25) + " more"); }
  process.exit(1);
}
console.log("all checks passed");
