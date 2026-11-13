"use strict";
// Checks fixtures/sample-day.json against the rules in MODEL.md.
// The "which node is current" logic comes from js/model.js, the same file the web app uses.
const fs = require("fs");
const path = require("path");
const Model = require(path.join(__dirname, "..", "js", "model.js"));

const file = process.argv[2] || path.join(__dirname, "..", "fixtures", "sample-day.json");
const day = JSON.parse(fs.readFileSync(file, "utf8"));
const nodes = day.nodes;
const bank = day.options;
const problems = [];
function bad(msg) { problems.push(msg); }
const mins = Model.mins;

const KINDS = ["routine", "variation", "wild", "checklist", "quiet", "flirty", "info"];
const PRAISE = /great job|well done|good job|proud of you|amazing|you did it|nailed it|awesome/i;

function withWeather(ctx, sky) {
  if (!sky) { return ctx; }
  return Object.assign({}, ctx, { weather: [{ from: "00:00", to: "23:59", sky: sky }] });
}

function resolve(now, state, weatherOverride) {
  const v = Model.advance(day, { node: day.root, enterAt: 0 }, mins(now), withWeather(day.context, weatherOverride), state);
  return { id: v.id, cards: v.cards.map(function (c) { return c.id; }) };
}

if (!nodes[day.root]) { bad("root " + day.root + " does not exist"); }
const seenCards = {};
Object.keys(nodes).forEach(function (id) {
  const n = nodes[id];
  const where = "node " + id;
  if (!n.title) { bad(where + ": missing title"); }
  if (mins(n.window[1]) <= mins(n.window[0])) { bad(where + ": window ends before it starts"); }
  if (n.cards.length < 1 || n.cards.length > 4) { bad(where + ": needs 1 to 4 cards, has " + n.cards.length); }
  const all = n.cards.slice();
  (n.variants || []).forEach(function (v) {
    if (v.cards.length < 1 || v.cards.length > 4) { bad(where + ": variant needs 1 to 4 cards"); }
    v.cards.forEach(function (c) { all.push(c); });
  });
  all.forEach(function (c) {
    if (seenCards[c.id]) { bad("card id " + c.id + " used twice"); }
    seenCards[c.id] = true;
    if (!bank[c.option]) { bad(where + ": card " + c.id + " uses unknown option " + c.option); }
    if (KINDS.indexOf(c.tags.kind) === -1) { bad(where + ": card " + c.id + " has unknown kind " + c.tags.kind); }
    if (PRAISE.test(c.text)) { bad(where + ": card " + c.id + " reads as praise: " + c.text); }
  });
  if (n.cards.filter(function (c) { return c.tags.kind === "flirty"; }).length > 1) { bad(where + ": more than one flirty card"); }
  if (!("expired" in n.children)) { bad(where + ": missing 'expired' child (inaction needs an outcome)"); }
  if (!("picked:*" in n.children)) { bad(where + ": missing 'picked:*' child"); }
  if (n.reroll && !n.children.reroll) { bad(where + ": reroll is on but there is no 'reroll' child"); }
  if (!n.reroll && n.children.reroll) { bad(where + ": has a 'reroll' child but reroll is off"); }
  Object.keys(n.children).forEach(function (k) {
    const t = n.children[k];
    if (t !== null && !nodes[t]) { bad(where + ": child " + k + " points to missing node " + t); }
  });
  if (n.on_invalid && !nodes[n.on_invalid]) { bad(where + ": on_invalid points to missing node " + n.on_invalid); }
});

const reach = {};
(function walk(id) {
  if (!id || reach[id] || !nodes[id]) { return; }
  reach[id] = true;
  const n = nodes[id];
  Object.keys(n.children).forEach(function (k) { walk(n.children[k]); });
  if (n.on_invalid) { walk(n.on_invalid); }
})(day.root);
Object.keys(nodes).forEach(function (id) { if (!reach[id]) { bad("node " + id + " is unreachable from root"); } });

let chainId = day.root;
let prevEnd = null;
let flirtyOnChain = 0;
const chainSeen = {};
while (chainId) {
  if (chainSeen[chainId]) { bad("expired chain loops at " + chainId); break; }
  chainSeen[chainId] = true;
  const n = nodes[chainId];
  if (!n) { bad("expired chain points to missing node " + chainId); break; }
  if (prevEnd !== null && mins(n.window[0]) !== prevEnd) { bad("expired chain gap before " + chainId + " (" + n.window[0] + " vs " + prevEnd + " minutes)"); }
  prevEnd = mins(n.window[1]);
  flirtyOnChain += n.cards.filter(function (c) { return c.tags.kind === "flirty"; }).length;
  chainId = n.children.expired;
}
if (prevEnd !== null && prevEnd < mins("23:59")) { bad("expired chain ends before the day does"); }
if (flirtyOnChain > 2) { bad("more than 2 flirty cards on the default path"); }

day.scenarios.forEach(function (s) {
  const r = resolve(s.now, s.state, s.weather_override);
  if (r.id !== s.expect) { bad("scenario '" + s.name + "': expected " + s.expect + ", got " + r.id); }
  if (s.expect_first_card && r.cards[0] !== s.expect_first_card) {
    bad("scenario '" + s.name + "': expected first card " + s.expect_first_card + ", got " + r.cards[0]);
  }
  console.log((r.id === s.expect ? "ok   " : "FAIL ") + s.now + "  " + s.name + "  ->  " + r.id + "  [" + r.cards.join(", ") + "]");
});

console.log("");
console.log(Object.keys(nodes).length + " nodes, " + Object.keys(seenCards).length + " cards, " + Object.keys(bank).length + " options");
if (problems.length) {
  console.log("\n" + problems.length + " problem(s):");
  problems.forEach(function (p) { console.log(" - " + p); });
  process.exit(1);
}
console.log("all checks passed");
