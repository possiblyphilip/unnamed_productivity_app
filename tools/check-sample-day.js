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

// follow a list of picks from the first screen, then ask what is current at a given time
function after(bundle, picks, now) {
  let id = bundle.root;
  picks.forEach(function (p) {
    const next = bundle.nodes[id].children["picked:" + p];
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
checkTree("all rain", allRain);

const list = function (r) { return r.cards.join(",") || "(quiet: " + r.node.quiet + ")"; };
const tests = [
  ["08:10 first screen", after(normal, [], "08:10"), "coffee_window,eat_first,stretch_shower"],
  ["after coffee", after(normal, ["coffee_window"], "08:10"), "eat_first,stretch_shower,write_25,putoff_ten"],
  ["after shower: dressing comes next, no perfume yet", after(normal, ["stretch_shower"], "08:10"), "coffee_window,eat_first,get_dressed"],
  ["after shower and dressing", after(normal, ["stretch_shower", "get_dressed"], "08:10"), "coffee_window,eat_first,perfume,market_flowers"],
  ["after the market walk: coffee and eggs are gone, a croissant is next", after(normal, ["stretch_shower", "get_dressed", "market_flowers"], "08:10"), "croissant,flowers_water,perfume"],
  ["after the croissant: fed and caffeinated, so writing opens up", after(normal, ["stretch_shower", "get_dressed", "market_flowers", "croissant"], "08:10"), "flowers_water,write_25,putoff_ten,two_emails"],
  ["reroll after coffee shows the next set", (function () {
    const n = normal.nodes[normal.nodes[normal.root].children["picked:coffee_window"]];
    return { cards: normal.nodes[n.children.reroll].cards, node: n };
  })(), "two_emails,tidy_surface,sketch_15,read_20"],
  ["11:40 before the appointment", after(normal, [], "11:40"), "eat_before_out,bag_keys,getting_ready"],
  ["after getting ready: leaving early is next", after(normal, [], "11:40").node && (function () {
    const n = normal.nodes[Model.advance(normal, { node: normal.root }, mins("11:40")).id];
    const nx = normal.nodes[n.children["picked:getting_ready"]];
    return { cards: nx.cards, node: nx };
  })(), "eat_before_out,bag_keys,leave_early"],
  ["12:40 during the appointment", after(normal, [], "12:40"), "directions"],
  ["14:10 dry afternoon", after(normal, [], "14:10"), "write_25,sketch_15,park_walk,tea_window"],
  ["14:10 with rain all day has no park walk", after(allRain, [], "14:10"), "write_25,sketch_15,tea_window,walk_ten"],
  ["14:10 low energy starts with lying down", after(low, [], "14:10"), "lie_down_20,tea_window,walk_ten,read_20"],
  ["20:30 night is quiet", after(normal, [], "20:30"), ""],
  ["no appointment: 11:40 is still morning", after(noEvents, [], "11:40"), "coffee_window,eat_first,stretch_shower"]
];
tests.forEach(function (t) {
  const got = t[1].cards.join(",");
  const ok = got === t[2];
  if (!ok) { bad("test '" + t[0] + "': expected [" + t[2] + "], got [" + got + "]"); }
  console.log((ok ? "ok   " : "FAIL ") + t[0] + "  ->  " + (got || "(quiet)"));
});
const titles = [
  ["11:40", normal, "Before 12:30"], ["12:40", normal, "Appointment"], ["14:10", normal, "Afternoon"], ["11:40", noEvents, "Morning"]
];
titles.forEach(function (t) {
  const got = after(t[1], [], t[0]).title;
  if (got !== t[2]) { bad("title at " + t[0] + ": expected " + t[2] + ", got " + got); }
  console.log((got === t[2] ? "ok   " : "FAIL ") + "title at " + t[0] + "  ->  " + got);
});

// the lazy session the app uses: always something to pick deep into the morning, and progress survives a replan
(function () {
  const sess = Planner.session(Sample.context, { energy: "normal" });
  const b = sess.bundle;
  let id = b.root;
  const path = ["stretch_shower", "get_dressed", "market_flowers", "croissant", "write_25", "flowers_water", "perfume", "two_emails"];
  path.forEach(function (p) {
    const v = Model.advance(b, { node: id }, mins("08:10"), sess.ensure);
    if (!v.node || v.cards.map(function (x) { return x.id; }).indexOf(p) === -1) { bad("lazy: " + p + " is not on offer after " + (path.slice(0, path.indexOf(p)).join(", ") || "nothing")); return; }
    id = v.node.children["picked:" + p];
  });
  const end = Model.advance(b, { node: id }, mins("08:10"), sess.ensure);
  const ok = end.cards.length > 0;
  if (!ok) { bad("lazy: the morning goes quiet after " + path.length + " picks"); }
  console.log((ok ? "ok   " : "FAIL ") + "eight picks deep in the morning there is still something to choose  ->  " + (end.cards.map(function (x) { return x.id; }).join(",") || "(quiet)"));

  const low = Planner.session(Sample.context, { energy: "low" });
  const restored = low.restore(id);
  const rv = Model.advance(low.bundle, { node: restored }, mins("08:10"), low.ensure);
  const keep = restored === id && rv.node && rv.node.facts.indexOf("market") !== -1;
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
