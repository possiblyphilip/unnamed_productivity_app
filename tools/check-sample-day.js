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
    if (n.show > 4) { bad(where + ": more than 4 cards on show"); }
    if (n.cards.length > 8) { bad(where + ": more than 8 cards in all"); }
    if (n.cards.length && (!n.show || n.show > n.cards.length)) { bad(where + ": bad show count"); }
    if (!n.cards.length && !n.quiet) { bad(where + ": no cards and no quiet text"); }
    if (!("expired" in n.children)) { bad(where + ": missing 'expired' child"); }
    const onShow = n.cards.slice(0, n.show);
    const real = onShow.filter(function (x) { return !OPT[x].filler; }).length;
    const fillers = onShow.length - real;
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
    if (!next) { bad("cannot pick " + p + " at " + id); return; }
    id = next;
  });
  const v = Model.advance(bundle, { node: id }, mins(now));
  return { title: v.node ? v.node.title : null, cards: v.cards.map(function (c) { return c.id; }).slice(0, v.node ? v.node.show : 0), all: v.cards.map(function (c) { return c.id; }), node: v.node };
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
  return { title: r.title, cards: r.cards, offered: r.all, node: n };
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


// ---- the shape of the tree: broad first, then narrower ----
// a card that sits under a category is only ever shown inside it, and the heading says where you are
(function () {
  const wrong = [];
  [normal, low, noEvents, sleep5, sleep9].forEach(function (b) {
    Object.keys(b.nodes).forEach(function (id) {
      const n = b.nodes[id];
      const inside = n.facts.filter(function (f) { return f.indexOf("in_") === 0; });
      n.cards.forEach(function (c) {
        const o = OPT[c];
        if (!o.under && inside.length) { wrong.push(c + " shown inside " + inside.join(",")); }
        if (o.under && inside.indexOf("in_" + o.under) === -1) { wrong.push(c + " shown outside " + o.under); }
      });
      if (inside.length && n.title.indexOf(" · ") === -1 && inside.length > 1) { wrong.push("title does not show the path: " + n.title); }
    });
  });
  wrong.slice(0, 5).forEach(function (m) { bad("tree shape: " + m); });
  console.log((wrong.length ? "FAIL " : "ok   ") + "narrow cards only appear inside their category, broad ones only on the first screen");
})();

// Kyra's rules for the copy: nothing over-specific on a first screen, nothing obvious, no praise
(function () {
  const problems2 = [];
  const specific = /window|flowers|croissant|perfume|keys|bag\b|dressed|get dressed|eggs|toast|sketch for|market/i;
  Planner.OPTIONS.forEach(function (o) {
    if (specific.test(o.text)) { problems2.push("too specific or obvious: " + o.text); }
    if (!o.under && !o.opens && !o.filler && o.text.split(/\s+/).length > 6) { problems2.push("long first-screen card: " + o.text); }
    if (!o.under && o.text.split(/\s+/).length > 6 && o.opens) { problems2.push("long category: " + o.text); }
  });
  problems2.forEach(function (m) { bad("copy: " + m); });
  console.log((problems2.length ? "FAIL " : "ok   ") + "copy is broad, short and plain (nothing like 'coffee by the window' or 'get dressed')");
})();

expect("08:10 first screen is broad categories", screen(normal, [], "08:10"), { has: ["c_routine", "c_move"], lacks: ["shower", "m_stretch", "st_full"], count: [3, 4] });
(function () {
  const r = screen(normal, [], "08:10");
  const ok = r.offered.length > r.cards.length;
  if (!ok) { bad("nothing waits below the first screen"); }
  console.log((ok ? "ok   " : "FAIL ") + "more cards wait below the first screen  ->  " + r.offered.slice(r.cards.length).join(", "));
})();
expect("Movement opens movement choices", screen(normal, ["c_move"], "08:10"), { title: "Movement", has: ["m_stretch", "m_yoga"], lacks: ["c_routine", "c_move", "st_full"] });
expect("Stretching opens stretching choices, not the generic label", screen(normal, ["c_move", "m_stretch"], "08:10"), { title: "Movement · Stretching", has: ["st_full", "st_hips"], lacks: ["m_stretch", "m_yoga"] });
expect("after a stretch the day goes back to broad choices", screen(normal, ["c_move", "m_stretch", "st_hips"], "08:10"), { has: ["c_routine"], lacks: ["c_move", "st_full", "m_yoga"] });
expect("Back from stretching returns to movement", (function () {
  let id = Model.advance(normal, { node: normal.root }, mins("08:10")).id;
  ["c_move", "m_stretch"].forEach(function (p) { id = normal.nodes[id].children["picked:" + p]; });
  const back = normal.nodes[id].children.back;
  return { title: normal.nodes[back].title, cards: normal.nodes[back].cards.slice(0, normal.nodes[back].show), offered: normal.nodes[back].cards, node: normal.nodes[back] };
})(), { title: "Movement", has: ["m_stretch"] });
expect("Back from movement returns to the first screen with Movement still on offer", (function () {
  let id = Model.advance(normal, { node: normal.root }, mins("08:10")).id;
  id = normal.nodes[id].children["picked:c_move"];
  const back = normal.nodes[id].children.back;
  return { title: normal.nodes[back].title, cards: normal.nodes[back].cards.slice(0, normal.nodes[back].show), offered: normal.nodes[back].cards, node: normal.nodes[back] };
})(), { title: "Morning", has: ["c_move"] });
expect("morning routine stays open for its next step", screen(normal, ["c_routine", "shower"], "08:10"), { title: "Morning routine", has: ["skincare"], lacks: ["shower"] });
expect("breakfast asks what kind, then returns to the routine", screen(normal, ["c_routine", "c_breakfast"], "08:10"), { title: "Morning routine · Breakfast", has: ["bf_quick", "bf_proper"] });
expect("after breakfast the routine carries on without it", screen(normal, ["c_routine", "c_breakfast", "bf_quick"], "08:10"), { title: "Morning routine", has: ["shower"], lacks: ["c_breakfast", "bf_quick"] });
expect("mindful practice opens practices", screen(normal, ["c_mindful"], "08:10"), { has: ["mi_breathe", "mi_meditate", "mi_grateful"] });
expect("work opens kinds of work, deep work asks how long", screen(normal, ["c_work", "w_deep"], "08:10"), { has: ["dw_25", "dw_50"] });
expect("errands lead to shopping, which leads to kinds of shopping", screen(normal, ["c_errands", "e_shop"], "08:10"), { offers: ["sh_groc", "sh_clothes", "sh_thrift", "sh_browse"] });
expect("responsibilities lead to personal, which leads to taxes", screen(normal, ["c_resp", "r_personal"], "08:10"), { has: ["rp_taxes"] });
expect("after deep work: a break", screen(normal, ["c_work", "w_deep", "dw_25"], "08:10"), { has: ["break_5"] });
expect("after writing: read it back", screen(normal, ["c_creative", "cr_write"], "08:10"), { has: ["read_back"] });
expect("11:40 before the appointment", screen(normal, [], "11:40"), { title: "Before 12:30", has: ["getting_ready"], offers: ["c_eat", "c_relax"] });
expect("after getting ready, heading out early comes first", screen(normal, ["getting_ready"], "11:40"), { first: "leave_early" });
expect("12:40 during the appointment: one card, head there when it is time", screen(normal, [], "12:40"), { title: "Appointment", count: [1, 1], has: ["leave_now"] });
expect("14:10 afternoon opens with broad choices and More options", screen(normal, [], "14:10"), { title: "Afternoon", has: ["c_work"], offers: ["c_eat", "c_move"], lacks: ["m_walk", "cr_write"] });
expect("14:10 a walk is on offer once you open Movement in daylight", screen(normal, ["c_move"], "14:10"), { offers: ["m_walk"] });
expect("14:10 low energy starts with relaxing, and lying down is in it", screen(low, [], "14:10"), { first: "c_relax" });
expect("14:10 low energy: relaxing offers lying down first", screen(low, ["c_relax"], "14:10"), { first: "rx_lie" });
expect("20:30 night is never empty: wind down, bed, tomorrow", screen(normal, [], "20:30"), { title: "Tonight", count: [2, 4], has: ["c_winddown", "bed_ready"] });
expect("no appointment: 11:40 is still morning", screen(noEvents, [], "11:40"), { title: "Morning" });
expect("evening starts with eating", screen(normal, [], "18:00"), { first: "c_eat", title: "Evening" });
expect("eating opens quick, leftovers, cooking", screen(normal, ["c_eat"], "18:00"), { has: ["ea_quick", "ea_left", "ea_cook"] });
expect("cooking leads to simple or something new, which leads to recipes", screen(normal, ["c_eat", "ea_cook", "ck_new"], "18:00"), { title: "Eating · Cooking · Cooking something new", any: [["rc_risotto"]], lacks: ["ea_quick", "ck_simple"] });
expect("after cooking, dinner is done and the evening carries on", screen(normal, ["c_eat", "ea_cook", "ck_simple"], "18:00"), { lacks: ["c_eat", "ea_quick", "ck_simple"], offers: ["c_relax"] });

// low energy never offers a demanding option anywhere
(function () {
  const hits = [];
  Object.keys(low.nodes).forEach(function (id) { low.nodes[id].cards.forEach(function (c) { if (OPT[c].demanding) { hits.push(c); } }); });
  if (hits.length) { bad("low energy offers demanding options: " + hits.slice(0, 5).join(",")); }
  console.log((hits.length ? "FAIL " : "ok   ") + "low energy never offers a demanding option");
})();

// no screen is ever a dead end: a category with nothing in it is never offered
(function () {
  const dead = [];
  [normal, low, sleep5, sleep9, noEvents].forEach(function (b) {
    Object.keys(b.nodes).forEach(function (id) {
      const n = b.nodes[id];
      if (!n.cards.length && n.type !== "night" && n.facts.some(function (f) { return f.indexOf("in_") === 0; })) { dead.push(id); }
    });
  });
  if (dead.length) { bad("empty screens inside a category: " + dead.slice(0, 3).join(" | ")); }
  console.log((dead.length ? "FAIL " : "ok   ") + "no category opens onto an empty screen");
})();

// "not feeling it": a new set without the option, for the rest of the day
(function () {
  const sess = Planner.session(Sample.context, { energy: "normal" });
  const b = sess.bundle;
  const at = function (t) { return Model.advance(b, { node: b.root }, mins(t), sess.ensure).id; };
  const show = function (id, t) { return Model.advance(b, { node: id }, mins(t), sess.ensure); };
  const ids = function (v) { return v.cards.map(function (x) { return x.id; }); };
  function row(name, ok, detail) { if (!ok) { bad("reject: " + name + " (" + detail + ")"); } console.log((ok ? "ok   " : "FAIL ") + "reject: " + name + "  ->  " + detail); }

  let v = show(sess.reject(at("08:10"), "c_move"), "08:10");
  row("no movement: it is gone and the screen is still full", ids(v).indexOf("c_move") === -1 && ids(v).length >= 3, ids(v).join(","));
  const routine = b.nodes[at("08:10")].children["picked:c_routine"];
  v = show(sess.reject(routine, "shower"), "08:10");
  row("no shower: the rest of the routine is still there", ids(v).indexOf("shower") === -1 && ids(v).indexOf("skincare") !== -1 && v.node.title === "Morning routine", ids(v).join(","));
  const stretch = b.nodes[b.nodes[at("08:10")].children["picked:c_move"]].children["picked:m_stretch"];
  let w = stretch;
  ["st_full", "st_hips", "st_neck", "st_back"].forEach(function (o) { w = sess.reject(w, o); });
  v = show(w, "08:10");
  row("turning down every stretch closes the category", ids(v).length > 0 && ids(v).indexOf("m_stretch") === -1, v.node.title + ": " + ids(v).join(","));
  let night = sess.reject(at("20:30"), "bed_ready");
  const seen = {};
  let id = night;
  for (let i = 0; i < 6; i++) { const x = show(id, "20:30"); x.cards.forEach(function (c) { seen[c.id] = true; }); if (!x.cards.length) { break; } id = x.node.children["picked:" + x.cards[0].id]; }
  row("no bedtime routine: lights out is still reachable", seen.lights_out, Object.keys(seen).join(","));
})();

// the day never runs dry: from every part of the day, picking the first card keeps giving something
(function () {
  const sess = Planner.session(Sample.context, { energy: "normal" });
  const b = sess.bundle;
  const times = [["morning", "08:10", 8], ["before the appointment", "11:40", 4], ["the appointment", "12:40", 2], ["afternoon", "14:10", 8], ["evening", "18:00", 8], ["night", "20:30", 3]];
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
  ["bed_ready", "lights_out"].forEach(function (p) {
    const v = Model.advance(b, { node: id }, mins("20:30"), sess.ensure);
    if (v.cards.map(function (x) { return x.id; }).indexOf(p) === -1) { bad("bedtime: " + p + " is not on offer"); return; }
    id = v.node.children["picked:" + p];
  });
  const last = Model.advance(b, { node: id }, mins("20:30"), sess.ensure);
  const ok = !last.cards.length && last.node && last.node.quiet;
  if (!ok) { bad("after lights out the evening should be done"); }
  console.log((ok ? "ok   " : "FAIL ") + "after lights out the day is done  ->  " + (last.node ? last.node.quiet : ""));
})();

// sleep: a gentler plan after about 5 hours, the ordinary one at 7, more room at 9
(function () {
  const rows = [];
  function row(name, ok, detail) { if (!ok) { bad("sleep: " + name + " (" + detail + ")"); } rows.push((ok ? "ok   " : "FAIL ") + name + "  ->  " + detail); }
  const hitsDemanding = function (b) { const h = []; Object.keys(b.nodes).forEach(function (id) { b.nodes[id].cards.forEach(function (x) { if (OPT[x].demanding) { h.push(x); } }); }); return h; };
  const d5 = hitsDemanding(sleep5);
  row("5 hours: nothing demanding is offered anywhere", d5.length === 0, d5.length ? d5.slice(0, 3).join(",") : "none");
  const a5 = screen(sleep5, [], "14:10").cards;
  row("5 hours: the afternoon starts with relaxing", a5[0] === "c_relax", a5.join(","));
  const m9 = screen(sleep9, ["c_work", "w_deep"], "08:10");
  row("9 hours: deep work is on offer", m9.cards.indexOf("dw_50") !== -1, m9.cards.join(","));
  const m5 = screen(sleep5, ["c_work"], "08:10");
  row("5 hours: work offers no deep work", m5.cards.indexOf("w_deep") === -1, m5.cards.join(","));
  const m7 = screen(sleep7, ["c_move"], "08:10");
  row("7 hours: the same morning as the default plan", JSON.stringify(m7.cards) === JSON.stringify(screen(normal, ["c_move"], "08:10").cards) && Object.keys(sleep7.nodes).length === Object.keys(normal.nodes).length, m7.cards.join(","));
  const same = JSON.stringify(screen(lowSleep9, [], "14:10").cards) === JSON.stringify(screen(normal, [], "14:10").cards);
  row("low energy after 9 hours of sleep is an ordinary day", same, screen(lowSleep9, [], "14:10").cards.join(","));
  const avg = function (b) { let t = 0, k = 0; Object.keys(b.nodes).forEach(function (id) { const n = b.nodes[id].show; if (n) { t += n; k++; } }); return t / k; };
  row("fewer cards a screen after a short night", avg(sleep5) < avg(normal), avg(sleep5).toFixed(2) + " < " + avg(normal).toFixed(2) + " cards a screen");
  rows.forEach(function (r) { console.log(r); });
})();

// every block opens on three or four broad cards (the appointment itself has one), with more waiting below
(function () {
  const rows = [];
  let id = normal.root;
  while (id) {
    const n = normal.nodes[id];
    const want = n.type === "during_event" ? [1, 1] : [3, 4];
    if (n.show < want[0] || n.show > want[1]) { bad("first screen of " + n.title + " shows " + n.show + " cards"); }
    rows.push(n.title + " " + n.show);
    id = n.children.expired;
  }
  const ok = !problems.some(function (m) { return m.indexOf("first screen of") === 0; });
  console.log((ok ? "ok   " : "FAIL ") + "each block opens on three or four cards  ->  " + rows.join(", "));
})();

// the playful category turns up some days and not others
(function () {
  const o = OPT.c_playful, problems2 = [];
  let days = 0;
  for (let d = 1; d <= 30; d++) {
    const day = "2026-12-" + String(d).padStart(2, "0");
    if (["morning", "afternoon", "evening"].some(function (blk) { return Planner.hash(day + "|" + blk + "|" + o.id) % 100 < Math.round(o.chance * 100); })) { days++; }
  }
  if (days < 10 || days > 30) { problems2.push("turns up on " + days + " of 30 days"); }
  let found = false;
  Object.keys(normal.nodes).forEach(function (id) { if (normal.nodes[id].cards.indexOf("c_playful") !== -1) { found = true; } });
  if (!found) { problems2.push("never offered on the sample day"); }
  problems2.forEach(function (m) { bad("playful: " + m); });
  console.log((problems2.length ? "FAIL " : "ok   ") + "something playful turns up some days (" + days + " of 30)");
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
